---
name: p2p-network
description: Amiba 局域网 P2P 通信开发指南 — 设备发现、建立会话、收发消息的完整流程与注意事项
keywords:
  - 网络
  - P2P
  - 通信
  - 局域网
  - 连接
  - 聊天
  - 发送
  - 消息
  - 发现设备
  - 互联
  - peer
  - session
  - network
---

# Amiba 局域网 P2P 通信指南 (p2p-network)

当服务需要在局域网内与其他设备通信时，使用 `__amiba__.network` API。核心模型：**UDP 发现设备 + 每个连接封装为 `NetworkSession`**。

---

## 1. 权限声明

服务 `manifest.json` 必须声明 `network` 权限：

```json
{ "permissions": ["network"] }
```

如需使用 toast 提示，同时加 `notification`。

---

## 2. API 速查

### 可见性与发现

```js
// 使本设备在局域网中可见（仅 UDP 广播/监听，不启动 TCP）
await __amiba__.network.setVisibility({ lan: true, ble: false })

// 开始扫描局域网设备
await __amiba__.network.startDiscovery('lan')

// 获取已发现设备列表
const devices = await __amiba__.network.getVisibleDevices()
// → [{ id, name, transport, address, lastSeen }, ...]

// 停止扫描
await __amiba__.network.stopDiscovery('lan')

// 监听新设备出现
__amiba__.network.onPeerDiscovered((peer) => {
  // peer: { id, name, transport, address }
})
```

### 监听控制（按需，必须先调用才能接收外来连接）

```js
// 请求启动 TCP 监听 + 注册服务标识（引用计数；归零时停止）
await __amiba__.network.startListening('p2p-chat')

// 停止监听（host 在服务卸载时自动调用）
await __amiba__.network.stopListening('p2p-chat')
```

### 会话（Session）

> **TCP 监听由服务按需启动**：`setVisibility` 只负责 UDP 发现，服务需主动调用 `startListening(serviceKey)` 才启动 TCP 监听，以接收外来连接。

```js
// ① 开始监听（启动 TCP 监听 + 注册服务标识）
await __amiba__.network.startListening('p2p-chat')

// ② 主动连接 → 发送 hello 握手 → 返回 session 对象
const session = await __amiba__.network.connect(peerId, "你好，一起聊天？", 'p2p-chat')
// → { id, peerId, peerName, send(), close(), on() }

// 发送消息（原始字符串，建议 JSON 序列化）
await session.send(JSON.stringify({ type: 'chat', text: '你好' }))

// 接收消息
session.on('message', (raw) => {
  const data = JSON.parse(raw)
  // ...
})

// 监听对方断开
session.on('close', () => {
  // 清理 UI 状态
})

// 主动断开
await session.close()

// 停止监听（可在服务退出时调用；host 也会在 iframe 卸载时自动清理）
await __amiba__.network.stopListening('p2p-chat')
```

### 接受外来连接

```js
// 服务必须先 startListening，才能接收外来连接
await __amiba__.network.startListening('p2p-chat')

// 被动方在 accept 后收到 session（仅本服务 accept 后才触发）
__amiba__.network.onSession((session) => {
  // session 对象同上，可直接使用
  session.on('message', ...)
  session.on('close', ...)
})
```

### 握手确认（服务自行处理）

**不再由宿主弹出全局对话框。** 服务调用 `startListening` 后，外来连接请求只转发给本服务。服务在 iframe 内自行展示确认 UI 并决定 accept/reject：

```js
// 必须先 startListening，否则不会收到 session-request
await __amiba__.network.startListening('p2p-chat')

__amiba__.network.onSessionRequest((info) => {
  // info: { pendingId, peerId, peerName, greeting, service }
  console.log(`${info.peerName} 想连接至 ${info.service}：${info.greeting}`)

  // 服务自行显示确认 UI 后：
  __amiba__.network.acceptSessionRequest(info.pendingId)

  // 或拒绝
  __amiba__.network.rejectSessionRequest(info.pendingId, '不想聊')
})
```

**注意**：hello 消息包含 `service` 字段。Rust 层会验证是否存在匹配的监听服务，不匹配则直接拒绝。30s 无响应自动超时拒绝。

---

## 3. 完整通信流程

### 双方必须做的事

