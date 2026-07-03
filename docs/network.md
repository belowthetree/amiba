# 网络互联通信

## 概述

变形虫支持局域网（LAN）设备发现和对等消息传递，为服务提供去中心化的近场通信能力。

## 设计目标

- **零配置**：无需服务器、无需配网，设备自动发现
- **安全边界**：仅声明 `network` 权限的服务可使用，iframe 沙箱隔离
- **离线优先**：不依赖互联网，纯本地 UDP 广播 + WebSocket
- **可组合**：提供原始消息 API + 结构化协议（protocol）层，服务可按需选择

## 架构

```
┌─ 服务 (iframe) ────────────────────────┐
│  __amibia__.network.send(peerId, msg)  │
│  __amibia__.network.protocol.send(...) │  ← v3 新增
└──────────┬─────────────────────────────┘
           │ postMessage (JSBridge)
┌──────────▼─────────────────────────────┐
│  NetworkBridge (network-bridge.ts)     │
│  · 事件总线分发                         │
│  · 响应式 peerList                      │
│  · Worker 集成                         │
│  · 协议消息路由 (Protocol dispatch)     │  ← v3 新增
└──┬───────────────────┬─────────────────┘
   │ Tauri invoke/event│ postMessage
┌──▼──── Rust ─────┐ ┌─▼── Web Worker ────┐
│ UDP 广播 (每3秒)  │ │ 每 peer 一个 WS    │
│ · 多网卡子网广播  │ │ · 原生 WebSocket   │
│ · SO_REUSEADDR   │ │ · 10s 心跳         │
│ · 可取消 (watch) │ │ · 5 次断线重连     │  ← v3: 握手协议
│ UDP 监听 :28880  │ │ · 消息队列缓存     │
│ TCP 监听 :random │ │                    │
│ · 握手协议       │ │                    │  ← v3 新增
│ · 消息转发到前端 │ │                    │  ← v3 新增
│ · mpsc 双向通道  │ │                    │  ← v3 新增
│ 过期清理 (15秒)  │ │                    │
└──────────────────┘ └────────────────────┘
```

### 协议栈

| 层次 | 协议 | 说明 |
|------|------|------|
| 设备发现 | UDP 广播 | 每 3 秒向 255.255.255.255:28880 + 各网卡子网广播地址发送 JSON |
| 连接握手 | WebSocket 首帧 | Worker open 后立即发送 `{"type":"handshake","peerId":"..."}` |
| 传输 | WebSocket | 浏览器原生 `new WebSocket(ws://IP:port)`，由 Web Worker 管理 |
| 原始消息 | JSON | 任意可序列化的 JSON，通过 `send(peerId, msg)` 收发 |
| 协议层 (v3) | JSON + routing | 结构化的 `{ type: "protocol", protocol: "name", data, requestId? }`，支持 RPC |

### 发现流程

```
设备 A                          设备 B
setVisibility({lan:true})      setVisibility({lan:true})
  ├─ TCP 监听 :random            ├─ TCP 监听 :random
  ├─ UDP 广播 (每3秒)            ├─ UDP 广播 (每3秒)
  │  → 192.168.1.255:28880     │  → 192.168.1.255:28880
  │  → 10.0.0.255:28880        │
  └─ UDP 监听 :28880            └─ UDP 监听 :28880
       │                            │
       │  ←── A 的广播 ─────────────┘
       │      收到 → peer-discovered
       │                            │
       └── B 的广播 ──────────────→ │
              收到 → peer-discovered
```

### 连接与通信流程 (v3)

```
设备 A (主动方)                      设备 B (被动方)
  connect(B)                            (UDP 广播自己的 ws_port)
  Worker → new WebSocket(ws://B_IP:B_PORT)
    │
    ├─ open → 发送 handshake
    │  {"type":"handshake","peerId":"A_id"}
    │                                      ├─ Rust TCP 监听 accept
    │                                      ├─ 读首帧 → 知道 A 已连接
    │                                      ├─ 注册到 peer_tx map
    │                                      └─ emit "network:peer-connected"
    │
    ├─ send 原始消息 / 协议消息
    │                                      ├─ Rust 收到 WS 帧
    │                                      ├─ emit "network:message-received"
    │                                      └─ NetworkBridge → iframe
    │
    └─ 关闭或超时
                                           └─ 清理 peer_tx，emit "network:peer-disconnected"
```

消息到达 B 的 iframe 后，若为协议消息则自动分发给注册的 handler。

### 多网卡广播

每台设备枚举所有非回环 IPv4 网卡，向每个子网的广播地址发送。例如一台同时有 LAN 和 Docker 虚拟网卡的机器：

```
UDP 广播目标 (3) : ["255.255.255.255:28880", "192.168.1.255:28880", "172.29.64.255:28880"]
```

确保广播覆盖所有可达子网，解决 Docker/Hyper-V/VPN 网卡导致广播走错接口的问题。

### 设备生命周期

- **发现**：收到 UDP 广播 → 加入 `peerList` → 发出 `peer-discovered` 事件
- **在线保持**：每次收到广播刷新 `lastSeen`（每 3 秒一次）
- **离线清理**：每 5 秒检查，超过 15 秒未收到广播 → 移除 → 发出 `peer-lost` 事件
- **连接**：调用 `connect(peerId)` → Worker 通过 `ws://IP:port` 建立 WebSocket，立即发送握手帧
- **心跳**：连接后每 10 秒发送 `{"type":"ping"}`
- **断线重连**：最多 5 次，间隔 2 秒
- **取消发现**：`stopDiscovery()` 通过 `watch::Sender<bool>` 取消所有后台任务

