// ============================================================
// 变形虫 (Amiba) — NetworkBridge v4
// ============================================================
// UDP 设备发现（保留）+ Session 管理（新）。
// WebSocket 连接由 Rust 层统一管理，前端通过 Tauri invoke/event 交互。
// ============================================================

import { reactive } from 'vue'
import type { DiscoveredPeer, TransportVisibility } from '../types/service'
import { isTauriRuntime, isHarmonyRuntime } from '../config/platform-bridge'

// ---- 状态 ----

export const peerList = reactive<DiscoveredPeer[]>([])
export let currentVisibility: TransportVisibility = { lan: true, ble: false }

let isTauri = false

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
  // 鸿蒙壳同样提供 network_* 命令族（ArkTS NetworkCommands.ets，协议与 Rust 一致）
  isTauri = isTauriRuntime() || isHarmonyRuntime()
  if (!isTauri) {
    console.log('[NetworkBridge] 非 Tauri 环境')
    return
  }

  // 从持久化存储恢复可见性状态
  try {
    const { settings } = await import('../config/config')
    currentVisibility = { lan: settings.network_lan_visible, ble: false }
    console.log('[NetworkBridge] 恢复可见性:', currentVisibility)
    // 同步到 Rust（Rust 启动默认 lan:true，需覆盖）
    if (!settings.network_lan_visible) {
      const { nativeInvoke } = await import('../config/platform-bridge')
      await nativeInvoke('network_set_visibility', { visibility: currentVisibility })
    }
  } catch (e) {
    console.warn('[NetworkBridge] 恢复可见性失败:', e)
  }

  // 同步 device_id 到 amiba_settings（Rust 已有持久化，首次读取后缓存）
  try {
    const { settings } = await import('../config/config')
    if (!settings.device_id && isTauri) {
      const { nativeInvoke } = await import('../config/platform-bridge')
      const id: string = await nativeInvoke('network_get_device_id')
      settings.device_id = id
      console.log('[NetworkBridge] device_id 已同步:', id.slice(0, 8))
    }
  } catch (e) {
    console.warn('[NetworkBridge] device_id 同步失败:', e)
  }

  // 监听 Tauri 事件
  try {
    const { nativeListen } = await import('../config/platform-bridge')

    // --- 设备发现 ---
    await nativeListen<{ id: string; name: string; transport: string; address?: string }>(
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

    await nativeListen<{ id: string }>(
      'network:peer-lost',
      (event) => {
        const idx = peerList.findIndex((p) => p.id === event.payload.id)
        if (idx >= 0) peerList.splice(idx, 1)
        emit('peer-lost', event.payload.id)
      }
    )

    // --- Session 事件（Rust → 前端，Phase 4 完善） ---
    await nativeListen<{ sessionId: string; peerId: string; peerName: string; direction: string; service?: string }>(
      'network:session-created',
      (event) => {
        console.log('[NetBridge] session-created dir=', event.payload.direction, 'sid=', event.payload.sessionId?.slice(0,8), 'peer=', event.payload.peerName, 'service=', event.payload.service)
        emit('session-created', event.payload)
      }
    )
    await nativeListen<{ sessionId: string; message: string }>(
      'network:session-message',
      (event) => emit('session-message', event.payload)
    )
    await nativeListen<{ sessionId: string; reason?: string }>(
      'network:session-closed',
      (event) => emit('session-closed', event.payload)
    )
    await nativeListen<{ sessionId: string; error: string }>(
      'network:session-error',
      (event) => emit('session-error', event.payload)
    )
  } catch (e) {
    console.warn('[NetworkBridge] Tauri event 监听失败:', e)
  }
}

// ---- 可见性门控 ----

/** 检查网络是否被用户启用，未启用则抛出友好错误 */
async function requireNetworkEnabled(): Promise<void> {
  const { settings } = await import('../config/config')
  if (!settings.network_lan_visible) {
    throw new Error('网络功能未启用，请在「设置 → 网络」中开启局域网发现')
  }
}

// ---- 可见性 ----

export async function setVisibility(vis: TransportVisibility): Promise<void> {
  currentVisibility = vis
  const { settings } = await import('../config/config')
  settings.network_lan_visible = vis.lan
  if (isTauri) {
    const { nativeInvoke } = await import('../config/platform-bridge')
    await nativeInvoke('network_set_visibility', { visibility: vis })
  }
}

export async function getVisibility(): Promise<TransportVisibility> {
  if (isTauri) {
    try {
      const { nativeInvoke } = await import('../config/platform-bridge')
      currentVisibility = await nativeInvoke<TransportVisibility>('network_get_visibility')
    } catch { /* cached */ }
  }
  return { ...currentVisibility }
}

// ---- 发现 ----

export async function startDiscovery(transport: string): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面端可用')
  await requireNetworkEnabled()
  const { nativeInvoke } = await import('../config/platform-bridge')
  await nativeInvoke('network_start_discovery', { transport })
}

export async function stopDiscovery(transport: string): Promise<void> {
  if (!isTauri) return
  try {
    const { nativeInvoke } = await import('../config/platform-bridge')
    await nativeInvoke('network_stop_discovery', { transport })
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
export async function connect(peerId: string, serviceKey?: string): Promise<NetworkSession> {
  if (!isTauri) throw new Error('网络功能仅在桌面端可用')
  await requireNetworkEnabled()
  console.log('[NetBridge] connect ->', peerId?.slice(0,8), 'serviceKey=', serviceKey)
  const session = await createOutboundSession(peerId, serviceKey)
  console.log('[NetBridge] connect <- sid=', session.id.slice(0,8))
  return session
}

/** 接受外来连接 → 创建被动 NetworkSession */
export function createInboundSession(info: { sessionId: string; peerId: string; peerName: string }): NetworkSession {
  const session = new NetworkSession(info.sessionId, info.peerId, info.peerName)
  sessions.set(session.id, session)
  return session
}

// ---- 按需监听（服务主动请求 TCP listener） ----

/** 服务请求启动 TCP 监听（引用计数；首个服务触发实际启动） */
export async function startListening(serviceKey: string): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面端可用')
  await requireNetworkEnabled()
  console.log('[NetBridge] startListening:', serviceKey)
  const { nativeInvoke } = await import('../config/platform-bridge')
  await nativeInvoke('network_start_listener', { serviceKey })
}

/** 服务请求停止 TCP 监听（引用计数归零时实际停止） */
export async function stopListening(serviceKey: string): Promise<void> {
  if (!isTauri) throw new Error('网络功能仅在桌面端可用')
  console.log('[NetBridge] stopListening:', serviceKey)
  const { nativeInvoke } = await import('../config/platform-bridge')
  await nativeInvoke('network_stop_listener', { serviceKey })
}
