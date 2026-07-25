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
│  RoomManager (room-manager.ts)                    │
│  · 房间抽象 — 房主/成员星型通信                    │
│  · 成员管理 / 广播 / 定向发送 / 踢出               │
│  · 房间服务键 room:<serviceId> 路由入站会话        │
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

### 连接与通信流程 (v5 — 服务匹配)

**服务匹配协议（传输层，对应用透明）**：
- `connect(peerId, serviceKey)` → hello 含 `service` 字段
- 被动方 Rust 自动匹配 `listening_services`：
  - 匹配 → 自动 ack → 直接建 Inbound Session → emit `session-created`
  - 不匹配 → 自动 reject → 关闭连接
- 服务视角：`startListening` → `onSession`（自动，无手动确认步骤）

```
A 主动连接 B:

  A: session = await connect(B_id, 'p2p-chat')
       │
       └─ invoke('network_connect', {peerId: B_id, serviceKey: 'p2p-chat'})
            │
            ▼
          Rust: connect_async("ws://B_IP:B_PORT")
            │
            ├─ 发送 hello: {"type":"hello","from":"A_id","name":"A_name","service":"p2p-chat"}
            ├─ 等待 ack / reject / 30s 超时
            │   ├─ ack   → 创建 Outbound SessionState → emit session-created → 返回 session
            │   ├─ reject → 关闭 WS → connect() Promise reject(reason)
            │   └─ 超时  → 关闭 WS → connect() Promise reject("对方未响应")
            └─ spawn_session_io → 双工读写 task

B 接受外来连接（自动，无人工干预）:

  Rust TCP listener accept → upgrade WS
    ├─ 读取 hello: {"type":"hello","from":"A_id","name":"A_name","service":"p2p-chat"}
    ├─ 检查 listening_services.contains("p2p-chat")
    │   ├─ 匹配 → 自动发送 ack → 创建 Inbound SessionState
    │   │         → emit "network:session-created" → B 前端 onSession()
    │   │         → spawn_session_io
    │   └─ 不匹配 → 自动发送 reject{"reason":"没有服务在监听 'xxx'"}
    │              → 关闭 WS

消息流 (A → B):

  A: session.send(msg)
    → invoke('network_send', {sessionId, message})
    → Rust mpsc tx → WS write → B 的 TCP listener
    → read → emit "network:session-message"
    → B 前端 session.on('message', handler)
```

### 握手协议

| 消息 | 方向 | 格式 | 说明 |
|------|------|------|------|
| `hello` | 连接方 → 被动方 | `{"type":"hello","from":"<peerId>","name":"<hostname>","service":"<serviceKey>"}` | 首条消息，含设备身份和服务标识 |
| `ack` | 被动方 → 连接方 | `{"type":"ack"}` | 服务匹配，接受连接（自动） |
| `reject` | 被动方 → 连接方 | `{"type":"reject","reason":"<原因>"}` | 服务不匹配，拒绝连接（自动） |

**超时策略**：
- hello 读取超时：10s（被动方等待 hello）
- 连接方等待 ack 超时：30s

**入站会话路由（前端）**：`network:session-created` 事件载荷携带 `service` 字段（握手 hello 中的 serviceKey）。前端各模块按服务键认领会话：服务容器只处理 `service === 其 startListening 注册的 key` 的会话；房间会话（`room:*`）由 RoomManager 认领；服务/技能分享（`amiba.service-share` / `amiba.skill-share`）由各自分享模块认领。

### 设备生命周期

- **发现**：收到 UDP 广播 → 加入 `peerList` → 发出 `peer-discovered` 事件
- **在线保持**：每次收到广播刷新 `lastSeen`（每 3 秒一次）
- **离线清理**：每 5 秒检查，超过 15 秒未收到广播 → 移除 → 发出 `peer-lost` 事件
- **连接**：`connect(peerId)` → Rust `connect_async` 建立出站 WS → 创建 Session
- **取消发现**：`stopDiscovery()` 通过 `watch::Sender<bool>` 取消所有后台任务

## 可见性模型

