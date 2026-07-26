# JSBridge 通信协议

## 概述

JSBridge 是宿主（Vue SPA）与用户服务（iframe）之间的唯一通信通道。基于浏览器原生 `postMessage`，安全、标准、无需三方库。

## 消息格式

全部用 **postMessage**，不发明新协议。

```ts
// 服务 → 宿主 请求
interface ServiceRequest {
  type: 'api'
  module: string          // storage | notification | ui | widgets | network | background | fileAccess | fetch | ai
  method: string          // setStorage | showToast | navigateTo | ...
  params: Record<string, any>
  requestId: string       // UUID，用于匹配响应
}

// 宿主 → 服务 响应
interface ServiceResponse {
  type: 'api-response'
  requestId: string
  result?: any            // 成功时返回
  error?: string          // 失败时返回
}

// 宿主 → 服务 事件推送
interface HostEvent {
  type: 'event'
  name: string            // page-show | page-hide | task-trigger | peer-discovered | peer-lost | session-created | session-event | ai-event
  data?: any
}
```

## API 完整契约

### storage

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `setStorage` | `{ key: string, data: any }` | `void` | storage |
| `getStorage` | `{ key: string }` | `any` | storage |
| `removeStorage` | `{ key: string }` | `void` | storage |

### notification

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `showToast` | `{ title: string, icon?: 'success'\|'error'\|'loading'\|'none', duration?: number }` | `void` | notification |

### ui

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `navigateTo` | `{ url: string }` | `void` | — |
| `navigateBack` | `{ delta?: number }` | `void` | — |

### widgets

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `registerWidget` | `{ config: FloatingWidgetConfig }` | `void` | widgets |
| `removeWidget` | `{ id: string }` | `void` | widgets |
| `showWidget` | `{ id: string }` | `void` | widgets |
| `hideWidget` | `{ id: string }` | `void` | widgets |

`FloatingWidgetConfig` 结构：

```ts
interface FloatingWidgetConfig {
  id: string              // 唯一标识，如 "quick-note"
  icon: string            // emoji 图标，如 "📝"
  label?: string          // 悬停提示
  page: string            // widget HTML 文件路径，如 "widgets/quick-note.html"
  edge: 'left' | 'right' // 吸附边缘
  position: number        // 初始 y 位置（px，距顶部）
  showOn: string[]        // 生命周期路由名，空数组=全局
  trigger: 'manual' | 'page'  // manual=API控制(默认), page=进入showOn自动显示
}
```

Widget 也可以通过服务目录下的 `widget.json` 声明式配置，服务加载时自动注册。参见 [服务模型](services.md)。

### network

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `setVisibility` | `{ visibility: { lan: bool, ble: bool } }` | `void` | network |
| `getVisibility` | — | `{ lan: bool, ble: bool }` | network |
| `startDiscovery` | `'lan' \| 'ble' \| 'all'` (字符串) | `void` | network |
| `stopDiscovery` | `'lan' \| 'ble' \| 'all'` | `void` | network |
| `getVisibleDevices` | — | `DiscoveredPeer[]` | network |
| `connect` | `{ peerId: string, serviceKey?: string }` | `{ sessionId, peerId, peerName }` — Promise | network |
| `sessionSend` | `{ sessionId: string, message: string }` | `void` | network |
| `sessionClose` | `{ sessionId: string }` | `void` | network |
| `startListening` | `{ serviceKey: string }` | `void` | network |
| `stopListening` | `{ serviceKey: string }` | `void` | network |
| `roomCreate` | `{ opts: { name?, hostName?, maxMembers? } }` | `RoomInfo` — Promise | network |
| `roomJoin` | `{ peerId: string, opts: { name? } }` | `RoomInfo` — Promise | network |
| `roomSend` | `{ roomId: string, data: any }` | `void` — 成员 → 房主 | network |
| `roomBroadcast` | `{ roomId: string, data: any }` | `void` — 房主 → 全体 | network |
| `roomSendTo` | `{ roomId: string, memberId: string, data: any }` | `void` — 房主 → 单人 | network |
| `roomKick` | `{ roomId: string, memberId: string }` | `void` | network |
| `roomClose` | `{ roomId: string }` | `void` — 房主解散 / 成员离开 | network |

`RoomInfo` = `{ roomId, name, isHost, selfId, hostId, members: [{id, name, isHost}] }`，iframe 内构造 room 代理（members 随 room-event 自动同步）。房间协议与模型详见 [网络互联](network.md)「房间模型」。

**Session 对象**（`connect()` 返回 / `onSession()` 接收）：

