// ============================================================
// 变形虫 (Amiba) — LAN 网络命令族（UDP 发现 + WS 会话）
// ============================================================
// 对应 Rust src-tauri/src/network_visibility.rs + network_session.rs，
// 线协议逐字段对齐（鸿蒙端必须与桌面/Android 对端互通）：
//
//   UDP 发现（端口 28880）：
//     广播报文（紧凑 JSON，每 3s）：{"id":"<deviceId>","name":"<deviceName>","sid":"<本次运行UUID>","ws_port":<端口>}
//     自过滤：按 sid（非 device_id）；peer 失联：last_seen 超 15s → peer-lost；清扫间隔 5s
//     降级说明：Rust 除 255.255.255.255 外还枚举网卡算定向广播地址（x.x.x.255），
//               鸿蒙无网卡枚举 API，按 docs/harmonyos-migration.md §5.4 决策仅 255.255.255.255
//
//   WS 应用层（tokio-tungstenite 标准 RFC6455 帧，路径 /）：
//     连接方首条文本: {"type":"hello","from":"<peerId>","name":"<设备名>","service":"<serviceKey>"}
//     被动方: 服务匹配 → {"type":"ack"} → 建 Inbound Session
//             不匹配 → {"type":"reject","reason":"..."} → 关闭
//     之后：文本帧即业务消息；含 "type":"ping"/"type":"pong" 子串的文本为应用层保活，过滤不上抛
//     hello 读取超时 10s，ack 等待超时 30s
//
//   事件（经 HarmonyBridge.emitToWeb，名字/载荷与 Tauri emit 一致）：
//     network:peer-discovered  {id,name,transport:"lan",address:"ip:ws_port"}
//     network:peer-lost        {id}
//     network:session-created  {sessionId,peerId,peerName,direction:"inbound"|"outbound",service}
//     network:session-message  {sessionId,message}
//     network:session-closed   {sessionId,reason:"disconnected"(本地)|"connection-lost"(对端)}
//     network:session-error    {sessionId,error}
//       ※ Rust 从不发 session-error（前端仅预留监听）；鸿蒙端在会话已建立后
//         遇到异步 IO 错误时补发（载荷形状与前端声明一致），随后照旧 session-closed
//
// 初始化（与 HttpCommands/FsCommands 两阶段模式一致）：
//   EntryAbility.onCreate → initNetworkContext(context)（device_id/name 装载）
//   Index.aboutToAppear   → initNetworkBridge(bridge)（事件推送通道）
// ============================================================

import { socket, webSocket } from '@kit.NetworkKit'
import { deviceInfo } from '@kit.BasicServicesKit'
import { util } from '@kit.ArkTS'
import { common } from '@kit.AbilityKit'
import { fileIo as fs } from '@kit.CoreFileKit'
import { HarmonyBridge } from './HarmonyBridge'
import { getFilesDir, ensureParentDir } from './FsCommands'
import { WsServer, WsInboundConnection } from './NetworkWsServer'

const TAG = '[AmibaNet]'

export const NETWORK_COMMANDS: string[] = [
  'network_set_visibility',
  'network_get_visibility',
  'network_start_discovery',
  'network_stop_discovery',
  'network_get_device_id',
  'network_get_device_name',
  'network_connect',
  'network_send',
  'network_disconnect',
  'network_start_listener',
  'network_stop_listener',
  // Rust 注册但前端未调用的两条，为协议完整一并实现
  'network_get_visible_devices',
  'network_get_ws_port'
]

// ---- 常量（与 Rust 一致）----
const UDP_PORT: number = 28880
const UDP_BROADCAST_ADDR: string = '255.255.255.255'
const BROADCAST_INTERVAL_MS: number = 3000
const PEER_STALE_MS: number = 15000
const PEER_CLEANUP_INTERVAL_MS: number = 5000
const HELLO_READ_TIMEOUT_MS: number = 10000
const CONNECT_ACK_TIMEOUT_MS: number = 30000
const WS_OPEN_TIMEOUT_MS: number = 30000

