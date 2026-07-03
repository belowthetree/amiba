// ============================================================
// 变形虫 (Amiba) — NetworkBridge v3
// ============================================================
// 借鉴 HuLa 架构：
//   - Web Worker 管理 WebSocket 连接
//   - 事件总线分发消息
//   - 响应式 peerList
//   - Tauri invoke 用于 UDP 发现 + 获取 WS 端口
//   - 接收 Tauri event 转发到 iframe
// ============================================================

import { reactive } from 'vue'
import type { DiscoveredPeer, TransportVisibility } from '../types/service'
import { networkWorker } from './network-worker-init'

// ---- 状态 ----

export const peerList = reactive<DiscoveredPeer[]>([])
export let currentVisibility: TransportVisibility = { lan: true, ble: false }

let isTauri = false
let cachedDeviceId = ''

// ---- 事件总线（按 serviceId 分组） ----

type EventHandler = (...args: any[]) => void
const eventBus = new Map<string, Set<EventHandler>>()

function emit(event: string, ...args: any[]) {
  const handlers = eventBus.get(event)
  if (handlers) for (const h of handlers) h(...args)
}

export function onEvent(event: string, handler: EventHandler): () => void {
  if (!eventBus.has(event)) eventBus.set(event, new Set())
  eventBus.get(event)!.add(handler)
  return () => eventBus.get(event)?.delete(handler)
}

/** 获取本机设备 ID（缓存，首次从 Rust 获取） */
async function getMyDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      cachedDeviceId = await invoke<string>('network_get_device_id')
    } catch {
      cachedDeviceId = 'web-' + Math.random().toString(36).slice(2, 10)
    }
  } else {
    cachedDeviceId = 'web-' + Math.random().toString(36).slice(2, 10)
  }
  return cachedDeviceId
}

// ---- 初始化 ----

export async function initNetworkBridge(): Promise<void> {
  try {
    await import('@tauri-apps/api/core')
    isTauri = true
  } catch {
    isTauri = false
    console.log('[NetworkBridge] 非 Tauri 环境')
    return
  }

  // 预加载设备 ID
  getMyDeviceId()

  // 监听 Worker 消息
  networkWorker.addEventListener('message', (e: MessageEvent) => {
    const { type, peerId, data, msg } = e.data
    switch (type) {
      case 'open':
        updatePeerConnected(peerId, true)
        emit('peer-connected', peerId)
        break
      case 'message':
        dispatchIncomingMessage(peerId, typeof data === 'string' ? data : JSON.stringify(data))
        break
      case 'close':
        updatePeerConnected(peerId, false)
        emit('peer-disconnected', peerId)
        break
      case 'error':
        console.warn(`[NetworkBridge] ${peerId}: ${msg}`)
        break
    }
  })

  // 监听 Tauri 发现事件
  try {
    const { listen } = await import('@tauri-apps/api/event')

    await listen<{ id: string; name: string; transport: string; address?: string }>(
      'network:peer-discovered',
      (event) => {
        const existing = peerList.findIndex((p) => p.id === event.payload.id)
        if (existing >= 0) {
          peerList[existing] = {
            ...peerList[existing],
            lastSeen: new Date().toISOString(),
            address: event.payload.address || peerList[existing].address,
          }
        } else {
          peerList.push({
            id: event.payload.id,
            name: event.payload.name,
            transport: event.payload.transport as 'lan' | 'ble',
            address: event.payload.address || '',
            lastSeen: new Date().toISOString(),
          })
        }
        emit('peer-discovered', event.payload)
      }
    )

    await listen<{ id: string }>(
      'network:peer-lost',
      (event) => {
        const idx = peerList.findIndex((p) => p.id === event.payload.id)
        if (idx >= 0) peerList.splice(idx, 1)
        emit('peer-lost', event.payload.id)
      }
    )

    // 监听 Rust → 前端的消息转发（v3 新增）
    await listen<{ peerId: string; message: string }>(
      'network:message-received',
      (event) => {
        dispatchIncomingMessage(event.payload.peerId, event.payload.message)
      }
    )

    await listen<{ peerId: string }>(
      'network:peer-connected',
      (event) => {
        updatePeerConnected(event.payload.peerId, true)
        emit('peer-connected', event.payload.peerId)
      }
    )

    await listen<{ peerId: string }>(
      'network:peer-disconnected',
      (event) => {
        updatePeerConnected(event.payload.peerId, false)
        emit('peer-disconnected', event.payload.peerId)
      }
    )
  } catch (e) {
    console.warn('[NetworkBridge] Tauri event 监听失败:', e)
  }
}