| 操作 | 含义 |
|------|------|
| `setVisibility({lan:true})` | 启动 UDP 广播 + UDP 监听，本机可被发现（不启动 TCP 监听） |
| `setVisibility({lan:false})` | 取消后台任务并停止广播，本机隐藏 |
| `startDiscovery('lan')` | 启动 UDP 监听 + UDP 广播，主动扫描局域网 |
| `stopDiscovery('lan')` | 取消后台任务，停止发现 |

**设置页面入口**：`设置 → 🌐 网络 → 局域网发现` 提供 toggle 开关。打开时调用 `setVisibility({lan:true})` 启动 UDP 发现（TCP 监听由各服务按需启动）。

## Session 模型 (v5 — 服务匹配)

`NetworkSession` 是整个通信的核心抽象。`connect()` 发起服务匹配握手，成功后返回 session；外来连接在服务匹配成功后自动触发 `onSession()`。

### Session 对象

```js
const session = await __amiba__.network.connect(peerId, 'p2p-chat')
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
startListening → connect(peerId, serviceKey) → 发 hello → 等 ack → Session 创建 (session-created)
    │
    ├─ session.send(msg)  ←→  session.on('message', cb)
    │
    ├─ 对端断开 → session.on('close', cb) → session 销毁
    │
    ├─ session.close() → session 销毁
    │
    └─ 服务卸载 → 所有 session 自动 close() + stopListening
```

## 房间模型 (Room)

`RoomManager`（`src/host/room-manager.ts`）在 NetworkSession 之上提供「房间」抽象：房主创建房间等待加入，成员加入后与房主星型通信。成员管理、广播、断线清理由宿主完成，服务无需自行维护 session 列表或设计握手协议。

### 拓扑与路由

- **星型拓扑**：成员只与房主直连（每人一条 NetworkSession）；成员间不直连，群聊等场景由房主转发（`broadcast`）。
- **房间服务键**：`room:<serviceId>`。房主 `createRoom` 内部调用 `startListening('room:<serviceId>')`；成员 `joinRoom` 以同一服务键 `connect`。Rust 传输层服务匹配保证只有相同服务的设备能加入。
- **入站路由**：入站 `session-created` 事件按 `service` 字段路由到 RoomManager（见「握手协议」节）。
- **数量约束**：同一设备同一服务同时最多一个活跃房间；默认最多 8 名成员（含房主），可通过 `maxMembers` 调整。

### 房间协议（应用层，JSON 信封）

传输层握手（hello/ack）之上，房间内的 session 消息体为 JSON 信封：

| 信封 | 方向 | 格式 | 说明 |
|------|------|------|------|
| `room-join` | 成员 → 房主 | `{type, name?}` | 入站 session 的首条消息（10s 超时） |
| `room-welcome` | 房主 → 成员 | `{type, roomId, roomName, selfId, hostId, members}` | 接纳，含完整成员快照 |
| `room-reject` | 房主 → 成员 | `{type, reason}` | 拒绝（满员等） |
| `room-member-join` | 房主 → 其他成员 | `{type, member}` | 成员加入通知 |
| `room-member-leave` | 房主 → 其他成员 | `{type, memberId}` | 成员离开通知 |
| `room-message` | 双向 | `{type, from?, data}` | 业务数据，`data` 为任意 JSON |
| `room-closed` | 房主 → 成员 | `{type, reason}` | 解散（`closed`）/ 踢出（`kicked`） |

### 生命周期

```
房主: createRoom(opts) → startListening(room:<svc>) → 等待入站
        │ 入站 session → 读 room-join → welcome + 广播 member-join
        │ 成员 session close → 移除 + 广播 member-leave
        └─ close() → 广播 room-closed → 关闭全部 session → stopListening

成员: joinRoom(peerId) → connect(room:<svc>) → 发 room-join → 等 welcome
        │ 收 room-message / member-join / member-leave → 更新 members
        │ 收 room-closed 或连接断开 → close 事件
        └─ close() → 关闭 session（房主侧感知为成员离开）

服务卸载 → destroyRoomForService(serviceId) 自动解散/离开
```

成员身份：成员 ID = 设备 ID（peerId）；同设备重复加入视为重连，旧 session 静默替换。

## API 速查