## 可见性模型

| 操作 | 含义 |
|------|------|
| `setVisibility({lan:true})` | 启动 TCP 监听 + UDP 广播 + UDP 监听，本机可被发现 |
| `setVisibility({lan:false})` | 取消后台任务并停止广播，本机隐藏 |
| `startDiscovery('lan')` | 启动 UDP 监听 + UDP 广播，主动扫描局域网 |
| `stopDiscovery('lan')` | 取消后台任务，停止发现 |

**设置页面入口**：`设置 → 🌐 网络 → 局域网发现` 提供 toggle 开关，点击即调用 `setVisibility()`。

## 协议系统 (v3 新增)

协议层在原始消息（`send`/`onMessage`）之上提供了结构化的命名消息和 RPC 语义。

### 协议消息格式

```json
// 请求 (fire-and-forget 或 RPC)
{
  "type": "protocol",
  "protocol": "chat",
  "data": { "text": "hello" },
  "requestId": "pr_1_abc123"    // 可选，有则期待响应
}

// 响应 (RPC)
{
  "type": "protocol-response",
  "requestId": "pr_1_abc123",
  "data": { "ok": true },
  "error": null
}
```

### 服务端 API

```js
// 注册协议处理器
const unsub = __amibia__.network.protocol.register('chat', (data, ctx) => {
  console.log('来自', ctx.peerId, ':', data.text)

  // 同步返回值 → 自动作为 RPC 响应
  return { reply: '收到' }

  // 或异步回复
  // ctx.reply({ reply: '收到' })
})

// 注销
__amibia__.network.protocol.unregister('chat')

// 发送（fire-and-forget）
await __amibia__.network.protocol.send(peerId, 'chat', { text: '你好' })

// RPC 请求 (Promise-based, 默认 15s 超时)
const result = await __amibia__.network.protocol.request(
  peerId, 'sum', { a: 1, b: 2 }, 5000  // 超时 5s
)

// 便捷监听
__amibia__.network.protocol.on('chat', (data, ctx) => { ... })
```

### ctx 对象

| 属性 | 类型 | 说明 |
|------|------|------|
| `peerId` | string | 发送方设备 ID |
| `protocol` | string | 协议名称 |
| `requestId` | string \| null | RPC 请求 ID，非 null 时可回复 |
| `reply(data)` | function | 发送 RPC 响应 |

### 路由流程

```
发送方 iframe                             接收方 iframe
  protocol.send(B, 'chat', data)
    → callHost('network','sendProtocol')
    → network-bridge.sendProtocol()
    → Worker → WS → B 的 Rust 监听
                                              ← Rust emit 事件
                                              ← NetworkBridge 检测 type="protocol"
                                              ← emit('protocol-message', ...)
                                              ← service-container sendEvent
                                              ← iframe bridge 分发给 handler
                                              ← handler(data, ctx) 执行
                                              ← 若 ctx.reply() → 反向发送响应
```

## API 速查

```js
// 可见性
await __amibia__.network.setVisibility({ lan: true, ble: false })
const vis = await __amibia__.network.getVisibility()

// 发现
await __amibia__.network.startDiscovery('lan')
await __amibia__.network.stopDiscovery('lan')
const devices = await __amibia__.network.getVisibleDevices()

// 连接与原始消息
await __amibia__.network.connect(peerId)
await __amibia__.network.send(peerId, { type: 'chat', text: 'hello' })
await __amibia__.network.disconnect(peerId)

// 协议消息 (v3)
await __amibia__.network.protocol.send(peerId, 'myProtocol', { ... })
const result = await __amibia__.network.protocol.request(peerId, 'sum', { a:1, b:2 })
__amibia__.network.protocol.register('myProtocol', (data, ctx) => { ... })
__amibia__.network.protocol.on('myProtocol', (data, ctx) => { ... })

// 事件
__amibia__.network.onPeerDiscovered((peer) => { ... })
__amibia__.network.onMessage(({ peerId, message }) => { ... })
```

## 限制与注意

- **同一局域网**内的设备才能互发现（同一子网或 UDP 广播可达）
- **多网卡自动处理**：向每个网卡子网分别广播
- **Web 浏览器**环境下网络功能不可用，返回明确错误
- **消息体**支持 string 或可 JSON 序列化的 object
- **端口 28880** 需防火墙放行（UDP），WebSocket 端口随机
- **协议消息**通过 `type: "protocol"` 字段自动路由，不需要手动解析
- **RPC 超时**默认 15 秒，可通过 `request()` 的第四个参数自定义
- **取消发现**：`network_stop_discovery` 通过 `watch::Sender<bool>` 实现，不再死循环

## 经验教训

- **2025-08-17**: 原始 echo-only TCP listener 无法实现真正的 P2P 消息。添加握手协议 + AppHandle 转发 + mpsc 双向通道，打通了从 Rust 到前端再到 iframe 的完整消息路径。
- **2025-08-17**: 协议层在 iframe bridge 脚本内实现（而非宿主），使得协议路由逻辑与宿主解耦，宿主只负责透传 `protocol-message` / `protocol-response` 事件类型，iframe 内的 handler 注册/RPC/超时均由 bridge 脚本管理。
