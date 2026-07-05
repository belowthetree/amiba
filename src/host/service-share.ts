// ============================================================
// 变形虫 (Amiba) — ServiceShare 局域网服务分享引擎
// ============================================================
// 基于 NetworkSession 的 JSON 协议，支持大文件分块传输。
// 事件驱动的 UI 集成接口。
// ============================================================

import { connect, createInboundSession, startListening, stopListening, onEvent, peerList } from './network-bridge'
import { getServicePackage, getUserServices, storeServicePackage, registerService } from './registry'
import { NetworkSession } from './network-session'
import type { ServiceManifest, ServicePackage } from '../types/service'

const SHARE_SERVICE_KEY = 'amiba.service-share'
const CHUNK_SIZE = 64 * 1024 // 64KB

// ---- 类型 ----

export interface ShareEvent {
  event: 'progress' | 'complete' | 'error' | 'declined' | 'request' | 'chunk-progress'
  message?: string
  percent?: number
  manifest?: ServiceManifest
  peerId?: string
  peerName?: string
  sessionId?: string
}

export type ShareEventHandler = (evt: ShareEvent) => void

// ---- 状态 ----

let handlers = new Set<ShareEventHandler>()
let currentSession: NetworkSession | null = null
let listeningUnsubs: (() => void)[] = []
let isListening = false
let pendingRequest: {
  session: NetworkSession
  manifest: ServiceManifest
  totalChunks: number
  peerName: string
} | null = null

// ---- 事件 ----

function emit(evt: ShareEvent) {
  for (const h of handlers) h(evt)
}