// ---- 可见性 ----

export async function setVisibility(vis: TransportVisibility): Promise<void> {
  currentVisibility = vis
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('network_set_visibility', { visibility: vis })
  }
}

export async function getVisibility(): Promise<TransportVisibility> {
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      currentVisibility = await invoke<TransportVisibility>('network_get_visibility')
    } catch { /* cached */ }
  }
  return { ...currentVisibility }
}

// ---- 发现 ----

export async function startDiscovery(transport: string): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面端可用')
  const { invoke } = await import('@tauri-apps/api/core')
  // 先获取自己的 WS 端口
  const wsPort = await invoke<number>('network_get_ws_port').catch(() => 0)
  // 更新已有 peer 的 address（从 UDP 广播中获取的）
  await invoke('network_start_discovery', { transport })
}

export async function stopDiscovery(transport: string): Promise<void> {
  if (!isTauri) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('network_stop_discovery', { transport })
  } catch { /* ignore */ }
}

export function getVisibleDevices(): DiscoveredPeer[] {
  // 深拷贝去掉 Vue reactive proxy，否则 postMessage 序列化失败
  return JSON.parse(JSON.stringify(peerList))
}

// ---- 连接（通过 Worker） ----

export async function connect(peerId: string): Promise<void> {
  const peer = peerList.find((p) => p.id === peerId)
  if (!peer || !peer.address) throw new Error('设备地址未知')
  // 去除可能的空白字符，确保 URL 合法
  const address = peer.address.trim()
  if (!address.includes(':')) throw new Error('设备地址格式无效: ' + address)
  const url = `ws://${address}`
  console.log('[NetworkBridge] 连接:', url)
  const myPeerId = await getMyDeviceId()

  // 等待 Worker 确认连接（WebSocket open 事件），10s 超时
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsub()
      reject(new Error('连接超时（10s）'))
    }, 10000)

    const unsub = onEvent('peer-connected', (id: string) => {
      if (id === peerId) {
        clearTimeout(timeout)
        unsub()
        console.log('[NetworkBridge] 连接已确认:', peerId)
        resolve()
      }
    })

    networkWorker.postMessage({ type: 'connect', peerId, url, myPeerId })
  })
}

export async function disconnect(peerId: string): Promise<void> {
  networkWorker.postMessage({ type: 'disconnect', peerId })
}

export async function send(peerId: string, message: any): Promise<void> {
  networkWorker.postMessage({ type: 'send', peerId, message })
}

// ---- 协议通信 ----

/** 发送协议消息（fire-and-forget 或带 requestId 的 RPC 请求） */
export async function sendProtocol(
  peerId: string,
  protocol: string,
  data: any,
  requestId?: string
): Promise<void> {
  const msg: any = { type: 'protocol', protocol, data }
  if (requestId) msg.requestId = requestId
  networkWorker.postMessage({ type: 'send', peerId, message: msg })
}

/** 发送协议响应 */
export async function sendProtocolResponse(
  peerId: string,
  requestId: string,
  data?: any,
  error?: string
): Promise<void> {
  const msg: any = { type: 'protocol-response', requestId }
  if (data !== undefined) msg.data = data
  if (error) msg.error = error
  networkWorker.postMessage({ type: 'send', peerId, message: msg })
}

/** 解析收到的消息，路由到正确的协议事件 */
function dispatchIncomingMessage(peerId: string, raw: string) {
  try {
    const msg = JSON.parse(raw)
    if (msg && msg.type === 'protocol') {
      emit('protocol-message', {
        peerId,
        protocol: msg.protocol,
        data: msg.data,
        requestId: msg.requestId || undefined,
      })
      return
    }
    if (msg && msg.type === 'protocol-response') {
      emit('protocol-response', {
        requestId: msg.requestId,
        data: msg.data,
        error: msg.error,
      })
      return
    }
  } catch { /* not JSON, fall through to raw message */ }

  // Default: emit as raw message (backward compatible)
  emit('message-received', peerId, raw)
}

// ---- 内部 ----

function updatePeerConnected(id: string, connected: boolean) {
  const idx = peerList.findIndex((p) => p.id === id)
  if (idx >= 0) {
    peerList[idx] = { ...peerList[idx], lastSeen: new Date().toISOString() }
  }
}

/** 清理所有 Worker 连接（服务卸载时调用） */
export function clearServiceCallbacks(_serviceId: string): void {
  // Worker 连接是全局的，按 serviceId 清理事件回调
  // 实际清理由 service-container 的 onUnmounted 处理
}