// ---- 线协议类型 ----
interface TransportVisibility {
  lan: boolean
  ble: boolean
}
/** UDP 广播报文（字段序对齐 serde_json json! 宏输出） */
interface DiscoveryMsg {
  id: string
  name: string
  sid: string
  ws_port: number
}
/** peer 表项（Rust DiscoveredPeer；last_seen 为毫秒字符串，与 Rust now_iso 一致） */
interface PeerEntry {
  id: string
  name: string
  transport: string
  address: string
  lastSeenMs: number
}
interface HelloMsg {
  type: string
  from: string
  name: string
  service: string
}
interface AckMsg {
  type: string
}
interface RejectMsg {
  type: string
  reason: string
}
interface SessionEntry {
  id: string
  peerId: string
  peerName: string
  direction: string
  inbound: WsInboundConnection | null
  outbound: webSocket.WebSocket | null
  /** 消息计数（节流日志用） */
  msgCount: number
}
interface ConnectResult {
  sessionId: string
  peerId: string
  peerName: string
}
interface PeerDiscoveredPayload {
  id: string
  name: string
  transport: string
  address: string
}
interface PeerLostPayload {
  id: string
}
interface SessionCreatedPayload {
  sessionId: string
  peerId: string
  peerName: string
  direction: string
  service: string
}
interface SessionMessagePayload {
  sessionId: string
  message: string
}
interface SessionClosedPayload {
  sessionId: string
  reason: string
}
interface SessionErrorPayload {
  sessionId: string
  error: string
}
/** Rust DiscoveredPeer 的网络序列化形态（network_get_visible_devices 用，snake_case） */
interface DiscoveredPeerWire {
  id: string
  name: string
  transport: string
  address: string
  last_seen: string
}

// ---- 模块状态（对齐 Rust VisibilityState + SessionStore）----
let bridge: HarmonyBridge | null = null
let deviceId: string = ''
let deviceName: string = ''
/** 本机发现会话标识（过滤自己发出的广播；每次启动随机，对齐 Rust session_id） */
const discoverySid: string = util.generateRandomUUID(false)
let visibility: TransportVisibility = { lan: true, ble: false }
const peers = new Map<string, PeerEntry>()
let wsPort: number = 0
let listenerRefcount: number = 0
const listeningServices = new Set<string>()
let wsServer: WsServer | null = null
const sessions = new Map<string, SessionEntry>()

// UDP 运行时（取消语义对齐 Rust watch channel：stop 立即失效旧任务）
let udpSendSock: socket.UDPSocket | null = null
let udpListenSock: socket.UDPSocket | null = null
let broadcastTimer: number = -1
let cleanupTimer: number = -1
/** 发现任务代际：stop/restart 时递增，异步 bind 回调检查防过期任务复活 */
let discoveryEpoch: number = 0
let udpSendCount: number = 0
let udpRecvCount: number = 0

// ============================================================
// 初始化
// ============================================================

/** EntryAbility.onCreate 调用：装载 device_id（落盘复用）与 device_name */
export function initNetworkContext(context: common.UIAbilityContext): void {
  deviceId = loadOrCreateDeviceId()
  deviceName = loadDeviceName()
  console.log(`${TAG} 初始化: device=${deviceName} id=${deviceId.substring(0, 8)} sid=${discoverySid.substring(0, 8)}`)
}

/** Index.aboutToAppear 调用：注入桥实例（network:* 事件推送） */
export function initNetworkBridge(b: HarmonyBridge): void {
  bridge = b
  console.log(`${TAG} 桥已注入`)
}

// device_id：${filesDir}/amiba/device_id（对齐 Rust app_data_dir/amiba/device_id）
function loadOrCreateDeviceId(): string {
  const path = `${getFilesDir()}/amiba/device_id`
  try {
    if (fs.accessSync(path)) {
      const st = fs.statSync(path)
      const file = fs.openSync(path, fs.OpenMode.READ_ONLY)
      try {
        const buf = new ArrayBuffer(st.size)
        fs.readSync(file.fd, buf)
        const id = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(buf)).trim()
        if (id.length > 0) {
          return id
        }
      } finally {
        fs.closeSync(file)
      }
    }
  } catch (e) {
    // 读失败按首次处理，重建
  }
  const id = util.generateRandomUUID(false)
  try {
    ensureParentDir(path)
    const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
    try {
      fs.writeSync(file.fd, new util.TextEncoder().encodeInto(id).buffer)
    } finally {
      fs.closeSync(file)
    }
  } catch (e) {
    console.error(`${TAG} ✗ device_id 落盘失败（本次运行内有效）`)
  }
  return id
}

