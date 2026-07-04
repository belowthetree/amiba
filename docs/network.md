# 网络互联通信

## 概述

变形虫支持局域网（LAN）设备发现和对等消息传递，为服务提供去中心化的近场通信能力。

## 设计目标

- **零配置**：无需服务器、无需配网，设备自动发现
- **安全边界**：仅声明 `network` 权限的服务可使用，iframe 沙箱隔离
- **离线优先**：不依赖互联网，纯本地 UDP 广播 + WebSocket
- **会话隔离**：每个连接封装为 `NetworkSession`，绑定到服务生命周期，服务卸载自动清理

## 架构 (v4)

> **模块拆分**：Rust 层原 `network.rs` 已拆为 `network_visibility.rs`（UDP 发现 + 可见性编排）与 `network_session.rs`（TCP 监听 + WebSocket 会话）。两者通过 `ws_port` 与 `setVisibility` 编排解耦耦合，命令名不变，前端零改动。

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
│  Rust                                              │
│                                                   │
│  ┌─ network_visibility.rs ─────────────────────┐ │
│  │ VisibilityState { device_id, discovered,    │ │
│  │   visibility, cancel_tx }                   │ │
│  │ · UDP 广播 (每3秒) — 255.255.255.255:28880   │ │
│  │ · UDP 监听 :28880 — SO_REUSEADDR            │ │
│  │ · 多网卡子网广播 / 15s 超时清理 / watch 取消  │ │
│  │ · setVisibility 编排 session 模块的 listener │ │
│  └──────────────┬───────────────────────────────┘ │
│                 │ 调 ensure_listener/stop_listener │
│  ┌──────────────▼───────────────────────────────┐ │
│  │ network_session.rs                           │ │
│  │ SessionStore { sessions, ws_port,            │ │
│  │   listener_cancel }                          │ │
│  │ · TCP 监听 (:random) — accept → Inbound      │ │
│  │ · WS 客户端 — connect_async → Outbound       │ │
│  │ · 每 session 双工读写 task (spawn_session_io) │ │
│  │ · mpsc 通道 — 前端→Rust→WS                    │ │
│  │ · emit: session-created/message/closed        │ │
│  │ · listener 随可见性开关启停（修复端口常驻）    │ │
│  └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

**跨模块依赖**：
- `network_set_visibility`（visibility）→ `network_session::ensure_listener` / `stop_listener`：开/关可见性时启停 TCP 监听
- `start_udp_broadcast`（visibility）→ 读 `SessionStore.ws_port`：广播 payload 含端口
- `network_connect`（session）→ 读 `VisibilityState.discovered_peers`：查 peer 地址

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

### 连接与通信流程 (v5 — 含 hello 握手)

```
A 主动连接 B（打招呼机制）:

  A: session = await connect(B_id, "你好，一起聊天？")
       │
       └─ invoke('network_connect', {peerId: B_id, greeting: "你好..."})
            │
            ▼
          Rust: connect_async("ws://B_IP:B_PORT")
            │
            ├─ 发送 hello: {"type":"hello","from":"A_id","name":"A_name","greeting":"你好..."}
            ├─ 等待 ack / reject / 30s 超时
            │   ├─ ack   → 创建 Outbound SessionState → emit session-created → 返回 session
            │   ├─ reject → 关闭 WS → connect() Promise reject(reason)
            │   └─ 超时  → 关闭 WS → connect() Promise reject("对方未响应")
            └─ spawn_session_io → 双工读写 task

B 接受外来连接（双层确认）:

  Rust TCP listener accept → upgrade WS
    ├─ 读取 hello: {"type":"hello","from":"A_id","name":"A_name","greeting":"你好..."}
    ├─ 存 PendingSession（持有 WS 分片 + 30s 超时计时器）
    ├─ emit "network:session-request" {pendingId, peerId, peerName, greeting}
    │    │
    │    ├─[宿主层] service-container.vue 弹确认对话框「A 想连接：你好...」
    │    │    ├─ 用户点接受 → invoke('network_accept_session') → 发 ack → 升级为正式 session
    │    │    └─ 用户点拒绝 → invoke('network_reject_session') → 发 reject → 关闭 WS
    │    │
    │    ├─[服务层] sendEvent('session-request') 转发到 iframe
    │    │    └─ 服务调 __amiba__.network.acceptSessionRequest / rejectSessionRequest
    │    │
    │    └─[10s 超时] 服务和宿主都未响应 → 默认 accept（保证未适配服务可用）
    │
    ├─ network_accept_session(pendingId)
    │    ├─ 发送 ack: {"type":"ack"}
    │    ├─ 创建 Inbound SessionState（peer_id 来自 hello 真实身份）
    │    ├─ emit "network:session-created" → B 前端 onSession()
    │    └─ spawn_session_io
    │
    ├─ network_reject_session(pendingId, reason)
    │    ├─ 发送 reject: {"type":"reject","reason":"..."}
    │    ├─ 关闭 WS
    │    └─ emit "network:session-rejected"
    │
    └─ 30s 超时 → 自动 reject → emit "network:session-timeout"

消息流 (A → B):

  A: session.send(msg)
    → invoke('network_send', {sessionId, message})
    → Rust mpsc tx → WS write → B 的 TCP listener
    → read → emit "network:session-message"
    → B 前端 session.on('message', handler)

消息流 (B → A):

  同上，通过 B 的 session.send() → B 的 Rust → A 的 Rust → A 的前端
```

