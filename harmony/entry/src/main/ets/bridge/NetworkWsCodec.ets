// ============================================================
// 变形虫 (Amiba) — RFC6455 WebSocket 编解码（纯函数，零依赖）
// ============================================================
// 鸿蒙壳 WS 服务端的协议核心：SHA1 / Base64 / 握手 / 帧编解码。
// 本文件刻意不 import 任何 @kit 模块——全部为标准 TypeScript 纯函数，
// 可用 tsc 单独编译后在 Node 下跑测试向量离线验证（协议自查手段）。
//
// 官方测试向量（注释即 Review 依据）：
//   RFC6455 §1.2 握手示例：
//     Sec-WebSocket-Key:    dGhlIHNhbXBsZSBub25jZQ==
//     Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
//   RFC3174 SHA1 向量：
//     sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d
//     sha1("")    = da39a3ee5e6b4b0d3255bfef95601890afd80709
//     sha1("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
//                 = 84983e441c3bd26ebaae4aa1f95129e5e54670f1
//   RFC6455 §5.7 帧示例：
//     "Hello" 不掩码帧: 81 05 48 65 6c 6c 6f
//     "Hello" 掩码帧(mask=37fa213d): 81 85 37 fa 21 3d 7f 9f 4d 51 58
// ============================================================

// ---- 帧操作码（RFC6455 §5.2）----
export const OP_CONT: number = 0x0
export const OP_TEXT: number = 0x1
export const OP_BINARY: number = 0x2
export const OP_CLOSE: number = 0x8
export const OP_PING: number = 0x9
export const OP_PONG: number = 0xA

// 单帧载荷上限（对齐 tokio-tungstenite 默认 max_message_size 64MiB）
export const MAX_FRAME_PAYLOAD: number = 64 * 1024 * 1024

// ============================================================
// SHA1（RFC3174 逐位实现，32 位无符号运算经 | 0 / >>> 0 约束）
// ============================================================

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) | 0
}

export function sha1(data: Uint8Array): Uint8Array {
  // 消息长度（bit），拆成高/低两个 32 位字写入尾部（本场景输入远小于 2^32 bit）
  const bitLen: number = data.length * 8
  const lenHigh: number = Math.floor(bitLen / 0x100000000)
  const lenLow: number = bitLen >>> 0

  // padding：尾部 0x80 + 0x00* + 8 字节长度，总长补齐到 64 的倍数
  const padTotal: number = (data.length % 64 < 56)
    ? (56 - data.length % 64)
    : (120 - data.length % 64)
  const msg = new Uint8Array(data.length + padTotal + 8)
  msg.set(data, 0)
  msg[data.length] = 0x80
  const tailPos = msg.length - 8
  msg[tailPos] = (lenHigh >>> 24) & 0xFF
  msg[tailPos + 1] = (lenHigh >>> 16) & 0xFF
  msg[tailPos + 2] = (lenHigh >>> 8) & 0xFF
  msg[tailPos + 3] = lenHigh & 0xFF
  msg[tailPos + 4] = (lenLow >>> 24) & 0xFF
  msg[tailPos + 5] = (lenLow >>> 16) & 0xFF
  msg[tailPos + 6] = (lenLow >>> 8) & 0xFF
  msg[tailPos + 7] = lenLow & 0xFF

  let h0: number = 0x67452301 | 0
  let h1: number = 0xEFCDAB89 | 0
  let h2: number = 0x98BADCFE | 0
  let h3: number = 0x10325476 | 0
  let h4: number = 0xC3D2E1F0 | 0
  const w = new Int32Array(80)

  for (let block = 0; block < msg.length; block += 64) {
    for (let t = 0; t < 16; t++) {
      const i = block + t * 4
      w[t] = ((msg[i] << 24) | (msg[i + 1] << 16) | (msg[i + 2] << 8) | msg[i + 3]) | 0
    }
    for (let t = 16; t < 80; t++) {
      w[t] = rotl32((w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]) | 0, 1)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let t = 0; t < 80; t++) {
      let f: number
      let k: number
      if (t < 20) {
        f = ((b & c) | ((~b) & d)) | 0
        k = 0x5A827999 | 0
      } else if (t < 40) {
        f = (b ^ c ^ d) | 0
        k = 0x6ED9EBA1 | 0
      } else if (t < 60) {
        f = ((b & c) | (b & d) | (c & d)) | 0
        k = 0x8F1BBCDC | 0
      } else {
        f = (b ^ c ^ d) | 0
        k = 0xCA62C1D6 | 0
      }
      const tmp = (rotl32(a, 5) + f + e + k + w[t]) | 0
      e = d
      d = c
      c = rotl32(b, 30)
      b = a
      a = tmp
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }

  const out = new Uint8Array(20)
  const hs: number[] = [h0, h1, h2, h3, h4]
  for (let i = 0; i < 5; i++) {
    out[i * 4] = (hs[i] >>> 24) & 0xFF
    out[i * 4 + 1] = (hs[i] >>> 16) & 0xFF
    out[i * 4 + 2] = (hs[i] >>> 8) & 0xFF
    out[i * 4 + 3] = hs[i] & 0xFF
  }
  return out
}

