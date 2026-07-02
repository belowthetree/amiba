// ============================================================
// 变形虫 (Amiba) — Network Worker (WebSocket 管理线程)
// 仿 HuLa Worker.ts：浏览器原生 WebSocket + 心跳 + 重连 + 消息队列
// ============================================================

const RECONNECT_MAX = 5
const RECONNECT_DELAY = 2000
const HEARTBEAT_INTERVAL = 9900

/** peerId → 连接状态 */
const peers = new Map()

function postOut(msg) {
  self.postMessage(msg)
}

// ---- 每 peer 清理 ----
function cleanup(conn) {
  if (conn._heartTimer) { clearInterval(conn._heartTimer); conn._heartTimer = null }
  if (conn._reconTimer) { clearTimeout(conn._reconTimer); conn._reconTimer = null }
  conn.ws.removeEventListener('open', conn._onOpen)
  conn.ws.removeEventListener('message', conn._onMsg)
  conn.ws.removeEventListener('close', conn._onClose)
  conn.ws.removeEventListener('error', conn._onError)
}

// ---- 连接 ----
function doConnect(peerId, url) {
  // 清理旧连接
  const old = peers.get(peerId)
  if (old) { cleanup(old); old.ws.close() }

  const ws = new WebSocket(url)
  const conn = { ws, peerId, url, _heartTimer: null, _reconTimer: null, _reconCount: 0, _lockRecon: false, _pending: [] }

  conn._onOpen = () => {
    postOut({ type: 'open', peerId })
    // 心跳
    conn._heartTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, HEARTBEAT_INTERVAL)
    // 清空缓存
    for (const m of conn._pending) ws.send(typeof m === 'string' ? m : JSON.stringify(m))
    conn._pending = []
  }

  conn._onMsg = (e) => postOut({ type: 'message', peerId, data: e.data })

  conn._onClose = () => {
    if (conn._heartTimer) { clearInterval(conn._heartTimer); conn._heartTimer = null }
    if (conn._lockRecon) return
    conn._lockRecon = true
    if (conn._reconCount >= RECONNECT_MAX) {
      postOut({ type: 'error', peerId, msg: '连接失败，已达最大重试次数' })
      cleanup(conn); peers.delete(peerId); return
    }
    conn._reconTimer = setTimeout(() => { conn._reconCount++; conn._lockRecon = false; doConnect(peerId, url) }, RECONNECT_DELAY)
  }

  conn._onError = () => {
    if (ws.readyState !== WebSocket.OPEN) postOut({ type: 'error', peerId, msg: '连接错误' })
  }

  ws.addEventListener('open', conn._onOpen)
  ws.addEventListener('message', conn._onMsg)
  ws.addEventListener('close', conn._onClose)
  ws.addEventListener('error', conn._onError)
  peers.set(peerId, conn)
}

// ---- 发送 ----
function doSend(peerId, message) {
  const conn = peers.get(peerId)
  if (!conn) { postOut({ type: 'error', peerId, msg: '未连接' }); return }
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(typeof message === 'string' ? message : JSON.stringify(message))
  } else {
    conn._pending.push(message)
  }
}

// ---- 断开 ----
function doDisconnect(peerId) {
  const conn = peers.get(peerId)
  if (conn) { cleanup(conn); conn.ws.close(); peers.delete(peerId) }
}

// ---- 主线程消息 ----
self.onmessage = (e) => {
  const { type, peerId, url, message } = e.data
  switch (type) {
    case 'connect': doConnect(peerId, url); break
    case 'send': doSend(peerId, message); break
    case 'disconnect': doDisconnect(peerId); break
    case 'disconnectAll': for (const [id] of peers) doDisconnect(id); break
  }
}
