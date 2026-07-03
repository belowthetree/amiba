# 网络互联通信

## 概述

变形虫支持局域网（LAN）设备发现和对等消息传递，为服务提供去中心化的近场通信能力。

## 设计目标

- **零配置**：无需服务器、无需配网，设备自动发现
- **安全边界**：仅声明 `network` 权限的服务可使用，iframe 沙箱隔离
- **离线优先**：不依赖互联网，纯本地 UDP 广播 + WebSocket
- **会话隔离**：每个连接封装为 `NetworkSession`，绑定到服务生命周期，服务卸载自动清理

## 架构 (v4)

```
┌─ 服务 (iframe) ──────────────────────────────────┐
│  session = await __amiba__.network.connect(B)    │
│  session.send(JSON.stringify({type:'chat',...})) │
│  session.on('message', handler)                   │
│  session.close()                                  │
│  __amiba__.network.onSession(s => {...})          │
└──────────┬───────────────────────────────────────┘
           │ postMessage (JSBridge)
┌──────────▼───────────────────────────────────────┐
│  NetworkBridge (network-bridge.ts)                │
│  · peerList (reactive) — UDP 发现设备列表          │
│  · sessions Map — NetworkSession 注册表            │
│  · 事件总线分发                                    │
└──┬────────────────────┬───────────────────────────┘
   │ Tauri invoke       │ Tauri event
   ▼                    ▼
┌───────────────────────────────────────────────────┐
│  Rust (network.rs)                                │
│                                                   │
│  ┌─ UDP 发现 ──────────────────────────────────┐ │
│  │ 广播 (每3秒) — 255.255.255.255:28880         │ │
│  │ 监听 :28880 — SO_REUSEADDR                  │ │
│  │ 多网卡子网广播 / 15s 超时清理 / watch 取消    │ │
│  └──────────────────────────────────────────────┘ │
│                                                   │
│  ┌─ Session 管理 ──────────────────────────────┐ │
│  │ TCP 监听 (:random) — accept → Inbound       │ │
│  │ WS 客户端 — connect_async → Outbound        │ │
│  │ 每 session 双工读写 task (spawn_session_io)  │ │
│  │ mpsc 通道 — 前端→Rust→WS                     │ │
│  │ emit: session-created/message/closed         │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### 协议栈

| 层次 | 协议 | 说明 |
|------|------|------|
| 设备发现 | UDP 广播 | 每 3 秒向 255.255.255.255:28880 + 各网卡子网广播地址发送 JSON |
| 传输 | WebSocket | Rust `tokio-tungstenite` 统一管理客户端 (`connect_async`) 和服务端 (`accept_async`) |
| 消息 | JSON 字符串 | 服务自行决定序列化格式（如 `{"type":"chat","text":"hello"}`） |

### 发现流程

```
设备 A                          设备 B
setVisibility({lan:true})      setVisibility({lan:true})
  ├─ TCP 监听 :random            ├─ TCP 监听 :random
  ├─ UDP 广播 (每3秒)            ├─ UDP 广播 (每3秒)
  │  → 192.168.1.255:28880     │  → 192.168.1.255:28880
  └─ UDP 监听 :28880            └─ UDP 监听 :28880
       │                            │
       │  ←── A 的广播 ─────────────┘
       │      收到 → peer-discovered
       │                            │
       └── B 的广播 ──────────────→ │
              收到 → peer-discovered
```

### 连接与通信流程 (v4)

```
A 主动连接 B:

  A: session = await connect(B_id)
       │
       └─ invoke('network_connect', {peerId: B_id})
            │
            ▼
          Rust: connect_async("ws://B_IP:B_PORT")
            │
            ├─ 创建 SessionState {id, peer_id, direction: Outbound}
            ├─ emit "network:session-created" → A 前端收到 session 对象
            └─ spawn_session_io → 双工读写 task

B 接受外来连接:

  Rust TCP listener accept → upgrade WS
    ├─ 创建 SessionState {id, direction: Inbound}
    ├─ emit "network:session-created" → B 前端收到 onSession()
    └─ spawn_session_io

消息流 (A → B):

  A: session.send(msg)
    → invoke('network_send', {sessionId, message})
    → Rust mpsc tx → WS write → B 的 TCP listener
    → read → emit "network:session-message"
    → B 前端 session.on('message', handler)

