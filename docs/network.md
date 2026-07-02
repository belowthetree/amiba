# 网络互联通信

## 概述

变形虫支持局域网（LAN）设备发现和对等消息传递，为服务提供去中心化的近场通信能力。

## 设计目标

- **零配置**：无需服务器、无需配网，设备自动发现
- **安全边界**：仅声明 `network` 权限的服务可使用，iframe 沙箱隔离
- **离线优先**：不依赖互联网，纯本地 UDP 广播 + WebSocket

## 架构

```
┌─ 服务 (iframe) ────────────────────────┐
│  __amiba__.network.send(peerId, msg)   │
└──────────┬─────────────────────────────┘
           │ postMessage (JSBridge)
┌──────────▼─────────────────────────────┐
│  NetworkBridge (network-bridge.ts)     │
│  · 事件总线分发                         │
│  · 响应式 peerList                      │
│  · Worker 集成                         │
└──┬───────────────────┬─────────────────┘
   │ Tauri invoke/event│ postMessage
┌──▼──── Rust ─────┐ ┌─▼── Web Worker ────┐
│ UDP 广播 (每3秒)  │ │ 每 peer 一个 WS    │
│ · 多网卡子网广播  │ │ · 原生 WebSocket   │
│ · SO_REUSEADDR   │ │ · 10s 心跳         │
│ UDP 监听 :28880  │ │ · 5 次断线重连     │
│ TCP 监听 :random │ │ · 消息队列缓存     │
│ 过期清理 (15秒)  │ │                    │
└──────────────────┘ └────────────────────┘
```

### 协议栈

| 层次 | 协议 | 说明 |
|------|------|------|
| 设备发现 | UDP 广播 | 每 3 秒向 255.255.255.255:28880 + 各网卡子网广播地址发送 JSON |
| 传输 | WebSocket | 浏览器原生 `new WebSocket(ws://IP:port)`，由 Web Worker 管理 |
| 消息格式 | JSON | `{ "type": "chat" \| "data", "payload": ... }` |

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
- **连接**：调用 `connect(peerId)` → Worker 通过 `ws://IP:port` 建立 WebSocket
- **心跳**：连接后每 10 秒发送 `{"type":"ping"}`
- **断线重连**：最多 5 次，间隔 2 秒

## 可见性模型

| 操作 | 含义 |
|------|------|
| `setVisibility({lan:true})` | 启动 TCP 监听 + UDP 广播 + UDP 监听，本机可被发现 |
| `setVisibility({lan:false})` | 停止上述服务，本机隐藏 |
| `startDiscovery('lan')` | 启动 UDP 监听，主动扫描局域网 |

## API 速查

```js
// 可见性
await __amiba__.network.setVisibility({ lan: true, ble: false })
const vis = await __amiba__.network.getVisibility()

// 发现
await __amiba__.network.startDiscovery('lan')
await __amiba__.network.stopDiscovery('lan')
const devices = await __amiba__.network.getVisibleDevices()

// 连接与消息
await __amiba__.network.connect(peerId)
await __amiba__.network.send(peerId, { type: 'chat', text: 'hello' })
await __amiba__.network.disconnect(peerId)

// 事件
__amiba__.network.onPeerDiscovered((peer) => { ... })
__amiba__.network.onMessage(({ peerId, message }) => { ... })
```

## 限制与注意

- **同一局域网**内的设备才能互发现（同一子网或 UDP 广播可达）
- **多网卡自动处理**：向每个网卡子网分别广播
- **Web 浏览器**环境下网络功能不可用，返回明确错误
- **消息体**支持 string 或可 JSON 序列化的 object
- **端口 28880** 需防火墙放行（UDP），WebSocket 端口随机
