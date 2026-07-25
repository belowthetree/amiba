---
title: 局域网房间
description: 多人房间 API 完整指南 — 创建房间、加入房间、广播/定向通信，含代码模板
keywords: [房间, room, 多人, 联机, 广播, 房主, 组队, createRoom, joinRoom, broadcast, 局域网, 对战, 协作]
category: api
---

# 局域网房间

当需求包含「房间/多人/组队/房主/广播/对战/协作」等关键词时，**优先使用房间 API**（`__amiba__.network.createRoom / joinRoom`），不要直接用 P2P session 自行实现成员管理与广播。一对一通信才使用 `network.md` 中的 session API。

房间模型：**星型拓扑** — 房主创建房间等待加入；成员只与房主通信；房主可广播给全体或定向发给单人。成员列表、加入/离开通知、断线清理全部由宿主自动完成。

## 权限声明

manifest.json 中添加 `"network"` 权限（房间是 network 模块的一部分）：

```json
{ "permissions": ["storage", "network"] }
```

## 约束

- 加入者与房主必须运行**相同服务**（同一 manifest.id）
- 同一设备同一服务同时只能有一个活跃房间（创建前请先关闭旧房间）
- 设备需开启局域网发现（`设置 → 网络`，或代码中 `setVisibility({lan:true})`）
- 网络功能仅 Tauri 端可用，Web 浏览器不支持（与 network 模块一致）

## 房主：创建房间

```js
// 创建房间（自动启动 TCP 监听，无需调用 startListening）
const room = await __amiba__.network.createRoom({
  name: '周末对战房',   // 可选，默认 "<主机名> 的房间"
  hostName: '小明',     // 可选，房主显示名，默认设备主机名
  maxMembers: 6,        // 可选，含房主，默认 8
})
// room: { id, name, isHost: true, selfId, hostId, members, broadcast, sendTo, kick, close, on }

// 成员加入 / 离开
room.on('member-join', ({ member, members }) => {
  console.log(member.name, '加入，当前', members.length, '人')
})
room.on('member-leave', ({ member, members }) => {
  console.log(member.name, '离开')
})

// 接收成员消息（成员 → 房主）
room.on('message', ({ from, data }) => {
  console.log('来自', from.name, ':', data)
})

// 广播给全体成员（data 为任意可 JSON 序列化的值）
await room.broadcast({ type: 'chat', text: '大家好！' })

// 定向发给某个成员
await room.sendTo(member.id, { type: 'private', text: '悄悄话' })

// 踢出成员
await room.kick(member.id)

// 解散房间（所有成员收到 close 事件）
await room.close()
```

## 成员：加入房间

```js
// 先发现设备（见 network.md）
await __amiba__.network.setVisibility({ lan: true })
await __amiba__.network.startDiscovery('lan')
const devices = await __amiba__.network.getVisibleDevices()

// 加入目标设备上的房间（对方必须已用同一服务 createRoom）
const room = await __amiba__.network.joinRoom(peerId, { name: '小红' })
// 失败抛出错误：「该设备上没有可加入的房间」/「房间已满」/「加入房间超时」
// room: { id, name, isHost: false, selfId, hostId, members, send, close, on }

// 发送消息给房主（data 为任意可 JSON 序列化的值）
await room.send({ type: 'chat', text: '房主好！' })

// 接收房主消息（broadcast / sendTo 都走这里，from 为房主成员对象）
room.on('message', ({ from, data }) => {
  console.log('房主说:', data)
})

// 其他成员加入 / 离开（members 为最新完整列表，含房主与自己）
room.on('member-join', ({ member, members }) => renderMembers(members))
room.on('member-leave', ({ member, members }) => renderMembers(members))

// 房间被解散 / 被踢出 / 房主掉线
room.on('close', ({ reason }) => {
  // reason: 'closed'（房主解散）| 'kicked'（被踢出）| 'disconnected'（连接断开）
})

// 主动离开
await room.close()
```

## Room 对象参考

| 属性/方法 | 端 | 说明 |
|-----------|----|------|
| `id` / `name` | 双方 | 房间 ID / 房间名 |
| `isHost` | 双方 | 本端是否房主 |
| `selfId` / `hostId` | 双方 | 本端成员 ID / 房主成员 ID |
| `members` | 双方 | 成员数组 `[{id, name, isHost}]`，含房主与自己，随事件自动更新 |
| `broadcast(data)` | 房主 | 广播给全体成员 |
| `sendTo(memberId, data)` | 房主 | 定向发送 |
| `kick(memberId)` | 房主 | 踢出成员 |
| `send(data)` | 成员 | 发送给房主 |
| `close()` | 双方 | 房主解散 / 成员离开（本端主动调用不触发 close 事件） |
| `on(event, cb)` | 双方 | 监听事件，返回取消函数 |

| 事件 | 端 | 回调参数 |
|------|----|----------|
| `member-join` | 双方 | `{ member, members }` |
| `member-leave` | 双方 | `{ member, members }` |
| `message` | 双方 | `{ from: {id,name,isHost}, data }` |
| `close` | 成员 | `{ reason }` — 房主解散/被踢/断线时触发 |

## 完整聊天室模板

```js
let room = null

// 房主端
async function hostRoom() {
  room = await __amiba__.network.createRoom({ name: '聊天室' })
  room.on('member-join', ({ members }) => renderMembers(members))
  room.on('member-leave', ({ members }) => renderMembers(members))
  room.on('message', ({ from, data }) => {
    displayMessage(from.name, data.text)
    // 转发给其他成员（实现群聊）：把发送者信息放进 data 再广播
    room.broadcast({ fromName: from.name, text: data.text })
  })
}

// 成员端
async function join(peerId) {
  room = await __amiba__.network.joinRoom(peerId)
  room.on('message', ({ data }) => displayMessage(data.fromName || '房主', data.text))
  room.on('member-join', ({ members }) => renderMembers(members))
  room.on('member-leave', ({ members }) => renderMembers(members))
  room.on('close', ({ reason }) => { room = null; showClosed(reason) })
}

async function sendChat(text) {
  if (!room) return
  if (room.isHost) await room.broadcast({ fromName: '我(房主)', text })
  else await room.send({ text })
}
```

## 常见错误

- ❌ 房主调用 `startListening` 后再 `createRoom` → createRoom 内部已处理监听，直接调用即可
- ❌ 成员用 `connect()` 连房主 → 用 `joinRoom(peerId)`，握手与成员注册由宿主完成
- ❌ 在 `data` 中传函数/DOM 节点 → data 必须可 JSON 序列化
- ❌ 不同服务之间尝试加入 → 房间按服务隔离，双方必须是同一服务
- ❌ 重复 createRoom 而不关闭旧房间 → 报错「当前服务已有活跃房间」