export function onShareEvent(handler: ShareEventHandler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function getPendingRequest() {
  return pendingRequest
}

// ---- 发送端 ----

export async function sendService(serviceId: string, peerId: string): Promise<void> {
  try {
    emit({ event: 'progress', message: '正在获取服务数据...' })

    const pkg = await getServicePackage(serviceId)
    if (!pkg) {
      emit({ event: 'error', message: `服务 "${serviceId}" 不存在` })
      return
    }

    const payload = JSON.stringify(pkg)
    const chunks = splitChunks(payload)

    emit({ event: 'progress', message: '正在连接...' })

    currentSession = await connect(peerId, SHARE_SERVICE_KEY)
    console.log('[ServiceShare] 已连接:', currentSession.id.slice(0, 8), 'peer:', peerId.slice(0, 8))

    // 发送分享请求
    const request = {
      type: 'share-request',
      serviceId: pkg.manifest.id,
      manifest: pkg.manifest,
      totalChunks: chunks.length,
    }
    await currentSession.send(JSON.stringify(request))
    console.log('[ServiceShare] 请求已发送, chunks:', chunks.length)

    // 等待接收方回应
    const response = await waitForMessage(currentSession, 'share-response', 30_000)
    if (!response) {
      emit({ event: 'error', message: '等待对方回应超时' })
      await currentSession.close()
      currentSession = null
      return
    }

    if (!response.accepted) {
      emit({ event: 'declined', message: response.reason || '对方拒绝了分享请求' })
      await currentSession.close()
      currentSession = null
      return
    }

    // 逐块发送
    emit({ event: 'progress', message: '正在传输...', percent: 0 })
    for (let i = 0; i < chunks.length; i++) {
      const chunk = {
        type: 'share-chunk',
        index: i,
        total: chunks.length,
        data: chunks[i],
      }
      await currentSession.send(JSON.stringify(chunk))

      // 等待 ACK
      const ack = await waitForMessage(currentSession, 'chunk-ack', 15_000)
      if (!ack || ack.index !== i) {
        // 重试一次
        await currentSession.send(JSON.stringify(chunk))
        const retryAck = await waitForMessage(currentSession, 'chunk-ack', 15_000)
        if (!retryAck || retryAck.index !== i) {
          emit({ event: 'error', message: `第 ${i + 1} 块传输失败` })
          await currentSession.close()
          currentSession = null
          return
        }
      }

      const pct = Math.round(((i + 1) / chunks.length) * 100)
      emit({ event: 'chunk-progress', percent: pct, message: `${i + 1}/${chunks.length}` })
    }

    // 发送完成信号
    await currentSession.send(JSON.stringify({ type: 'share-complete' }))

    emit({ event: 'complete', message: '分享完成' })
    await currentSession.close()
    currentSession = null
  } catch (e: any) {
    console.error('[ServiceShare] 发送失败:', e)
    emit({ event: 'error', message: e.message || '发送失败' })
    if (currentSession) {
      await currentSession.close().catch(() => {})
      currentSession = null
    }
  }
}

// ---- 接收端 ----

export async function startReceiving(): Promise<void> {
  if (isListening) return
  isListening = true

  await startListening(SHARE_SERVICE_KEY)
  console.log('[ServiceShare] 开始监听分享请求')

  // 监听新 session（由 Rust 层自动创建的上行连接）
  const unsub = onEvent('session-created', async (info: { sessionId: string; peerId: string; peerName: string; direction?: string }) => {
    if (info.direction !== 'inbound') return

    console.log('[ServiceShare] 收到入站 session:', info.sessionId.slice(0, 8), '来自:', info.peerName)
    const session = createInboundSession(info)

    // 等待第一个消息（share-request）
    const msg = await waitForSessionMessage(session, 15_000)
    if (!msg) {
      console.log('[ServiceShare] 未收到 share-request，关闭')
      await session.close()
      return
    }

    try {
      const request = JSON.parse(msg)
      if (request.type !== 'share-request') {
        console.log('[ServiceShare] 非分享消息:', request.type)
        await session.close()
        return
      }

      console.log('[ServiceShare] 收到分享请求:', request.manifest.name, 'chunks:', request.totalChunks)

      pendingRequest = {
        session,
        manifest: request.manifest,
        totalChunks: request.totalChunks,
        peerName: info.peerName,
      }

      emit({
        event: 'request',
        manifest: request.manifest,
        peerId: info.peerId,
        peerName: info.peerName,
        sessionId: session.id,
      })
    } catch {
      await session.close()
    }
  })

  listeningUnsubs.push(unsub)
}

export function acceptShare(): void {
  if (!pendingRequest) return

  const { session, totalChunks } = pendingRequest
  const chunks: string[] = new Array(totalChunks)
  let receivedCount = 0

  session.send(JSON.stringify({ type: 'share-response', accepted: true }))

  session.on('message', (msg: string) => {
    try {
      const { type, index, data } = JSON.parse(msg)
      if (type === 'share-chunk') {
        chunks[index] = data
        receivedCount++
        session.send(JSON.stringify({ type: 'chunk-ack', index }))
        const pct = Math.round((receivedCount / totalChunks) * 100)
        emit({ event: 'chunk-progress', percent: pct, message: `${receivedCount}/${totalChunks}` })
      } else if (type === 'share-complete') {
        reassembleAndInstall(chunks)
        session.close()
        pendingRequest = null
      }
    } catch { /* ignore bad messages */ }
  })
}

export async function declineShare(): Promise<void> {
  if (!pendingRequest) return
  await pendingRequest.session.send(JSON.stringify({ type: 'share-response', accepted: false, reason: '用户拒绝' }))
  await pendingRequest.session.close()
  pendingRequest = null
}

export async function stopReceiving(): Promise<void> {
  if (!isListening) return
  isListening = false
  for (const unsub of listeningUnsubs) unsub()
  listeningUnsubs = []
  await stopListening(SHARE_SERVICE_KEY)
  console.log('[ServiceShare] 停止监听')
}

// ---- 内部工具 ----

function splitChunks(data: string): string[] {
  const chunks: string[] = []
  let offset = 0
  while (offset < data.length) {
    chunks.push(data.slice(offset, offset + CHUNK_SIZE))
    offset += CHUNK_SIZE
  }
  return chunks
}

function waitForMessage(session: NetworkSession, expectedType: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub()
      resolve(null)
    }, timeoutMs)

    const unsub = session.on('message', (msg: string) => {
      try {
        const data = JSON.parse(msg)
        if (data.type === expectedType) {
          clearTimeout(timer)
          unsub()
          resolve(data)
        }
      } catch { /* skip */ }
    })
  })
}

function waitForSessionMessage(session: NetworkSession, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub()
      resolve(null)
    }, timeoutMs)

    const unsub = session.on('message', (msg: string) => {
      clearTimeout(timer)
      unsub()
      resolve(msg)
    })
  })
}

async function reassembleAndInstall(chunks: string[]): Promise<void> {
  try {
    const payload = chunks.join('')
    const pkg: ServicePackage = JSON.parse(payload)

    console.log('[ServiceShare] 重组完成，准备安装:', pkg.manifest.name)

    await registerService(pkg.manifest, 'downloaded')
    await storeServicePackage(pkg.manifest.id, pkg)

    emit({ event: 'complete', message: `服务 "${pkg.manifest.name}" 已安装` })
  } catch (e: any) {
    console.error('[ServiceShare] 安装失败:', e)
    emit({ event: 'error', message: '安装失败: ' + (e.message || String(e)) })
  }
}