// ============================================================
// Base64 编码（RFC4648，标准字母表，仅 encode——握手只需单向）
// 向量：base64(0x73 0xB3 0xCF ...) → 见 computeAcceptKey 的 RFC6455 向量
// ============================================================

const B64_ALPHABET: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64Encode(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i += 3) {
    const b0 = data[i]
    const has1 = i + 1 < data.length
    const has2 = i + 2 < data.length
    const b1 = has1 ? data[i + 1] : 0
    const b2 = has2 ? data[i + 2] : 0
    out += B64_ALPHABET.charAt((b0 >> 2) & 0x3F)
    out += B64_ALPHABET.charAt(((b0 << 4) | (b1 >> 4)) & 0x3F)
    out += has1 ? B64_ALPHABET.charAt(((b1 << 2) | (b2 >> 6)) & 0x3F) : '='
    out += has2 ? B64_ALPHABET.charAt(b2 & 0x3F) : '='
  }
  return out
}

// ============================================================
// 握手（RFC6455 §1.2/§4）
// ============================================================

// RFC6455 §1.2 规定的固定 GUID
const WS_GUID: string = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// Sec-WebSocket-Accept = base64(SHA1(key + GUID))
// 向量：computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==") === "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
export function computeAcceptKey(secWebSocketKey: string): string {
  const src = secWebSocketKey + WS_GUID
  const bytes = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) {
    // key + GUID 均为 ASCII（key 为 base64 串），逐字节取 charCode 即可
    bytes[i] = src.charCodeAt(i) & 0xFF
  }
  return base64Encode(sha1(bytes))
}

// ---- 握手请求解析 ----

export interface WsHandshakeRequest {
  method: string
  path: string
  /** 头部键已统一小写 */
  headers: Map<string, string>
}

// 在字节流中查找头结束标记 \r\n\r\n，返回其结束偏移（不含则 -1）
export function findHeaderEnd(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0x0D && buf[i + 1] === 0x0A && buf[i + 2] === 0x0D && buf[i + 3] === 0x0A) {
      return i + 4
    }
  }
  return -1
}

// 解析 HTTP Upgrade 请求头文本（头区为 ASCII，逐字节拉丁解码即可）。
// 校验规则对齐 tokio-tungstenite 服务端：GET 方法 + Upgrade: websocket +
// Connection 含 upgrade + Sec-WebSocket-Key 存在 + Sec-WebSocket-Version: 13。
// 不合法返回 null（调用方直接断开，对齐 Rust accept_async 失败即 return）。
export function parseHandshakeRequest(text: string): WsHandshakeRequest | null {
  const lines = text.split('\r\n')
  if (lines.length < 1 || lines[0].length === 0) {
    return null
  }
  const parts = lines[0].split(' ')
  if (parts.length < 3) {
    return null
  }
  const req: WsHandshakeRequest = {
    method: parts[0],
    path: parts[1],
    headers: new Map<string, string>()
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.length === 0) {
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) {
      continue
    }
    const key = line.substring(0, colon).trim().toLowerCase()
    const value = line.substring(colon + 1).trim()
    req.headers.set(key, value)
  }
  return req
}

// 校验握手请求是否满足 WS 升级条件（不校验 path，tungstenite 同样不校验）
export function validateHandshake(req: WsHandshakeRequest): boolean {
  if (req.method.toUpperCase() !== 'GET') {
    return false
  }
  const upgrade = req.headers.get('upgrade')
  if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
    return false
  }
  const connection = req.headers.get('connection')
  if (connection === undefined || connection.toLowerCase().indexOf('upgrade') < 0) {
    return false
  }
  const key = req.headers.get('sec-websocket-key')
  if (key === undefined || key.length === 0) {
    return false
  }
  const version = req.headers.get('sec-websocket-version')
  if (version === undefined || version.trim() !== '13') {
    return false
  }
  return true
}

// 101 响应（头部字段与顺序按 RFC6455 §1.2 示例；tungstenite 客户端只按名取值）
export function buildHandshakeResponse(secWebSocketKey: string): string {
  return 'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${computeAcceptKey(secWebSocketKey)}\r\n` +
    '\r\n'
}

// ============================================================
// 帧编解码（RFC6455 §5）
// ============================================================

export interface WsFrame {
  fin: boolean
  opcode: number
  /** 已去掩码的载荷 */
  payload: Uint8Array
}

