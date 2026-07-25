---
title: 局域网 P2P 通信
description: 局域网设备发现和对等消息传递完整指南，含代码模板
keywords: [P2P, network, 局域网, 聊天, 协作, 联机, 发现, 连接, startListening, connect]
category: api
---

# 局域网 P2P 通信

当用户需求包含「多人/聊天/协作/联机/房间/局域网」等关键词时，必须使用 `network` 权限 + P2P API。**不要用 BroadcastChannel 或本地多角色模拟。**

> **多人房间场景优先用房间 API**：若需求是「创建房间 / 房主 / 多人广播 / 组队」，使用 `__amiba__.network.createRoom / joinRoom`（见 `room.md`），成员管理与广播由宿主完成。本文档的 session API 适用于一对一或需要自定义协议的场景。

## 权限声明

manifest.json 中添加 `"network"` 权限：

```json
{ "permissions": ["storage", "network"] }
```

## 完整通信流程

### 1. 初始化（app.js 入口）

```js
const SERVICE_KEY = 'user.xxx' // 使用 manifest.id

// 使设备可见（UDP 广播）
await __amiba__.network.setVisibility({ lan: true })

// 开始扫描局域网
await __amiba__.network.startDiscovery('lan')

// 启动 TCP 监听（必须先调用，否则无法接收外来连接）
await __amiba__.network.startListening(SERVICE_KEY)
```

### 2. 发现设备

```js
// 方式 A: 监听新设备上线
__amiba__.network.onPeerDiscovered((peer) => {
  console.log('发现设备:', peer.name, peer.address)
  // peer: { id, name, transport, address }
})

// 方式 B: 主动查询
const devices = await __amiba__.network.getVisibleDevices()
// 返回 [{id, name, transport, address}]
// 建议 4-5 秒间隔轮询，不要每秒都查
```

### 3. 主动连接

```js
const session = await __amiba__.network.connect(peerId, SERVICE_KEY)
// 成功返回 session 对象
// 失败抛出错误（如"该设备暂未开放连接"）

// 发送消息
session.send(JSON.stringify({ type: 'chat', text: '你好！' }))

// 接收消息
session.on('message', (raw) => {
  const data = JSON.parse(raw)
  console.log('收到:', data)
})

// 监听断开
session.on('close', () => {
  console.log('对方断开')
})

// 主动断开
session.close()
```

### 4. 接收外来连接

```js
__amiba__.network.onSession((session) => {
  console.log('新连接:', session.peerName)
  // session 对象同上，有 send/on/close 方法

  session.on('message', (raw) => {
    const data = JSON.parse(raw)
    // 处理消息
  })

  session.on('close', () => {
    console.log(session.peerName, '断开')
  })
})
```

## 完整聊天模板

```js
const SERVICE_KEY = 'user.chatroom'

async function init() {
  await __amiba__.network.setVisibility({ lan: true })
  await __amiba__.network.startDiscovery('lan')
  await __amiba__.network.startListening(SERVICE_KEY)

  // 监听新设备
  __amiba__.network.onPeerDiscovered((peer) => {
    addDeviceToList(peer)
  })

  // 监听外来连接
  __amiba__.network.onSession((session) => {
    handleSession(session)
  })
}

async function connectTo(peerId) {
  const session = await __amiba__.network.connect(peerId, SERVICE_KEY)
  handleSession(session)
}

function handleSession(session) {
  session.on('message', (raw) => {
    const msg = JSON.parse(raw)
    if (msg.type === 'chat') displayMessage(session.peerName, msg.text)
  })
  session.on('close', () => removePeer(session.peerId))
}

function sendMessage(text) {
  const msg = JSON.stringify({ type: 'chat', text })
  // 向所有 session 广播（需自行维护 sessions 列表）
  sessions.forEach(s => s.send(msg))
}

init()
```

## 常见错误

- ❌ 未调用 `startListening(SERVICE_KEY)` → 无法被其他设备连接
- ❌ `connect(peerId)` 只传一个参数 → 必须传 `connect(peerId, SERVICE_KEY)`
- ❌ 用 `setInterval` 每秒轮询设备列表 → 建议 4-5 秒
- ❌ 用 BroadcastChannel 或 localStorage 模拟多人 → 沙箱不支持
