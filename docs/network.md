# 网络互联通信

## 概述

变形虫支持局域网（LAN）和蓝牙低功耗（BLE）两种近场互联方式，为服务提供去中心化的设备发现和对等消息传递能力。

## 设计目标

- **零配置**：无需服务器、无需配网，设备自动发现
- **传输抽象**：服务只关心"发消息给某个设备"，不感知底层是 LAN 还是 BLE
- **安全边界**：仅声明 `network` 权限的服务可使用，iframe 沙箱隔离
- **离线优先**：不依赖互联网，纯本地通信

## 架构

```
服务 (iframe)
  │ __amiba__.network.send(peerId, msg)
  ▼
JSBridge (bridge.ts)
  │ postMessage → service-container handler
  ▼
NetworkBridge (network-bridge.ts)
  │ Tauri invoke / event
  ▼
Rust 原生层 (network.rs)
  ├── LAN:  mdns-sd 发现 + tokio-tungstenite WebSocket
  └── BLE:  btleplug 扫描 + GATT 通信
```

## 协议细节

### LAN

| 层次 | 协议 | 说明 |
|------|------|------|
| 服务发现 | mDNS (RFC 6762) | `_amiba._tcp.local.` 服务类型，自动广播和浏览 |
| 传输 | WebSocket | 全双工，基于 TCP，文本帧承载 JSON 消息 |
| 消息格式 | JSON | `{ "type": "chat" \| "data", "payload": ... }` |

流程：
1. 设备 A 调用 `startDiscovery({transport:'lan'})` → mDNS 浏览
2. 设备 B 调用 `setVisibility({lan:true})` → mDNS 注册 + WS 监听
3. A 收到 `peer-discovered` 事件，含 B 的 IP:port
4. A 调用 `connect(peerId)` → WebSocket 连接到 B
5. 双方通过 `send()` / `onMessage()` 交换消息

### BLE

| 层次 | 协议 | 说明 |
|------|------|------|
| 设备发现 | BLE Scan | 扫描广播包，解析设备名和信号强度 |
| 传输 | GATT | 中央-外设模型，读写特征值 |
| 平台 | Windows / macOS / Linux | 使用 `btleplug` 跨平台 BLE 库 |

## 可见性模型

| 操作 | 含义 |
|------|------|
| `setVisibility({lan:true})` | 本设备在局域网中可被发现 |
| `setVisibility({ble:true})` | 本设备可被蓝牙扫描到 |
| `startDiscovery({transport:'lan'})` | 本设备主动扫描局域网中的其他设备 |

可见性是"我让别人看到"，发现是"我看别人"。

## API 速查

```js
// 可见性
await __amiba__.network.setVisibility({ lan: true, ble: false })
const vis = await __amiba__.network.getVisibility()

// 发现
await __amiba__.network.startDiscovery({ transport: 'lan' })
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

- **BLE 仅桌面平台**（Windows/macOS/Linux），移动端后续支持
- **同一局域网**内的设备才能通过 LAN 发现（同一子网或 mDNS 可达）
- Web 浏览器环境下网络功能不可用，返回明确错误
- 消息体支持 string 或可 JSON 序列化的 object
