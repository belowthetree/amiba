// ============================================================
// 变形虫 (Amiba) — NetworkBridge v4
// ============================================================
// UDP 设备发现（保留）+ Session 管理（新）。
// WebSocket 连接由 Rust 层统一管理，前端通过 Tauri invoke/event 交互。
// ============================================================

import { reactive } from 'vue'
import type { DiscoveredPeer, TransportVisibility } from '../types/service'

// ---- 状态 ----

export const peerList = reactive<DiscoveredPeer[]>([])
export let currentVisibility: TransportVisibility = { lan: true, ble: false }

let isTauri = false
let cachedDeviceId = ''

// ---- 事件总线 ----

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

  // 监听 Tauri 事件
  try {
    const { listen } = await import('@tauri-apps/api/event')

    // --- 设备发现 ---
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

    // --- Session 事件（Rust → 前端，Phase 4 完善） ---
    await listen<{ sessionId: string; peerId: string; peerName: string; direction: string }>(
      'network:session-created',
      (event) => emit('session-created', event.payload)
    )
    await listen<{ sessionId: string; message: string }>(
      'network:session-message',
      (event) => emit('session-message', event.payload)
    )
    await listen<{ sessionId: string; reason?: string }>(
      'network:session-closed',
      (event) => emit('session-closed', event.payload)
    )
    await listen<{ sessionId: string; error: string }>(
      'network:session-error',
      (event) => emit('session-error', event.payload)
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
  return JSON.parse(JSON.stringify(peerList))
}

// ---- Session ----

import { NetworkSession } from './network-session'
import { createOutboundSession } from './network-session'
export { NetworkSession }

/** 已创建的 session 注册表 */
export const sessions = new Map<string, NetworkSession>()

/** 发起连接 → 返回 NetworkSession */
export async function connect(peerId: string): Promise<NetworkSession> {
  if (!isTauri) throw new Error('网络功能仅在桌面端可用')
  const session = await createOutboundSession(peerId)
  return session
}

/** 接受外来连接 → 创建被动 NetworkSession */
export function createInboundSession(info: { sessionId: string; peerId: string; peerName: string }): NetworkSession {
  const session = new NetworkSession(info.sessionId, info.peerId, info.peerName)
  sessions.set(session.id, session)
  return session
}
