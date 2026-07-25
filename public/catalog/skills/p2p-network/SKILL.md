---
name: p2p-network
description: Amiba 局域网通信开发指南 — 多人房间（createRoom/joinRoom）与 P2P 会话（设备发现、connect、收发消息）的完整流程与注意事项
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
  - 房间
  - 多人
  - 房主
  - 广播
  - peer
  - session
  - network
  - room
---

# Amiba 局域网通信指南 (p2p-network)

当服务需要在局域网内与其他设备通信时，使用 `__amiba__.network` API。两种模型按场景选择：

- **多人房间（优先）**：`createRoom` / `joinRoom` — 房主-成员星型拓扑，成员管理、广播、断线清理由宿主完成，**无需自行维护 session 列表**。
- **P2P 会话**：UDP 发现 + `connect` 建立 `NetworkSession` — 适用于一对一或需要完全自定义协议的场景。

---

## 0. 多人房间 API（房间/组队/广播场景优先使用）

> 适用：聊天室、多人游戏、协作看板等「一个房主 + 多个成员」的场景。
> 加入者与房主必须运行**相同服务**；同设备同服务同时只能有一个活跃房间。

```js
// ── 房主 ──
const room = await __amiba__.network.createRoom({
  name: '对战房',     // 可选，默认 "<主机名> 的房间"
  hostName: '小明',   // 可选，默认设备主机名
  maxMembers: 6,      // 可选，含房主，默认 8
})
// room: { id, name, isHost: true, selfId, hostId, members, broadcast, sendTo, kick, close, on }

room.on('member-join', ({ member, members }) => { /* 新成员 */ })
room.on('member-leave', ({ member, members }) => { /* 成员离开 */ })
room.on('message', ({ from, data }) => { /* 成员 → 房主的消息 */ })

await room.broadcast({ type: 'state', data: gameState })  // 广播全体
await room.sendTo(memberId, { type: 'private' })          // 定向发送
await room.kick(memberId)                                 // 踢出
await room.close()                                        // 解散房间

// ── 成员 ──
await __amiba__.network.setVisibility({ lan: true })
await __amiba__.network.startDiscovery('lan')
const devices = await __amiba__.network.getVisibleDevices()  // 发现房主设备

const room = await __amiba__.network.joinRoom(peerId, { name: '小红' })
// 失败抛错：「该设备上没有可加入的房间」/「房间已满」/「加入房间超时」

await room.send({ type: 'ready' })              // 发给房主（data 任意 JSON）
room.on('message', ({ from, data }) => { /* 房主 broadcast / sendTo 的消息 */ })
room.on('member-join', ({ member, members }) => { /* members 自动保持最新 */ })
room.on('member-leave', ({ member, members }) => {})
room.on('close', ({ reason }) => { /* closed | kicked | disconnected */ })
await room.close()                              // 离开房间
```

**房间注意事项**：

1. **不要混用 session API**：房间内部已管理监听与连接，房主无需 `startListening`，成员不要 `connect`。
2. **`data` 必须可 JSON 序列化**（对象/数组/字符串/数字）。
3. **群聊转发模式**：成员消息只到房主，需要群聊时由房主再 `broadcast`（把发送者名字放进 data）。
4. `members` 含房主与自己，`isHost: true` 标记房主；事件回调始终携带最新 `members` 快照。
5. 完整参考见内置文档 `room.md`。

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
const session = await __amiba__.network.connect(peerId, 'p2p-chat')
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
// 服务必须先 startListening，匹配的服务才会自动建会话
await __amiba__.network.startListening('p2p-chat')

// 同服务对端连接时，本服务直接收到 session（自动，无需手动确认）
__amiba__.network.onSession((session) => {
  // session 对象同上，可直接使用
  session.on('message', ...)
  session.on('close', ...)
})
```

### 服务匹配（传输层，对应用透明）

连接建立时底层自动验证 `service` 是否匹配。对服务而言，只是收到了另一台机器相同服务发来的数据，无需关心握手细节：

```
A: connect(peerId, 'p2p-chat')
   → hello{service:"p2p-chat"}
                                B: accept → 检查 listening_services
                                   → 匹配 "p2p-chat" → 自动 ack → onSession
                                   → 不匹配 → 自动 reject
   ← ack → session 就绪
```

**注意**：hello 消息包含 `service` 字段，Rust 自动匹配。30s 无 ack 自动超时失败。

---

## 3. 完整通信流程

### 双方必须做的事

```
设备 A                          设备 B
─────────────────────────────────────────────────────────
setVisibility({lan:true})      setVisibility({lan:true})  ← ① 变为可见（UDP 发现）
startDiscovery('lan')          startDiscovery('lan')      ← ② 开始扫描
startListening('p2p-chat')    startListening('p2p-chat') ← ③ 启动 TCP 监听
   │                               │
   │  ← UDP 广播互相发现 →          │
   │                               │
connect(B_id, 'p2p-chat')          │                      ← ④ A 主动连接（指定服务）
   │                               │
   ├─ 发 hello{service:"p2p-chat"}  ├─ 收到 hello           ← ⑤ B 自动匹配服务
   │                               ├─ 匹配？→ auto ack       （匹配则直接建 session）
   │                               ├─ session 就绪            （不匹配则 auto reject）
   ├─ 收到 ack → session 就绪       ├─ onSession(session)   ← ⑥ B 自动收到 session
   │                               │
session.send(...)               session.on('message',...)  ← ⑦ 收发数据
session.on('message', ...)      session.send(...)
```

### 注意事项

1. **`setVisibility({lan:true})` 只管 UDP 发现**。TCP 监听由服务按需启动（`startListening`），不调用则无法被连接。
2. **双方都必须先调用 `startListening`** 才能互相连接，否则报错"该设备暂未开放连接"。
3. **`startDiscovery` 的参数是字符串 `'lan'`**，不是 `{transport:'lan'}`。
4. **connect() 需指定 serviceKey**：第二个参数标识目标服务，hello 中携带 `service` 字段用于路由。
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

// 初始化：UDP 发现 + TCP 监听
await __amiba__.network.setVisibility({ lan: true })
await __amiba__.network.startDiscovery('lan')
await __amiba__.network.startListening(SERVICE_KEY)
// 服务卸载时 host 自动调 stopListening(SERVICE_KEY)

// 连接（指定目标服务，底层自动服务匹配）
async function connectTo(peerId) {
  currentSession = await __amiba__.network.connect(peerId, SERVICE_KEY)
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

// 同服务对端连接时自动收到 session（无需手动确认）
__amiba__.network.onSession((session) => {
  currentSession = session
  currentSession.on('message', ...)
  currentSession.on('close', ...)
})

// 发现设备
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