### 握手协议

| 消息 | 方向 | 格式 | 说明 |
|------|------|------|------|
| `hello` | 连接方 → 被动方 | `{"type":"hello","from":"<peerId>","name":"<hostname>","greeting":"<可选>"}` | 首条消息，含设备身份和打招呼文本 |
| `ack` | 被动方 → 连接方 | `{"type":"ack"}` | 接受连接 |
| `reject` | 被动方 → 连接方 | `{"type":"reject","reason":"<原因>"}` | 拒绝连接 |

**超时策略**：
- hello 读取超时：10s（被动方等待 hello）
- 握手确认超时：30s（被动方等待前端 accept/reject，Rust 层兜底）
- 服务响应超时：10s（前端服务未响应 → 宿主默认 accept）
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

## Session 模型 (v5 — 含 hello 握手)

`NetworkSession` 是整个通信的核心抽象。每次 `connect()` 发起 hello 握手，握手成功后返回 session；外来连接通过 `onSession()` 获得 session（仅在被动方 accept 后触发）。

### Session 对象

```js
const session = await __amiba__.network.connect(peerId, "你好")
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

### 握手事件（宿主层 + 服务层）

| 事件 | 触发时机 | handler 参数 |
|------|----------|-------------|
| `session-request` | 收到外来 hello | `{pendingId, peerId, peerName, greeting}` |
| `session-rejected` | 连接被拒绝 | `{pendingId, reason}` |
| `session-timeout` | 30s 握手超时 | `{pendingId}` |

### 生命周期

```
connect(peerId, greeting) → 发 hello → 等 ack → Session 创建 (session-created)
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

// Session（含 hello 握手）
const session = await __amiba__.network.connect(peerId, "你好，一起聊天？")
await session.send(JSON.stringify({ type: 'chat', text: 'hello' }))
session.on('message', (msg) => { const data = JSON.parse(msg); ... })
session.on('close', () => { /* 对方断开 */ })
await session.close()

// 接受外来会话（仅在被动方 accept 后触发）
__amiba__.network.onSession((session) => { /* 同上 */ })

// 握手确认（被动方收到外来连接请求时）
__amiba__.network.onSessionRequest((info) => {
  // info: { pendingId, peerId, peerName, greeting }
  // 服务可自行决定是否接受：
  __amiba__.network.acceptSessionRequest(info.pendingId)   // 接受
  __amiba__.network.rejectSessionRequest(info.pendingId, '不想聊')  // 拒绝
})
```

## 限制与注意

- **同一局域网**内的设备才能互发现
- **Web 浏览器**环境下网络功能不可用
- **端口 28880** 需防火墙放行（UDP），WebSocket 端口随机
- **消息体**为字符串，服务自行决定序列化格式（推荐 JSON）
- **Session 绑定服务生命周期**：服务卸载时自动 close 所有 session
- **TCP 监听仅在 `setVisibility({lan:true})` 时启动**，仅调用 `startDiscovery` 不会启动
- **TCP 监听随可见性关闭而停止**：`setVisibility({lan:false})` 取消 listener 并释放端口（已建 session 不断）

## 经验教训

- **2025-08-17**: 原始 echo-only TCP listener 无法实现 P2P 消息。添加握手协议 + AppHandle 转发 + mpsc 双向通道。
- **2025-08-17**: 协议层在 iframe bridge 脚本内实现，与宿主解耦。
- **2025-08-18 (v4)**: Worker 管理 WebSocket 客户端导致连接状态不可见、双向需两条连接、Rust 和 Worker 各管一半。重构为 Rust 统一管理所有 WebSocket（`connect_async` + `accept_async`），前端通过 `NetworkSession` 抽象与连接交互。协议层移除，序列化由服务自行处理。
- **2025-08-19 (解耦)**: `network.rs` 拆为 `network_visibility.rs`（UDP 发现 + 可见性编排）与 `network_session.rs`（TCP 监听 + WS 会话）。`NetworkState` 拆为 `VisibilityState` + `SessionStore`。`setVisibility` 编排两模块：先 `ensure_listener` 拿 `ws_port`，再启 UDP 广播。修复 TCP listener 启动后不停止的端口常驻泄漏（`stop_listener` 随可见性关闭调用）。命令名不变，前端零改动。为后续 hello 握手机制铺路。
- **2025-08-20 (v5 握手)**: 添加 hello/ack/reject 握手协议。入站连接不再直接建 session，而是读取 hello → 存 `PendingSession` → emit `session-request` → 等待前端 accept/reject。出站 `connect()` 发 hello 等 ack（30s 超时）。双层确认：宿主弹对话框 + 服务 `onSessionRequest` 回调，先响应者优先；10s 服务无响应默认 accept；30s Rust 兜底超时自动 reject。修复 inbound session `peer_id` 从 `inbound-<uuid>` 改为 hello 真实 `from`。新增命令 `network_accept_session` / `network_reject_session`，新增事件 `session-request` / `session-rejected` / `session-timeout`。