```js
// 可见性 & 发现
await __amiba__.network.setVisibility({ lan: true, ble: false })
const vis = await __amiba__.network.getVisibility()
await __amiba__.network.startDiscovery('lan')
await __amiba__.network.stopDiscovery('lan')
const devices = await __amiba__.network.getVisibleDevices()
__amiba__.network.onPeerDiscovered((peer) => { ... })

// TCP 监听（按需，先监听才能接收外来连接）
await __amiba__.network.startListening('p2p-chat')
await __amiba__.network.stopListening('p2p-chat')

// Session（自动服务匹配）
const session = await __amiba__.network.connect(peerId, 'p2p-chat')
await session.send(JSON.stringify({ type: 'chat', text: 'hello' }))
session.on('message', (msg) => { const data = JSON.parse(msg); ... })
session.on('close', () => { /* 对方断开 */ })
await session.close()

// 接受外来会话（自动，服务匹配成功即触发）
__amiba__.network.onSession((session) => { /* 同上 */ })

// 局域网房间（多人场景，宿主管理成员与广播）
const room = await __amiba__.network.createRoom({ name: '对战房', maxMembers: 6 })  // 房主
const room2 = await __amiba__.network.joinRoom(peerId, { name: '小红' })            // 成员
room.broadcast({ type: 'state' })      // 房主广播
room.sendTo(memberId, { ... })         // 房主定向
room2.send({ type: 'ready' })          // 成员 → 房主
room.on('member-join', ({ member, members }) => {})
room.on('message', ({ from, data }) => {})
room.on('close', ({ reason }) => {})   // 成员：closed | kicked | disconnected
await room.close()                     // 房主解散 / 成员离开
```

## 限制与注意

- **同一局域网**内的设备才能互发现
- **Web 浏览器**环境下网络功能不可用
- **端口 28880** 需防火墙放行（UDP），WebSocket 端口随机
- **消息体**为字符串，服务自行决定序列化格式（推荐 JSON）
- **Session 绑定服务生命周期**：服务卸载时自动 close 所有 session
- **TCP 监听由服务按需启动**：`startListening(serviceKey)` 才启动 TCP listener，`stopListening` 或服务卸载时停止。
- **`setVisibility({lan:true})` 仅启 UDP 发现**，不包含 TCP 监听。

## 经验教训

- **2025-08-17**: 原始 echo-only TCP listener 无法实现 P2P 消息。添加握手协议 + AppHandle 转发 + mpsc 双向通道。
- **2025-08-17**: 协议层在 iframe bridge 脚本内实现，与宿主解耦。
- **2025-08-18 (v4)**: Worker 管理 WebSocket 客户端导致连接状态不可见、双向需两条连接、Rust 和 Worker 各管一半。重构为 Rust 统一管理所有 WebSocket（`connect_async` + `accept_async`），前端通过 `NetworkSession` 抽象与连接交互。协议层移除，序列化由服务自行处理。
- **2025-08-19 (解耦)**: `network.rs` 拆为 `network_visibility.rs`（UDP 发现 + 可见性编排）与 `network_session.rs`（TCP 监听 + WS 会话）。
- **2025-08-20 (v5 服务匹配)**: 拆除打招呼机制的 PendingSession/accept/reject/session-request 等概念。hello 降级为纯传输层服务匹配：Rust 收到 hello 后自动检查 `listening_services`，匹配则发 ack 直接建 session，不匹配则自动 reject。`connect()` 去掉 `greeting` 参数，只保留 `serviceKey`。服务视角：`startListening → onSession`，无需手动确认。TCP 监听从 `setVisibility` 中剥离，由 `startListening`/`stopListening` 按引用计数管理。
- **2026-07-25 (房间模型)**: 新增 RoomManager（`room-manager.ts`），在 NetworkSession 之上提供房主-成员星型房间抽象（`createRoom`/`joinRoom`/`broadcast`/`sendTo`/`kick`），服务无需自行实现成员管理与广播。房间服务键约定 `room:<serviceId>`；`network:session-created` 事件载荷新增 `service` 字段，前端按服务键路由入站会话（容器/房间/分享各认领所属），修复了分享会话泄漏到任意打开服务的问题。新增 `network_get_device_name` 命令用于房主默认显示名。
