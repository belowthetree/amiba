// ============================================================
// 变形虫 (Amiba) — SkillShare 局域网技能分享引擎
// ============================================================
// 基于 NetworkSession 的 JSON 分块协议，复用 service-share 的网络基础设施。
// 服务 key: "amiba.skill-share"，分块大小 64KB。
// ============================================================

import { connect, createInboundSession, startListening, stopListening, onEvent } from './network-bridge'
import { NetworkSession } from './network-session'
import { buildSkillPackage, installSkillPackage } from '../ai/skill-packager'
import type { SkillPackage } from '../types/skill-package'
import type { SkillFrontmatter } from '../ai/skill-parser'

const SHARE_SERVICE_KEY = 'amiba.skill-share'
const CHUNK_SIZE = 64 * 1024

// ---- 类型 ----

export interface SkillShareEvent {
  event: 'progress' | 'complete' | 'error' | 'declined' | 'request' | 'chunk-progress'
  message?: string
  percent?: number
  manifest?: SkillFrontmatter
  skillName?: string
  skillSlug?: string
  peerId?: string
  peerName?: string
  sessionId?: string
}

export type SkillShareEventHandler = (evt: SkillShareEvent) => void

// ---- 状态 ----

let handlers = new Set<SkillShareEventHandler>()
let currentSession: NetworkSession | null = null
let listeningUnsubs: (() => void)[] = []
let isListening = false
let pendingRequest: {
  session: NetworkSession
  manifest: SkillFrontmatter
  skillSlug: string
  totalChunks: number
  peerName: string
} | null = null

// ---- 事件 ----

function emit(evt: SkillShareEvent) {
  for (const h of handlers) h(evt)
}

export function onSkillShareEvent(handler: SkillShareEventHandler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function getPendingSkillRequest() {
  return pendingRequest
}

// ---- 发送端 ----

export async function sendSkill(slug: string, peerId: string): Promise<void> {
  try {
    emit({ event: 'progress', message: '正在获取技能数据...' })

    const pkg = await buildSkillPackage(slug)

    const payload = JSON.stringify(pkg)
    const chunks = splitChunks(payload)

    emit({ event: 'progress', message: '正在连接...' })

    currentSession = await connect(peerId, SHARE_SERVICE_KEY)
    console.log('[SkillShare] 已连接:', currentSession.id.slice(0, 8), 'peer:', peerId.slice(0, 8))

    const request = {
      type: 'skill-share-request',
      name: pkg.manifest.name,
      slug: pkg.slug,
      description: pkg.manifest.description,
      totalChunks: chunks.length,
    }
    await currentSession.send(JSON.stringify(request))
    console.log('[SkillShare] 请求已发送, chunks:', chunks.length)

    const response = await waitForMessage(currentSession, 'skill-share-response', 30_000)
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

    emit({ event: 'progress', message: '正在传输...', percent: 0 })
    for (let i = 0; i < chunks.length; i++) {
      const chunk = {
        type: 'skill-share-chunk',
        index: i,
        total: chunks.length,
        data: chunks[i],
      }
      await currentSession.send(JSON.stringify(chunk))

      const ack = await waitForMessage(currentSession, 'skill-chunk-ack', 15_000)
      if (!ack || ack.index !== i) {
        await currentSession.send(JSON.stringify(chunk))
        const retryAck = await waitForMessage(currentSession, 'skill-chunk-ack', 15_000)
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

    await currentSession.send(JSON.stringify({ type: 'skill-share-complete' }))

    emit({ event: 'complete', message: '分享完成' })
    await currentSession.close()
    currentSession = null
  } catch (e: any) {
    console.error('[SkillShare] 发送失败:', e)
    emit({ event: 'error', message: e.message || '发送失败' })
    if (currentSession) {
      await currentSession.close().catch(() => {})
      currentSession = null
    }
  }
}

// ---- 接收端 ----

export async function startReceivingSkills(): Promise<void> {
  if (isListening) return
  isListening = true

  await startListening(SHARE_SERVICE_KEY)
  console.log('[SkillShare] 开始监听技能分享请求')

  const unsub = onEvent('session-created', async (info: { sessionId: string; peerId: string; peerName: string; direction?: string }) => {
    if (info.direction !== 'inbound') return

    console.log('[SkillShare] 收到入站 session:', info.sessionId.slice(0, 8), '来自:', info.peerName)
    const session = createInboundSession(info)

    const msg = await waitForSessionMessage(session, 15_000)
    if (!msg) {
      console.log('[SkillShare] 未收到 skill-share-request，关闭')
      await session.close()
      return
    }

    try {
      const request = JSON.parse(msg)
      if (request.type !== 'skill-share-request') {
        console.log('[SkillShare] 非技能分享消息:', request.type)
        await session.close()
        return
      }

      console.log('[SkillShare] 收到分享请求:', request.name, 'chunks:', request.totalChunks)

      pendingRequest = {
        session,
        manifest: {
          name: request.name,
          description: request.description,
        },
        skillSlug: request.slug,
        totalChunks: request.totalChunks,
        peerName: info.peerName,
      }

      emit({
        event: 'request',
        manifest: { name: request.name, description: request.description },
        skillName: request.name,
        skillSlug: request.slug,
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

export function acceptSkillShare(): void {
  if (!pendingRequest) return

  const { session, totalChunks } = pendingRequest
  const chunks: string[] = new Array(totalChunks)
  let receivedCount = 0

  session.send(JSON.stringify({ type: 'skill-share-response', accepted: true }))

  session.on('message', (msg: string) => {
    try {
      const { type, index, data } = JSON.parse(msg)
      if (type === 'skill-share-chunk') {
        chunks[index] = data
        receivedCount++
        session.send(JSON.stringify({ type: 'skill-chunk-ack', index }))
        const pct = Math.round((receivedCount / totalChunks) * 100)
        emit({ event: 'chunk-progress', percent: pct, message: `${receivedCount}/${totalChunks}` })
      } else if (type === 'skill-share-complete') {
        reassembleAndInstall(chunks)
        session.close()
        pendingRequest = null
      }
    } catch { /* ignore bad messages */ }
  })
}

export async function declineSkillShare(): Promise<void> {
  if (!pendingRequest) return
  await pendingRequest.session.send(JSON.stringify({ type: 'skill-share-response', accepted: false, reason: '用户拒绝' }))
  await pendingRequest.session.close()
  pendingRequest = null
}

export async function stopReceivingSkills(): Promise<void> {
  if (!isListening) return
  isListening = false
  for (const unsub of listeningUnsubs) unsub()
  listeningUnsubs = []
  await stopListening(SHARE_SERVICE_KEY)
  console.log('[SkillShare] 停止监听')
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
    const pkg: SkillPackage = JSON.parse(payload)

    console.log('[SkillShare] 重组完成，准备安装:', pkg.manifest.name)

    const slug = await installSkillPackage(pkg, 'overwrite')
    emit({ event: 'complete', message: `技能 "${pkg.manifest.name}" 已安装`, skillSlug: slug })
  } catch (e: any) {
    console.error('[SkillShare] 安装失败:', e)
    emit({ event: 'error', message: '安装失败: ' + (e.message || String(e)) })
  }
}