| 属性/方法 | 说明 |
|-----------|------|
| `.id` | session UUID |
| `.peerId` | 对端设备 ID |
| `.peerName` | 对端设备名称 |
| `.send(message)` | 发送字符串消息 |
| `.close()` | 关闭会话 |
| `.on('message', cb)` | 监听消息，cb 接收 `(message: string)` |
| `.on('close', cb)` | 监听关闭，cb 接收 `(reason?: string)` |

**事件**（通过 `HostEvent` 推送到 iframe）：

| 事件名 | 触发时机 | data |
|--------|----------|------|
| `peer-discovered` | 发现新设备 | `{ id, name, transport, address }` |
| `session-created` | 外来连接建立 | `{ sessionId, peerId, peerName, service }` — iframe 内构造 session 代理；`service` 用于宿主按服务键路由 |
| `session-event` | session 消息/关闭 | `{ sessionId, event, data }` — 内部路由到对应 session 的 on() 回调 |
| `room-event` | 房间成员/消息/关闭 | `{ roomId, event, data }` — event: `member-join`/`member-leave`/`message`/`close`，路由到对应 room 的 on() 回调 |

### background

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `start` | `{ opts?: object }` | `void` — Promise | background |
| `stop` | — | `void` | background |
| `getState` | — | `{ running, startCount, lastRun, state }` | background |
| `postMessage` | `{ message: any }` | `void` | background |
| `onMessage` | `(msg: any) => void` | —（事件监听） | background |
| `on` | `(eventName, callback)` | —（事件监听） | background |

**事件**（通过 `HostEvent` 推送到后台 iframe）：

| 事件名 | 触发时机 | data |
|--------|----------|------|
| `tick` | 定时器触发（interval/cron） | `{ trigger, at }` |
| `bg-message` | 后台发消息到前台 | 消息体 |

**约束**：
- 后台服务只能与同服务的前台 iframe 通信（`postMessage` → 后台发前台，`onMessage` → 前台发后台）
- 必须显式调用 `start()` 才会启动，无 autoStart
- 崩溃静默重启，不通知用户
- 后台 iframe 内可正常使用 `storage`、`network`、`notification` 等模块

### fileAccess

通用磁盘文件访问。授权以 **token** 为生命周期（内存 Map），应用重启后需重新 `requestAccess`。

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `requestAccess` | `{ opts: { path?: string, pattern?: string, purpose?: string, silent?: boolean } }` | `{ token, path, pattern }` | fileAccess |
| `listFiles` | `{ token: string }` | `[{ name, path, size, isDir }]`（path 为相对路径） | fileAccess |
| `readText` | `{ token: string, path: string }` | `string` | fileAccess |
| `readBinary` | `{ token: string, path: string }` | `string`（base64） | fileAccess |

**约束**：
- `path` 不传则弹出系统文件夹选择对话框；`path` 已指定且 `silent: true` 时跳过用户确认
- `pattern` 支持 `*.ext`、`{*.a,*.b}`、`**/` 递归前缀
- token 绑定 serviceId，不可跨服务使用

### fetch

HTTP 请求代理（Rust reqwest 实现），绕过浏览器 CORS 和移动端明文流量限制。

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `request` | `{ url: string, method?: string, headers?: object, body?: string \| null }` | `{ status: number, body: string }` | fetch |

**约束**：
- 仅支持 `http`/`https` 协议，仅支持 GET/POST/PUT/DELETE
- 超时 10 秒，User-Agent 固定为 `AmibaService/1.0`
- 响应 body 一律为字符串（JSON 需自行 `JSON.parse`）

### ai

服务内嵌 AI 对话：宿主侧 ServiceAiRunner 执行（API Key 与工具执行均在宿主侧），桥调用立即返回 ack，生成内容经 `ai-event` 事件流式推送。默认仅只读工具可用，敏感工具由用户在服务设置中逐服务开启。

| 方法 | 参数 | 返回 | 权限 |
|------|------|------|------|
| `createConversation` | `{ opts: { conversationId?: string, system?: string } }` | `{ conversationId, resumed }` — Promise，iframe 内构造会话代理 | ai |
| `send` | `{ conversationId: string, text: string }` | `void` | ai |
| `abort` | `{ conversationId: string }` | `void` | ai |
| `close` | `{ conversationId: string }` | `void` — 销毁会话，释放宿主侧历史 | ai |

**事件**（通过 `HostEvent` 推送到 iframe）：

