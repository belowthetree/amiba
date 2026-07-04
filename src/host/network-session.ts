// ============================================================
// 变形虫 (Amiba) — NetworkSession
// ============================================================
// 表示一个与服务、对等设备绑定的通信会话。
// 服务通过 session.send() 发送消息，通过 session.on() 监听事件。
// 服务卸载时所有 session 自动关闭。
// ============================================================

import { onEvent, sessions } from './network-bridge'

type EventHandler = (...args: any[]) => void

export class NetworkSession {
  readonly id: string
  readonly peerId: string
  readonly peerName: string
  private _state: 'connecting' | 'connected' | 'disconnected' = 'connected'
  private _handlers = new Map<string, Set<EventHandler>>()
  private _unsubs: (() => void)[] = []

  constructor(id: string, peerId: string, peerName: string) {
    this.id = id
    this.peerId = peerId
    this.peerName = peerName
    console.log(`[NetworkSession] 创建: ${id.slice(0,8)} peer=${peerId.slice(0,8)} name=${peerName}`)

    // 监听来自此 session 的消息
    this._unsubs.push(
      onEvent('session-message', (payload: { sessionId: string; message: string }) => {
        if (payload.sessionId === this.id) {
          console.log(`[NetworkSession] msg recv sid=${this.id.slice(0,8)} body=${payload.message.slice(0,50)}`)
          this._emit('message', payload.message)
        }
      }),
      onEvent('session-closed', (payload: { sessionId: string; reason?: string }) => {
        if (payload.sessionId === this.id) {
          this._state = 'disconnected'
          this._emit('close', payload.reason)
          this._emit('state-change', 'disconnected')
          this.destroy()
        }
      }),
    )
  }

  get state() { return this._state }

  /** 发送原始消息 */
  async send(message: string): Promise<void> {
    if (this._state === 'disconnected') throw new Error('会话已断开')
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('network_send', { sessionId: this.id, message })
  }

  /** 监听事件 */
  on(event: 'message' | 'close' | 'state-change', handler: EventHandler): () => void {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set())
    this._handlers.get(event)!.add(handler)
    return () => this._handlers.get(event)?.delete(handler)
  }

  /** 关闭会话 */
  async close(): Promise<void> {
    if (this._state === 'disconnected') return
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('network_disconnect', { sessionId: this.id }).catch(() => {})
    this._state = 'disconnected'
    this.destroy()
  }

  /** 内部：触发事件 */
  private _emit(event: string, data?: any) {
    const handlers = this._handlers.get(event)
    if (handlers) for (const h of handlers) h(data)
  }

  /** 内部：清理资源 */
  destroy() {
    for (const unsub of this._unsubs) unsub()
    this._unsubs = []
    this._handlers.clear()
    sessions.delete(this.id)
  }
}

/** 创建出站 session（调用 Rust network_connect，含服务匹配握手） */
export async function createOutboundSession(peerId: string, serviceKey?: string): Promise<NetworkSession> {
  const { invoke } = await import('@tauri-apps/api/core')
  const info = await invoke<{ sessionId: string; peerId: string; peerName: string }>(
    'network_connect',
    { peerId, serviceKey }
  )
  const session = new NetworkSession(info.sessionId, info.peerId, info.peerName)
  sessions.set(session.id, session)
  console.log('[NetSession] created sid=', session.id.slice(0,8), 'peer=', session.peerName)
  return session
}