消息流 (B → A):

  同上，通过 B 的 session.send() → B 的 Rust → A 的 Rust → A 的前端
```

### 设备生命周期

- **发现**：收到 UDP 广播 → 加入 `peerList` → 发出 `peer-discovered` 事件
- **在线保持**：每次收到广播刷新 `lastSeen`（每 3 秒一次）
- **离线清理**：每 5 秒检查，超过 15 秒未收到广播 → 移除 → 发出 `peer-lost` 事件
- **连接**：`connect(peerId)` → Rust `connect_async` 建立出站 WS → 创建 Session
- **取消发现**：`stopDiscovery()` 通过 `watch::Sender<bool>` 取消所有后台任务

## 可见性模型

| 操作 | 含义 |
|------|------|
| `setVisibility({lan:true})` | 启动 TCP 监听 + UDP 广播 + UDP 监听，本机可被发现 |
| `setVisibility({lan:false})` | 取消后台任务并停止广播，本机隐藏 |
| `startDiscovery('lan')` | 启动 UDP 监听 + UDP 广播，主动扫描局域网 |
| `stopDiscovery('lan')` | 取消后台任务，停止发现 |

**设置页面入口**：`设置 → 🌐 网络 → 局域网发现` 提供 toggle 开关。打开时调用 `setVisibility({lan:true})` 启动 TCP 监听 + UDP 发现。

## Session 模型 (v4)

`NetworkSession` 是整个通信的核心抽象。每次 `connect()` 返回一个 session，外来连接通过 `onSession()` 获得 session。

### Session 对象

```js
const session = await __amiba__.network.connect(peerId)
// → {
//   id: "uuid",
//   peerId: "对方设备ID",
//   peerName: "对方设备名",
//   send(message): Promise<void>,
//   close(): Promise<void>,
//   on(event, handler): () => void
// }
```

### 事件

| 事件 | 触发时机 | handler 参数 |
|------|----------|-------------|
| `message` | 收到消息 | `(message: string)` — 原始 JSON 字符串 |
| `close` | 对端断开或调用 close() | `(reason?: string)` |

### 生命周期

```
connect(peerId) → Session 创建 (session-created)
    │
    ├─ session.send(msg)  ←→  session.on('message', cb)
    │
    ├─ 对端断开 → session.on('close', cb) → session 销毁
    │
    ├─ session.close() → session 销毁
    │
    └─ 服务卸载 → 所有 session 自动 close()
```

## API 速查

```js
// 可见性 & 发现
await __amiba__.network.setVisibility({ lan: true, ble: false })
const vis = await __amiba__.network.getVisibility()
await __amiba__.network.startDiscovery('lan')
await __amiba__.network.stopDiscovery('lan')
const devices = await __amiba__.network.getVisibleDevices()
__amiba__.network.onPeerDiscovered((peer) => { ... })

// Session
const session = await __amiba__.network.connect(peerId)
await session.send(JSON.stringify({ type: 'chat', text: 'hello' }))
session.on('message', (msg) => { const data = JSON.parse(msg); ... })
session.on('close', () => { /* 对方断开 */ })
await session.close()

// 接受外来会话
__amiba__.network.onSession((session) => { /* 同上 */ })
```

## 限制与注意

- **同一局域网**内的设备才能互发现
- **Web 浏览器**环境下网络功能不可用
- **端口 28880** 需防火墙放行（UDP），WebSocket 端口随机
- **消息体**为字符串，服务自行决定序列化格式（推荐 JSON）
- **Session 绑定服务生命周期**：服务卸载时自动 close 所有 session
- **TCP 监听仅在 `setVisibility({lan:true})` 时启动**，仅调用 `startDiscovery` 不会启动

## 经验教训

- **2025-08-17**: 原始 echo-only TCP listener 无法实现 P2P 消息。添加握手协议 + AppHandle 转发 + mpsc 双向通道。
- **2025-08-17**: 协议层在 iframe bridge 脚本内实现，与宿主解耦。
- **2025-08-18 (v4)**: Worker 管理 WebSocket 客户端导致连接状态不可见、双向需两条连接、Rust 和 Worker 各管一半。重构为 Rust 统一管理所有 WebSocket（`connect_async` + `accept_async`），前端通过 `NetworkSession` 抽象与连接交互。协议层移除，序列化由服务自行处理。
