// ============================================================
// 变形虫 (Amiba) — WS 入站服务端（TCPSocketServer + RFC6455 状态机）
// ============================================================
// 对应 Rust network_session.rs 的 ensure_listener / accept_async 部分：
// TCP 监听（0.0.0.0:0 临时端口）→ 每条连接跑 RFC6455 握手 + 帧收发。
// 帧编解码在 NetworkWsCodec.ets（纯函数，含 RFC 测试向量注释）。
//
// 连接生命周期：handshake（HTTP Upgrade）→ established（帧 IO）→ closed。
// 应用层 hello/ack 服务匹配不在本文件——由 NetworkCommands 经回调驱动。
// ============================================================

import { socket } from '@kit.NetworkKit'
import { util } from '@kit.ArkTS'
import {
  WsFrameDecoder, WsFrame, encodeFrame, findHeaderEnd, parseHandshakeRequest,
  validateHandshake, buildHandshakeResponse,
  OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG
} from './NetworkWsCodec'

const TAG = '[AmibaNetWs]'

// 握手头大小上限（防慢速攻击撑爆缓冲；正常 Upgrade 请求 < 1KB）
const MAX_HANDSHAKE_BYTES: number = 16 * 1024

// 文本编码（FsCommands 经验：encodeInto('') 部分系统版本返回 undefined，空串走零长数组）
function textToBytes(text: string): Uint8Array {
  return text.length === 0 ? new Uint8Array(0) : new util.TextEncoder().encodeInto(text)
}

function bytesToText(bytes: Uint8Array): string {
  return util.TextDecoder.create('utf-8').decodeToString(bytes)
}

// ============================================================
// 单条入站连接：握手 + 帧 IO 状态机
// ============================================================
export class WsInboundConnection {
  /** 对端地址（ip:port，日志用） */
  remoteAddr: string = ''
  /** 握手完成（开始收发应用帧）后置 true */
  established: boolean = false

  private conn: socket.TCPSocketConnection
  private decoder = new WsFrameDecoder()
  private handshakeBuf: Uint8Array = new Uint8Array(0)
  private closed = false
  private closeNotified = false
  // 分片消息重组（RFC6455 §5.4：首帧 opcode 记录 + 载荷拼接）
  private fragOpcode: number = -1
  private fragParts: Uint8Array[] = []

  // ---- 回调（NetworkCommands 接线； ArkTS 严格模式可空函数类型）----
  /** 握手结果：true=101 已回，进入帧模式；false=握手失败/连接已断 */
  onHandshake: ((conn: WsInboundConnection, ok: boolean) => void) | null = null
  /** 完整文本消息（分片已重组；ping/pong/close 控制帧内部消化） */
  onText: ((conn: WsInboundConnection, text: string) => void) | null = null
  /** 连接终结（对端 WS close / TCP 断开 / 协议错误），保证只触发一次 */
  onClosed: ((conn: WsInboundConnection) => void) | null = null
  /** WsServer 专用的集合清理钩子（与业务回调并存，避免包装赋值时序问题） */
  internalOnClosed: ((conn: WsInboundConnection) => void) | null = null

  constructor(conn: socket.TCPSocketConnection) {
    this.conn = conn
    conn.on('message', (info: socket.SocketMessageInfo) => {
      this.handleData(new Uint8Array(info.message))
    })
    conn.on('close', () => {
      this.notifyClosed('tcp-close')
    })
    conn.on('error', (err: Error) => {
      console.error(`${TAG} ✗ 连接错误 (${this.remoteAddr}): ${err.message}`)
      this.notifyClosed('tcp-error')
    })
  }

  async initRemoteAddr(): Promise<void> {
    try {
      const addr = await this.conn.getRemoteAddress()
      this.remoteAddr = `${addr.address}:${addr.port}`
    } catch (e) {
      this.remoteAddr = 'unknown'
    }
  }

  // ---- 发送 ----

  /** 发文本帧（服务端不掩码，RFC6455 §5.1） */
  async sendText(text: string): Promise<void> {
    if (this.closed) {
      throw new Error('连接已关闭')
    }
    await this.sendFrame(OP_TEXT, textToBytes(text))
  }