// device_name：Rust 用 hostname；鸿蒙无主机名概念，取市场名（如 HUAWEI Mate 60），
// 语义同为「人类可读的本机名」，对端 peer 列表直接展示
function loadDeviceName(): string {
  try {
    const market = deviceInfo.marketName
    if (market.length > 0) {
      return market
    }
  } catch (e) {
    // syscap 缺失：继续降级
  }
  try {
    const model = deviceInfo.productModel
    if (model.length > 0) {
      return model
    }
  } catch (e) {
    // 继续降级
  }
  return 'amiba-device' // 与 Rust get_hostname_str 失败兜底一致
}

// ============================================================
// 事件推送（payload 与 Tauri emit 一致）
// ============================================================

function emitEvent(event: string, payload: Object): void {
  const b = bridge
  if (b === null) {
    console.warn(`${TAG} 桥未注入，事件丢失: ${event}`)
    return
  }
  b.emitToWeb(event, payload)
}

// ============================================================
// UDP 发现（广播 + 监听 + 失联清扫）
// ============================================================

function stopUdpTasks(): void {
  discoveryEpoch++
  if (broadcastTimer >= 0) {
    clearInterval(broadcastTimer)
    broadcastTimer = -1
  }
  if (cleanupTimer >= 0) {
    clearInterval(cleanupTimer)
    cleanupTimer = -1
  }
  const sendSock = udpSendSock
  udpSendSock = null
  if (sendSock !== null) {
    try {
      sendSock.close()
    } catch (e) {
      // 已关闭：忽略
    }
  }
  const listenSock = udpListenSock
  udpListenSock = null
  if (listenSock !== null) {
    try {
      listenSock.close()
    } catch (e) {
      // 已关闭：忽略
    }
  }
}

