// ============================================================
// 变形虫 (Amiba) — NetworkBridge（网络互联宿主 JS 层）
// ============================================================
// 封装 Tauri invoke 调用，为 JSBridge 提供统一的网络 API。
// ============================================================

import { reactive } from 'vue'
import type { DiscoveredPeer, TransportVisibility } from '../types/service'

// ---- 状态 ----

export const peerList = reactive<DiscoveredPeer[]>([])

/** 本机可见性设置 */
export let currentVisibility: TransportVisibility = { lan: true, ble: false }

/** 是否为 Tauri 环境（桌面/Android） */
let isTauri = false

/** 按 serviceId 分组的消息回调 */
const messageCallbacks = new Map<string, Set<(peerId: string, message: any) => void>>()

/** 全局 peer 发现回调（按 serviceId） */
const peerDiscoveredCallbacks = new Map<string, Set<(peer: DiscoveredPeer) => void>>()

// ---- 初始化 ----

export async function initNetworkBridge(): Promise<void> {
  // 检测 Tauri 环境
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    isTauri = true

    // 获取当前可见性
    try {
      currentVisibility = await invoke<TransportVisibility>('network_get_visibility')
    } catch { /* 使用默认值 */ }
  } catch {
    isTauri = false
    console.log('[NetworkBridge] 非 Tauri 环境，网络功能不可用')
  }

  // 监听 Tauri 事件
  if (isTauri) {
    await setupEventListeners()
  }
}

async function setupEventListeners() {
  try {
    const { listen } = await import('@tauri-apps/api/event')

    await listen<{ id: string; name: string; transport: string; address?: string }>(
      'network:peer-discovered',
      (event) => {
        const peer: DiscoveredPeer = {
          id: event.payload.id,
          name: event.payload.name,
          transport: event.payload.transport as 'lan' | 'ble',
          address: event.payload.address || '',
          lastSeen: new Date().toISOString(),
        }
        // 更新响应式列表
        const existing = peerList.findIndex((p) => p.id === peer.id)
        if (existing >= 0) {
          peerList[existing] = peer
        } else {
          peerList.push(peer)
        }
        // 通知所有回调
        for (const cbs of peerDiscoveredCallbacks.values()) {
          for (const cb of cbs) cb(peer)
        }
      }
    )

    await listen<{ id: string; transport: string }>(
      'network:peer-connected',
      (event) => {
        const idx = peerList.findIndex((p) => p.id === event.payload.id)
        if (idx >= 0) {
          peerList[idx] = { ...peerList[idx], lastSeen: new Date().toISOString() }
        }
      }
    )

    await listen<{ id: string; transport: string }>(
      'network:peer-disconnected',
      (_event) => {
        // peer stays in list but marked disconnected
      }
    )

    await listen<{ peerId: string; message: any }>(
      'network:message-received',
      (event) => {
        for (const cbs of messageCallbacks.values()) {
          for (const cb of cbs) {
            try { cb(event.payload.peerId, event.payload.message) } catch { /* ignore */ }
          }
        }
      }
    )
  } catch (e) {
    console.warn('[NetworkBridge] 事件监听初始化失败:', e)
  }
}

// ---- Public API ----

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
    } catch { /* keep cached */ }
  }
  return { ...currentVisibility }
}

export async function startDiscovery(transport: string): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面/移动端可用')
  const { invoke } = await import('@tauri-apps/api/core')
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

export async function connect(peerId: string): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面/移动端可用')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('network_connect', { peerId })
}

export async function disconnect(peerId: string): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面/移动端可用')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('network_disconnect', { peerId })
}

export async function send(peerId: string, message: any): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面/移动端可用')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('network_send', { peerId, message })
}

// ---- Callback registration (per serviceId) ----

export function onMessage(
  serviceId: string,
  callback: (peerId: string, message: any) => void
): () => void {
  if (!messageCallbacks.has(serviceId)) {
    messageCallbacks.set(serviceId, new Set())
  }
  messageCallbacks.get(serviceId)!.add(callback)
  return () => {
    messageCallbacks.get(serviceId)?.delete(callback)
  }
}

export function onPeerDiscovered(
  serviceId: string,
  callback: (peer: DiscoveredPeer) => void
): () => void {
  if (!peerDiscoveredCallbacks.has(serviceId)) {
    peerDiscoveredCallbacks.set(serviceId, new Set())
  }
  peerDiscoveredCallbacks.get(serviceId)!.add(callback)
  return () => {
    peerDiscoveredCallbacks.get(serviceId)?.delete(callback)
  }
}

/** 清理某个服务的所有回调 */
export function clearServiceCallbacks(serviceId: string): void {
  messageCallbacks.delete(serviceId)
  peerDiscoveredCallbacks.delete(serviceId)
}