  /** 发 WS close 帧后关 TCP（本地主动断开的标准告别） */
  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    try {
      await this.sendFrame(OP_CLOSE, new Uint8Array(0))
    } catch (e) {
      // 已断开：忽略
    }
    this.closeTcp()
  }

  closeTcp(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    try {
      this.conn.off('message')
      this.conn.off('close')
      this.conn.off('error')
      this.conn.close()
    } catch (e) {
      // 已关闭：忽略
    }
    this.notifyClosed('local-close')
  }

  private async sendFrame(opcode: number, payload: Uint8Array): Promise<void> {
    const wire = encodeFrame(opcode, payload, null)
    try {
      await this.conn.send({ data: wire.buffer })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`发送失败: ${msg}`)
    }
  }

  // ---- 接收 ----

  private handleData(data: Uint8Array): void {
    if (this.closed) {
      return
    }
    if (!this.established) {
      this.handleHandshakeData(data)
      return
    }
    let frames: WsFrame[]
    try {
      frames = this.decoder.feed(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`${TAG} ✗ 帧解析失败 (${this.remoteAddr}): ${msg}`)
      // 协议错误：回 close 帧再断（RFC6455 §7.1.7）
      this.close().then(() => {})
      return
    }
    for (const frame of frames) {
      this.handleFrame(frame)
    }
  }

  // 握手阶段：攒头直到 \r\n\r\n → 解析校验 → 回 101
  private handleHandshakeData(data: Uint8Array): void {
    const merged = new Uint8Array(this.handshakeBuf.length + data.length)
    merged.set(this.handshakeBuf, 0)
    merged.set(data, this.handshakeBuf.length)
    this.handshakeBuf = merged

    if (this.handshakeBuf.length > MAX_HANDSHAKE_BYTES) {
      console.error(`${TAG} ✗ 握手头超限 (${this.remoteAddr})`)
      this.closeTcp()
      const cb = this.onHandshake
      if (cb !== null) {
        cb(this, false)
      }
      return
    }

    const headerEnd = findHeaderEnd(this.handshakeBuf)
    if (headerEnd < 0) {
      return // 头未收齐，等下一段
    }
    const headerText = bytesToText(this.handshakeBuf.subarray(0, headerEnd))
    // 头后多余字节（罕见：握手与首帧同报文）转入帧解码
    const rest = this.handshakeBuf.subarray(headerEnd)
    this.handshakeBuf = new Uint8Array(0)

    const req = parseHandshakeRequest(headerText)
    if (req === null || !validateHandshake(req)) {
      console.error(`${TAG} ✗ WS 握手校验失败 (${this.remoteAddr})`)
      this.closeTcp()
      const cb = this.onHandshake
      if (cb !== null) {
        cb(this, false)
      }
      return
    }

    const key = req.headers.get('sec-websocket-key') as string
    const response = buildHandshakeResponse(key)
    this.conn.send({ data: textToBytes(response).buffer })
      .then(() => {
        if (this.closed) {
          return
        }
        this.established = true
        console.log(`${TAG} ✓ WS 握手完成 (${this.remoteAddr})`)
        const cb = this.onHandshake
        if (cb !== null) {
          cb(this, true)
        }
        if (rest.length > 0) {
          this.handleData(rest)
        }
      })
      .catch((e: Error) => {
        console.error(`${TAG} ✗ 101 响应发送失败 (${this.remoteAddr}): ${e.message}`)
        this.closeTcp()
        const cb = this.onHandshake
        if (cb !== null) {
          cb(this, false)
        }
      })
  }

  private handleFrame(frame: WsFrame): void {
    if (this.closed) {
      return
    }
    switch (frame.opcode) {
      case OP_PING:
        // ping → pong（RFC6455 §5.5.2，载荷原样带回）
        this.sendFrame(OP_PONG, frame.payload).catch(() => {})
        return
      case OP_PONG:
        return // 应用层无 WS ping 发起方，pong 直接丢弃
      case OP_CLOSE:
        // 对端告别：若此前未发过 close（本地主动 close 会把 closed 置位），回 close 帧
        if (!this.closed) {
          this.sendFrame(OP_CLOSE, new Uint8Array(0))
            .catch(() => {})
            .then(() => {
              this.closeTcp()
            })
        }
        return
      case OP_TEXT:
      case OP_BINARY:
      case OP_CONT:
        this.handleDataFrame(frame)
        return
      default:
        console.error(`${TAG} ✗ 未知 opcode=${frame.opcode} (${this.remoteAddr})`)
        this.close().then(() => {})
        return
    }
  }

  // 数据帧：分片重组后产出完整文本消息
  private handleDataFrame(frame: WsFrame): void {
    if (frame.opcode === OP_CONT) {
      if (this.fragOpcode < 0) {
        console.error(`${TAG} ✗ 孤立 continuation 帧 (${this.remoteAddr})`)
        this.close().then(() => {})
        return
      }
      this.fragParts.push(frame.payload)
    } else {
      if (this.fragOpcode >= 0) {
        console.error(`${TAG} ✗ 分片未结束又来新数据帧 (${this.remoteAddr})`)
        this.close().then(() => {})
        return
      }
      this.fragOpcode = frame.opcode
      this.fragParts = [frame.payload]
    }
    if (!frame.fin) {
      return // 等后续 continuation
    }
    const opcode = this.fragOpcode
    const parts = this.fragParts
    this.fragOpcode = -1
    this.fragParts = []

    let total = 0
    for (const p of parts) {
      total += p.length
    }
    const payload = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      payload.set(p, off)
      off += p.length
    }
    // 文本/二进制统一按 UTF-8 解码为文本（对齐 Rust into_text() 语义：
    // 应用层协议只有 JSON 文本，二进制帧视同文本处理）
    const text = opcode === OP_TEXT || opcode === OP_BINARY ? bytesToText(payload) : ''
    const cb = this.onText
    if (cb !== null) {
      cb(this, text)
    }
  }

  private notifyClosed(reason: string): void {
    if (this.closeNotified) {
      return
    }
    this.closeNotified = true
    this.closed = true
    console.log(`${TAG} 连接关闭 (${this.remoteAddr}): ${reason}`)
    const internal = this.internalOnClosed
    if (internal !== null) {
      internal(this)
    }
    const cb = this.onClosed
    if (cb !== null) {
      cb(this)
    }
  }
}