| 事件名 | 触发时机 | data |
|--------|----------|------|
| `ai-event` | AI 会话流式输出 | `{ conversationId, event, data }` — event: `chunk`/`reasoning`/`tool`/`done`/`error`，路由到对应会话代理的 on() 回调 |

## 服务内全局注入

宿主在 iframe 加载完成后注入 `window.__amiba__` 对象，封装 postMessage 为 Promise 风格：

```js
window.__amiba__ = {
  storage: {
    set: (key, data) => callHost('storage', 'setStorage', { key, data }),
    get: (key)       => callHost('storage', 'getStorage', { key }),
    remove: (key)    => callHost('storage', 'removeStorage', { key }),
  },
  showToast: (title, icon) => callHost('notification', 'showToast', { title, icon }),
  navigateTo: (url) => callHost('ui', 'navigateTo', { url }),
  navigateBack: (delta) => callHost('ui', 'navigateBack', { delta }),
  network: {
    setVisibility: (opts) => callHost('network', 'setVisibility', { visibility: opts }),
    getVisibility: () => callHost('network', 'getVisibility', {}),
    startDiscovery: (t) => callHost('network', 'startDiscovery', { transport: t }),
    stopDiscovery: (t) => callHost('network', 'stopDiscovery', { transport: t }),
    getVisibleDevices: () => callHost('network', 'getVisibleDevices', {}),
    connect: (peerId, serviceKey) => callHost('network', 'connect', { peerId, serviceKey }),
      // → { sessionId, peerId, peerName } → 构造 session 代理
    startListening: (serviceKey) => callHost('network', 'startListening', { serviceKey }),
    stopListening: (serviceKey) => callHost('network', 'stopListening', { serviceKey }),
    onPeerDiscovered: (cb) => { /* event listener for peer-discovered */ },
    onSession: (cb) => { /* event listener for session-created → cb(sessionProxy) */ },
  },
  fileAccess: {
    requestAccess: (opts) => callHost('fileAccess', 'requestAccess', { opts }),
    listFiles: (token) => callHost('fileAccess', 'listFiles', { token }),
    readText: (token, path) => callHost('fileAccess', 'readText', { token, path }),
    readBinary: (token, path) => callHost('fileAccess', 'readBinary', { token, path }),
  },
  fetch: {
    request: (opts) => callHost('fetch', 'request', {
      url: opts.url, method: opts.method || 'GET',
      headers: opts.headers || {}, body: opts.body || null,
    }),
  },
}
```

服务业务逻辑中直接使用：

```js
await __amiba__.storage.set('count', 42)
const count = await __amiba__.storage.get('count')
__amiba__.navigateTo('/pages/detail')
__amiba__.showToast('保存成功', 'success')
```

## 通信流程

服务 iframe 和 widget iframe 走不同的宿主侧处理路径：

### 服务 iframe（service-container.vue）

```
服务 (iframe)                    宿主 (Vue SPA)
     │                                │
     │  postMessage({ type:'api',     │
     │    module, method, params,     │
     │    requestId })                │
     │ ──────────────────────────────>│
     │                                │ 1. createBridge 验证 event.source
     │                                │ 2. 检查 manifest.permissions 权限
     │                                │ 3. makeApiHandler 执行（闭包捕获 serviceId）
     │  postMessage({ type:'api-      │
     │    response', requestId,       │
     │    result })                   │
     │ <──────────────────────────────│
     │                                │
```

### Widget / 后台 iframe（background-manager.ts 全局处理器）

```
Widget/后台 iframe                 宿主 (Vue SPA)
     │                                │
     │  postMessage({ type:'api',     │
     │    module, method, params,     │
     │    requestId })                │    params 自动携带 serviceId
     │ ──────────────────────────────>│      (BRIDGE_SCRIPT callHost 注入)
     │                                │ 1. 从 params.serviceId 识别来源服务
     │                                │ 2. 跳过已知后台 worker iframe（避免双重处理）
     │                                │ 3. handleGlobalAPI 按模块路由到子处理器
     │  postMessage({ type:'api-      │
     │    response', requestId,       │
     │    result })                   │
     │ <──────────────────────────────│
     │                                │
```

**Widget 现在支持全部 9 个模块**（storage / notification / ui / widgets / network / background / fileAccess / fetch / ai），与服务 iframe 能力一致。唯一的区别是 widget 无 `allow-same-origin` 沙箱属性，无法加载宿主同源脚本。

## 安全措施

- 请求验证 `event.data.type === 'api'`
- 权限检查：对照 manifest.permissions 放行
- 30 秒超时
- iframe 使用 `sandbox="allow-scripts"`（禁止 top-navigation、弹窗、表单提交）
