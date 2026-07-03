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
// 使本设备在局域网中可见（启动 TCP 监听 + UDP 广播）
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

### 会话（Session）

```js
// 主动连接 → 返回 session 对象
const session = await __amiba__.network.connect(peerId)
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
```

### 接受外来连接

```js
__amiba__.network.onSession((session) => {
  // session 对象同上，可直接使用
  session.on('message', ...)
  session.on('close', ...)
})
```

---

## 3. 完整通信流程

### 双方必须做的事

```
设备 A                          设备 B
────────────────────────────────────────────
setVisibility({lan:true})      setVisibility({lan:true})  ← ① 变为可见（只需一次）
startDiscovery('lan')          startDiscovery('lan')      ← ② 开始扫描（只需一次）
   │                               │
   │  ← UDP 广播互相发现 →          │
   │                               │
connect(B_id)                       │                      ← ③ A 主动连接
   │                               │
   ├─ session 对象返回              ├─ onSession(session)  ← ④ B 接受会话
   │                               │
session.send(JSON.stringify(     session.on('message',     ← ⑤ 收发消息
   {type:'chat',text:'hi'}))        (raw) => {...})
session.on('message', ...)        session.send(...)
```

### 注意事项

1. **`setVisibility({lan:true})` 必须在通信前调用**。仅调用 `startDiscovery` 不会启动 TCP 监听，对方将无法连接到你。
2. **`startDiscovery` 的参数是字符串 `'lan'`**，不是 `{transport:'lan'}`。
3. **connect() 返回的 session 是异步的**，需要 `await`。
4. **消息格式为字符串**，推荐 JSON 序列化。服务自行设计消息协议（如 `{type, payload}`）。
5. **Session 绑定服务生命周期**：服务 iframe 卸载时，所有 session 会自动 close。

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
let currentSession = null

// 连接
async function connectTo(peerId, name) {
  currentSession = await __amiba__.network.connect(peerId)
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

// 接受外来
__amiba__.network.onSession((session) => {
  currentSession = session
  currentSession.on('message', ...)
  currentSession.on('close', ...)
})

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
