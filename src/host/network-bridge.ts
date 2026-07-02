// ============================================================
// 变形虫 (Amiba) — NetworkBridge v2
// ============================================================
// 借鉴 HuLa 架构：
//   - Web Worker 管理 WebSocket 连接
//   - 事件总线分发消息
//   - 响应式 peerList
//   - Tauri invoke 只用于 UDP 发现 + 获取 WS 端口
// ============================================================

import { reactive } from 'vue'
import type { DiscoveredPeer, TransportVisibility } from '../types/service'
import { networkWorker } from './network-worker-init'

// ---- 状态 ----

export const peerList = reactive<DiscoveredPeer[]>([])
export let currentVisibility: TransportVisibility = { lan: true, ble: false }

let isTauri = false

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

  // 监听 Worker 消息
  networkWorker.addEventListener('message', (e: MessageEvent) => {
    const { type, peerId, data, msg } = e.data
    switch (type) {
      case 'open':
        updatePeerConnected(peerId, true)
        emit('peer-connected', peerId)
        break
      case 'message':
        emit('message-received', peerId, typeof data === 'string' ? data : JSON.stringify(data))
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
    await listen<{ id: string; name: string; transport: string }>(
      'network:peer-discovered',
      (event) => {
        const existing = peerList.findIndex((p) => p.id === event.payload.id)
        if (existing >= 0) {
          peerList[existing] = { ...peerList[existing], lastSeen: new Date().toISOString() }
        } else {
          peerList.push({
            id: event.payload.id,
            name: event.payload.name,
            transport: event.payload.transport as 'lan' | 'ble',
            address: '',
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
  return [...peerList]
}

// ---- 连接（通过 Worker） ----

export async function connect(peerId: string): Promise<void> {
  const peer = peerList.find((p) => p.id === peerId)
  if (!peer || !peer.address) throw new Error('设备地址未知')
  const url = `ws://${peer.address}`
  networkWorker.postMessage({ type: 'connect', peerId, url })
}

export async function disconnect(peerId: string): Promise<void> {
  networkWorker.postMessage({ type: 'disconnect', peerId })
}

export async function send(peerId: string, message: any): Promise<void> {
  networkWorker.postMessage({ type: 'send', peerId, message })
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