async function startUdpBroadcast(epoch: number): Promise<void> {
  const sock = socket.constructUDPSocketInstance()
  try {
    await sock.bind({ address: '0.0.0.0', family: 1, port: 0 })
    await sock.setExtraOptions({ broadcast: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ UDP 广播绑定失败: ${msg}`)
    return
  }
  if (epoch !== discoveryEpoch) {
    // 启动期间已被 stop/restart（对齐 watch cancel）
    try {
      sock.close()
    } catch (e) {
      // 忽略
    }
    return
  }
  udpSendSock = sock
  udpSendCount = 0
  console.log(`${TAG} UDP 广播目标 (1): ["${UDP_BROADCAST_ADDR}:${UDP_PORT}"]`)

  const tick = (): void => {
    udpSendCount++
    // ws_port 每 tick 重读（0 = 暂无服务监听，可见但不可连，对齐 Rust）
    const msg: DiscoveryMsg = { id: deviceId, name: deviceName, sid: discoverySid, ws_port: wsPort }
    const payload = JSON.stringify(msg)
    sock.send({ data: payload, address: { address: UDP_BROADCAST_ADDR, family: 1, port: UDP_PORT } })
      .catch((e: Error) => {
        if (udpSendCount <= 1) {
          console.error(`${TAG} ✗ UDP 发送失败: ${e.message}`)
        }
      })
    // 循环内日志计数节流（对齐 Rust send_count % 10 == 1）
    if (udpSendCount % 10 === 1) {
      console.log(`${TAG} UDP 已发送 ${udpSendCount} 次`)
    }
  }
  tick() // 首发不等间隔（Rust loop 体先发送后 sleep）
  broadcastTimer = setInterval(tick, BROADCAST_INTERVAL_MS)
}

async function startUdpListener(epoch: number): Promise<void> {
  const sock = socket.constructUDPSocketInstance()
  sock.on('message', (info: socket.SocketMessageInfo) => {
    handleUdpPacket(new Uint8Array(info.message), info.remoteInfo.address)
  })
  sock.on('error', (err: Error) => {
    console.error(`${TAG} ✗ UDP 监听错误: ${err.message}`)
  })
  try {
    await sock.setExtraOptions({ reuseAddress: true })
    await sock.bind({ address: '0.0.0.0', family: 1, port: UDP_PORT })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ UDP 绑定失败 (${UDP_PORT}): ${msg}`)
    return
  }
  if (epoch !== discoveryEpoch) {
    try {
      sock.close()
    } catch (e) {
      // 忽略
    }
    return
  }
  udpListenSock = sock
  udpRecvCount = 0
  console.log(`${TAG} ✓ UDP 监听已启动，端口: ${UDP_PORT}`)
  cleanupTimer = setInterval(() => {
    purgeStalePeers()
  }, PEER_CLEANUP_INTERVAL_MS)
}

function handleUdpPacket(data: Uint8Array, srcIp: string): void {
  let msg: Record<string, Object>
  try {
    const text = util.TextDecoder.create('utf-8').decodeToString(data)
    msg = JSON.parse(text) as Record<string, Object>
  } catch (e) {
    return // 非 JSON 垃圾包：静默丢弃（Rust 同）
  }
  const peerSid = typeof msg['sid'] === 'string' ? (msg['sid'] as string) : ''
  const peerId = typeof msg['id'] === 'string' ? (msg['id'] as string) : 'unknown'
  const peerName = typeof msg['name'] === 'string' ? (msg['name'] as string) : 'unknown'
  const peerWsPort = typeof msg['ws_port'] === 'number' ? (msg['ws_port'] as number) : 0
  if (peerSid === discoverySid) {
    return // 自己发出的广播（Rust 按 sid 过滤）
  }
  udpRecvCount++
  if (udpRecvCount % 10 === 1) {
    console.log(`${TAG} UDP 收到第 ${udpRecvCount} 个外部包 (来自 ${srcIp} 设备 ${peerName})`)
  }
  const address = `${srcIp}:${peerWsPort}`
  const isNew = !peers.has(peerId)
  const entry: PeerEntry = {
    id: peerId,
    name: peerName,
    transport: 'lan',
    address: address,
    lastSeenMs: Date.now()
  }
  peers.set(peerId, entry)
  if (isNew) {
    console.log(`${TAG} 发现设备: ${peerName} (${peerId.substring(0, 8)})`)
    const payload: PeerDiscoveredPayload = { id: peerId, name: peerName, transport: 'lan', address: address }
    emitEvent('network:peer-discovered', payload)
  }
}

function purgeStalePeers(): void {
  const now = Date.now()
  const stale: string[] = []
  peers.forEach((p: PeerEntry, id: string) => {
    if (now - p.lastSeenMs > PEER_STALE_MS) {
      stale.push(id)
    }
  })
  for (const id of stale) {
    peers.delete(id)
    console.log(`${TAG} 设备失联: ${id.substring(0, 8)}`)
    const payload: PeerLostPayload = { id: id }
    emitEvent('network:peer-lost', payload)
  }
}

// ============================================================
// 入站 WS（hello 服务匹配 → Inbound Session）
// ============================================================

function acceptInbound(conn: WsInboundConnection): void {
  let helloSettled = false
  const helloTimer = setTimeout(() => {
    if (!helloSettled) {
      console.log(`${TAG} 未收到 hello (${conn.remoteAddr}), 关闭`)
      conn.close().then(() => {})
    }
  }, HELLO_READ_TIMEOUT_MS)

  conn.onHandshake = (c: WsInboundConnection, ok: boolean) => {
    if (!ok) {
      helloSettled = true
      clearTimeout(helloTimer)
    }
  }
  conn.onClosed = (c: WsInboundConnection) => {
    if (!helloSettled) {
      helloSettled = true
      clearTimeout(helloTimer)
    }
    // hello 匹配建 session 后 onClosed 会被替换为 session 级回调，走不到这里
  }
  conn.onText = (c: WsInboundConnection, text: string) => {
    if (helloSettled) {
      return
    }
    if (isAppPingPong(text)) {
      return // 保活包不算 hello（Rust read_first_text 循环跳过）
    }
    helloSettled = true
    clearTimeout(helloTimer)
    processHello(c, text).then(() => {})
  }
}

async function processHello(conn: WsInboundConnection, text: string): Promise<void> {
  let hello: Record<string, Object>
  try {
    hello = JSON.parse(text) as Record<string, Object>
  } catch (e) {
    console.error(`${TAG} ✗ hello 解析失败 (${conn.remoteAddr}): ${text.substring(0, 80)}`)
    await conn.close()
    return
  }
  if (hello['type'] !== 'hello') {
    console.error(`${TAG} ✗ 首条消息非 hello (${conn.remoteAddr})`)
    await conn.close()
    return
  }
  const peerId = typeof hello['from'] === 'string' ? (hello['from'] as string) : 'unknown'
  const peerName = typeof hello['name'] === 'string' ? (hello['name'] as string) : 'unknown'
  const serviceKey = typeof hello['service'] === 'string' ? (hello['service'] as string) : ''

  console.log(`${TAG} === 收到 hello: service=${serviceKey}, from=${peerId.substring(0, 8)}, name=${peerName}, addr=${conn.remoteAddr} ===`)
  console.log(`${TAG}    当前监听服务: [${Array.from(listeningServices).join(',')}]`)
  const matched = serviceKey.length > 0 && listeningServices.has(serviceKey)
  console.log(`${TAG}    匹配结果: matched=${matched} service_key='${serviceKey}'`)

  if (!matched) {
    const reason = serviceKey.length === 0 ? 'hello 未指定 service' : `没有服务在监听 '${serviceKey}'`
    console.log(`${TAG}    ✗ 服务不匹配，拒绝: ${reason}`)
    try {
      const reject: RejectMsg = { type: 'reject', reason: reason }
      await conn.sendText(JSON.stringify(reject))
    } catch (e) {
      // 发送失败直接关
    }
    await conn.close()
    return
  }

  console.log(`${TAG}    ✓ 服务匹配，发送 ack ...`)
  try {
    const ack: AckMsg = { type: 'ack' }
    await conn.sendText(JSON.stringify(ack))
  } catch (e) {
    console.error(`${TAG} ✗ 发送 ack 失败`)
    conn.closeTcp()
    return
  }

  const sessionId = util.generateRandomUUID(false)
  const entry: SessionEntry = {
    id: sessionId,
    peerId: peerId,
    peerName: peerName,
    direction: 'inbound',
    inbound: conn,
    outbound: null,
    msgCount: 0
  }
  sessions.set(sessionId, entry)
  wireInboundSession(conn, entry)
  // 连接所有权移交 session：listener 停止时不再随它关闭（对齐 Rust 语义）
  const server = wsServer
  if (server !== null) {
    server.release(conn)
  }
  console.log(`${TAG}    ✓ Inbound session 创建: ${sessionId.substring(0, 8)} <- ${peerId.substring(0, 8)} (${peerName})`)
  const payload: SessionCreatedPayload = {
    sessionId: sessionId,
    peerId: peerId,
    peerName: peerName,
    direction: 'inbound',
    service: serviceKey
  }
  emitEvent('network:session-created', payload)
}

function wireInboundSession(conn: WsInboundConnection, entry: SessionEntry): void {
  conn.onText = (c: WsInboundConnection, text: string) => {
    if (isAppPingPong(text)) {
      return
    }
    entry.msgCount++
    if (entry.msgCount % 50 === 1) {
      console.log(`${TAG} session ${entry.id.substring(0, 8)} 已收 ${entry.msgCount} 条`)
    }
    const payload: SessionMessagePayload = { sessionId: entry.id, message: text }
    emitEvent('network:session-message', payload)
  }
  conn.onClosed = (c: WsInboundConnection) => {
    if (sessions.delete(entry.id)) {
      const payload: SessionClosedPayload = { sessionId: entry.id, reason: 'connection-lost' }
      emitEvent('network:session-closed', payload)
      console.log(`${TAG} session ${entry.id.substring(0, 8)} 读取端已关闭`)
    }
  }
}

// ============================================================
// 出站 WS（官方客户端 + hello/ack 握手）
// ============================================================

/** 应用层保活过滤（子串匹配，逐字符对齐 Rust contains 语义） */
function isAppPingPong(text: string): boolean {
  return text.indexOf('"type":"ping"') >= 0 || text.indexOf('"type":"pong"') >= 0
}

function quietCloseWs(ws: webSocket.WebSocket): void {
  try {
    ws.off('open')
    ws.off('message')
    ws.off('close')
    ws.off('error')
    ws.close().catch(() => {})
  } catch (e) {
    // 已关闭：忽略
  }
}

async function cmdConnect(args: Record<string, Object>): Promise<ConnectResult> {
  const peerId = reqStr(args['peerId'], 'peerId')
  const serviceKey = optStr(args['serviceKey']) ?? ''

  const peer = peers.get(peerId)
  if (peer === undefined) {
    throw new Error(`设备 ${peerId} 未发现`)
  }
  const address = peer.address
  const peerName = peer.name
  if (address.length === 0) {
    throw new Error('设备地址未知')
  }
  if (address.endsWith(':0')) {
    throw new Error('该设备暂未开放连接。请在对方设备上打开相同服务（服务需调用 startListening）')
  }

  const url = `ws://${address}`
  console.log(`${TAG} === 主动连接: ${peerId.substring(0, 8)} -> ${url} (service=${serviceKey}) ===`)

  const ws = webSocket.createWebSocket()

  // 握手等待器：建 session 前，消息/关闭/错误都路由给它（单处理器避免ack与首条业务消息竞态）
  let handshakeResolve: ((text: string) => void) | null = null
  let handshakeReject: ((err: Error) => void) | null = null
  let sessionEntry: SessionEntry | null = null

  ws.on('message', (err: Error, data: string | ArrayBuffer) => {
    if (err) {
      return
    }
    const text = typeof data === 'string' ? data : util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(data))
    if (isAppPingPong(text)) {
      return
    }
    const waiter = handshakeResolve
    if (waiter !== null) {
      handshakeResolve = null
      waiter(text)
      return
    }
    const entry = sessionEntry
    if (entry !== null) {
      entry.msgCount++
      if (entry.msgCount % 50 === 1) {
        console.log(`${TAG} session ${entry.id.substring(0, 8)} 已收 ${entry.msgCount} 条`)
      }
      const payload: SessionMessagePayload = { sessionId: entry.id, message: text }
      emitEvent('network:session-message', payload)
    }
  })
  ws.on('close', () => {
    const rejecter = handshakeReject
    if (rejecter !== null) {
      handshakeReject = null
      rejecter(new Error('连接已断开'))
      return
    }
    const entry = sessionEntry
    if (entry !== null && sessions.delete(entry.id)) {
      const payload: SessionClosedPayload = { sessionId: entry.id, reason: 'connection-lost' }
      emitEvent('network:session-closed', payload)
      console.log(`${TAG} session ${entry.id.substring(0, 8)} 读取端已关闭`)
    }
  })
  ws.on('error', (e: Error) => {
    const rejecter = handshakeReject
    if (rejecter !== null) {
      handshakeReject = null
      rejecter(new Error(`握手读取错误: ${e.message}`))
      return
    }
    const entry = sessionEntry
    if (entry !== null && sessions.has(entry.id)) {
      // Rust 无 session-error 事件（仅日志）；鸿蒙补发（载荷形状与前端声明一致），随后照旧 closed
      console.error(`${TAG} ✗ session ${entry.id.substring(0, 8)} 读取错误: ${e.message}`)
      const errPayload: SessionErrorPayload = { sessionId: entry.id, error: e.message }
      emitEvent('network:session-error', errPayload)
      quietCloseWs(ws)
      if (sessions.delete(entry.id)) {
        const payload: SessionClosedPayload = { sessionId: entry.id, reason: 'connection-lost' }
        emitEvent('network:session-closed', payload)
      }
    }
  })

  // 建立 TCP + WS 握手：等 open 事件（connect() resolve 时序随系统版本不固定，双通道竞速）
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('WebSocket 连接失败: 连接超时'))
      }
    }, WS_OPEN_TIMEOUT_MS)
    ws.on('open', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve()
      }
    })
    ws.connect(url)
      .then((ok: boolean) => {
        if (!ok && !settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error('WebSocket 连接失败: connect 返回 false'))
        }
      })
      .catch((e: Error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`WebSocket 连接失败: ${e.message}`))
        }
      })
  }).catch((e: Error) => {
    quietCloseWs(ws)
    throw e
  })

  // 发 hello（仅服务匹配信息，无 greeting，与 Rust 一致）
  const hello: HelloMsg = { type: 'hello', from: deviceId, name: deviceName, service: serviceKey }
  try {
    const ok = await ws.send(JSON.stringify(hello))
    if (!ok) {
      throw new Error('send 返回 false')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    quietCloseWs(ws)
    throw new Error(`发送 hello 失败: ${msg}`)
  }
  console.log(`${TAG} 已发送 hello -> ${peerId.substring(0, 8)} (service=${serviceKey})`)

  // 等 ack/reject（30s 超时；ping/pong 已在消息处理器里过滤）
  const responseText = await new Promise<string>((resolve, reject) => {
    handshakeResolve = resolve
    handshakeReject = reject
    setTimeout(() => {
      if (handshakeReject === reject) {
        handshakeResolve = null
        handshakeReject = null
        reject(new Error('对方未响应（超时）'))
      }
    }, CONNECT_ACK_TIMEOUT_MS)
  }).catch((e: Error) => {
    quietCloseWs(ws)
    throw e
  })

  let resp: Record<string, Object>
  try {
    resp = JSON.parse(responseText) as Record<string, Object>
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    quietCloseWs(ws)
    throw new Error(`握手响应解析失败: ${msg}`)
  }
  const respType = typeof resp['type'] === 'string' ? (resp['type'] as string) : ''
  if (respType === 'reject') {
    const reason = typeof resp['reason'] === 'string' ? (resp['reason'] as string) : '已拒绝'
    console.log(`${TAG} ✗ 对方拒绝: ${reason}`)
    quietCloseWs(ws)
    throw new Error(reason)
  }
  if (respType !== 'ack') {
    quietCloseWs(ws)
    throw new Error('无效的握手响应')
  }
  console.log(`${TAG} 收到 ack <- ${peerId.substring(0, 8)}`)

  // 建 Outbound Session（消息处理器早已注册，无丢消息窗口）
  const sessionId = util.generateRandomUUID(false)
  const entry: SessionEntry = {
    id: sessionId,
    peerId: peerId,
    peerName: peerName,
    direction: 'outbound',
    inbound: null,
    outbound: ws,
    msgCount: 0
  }
  sessions.set(sessionId, entry)
  sessionEntry = entry
  console.log(`${TAG}    ✓ Outbound session 创建: ${sessionId.substring(0, 8)} -> ${peerId.substring(0, 8)} (${peerName})`)
  const payload: SessionCreatedPayload = {
    sessionId: sessionId,
    peerId: peerId,
    peerName: peerName,
    direction: 'outbound',
    service: serviceKey
  }
  emitEvent('network:session-created', payload)
  const result: ConnectResult = { sessionId: sessionId, peerId: peerId, peerName: peerName }
  return result
}