// ============================================================
// 监听服务：TCPSocketServer 0.0.0.0:0（临时端口，对齐 Rust）
// ============================================================
export class WsServer {
  /** TCP 接入回调（握手尚未开始） */
  onConnection: ((conn: WsInboundConnection) => void) | null = null
  private server: socket.TCPSocketServer | null = null
  private conns = new Set<WsInboundConnection>()

  /** 启动监听，返回实际端口 */
  async start(): Promise<number> {
    const server = socket.constructTCPSocketServerInstance()
    this.server = server
    server.on('connect', (client: socket.TCPSocketConnection) => {
      const conn = new WsInboundConnection(client)
      this.conns.add(conn)
      conn.internalOnClosed = (c: WsInboundConnection) => {
        this.conns.delete(c)
      }
      conn.initRemoteAddr().then(() => {
        console.log(`${TAG} === 新入站连接 (${conn.remoteAddr}) ===`)
        const cb = this.onConnection
        if (cb !== null) {
          cb(conn)
        }
      })
    })
    server.on('error', (err: Error) => {
      console.error(`${TAG} ✗ 监听错误: ${err.message}`)
    })
    await server.listen({ address: '0.0.0.0', family: 1, port: 0 })
    const local = await server.getLocalAddress()
    // NetAddress.port 声明为可选；listen 成功后必有值，防御缺省 0（0 会被对端按「未开放连接」处理）
    const port = local.port ?? 0
    console.log(`${TAG} ✓ TCP 监听已启动，端口: ${port}`)
    return port
  }

  /** 会话接管连接：从监听集合摘除（stop 不再关闭它，对齐 Rust session 独立于 listener） */
  release(conn: WsInboundConnection): void {
    this.conns.delete(conn)
  }

  /** 停止监听：关闭尚未建会话的连接（已建会话的连接经 release 摘除，不受 listener 停止影响） */
  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    for (const conn of this.conns) {
      conn.closeTcp()
    }
    this.conns.clear()
    if (server !== null) {
      try {
        server.off('connect')
        server.off('error')
        await server.close()
      } catch (e) {
        // 已关闭：忽略
      }
    }
    console.log(`${TAG} TCP 监听已停止`)
  }
}