// 编码一帧。maskKey 为 null 表示不掩码（服务端方向）；
// 客户端方向必须传 32 位掩码（本模块仅服务端用，保留参数便于单测对齐 RFC 向量）。
export function encodeFrame(opcode: number, payload: Uint8Array, maskKey: number | null): Uint8Array {
  const masked = maskKey !== null
  const len = payload.length
  let headLen: number
  if (len < 126) {
    headLen = 2
  } else if (len <= 0xFFFF) {
    headLen = 4
  } else {
    headLen = 10
  }
  const total = headLen + (masked ? 4 : 0) + len
  const out = new Uint8Array(total)
  out[0] = 0x80 | (opcode & 0x0F) // FIN=1（本实现发送不分片）
  let pos = 1
  const maskBit = masked ? 0x80 : 0x00
  if (len < 126) {
    out[pos++] = maskBit | len
  } else if (len <= 0xFFFF) {
    out[pos++] = maskBit | 126
    out[pos++] = (len >>> 8) & 0xFF
    out[pos++] = len & 0xFF
  } else {
    out[pos++] = maskBit | 127
    // 64 位长度：高 32 位 + 低 32 位（len < 2^53 内安全）
    const high = Math.floor(len / 0x100000000)
    const low = len >>> 0
    out[pos++] = (high >>> 24) & 0xFF
    out[pos++] = (high >>> 16) & 0xFF
    out[pos++] = (high >>> 8) & 0xFF
    out[pos++] = high & 0xFF
    out[pos++] = (low >>> 24) & 0xFF
    out[pos++] = (low >>> 16) & 0xFF
    out[pos++] = (low >>> 8) & 0xFF
    out[pos++] = low & 0xFF
  }
  if (maskKey !== null) {
    const mk = new Uint8Array(4)
    mk[0] = (maskKey >>> 24) & 0xFF
    mk[1] = (maskKey >>> 16) & 0xFF
    mk[2] = (maskKey >>> 8) & 0xFF
    mk[3] = maskKey & 0xFF
    out.set(mk, pos)
    pos += 4
    for (let i = 0; i < len; i++) {
      out[pos + i] = payload[i] ^ mk[i % 4]
    }
  } else {
    out.set(payload, pos)
  }
  return out
}

// 增量帧解码器：TCP 分段任意，feed() 榨出所有完整帧；协议错误抛 Error（调用方断开连接）
export class WsFrameDecoder {
  private buf: Uint8Array = new Uint8Array(0)

  feed(data: Uint8Array): WsFrame[] {
    // 追加到内部缓冲
    const merged = new Uint8Array(this.buf.length + data.length)
    merged.set(this.buf, 0)
    merged.set(data, this.buf.length)
    this.buf = merged

    const frames: WsFrame[] = []
    for (;;) {
      const frame = this.tryParseOne()
      if (frame === null) {
        break
      }
      frames.push(frame)
    }
    return frames
  }

  // 尝试解析一帧：数据不足返回 null 且不动缓冲；成功则消费对应字节
  private tryParseOne(): WsFrame | null {
    const buf = this.buf
    if (buf.length < 2) {
      return null
    }
    const b0 = buf[0]
    const b1 = buf[1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0F
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7F
    let pos = 2

    if (len === 126) {
      if (buf.length < pos + 2) {
        return null
      }
      len = (buf[pos] << 8) | buf[pos + 1]
      pos += 2
    } else if (len === 127) {
      if (buf.length < pos + 8) {
        return null
      }
      // 64 位长度（高位必须 ≤ 0x1FFFFF，超出 MAX_FRAME_PAYLOAD 直接协议错误）
      const high = ((buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0
      const low = ((buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7]) >>> 0
      pos += 8
      if (high > 0x1FFFFF) {
        throw new Error(`WS 帧长度过大: high=${high}`)
      }
      len = high * 0x100000000 + low
    }
    if (len > MAX_FRAME_PAYLOAD) {
      throw new Error(`WS 帧长度超限: ${len}`)
    }

    let maskKey: number | null = null
    if (masked) {
      if (buf.length < pos + 4) {
        return null
      }
      maskKey = ((buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0
      pos += 4
    }
    if (buf.length < pos + len) {
      return null
    }

    const payload = new Uint8Array(len)
    if (maskKey !== null) {
      const mk0 = (maskKey >>> 24) & 0xFF
      const mk1 = (maskKey >>> 16) & 0xFF
      const mk2 = (maskKey >>> 8) & 0xFF
      const mk3 = maskKey & 0xFF
      const mk: number[] = [mk0, mk1, mk2, mk3]
      for (let i = 0; i < len; i++) {
        payload[i] = buf[pos + i] ^ mk[i % 4]
      }
    } else {
      payload.set(buf.subarray(pos, pos + len), 0)
    }

    this.buf = buf.subarray(pos + len)
    const frame: WsFrame = { fin: fin, opcode: opcode, payload: payload }
    return frame
  }
}