// ============================================================
// 会话通用
// ============================================================

async function cmdSend(args: Record<string, Object>): Promise<null> {
  const sessionId = reqStr(args['sessionId'], 'sessionId')
  const message = reqStrAllowEmpty(args['message'], 'message')
  const entry = sessions.get(sessionId)
  if (entry === undefined) {
    throw new Error(`会话 ${sessionId} 不存在`)
  }
  const inbound = entry.inbound
  if (inbound !== null) {
    await inbound.sendText(message)
    return null
  }
  const outbound = entry.outbound
  if (outbound !== null) {
    try {
      const ok = await outbound.send(message)
      if (!ok) {
        throw new Error('send 返回 false')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`发送失败: ${msg}`)
    }
    return null
  }
  throw new Error(`会话 ${sessionId} 通道异常`)
}

async function closeSession(sessionId: string): Promise<null> {
  const entry = sessions.get(sessionId)
  if (entry === undefined) {
    return null // Rust: remove 未命中 → Ok
  }
  sessions.delete(sessionId)
  const inbound = entry.inbound
  if (inbound !== null) {
    await inbound.close()
  }
  const outbound = entry.outbound
  if (outbound !== null) {
    quietCloseWs(outbound)
  }
  const payload: SessionClosedPayload = { sessionId: entry.id, reason: 'disconnected' }
  emitEvent('network:session-closed', payload)
  console.log(`${TAG} session ${entry.id.substring(0, 8)} 已断开（本地）`)
  return null
}

