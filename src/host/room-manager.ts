// ============================================================
// 变形虫 (Amiba) — RoomManager 局域网房间
// ============================================================
// 在 NetworkSession 之上提供「房间」抽象：
//   房主 createRoom → 等待其他设备 joinRoom → 星型通信。
//   成员 → 房主：room.send(data)
//   房主 → 全体：room.broadcast(data)；房主 → 单人：room.sendTo(id, data)
// 协议为 JSON 信封（见下），成员管理/握手/广播由本模块负责，
// 服务无需关心底层 session 细节。
//
// 房间服务键：room:<serviceId> —— 同一设备同一服务同时只能有一个活跃房间；
// 加入者与房主必须运行相同服务（serviceId 一致才能匹配握手）。
//
// 协议信封（session 消息体，JSON）：
//   guest → host  { type:'room-join', name? }                 首条消息
//   host  → guest { type:'room-welcome', roomId, roomName, selfId, hostId, members }
//   host  → guest { type:'room-reject', reason }              拒绝（满员等）
//   host  → guest { type:'room-member-join', member }         成员变动通知
//   host  → guest { type:'room-member-leave', memberId }
//   双向          { type:'room-message', from?, data }        业务数据（data 为任意 JSON）
//   host  → guest { type:'room-closed', reason }              房主关闭/踢出
// ============================================================

import { onEvent, connect, createInboundSession, startListening, stopListening } from './network-bridge'
import { NetworkSession } from './network-session'
import type { RoomInfo, RoomMember, RoomOptions, JoinRoomOptions } from '../types/service'

// ---- 常量 ----

const ROOM_SERVICE_PREFIX = 'room:'
const JOIN_TIMEOUT_MS = 10_000
const DEFAULT_MAX_MEMBERS = 8

export type RoomEventName = 'member-join' | 'member-leave' | 'message' | 'close'
type EventHandler = (data: any) => void

// ---- 注册表 ----

/** roomId → Room */
export const rooms = new Map<string, Room>()
/** serviceId → Room（每服务同时最多一个活跃房间） */
const roomsByService = new Map<string, Room>()

export function getRoomById(roomId: string): Room | undefined {
  return rooms.get(roomId)
}

export function getRoomForService(serviceId: string): Room | undefined {
  return roomsByService.get(serviceId)
}

// ---- 本机身份 ----

async function getSelfDeviceId(): Promise<string> {
  try {
    const { settings } = await import('../config/config')
    if (settings.device_id) return settings.device_id
  } catch { /* ignore */ }
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<string>('network_get_device_id')
}

async function getSelfDeviceName(): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const name = await invoke<string>('network_get_device_name')
    if (name) return name
  } catch { /* ignore */ }
  return 'unknown'
}

// ============================================================
// Room
// ============================================================

export class Room {
  readonly id: string
  readonly name: string
  readonly isHost: boolean
  readonly serviceId: string
  readonly selfId: string
  readonly hostId: string

  private _members: RoomMember[] = []
  private _handlers = new Map<string, Set<EventHandler>>()
  private _closed = false

  // ---- 房主侧状态 ----
  private _memberSessions = new Map<string, NetworkSession>() // memberId → session
  private _unsubInbound: (() => void) | null = null
  private _listeningKey: string | null = null
  private _maxMembers = DEFAULT_MAX_MEMBERS

  // ---- 成员侧状态 ----
  private _session: NetworkSession | null = null

  private constructor(init: {
    id: string
    name: string
    isHost: boolean
    serviceId: string
    selfId: string
    hostId: string
    members: RoomMember[]
  }) {
    this.id = init.id
    this.name = init.name
    this.isHost = init.isHost
    this.serviceId = init.serviceId
    this.selfId = init.selfId
    this.hostId = init.hostId
    this._members = init.members
  }

  get members(): RoomMember[] {
    return JSON.parse(JSON.stringify(this._members))
  }

  /** 序列化为桥接层 RoomInfo（注入 iframe 的代理初始数据） */
  toInfo(): RoomInfo {
    return {
      roomId: this.id,
      name: this.name,
      isHost: this.isHost,
      selfId: this.selfId,
      hostId: this.hostId,
      members: this.members,
    }
  }

  // ---- 事件 ----