```
设备 A                          设备 B
─────────────────────────────────────────────────────────
setVisibility({lan:true})      setVisibility({lan:true})  ← ① 变为可见（UDP 发现）
startDiscovery('lan')          startDiscovery('lan')      ← ② 开始扫描
startListening('p2p-chat')    startListening('p2p-chat') ← ③ 启动 TCP 监听（按需）
   │                               │
   │  ← UDP 广播互相发现 →          │
   │                               │
connect(B_id,"你好","p2p-chat")    │                      ← ④ A 主动连接（指定目标服务）
   │                               │
   ├─ 发 hello{service:"p2p-chat"}  ├─ 收到 hello           ← ⑤ B 验证 service 匹配
   │                               ├─ 转发 session-request 到 p2p-chat 服务
   │                               ├─ 服务自行展示 UI，调 accept → 发 ack
   │                               │
   ├─ 收到 ack → session 就绪       ├─ onSession(session)   ← ⑥ 握手完成
   │                               │
session.send(JSON.stringify(     session.on('message',     ← ⑦ 收发消息
   {type:'chat',text:'hi'}))        (raw) => {...})
session.on('message', ...)        session.send(...)
```

### 注意事项

1. **`setVisibility({lan:true})` 只管 UDP 发现**。TCP 监听由服务按需启动（`startListening`），不调用则无法被连接。
2. **`startDiscovery` 的参数是字符串 `'lan'`**，不是 `{transport:'lan'}`。
3. **先 `startListening` 再等连接**：不调用 `startListening`，Rust 会直接拒绝外来连接（"没有服务在监听"）。
4. **connect() 需指定 serviceKey**：第三个参数标识目标服务，hello 中携带 `service` 字段用于路由。
5. **消息格式为字符串**，推荐 JSON 序列化。服务自行设计消息协议（如 `{type, payload}`）。
6. **Session 绑定服务生命周期**：服务 iframe 卸载时，所有 session 会自动 close，同时自动 `stopListening`。

---

## 4. Session 对象完整参考

| 属性/方法 | 类型 | 说明 |
|-----------|------|------|
| `id` | string | session UUID |
| `peerId` | string | 对方设备 ID |
| `peerName` | string | 对方设备名称（主机名） |
| `send(message)` | async (string) → void | 发送字符串消息 |
| `close()` | async () → void | 关闭会话 |
| `on('message', cb)` | (string) → () => void | 监听消息，返回取消函数 |
| `on('close', cb)` | () → () => void | 监听关闭，返回取消函数 |

---

## 5. DiscoveredPeer 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 设备唯一标识 |
| `name` | string | 设备主机名 |
| `transport` | `'lan'` \| `'ble'` | 发现方式 |
| `address` | string | `IP:port` 格式的 WebSocket 地址 |
| `lastSeen` | string | ISO 时间戳 |

---

## 6. 示例：P2P 聊天服务

参考 `example/p2p-chat/` 目录下的完整实现。

核心片段：

```js
const SERVICE_KEY = 'p2p-chat'
let currentSession = null

// 初始化：启动 UDP 发现 + TCP 监听
await __amiba__.network.setVisibility({ lan: true })
await __amiba__.network.startDiscovery('lan')
await __amiba__.network.startListening(SERVICE_KEY)
// 服务卸载时 host 自动调 stopListening(SERVICE_KEY)

// 连接（含打招呼 + 目标服务标识）
async function connectTo(peerId, name) {
  currentSession = await __amiba__.network.connect(peerId, `你好，我是${name}`, SERVICE_KEY)
  currentSession.on('message', (raw) => {
    const data = JSON.parse(raw)
    addMessage(data.text)
  })
  currentSession.on('close', () => {
    currentSession = null
  })
}

// 发送
async function sendMsg(text) {
  if (!currentSession) return
  await currentSession.send(JSON.stringify({ type: 'chat', text }))
}

// 接受外来连接（仅本服务的 session-request，需先 startListening）
__amiba__.network.onSessionRequest((info) => {
  // 服务自行展示确认 UI
  showConnectDialog(`${info.peerName} 想与你聊天："${info.greeting}"`, {
    onAccept: () => __amiba__.network.acceptSessionRequest(info.pendingId),
    onReject: () => __amiba__.network.rejectSessionRequest(info.pendingId, '不想聊'),
  })
})

// 外来 session（仅在 accept 后触发）
__amiba__.network.onSession((session) => {
  currentSession = session
  currentSession.on('message', ...)
  currentSession.on('close', ...)
})

// 发现设备
__amiba__.network.onPeerDiscovered(() => refreshDeviceList())
setInterval(() => refreshDeviceList(), 4000)
```

// 发现
__amiba__.network.onPeerDiscovered(() => refreshDeviceList())
setInterval(() => refreshDeviceList(), 4000)
```

---

## 7. 注意

- **仅局域网**：设备必须在同一子网内（UDP 广播可达）
- **端口 28880**：防火墙需放行 UDP 端口 28880（发现协议），WebSocket 端口随机
- **Web 浏览器不支持**：网络功能仅 Tauri 桌面端可用
- **每条消息独立**：无内置协议层，RPC/重试/超时由服务自行实现
- **不要轮询 `getVisibleDevices` 过频**：建议 4-5 秒间隔