// ============================================================
// Listener 管理（引用计数，对齐 Rust）
// ============================================================

async function cmdStartListener(args: Record<string, Object>): Promise<null> {
  const serviceKey = reqStr(args['serviceKey'], 'serviceKey')
  console.log(`${TAG} === startListening: service='${serviceKey}' ===`)
  listeningServices.add(serviceKey)
  listenerRefcount++
  if (listenerRefcount > 1) {
    console.log(`${TAG}    TCP 监听已在运行，refcount=${listenerRefcount}`)
    return null
  }
  const server = new WsServer()
  server.onConnection = (conn: WsInboundConnection) => {
    acceptInbound(conn)
  }
  try {
    wsPort = await server.start()
  } catch (e) {
    // 启动失败回滚计数（Rust 此处残留计数；回滚对前端不可见且更严谨）
    listeningServices.delete(serviceKey)
    listenerRefcount--
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`TCP 绑定失败: ${msg}`)
  }
  wsServer = server
  return null
}

async function cmdStopListener(args: Record<string, Object>): Promise<null> {
  const serviceKey = reqStr(args['serviceKey'], 'serviceKey')
  console.log(`${TAG} === stopListening: service='${serviceKey}' ===`)
  listeningServices.delete(serviceKey)
  if (listenerRefcount > 0) {
    listenerRefcount--
  }
  if (listenerRefcount > 0) {
    console.log(`${TAG}    其他服务仍在监听，保持 TCP 运行`)
    return null
  }
  const server = wsServer
  wsServer = null
  wsPort = 0
  if (server !== null) {
    await server.stop()
  }
  return null
}