  on(event: RoomEventName, handler: EventHandler): () => void {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set())
    this._handlers.get(event)!.add(handler)
    return () => this._handlers.get(event)?.delete(handler)
  }

  private _emit(event: RoomEventName, data?: any) {
    const handlers = this._handlers.get(event)
    if (handlers) for (const h of handlers) h(data)
  }

  // ============================================================
  // 房主操作
  // ============================================================

  /** 房主：向全体成员广播业务数据 */
  async broadcast(data: any): Promise<void> {
    this._requireHost('broadcast')
    this._requireOpen()
    const envelope = JSON.stringify({ type: 'room-message', from: this.hostId, data })
    for (const session of this._memberSessions.values()) {
      session.send(envelope).catch((e) => console.warn('[Room] 广播发送失败:', e))
    }
  }

  /** 房主：向指定成员发送业务数据 */
  async sendTo(memberId: string, data: any): Promise<void> {
    this._requireHost('sendTo')
    this._requireOpen()
    const session = this._memberSessions.get(memberId)
    if (!session) throw new Error('成员不存在: ' + memberId)
    await session.send(JSON.stringify({ type: 'room-message', from: this.hostId, data }))
  }

  /** 房主：踢出成员 */
  async kick(memberId: string): Promise<void> {
    this._requireHost('kick')
    this._requireOpen()
    const session = this._memberSessions.get(memberId)
    if (!session) throw new Error('成员不存在: ' + memberId)
    console.log('[Room] 踢出成员:', memberId.slice(0, 8))
    await session.send(JSON.stringify({ type: 'room-closed', reason: 'kicked' })).catch(() => {})
    await session.close().catch(() => {})
    this._removeMember(memberId)
  }

  // ============================================================
  // 成员操作
  // ============================================================

  /** 成员：向房主发送业务数据 */
  async send(data: any): Promise<void> {
    if (this.isHost) throw new Error('房主请使用 broadcast / sendTo')
    this._requireOpen()
    await this._session!.send(JSON.stringify({ type: 'room-message', data }))
  }

  // ============================================================
  // 通用
  // ============================================================

  /** 关闭房间（房主：解散房间并通知全员；成员：离开房间）。本端主动调用不触发 close 事件 */
  async close(): Promise<void> {
    if (this._closed) return
    this._closed = true
    console.log('[Room] === 关闭房间:', this.id, 'isHost=', this.isHost, '===')

    if (this.isHost) {
      const notice = JSON.stringify({ type: 'room-closed', reason: 'closed' })
      for (const session of this._memberSessions.values()) {
        session.send(notice).catch(() => {})
        session.close().catch(() => {})
      }
      this._memberSessions.clear()
      if (this._unsubInbound) { this._unsubInbound(); this._unsubInbound = null }
      if (this._listeningKey) {
        await stopListening(this._listeningKey).catch(() => {})
        this._listeningKey = null
      }
    } else if (this._session) {
      await this._session.close().catch(() => {})
      this._session = null
    }

    this._destroy()
  }

  /** 内部：被动关闭（房间被解散/被踢/连接断开），触发 close 事件 */
  private _onClosed(reason: string) {
    if (this._closed) return
    this._closed = true
    console.log('[Room] 房间被动关闭:', this.id, 'reason=', reason)
    if (this._session) {
      this._session.close().catch(() => {})
      this._session = null
    }
    this._emit('close', { reason })
    this._destroy()
  }

  private _destroy() {
    this._handlers.clear()
    rooms.delete(this.id)
    if (roomsByService.get(this.serviceId) === this) roomsByService.delete(this.serviceId)
  }

  private _requireHost(op: string) {
    if (!this.isHost) throw new Error(op + ' 仅房主可用')
  }

  private _requireOpen() {
    if (this._closed) throw new Error('房间已关闭')
  }

  // ============================================================
  // 房主侧：接受加入
  // ============================================================

  /** 房主：处理匹配到房间服务键的入站 session，等待 room-join 握手 */
  private _acceptCandidate(info: { sessionId: string; peerId: string; peerName: string }) {
    const session = createInboundSession(info)
    console.log('[Room] 候选加入者:', info.peerName, 'sid=', info.sessionId.slice(0, 8))

    const timer = setTimeout(() => {
      console.warn('[Room] 等待 room-join 超时，关闭:', info.sessionId.slice(0, 8))
      session.close().catch(() => {})
    }, JOIN_TIMEOUT_MS)

    const unsubClose = session.on('close', () => {
      clearTimeout(timer)
      unsubJoin()
      unsubClose()
    })

    const unsubJoin = session.on('message', (raw: string) => {
      let msg: any
      try { msg = JSON.parse(raw) } catch { return }
      if (msg?.type !== 'room-join') return
      clearTimeout(timer)
      unsubJoin()
      unsubClose()
      this._admitMember(session, typeof msg.name === 'string' && msg.name ? msg.name : session.peerName)
    })
  }

  /** 房主：校验并接纳成员，发送 welcome，广播 member-join */
  private _admitMember(session: NetworkSession, name: string) {
    if (this._closed) { session.close().catch(() => {}); return }

    // 满员校验（成员列表含房主）
    if (this._members.length >= this._maxMembers) {
      console.warn('[Room] 房间已满，拒绝:', name)
      session.send(JSON.stringify({ type: 'room-reject', reason: '房间已满' })).catch(() => {})
      session.close().catch(() => {})
      return
    }

    const memberId = session.peerId

    // 同设备重复加入：旧 session 静默替换（重连场景）
    const oldSession = this._memberSessions.get(memberId)
    if (oldSession) {
      console.log('[Room] 成员重连，替换旧 session:', name)
      oldSession.close().catch(() => {})
      this._memberSessions.delete(memberId)
      this._members = this._members.filter((m) => m.id !== memberId)
    }

    const member: RoomMember = { id: memberId, name, isHost: false }
    this._members.push(member)
    this._memberSessions.set(memberId, session)
    console.log('[Room] === 成员加入:', name, '(' + memberId.slice(0, 8) + '), 当前', this._members.length, '人 ===')

    // 成员消息 → message 事件
    session.on('message', (raw: string) => {
      let msg: any
      try { msg = JSON.parse(raw) } catch { return }
      if (msg?.type === 'room-message') {
        this._emit('message', { from: member, data: msg.data })
      }
    })

    // 成员断开 → 移除 + 通知其他成员
    session.on('close', () => {
      console.log('[Room] 成员断开:', name)
      this._removeMember(memberId)
    })

    // welcome（含完整成员快照）
    session.send(JSON.stringify({
      type: 'room-welcome',
      roomId: this.id,
      roomName: this.name,
      selfId: memberId,
      hostId: this.hostId,
      members: this.members,
    })).catch(() => {})

    // 通知其他成员
    const notice = JSON.stringify({ type: 'room-member-join', member })
    for (const [id, s] of this._memberSessions) {
      if (id !== memberId) s.send(notice).catch(() => {})
    }

    this._emit('member-join', { member, members: this.members })
  }

  /** 房主：移除成员并广播 member-leave */
  private _removeMember(memberId: string) {
    const idx = this._members.findIndex((m) => m.id === memberId)
    if (idx < 0) return
    const [member] = this._members.splice(idx, 1)
    this._memberSessions.delete(memberId)
    console.log('[Room] 成员离开:', member.name, ', 剩余', this._members.length, '人')

    if (!this._closed) {
      const notice = JSON.stringify({ type: 'room-member-leave', memberId })
      for (const s of this._memberSessions.values()) {
        s.send(notice).catch(() => {})
      }
      this._emit('member-leave', { member, members: this.members })
    }
  }

  // ============================================================
  // 工厂：创建 / 加入
  // ============================================================

  /** 房主：创建房间（启动 TCP 监听并等待加入） */
  static async create(serviceId: string, opts: RoomOptions = {}): Promise<Room> {
    if (roomsByService.has(serviceId)) throw new Error('当前服务已有活跃房间，请先关闭')

    const hostId = await getSelfDeviceId()
    const hostName = opts.hostName || await getSelfDeviceName()
    const room = new Room({
      id: 'room-' + Math.random().toString(36).slice(2, 10),
      name: opts.name || `${hostName} 的房间`,
      isHost: true,
      serviceId,
      selfId: hostId,
      hostId,
      members: [{ id: hostId, name: hostName, isHost: true }],
    })
    room._maxMembers = opts.maxMembers && opts.maxMembers > 1 ? Math.floor(opts.maxMembers) : DEFAULT_MAX_MEMBERS

    const serviceKey = ROOM_SERVICE_PREFIX + serviceId
    await startListening(serviceKey)
    room._listeningKey = serviceKey

    // 订阅入站 session（按房间服务键路由，其他会话不处理）
    room._unsubInbound = onEvent('session-created', (info: { sessionId: string; peerId: string; peerName: string; direction?: string; service?: string }) => {
      if (info.direction !== 'inbound') return
      if (info.service !== serviceKey) return
      room._acceptCandidate(info)
    })

    rooms.set(room.id, room)
    roomsByService.set(serviceId, room)
    console.log('[Room] === 房间已创建:', room.name, '(' + room.id + '), serviceKey=', serviceKey, '===')
    return room
  }

  /** 成员：加入指定设备上的房间 */
  static async join(serviceId: string, peerId: string, opts: JoinRoomOptions = {}): Promise<Room> {
    if (roomsByService.has(serviceId)) throw new Error('当前服务已在房间中，请先离开')

    const serviceKey = ROOM_SERVICE_PREFIX + serviceId
    let session: NetworkSession
    try {
      session = await connect(peerId, serviceKey)
    } catch (e: any) {
      const msg = e?.message || String(e)
      // Rust 服务匹配拒绝 → 友好提示
      if (msg.includes('没有服务在监听') || msg.includes('暂未开放连接')) {
        throw new Error('该设备上没有可加入的房间')
      }
      throw new Error(msg || '连接失败')
    }

    // 发送 room-join 握手
    await session.send(JSON.stringify({ type: 'room-join', name: opts.name }))

    // 等待 welcome / reject
    const reply = await waitForRoomReply(session, JOIN_TIMEOUT_MS)
    if (!reply) {
      await session.close().catch(() => {})
      throw new Error('加入房间超时')
    }
    if (reply.type === 'room-reject') {
      await session.close().catch(() => {})
      throw new Error(reply.reason || '加入被拒绝')
    }

    const room = new Room({
      id: String(reply.roomId || 'room-unknown'),
      name: String(reply.roomName || '未命名房间'),
      isHost: false,
      serviceId,
      selfId: String(reply.selfId || session.peerId),
      hostId: String(reply.hostId || ''),
      members: Array.isArray(reply.members) ? reply.members : [],
    })
    room._session = session

    // 房主消息与成员变动
    session.on('message', (raw: string) => {
      let msg: any
      try { msg = JSON.parse(raw) } catch { return }
      switch (msg?.type) {
        case 'room-message': {
          const from = room._members.find((m) => m.id === msg.from)
            || { id: String(msg.from || room.hostId), name: '未知成员', isHost: msg.from === room.hostId }
          room._emit('message', { from, data: msg.data })
          break
        }
        case 'room-member-join': {
          const member = msg.member as RoomMember
          if (member && member.id) {
            room._members = room._members.filter((m) => m.id !== member.id)
            room._members.push(member)
            room._emit('member-join', { member, members: room.members })
          }
          break
        }
        case 'room-member-leave': {
          const idx = room._members.findIndex((m) => m.id === msg.memberId)
          if (idx >= 0) {
            const [member] = room._members.splice(idx, 1)
            room._emit('member-leave', { member, members: room.members })
          }
          break
        }
        case 'room-closed':
          room._onClosed(String(msg.reason || 'closed'))
          break
      }
    })

    // 连接断开（房主掉线等）
    session.on('close', () => room._onClosed('disconnected'))

    rooms.set(room.id, room)
    roomsByService.set(serviceId, room)
    console.log('[Room] === 已加入房间:', room.name, '(' + room.id + '), host=', session.peerName, '===')
    return room
  }
}

// ---- 便捷入口 ----

export async function createRoom(serviceId: string, opts?: RoomOptions): Promise<Room> {
  return Room.create(serviceId, opts)
}

export async function joinRoom(serviceId: string, peerId: string, opts?: JoinRoomOptions): Promise<Room> {
  return Room.join(serviceId, peerId, opts)
}

/** 服务卸载时清理其活跃房间 */
export async function destroyRoomForService(serviceId: string): Promise<void> {
  const room = roomsByService.get(serviceId)
  if (room) await room.close()
}

// ---- 内部工具 ----

/** 等待 guest 侧握手响应（welcome / reject），超时返回 null */
function waitForRoomReply(session: NetworkSession, timeoutMs: number): Promise<any | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub()
      resolve(null)
    }, timeoutMs)

    const unsub = session.on('message', (raw: string) => {
      let msg: any
      try { msg = JSON.parse(raw) } catch { return }
      if (msg?.type === 'room-welcome' || msg?.type === 'room-reject') {
        clearTimeout(timer)
        unsub()
        resolve(msg)
      }
    })
  })
}