// ============================================================
// 参数提取（风格同 HttpCommands/FsCommands）
// ============================================================

function reqStr(v: Object | undefined, name: string): string {
  if (typeof v !== 'string' || (v as string).length === 0) {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

function reqStrAllowEmpty(v: Object | undefined, name: string): string {
  if (typeof v !== 'string') {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

function optStr(v: Object | undefined): string | null {
  return typeof v === 'string' ? (v as string) : null
}

// ============================================================
// 命令入口
// ============================================================
export async function handleNetworkCommand(cmd: string, args: Record<string, Object>): Promise<Object | null> {
  try {
    switch (cmd) {
      case 'network_get_device_id':
        return deviceId
      case 'network_get_device_name':
        return deviceName
      case 'network_get_visibility': {
        const v: TransportVisibility = { lan: visibility.lan, ble: visibility.ble }
        return v
      }
      case 'network_set_visibility': {
        const raw = args['visibility']
        if (typeof raw !== 'object' || raw === null) {
          throw new Error('缺少参数: visibility')
        }
        const vis = raw as Record<string, Object>
        const next: TransportVisibility = { lan: vis['lan'] === true, ble: vis['ble'] === true }
        console.log(`${TAG} === setVisibility: lan=${next.lan} ===`)
        visibility = next
        // 无论开关先停旧 UDP 任务；开则只启 UDP（TCP listener 由服务按需启动）
        stopUdpTasks()
        if (next.lan) {
          const epoch = discoveryEpoch
          startUdpBroadcast(epoch).then(() => {})
          startUdpListener(epoch).then(() => {})
        }
        return next
      }
      case 'network_start_discovery': {
        const transport = reqStr(args['transport'], 'transport')
        console.log(`${TAG} === startDiscovery: transport=${transport} ===`)
        stopUdpTasks()
        if (transport === 'lan' || transport === 'all') {
          const epoch = discoveryEpoch
          startUdpListener(epoch).then(() => {})
          startUdpBroadcast(epoch).then(() => {})
        }
        if (transport === 'ble' || transport === 'all') {
          throw new Error('BLE 当前平台暂不支持')
        }
        return null
      }
      case 'network_stop_discovery':
        stopUdpTasks()
        console.log(`${TAG} 发现已停止`)
        return null
      case 'network_get_visible_devices': {
        const list: DiscoveredPeerWire[] = []
        peers.forEach((p) => {
          const wire: DiscoveredPeerWire = {
            id: p.id,
            name: p.name,
            transport: p.transport,
            address: p.address,
            last_seen: `${p.lastSeenMs}`
          }
          list.push(wire)
        })
        return list
      }
      case 'network_get_ws_port':
        return wsPort
      case 'network_connect':
        return await cmdConnect(args)
      case 'network_send':
        return await cmdSend(args)
      case 'network_disconnect': {
        const sessionId = reqStr(args['sessionId'], 'sessionId')
        return await closeSession(sessionId)
      }
      case 'network_start_listener':
        return await cmdStartListener(args)
      case 'network_stop_listener':
        return await cmdStopListener(args)
      default:
        throw new Error(`未知 network 命令: ${cmd}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ ${cmd} 失败: ${msg}`)
    // ArkTS 限制 throw 只能抛 Error：统一重抛 Error 实例
    throw new Error(msg)
  }
}
