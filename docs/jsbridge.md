# JSBridge 通信协议

## 概述

JSBridge 是宿主（Vue SPA）与用户服务（iframe）之间的唯一通信通道。基于浏览器原生 `postMessage`，安全、标准、无需三方库。

## 消息格式

全部用 **postMessage**，不发明新协议。

```ts
// 服务 → 宿主 请求
interface ServiceRequest {
  type: 'api'
  module: string          // storage | notification | ui | task
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
  name: string            // page-show | page-hide | task-trigger
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
| `startDiscovery` | `{ transport: 'lan' \| 'ble' \| 'all' }` | `void` | network |
| `stopDiscovery` | `{ transport: string }` | `void` | network |
| `getVisibleDevices` | — | `DiscoveredPeer[]` | network |
| `connect` | `{ peerId: string }` | `void` | network |
| `disconnect` | `{ peerId: string }` | `void` | network |
| `send` | `{ peerId: string, message: any }` | `void` | network |

**事件**（通过 `HostEvent` 推送到 iframe）：

| 事件名 | 触发时机 | data |
|--------|----------|------|
| `peer-discovered` | 发现新设备 | `{ id, name, transport, address }` |
| `peer-connected` | 连接建立 | `{ id, transport }` |
| `peer-disconnected` | 连接断开 | `{ id, transport }` |
| `message-received` | 收到消息 | `{ peerId, message, timestamp }` |

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

```
服务 (iframe)                    宿主 (Vue SPA)
     │                                │
     │  postMessage({ type:'api',     │
     │    module, method, params,     │
     │    requestId })                │
     │ ──────────────────────────────>│
     │                                │ 1. 验证 origin
     │                                │ 2. 检查权限
     │                                │ 3. 执行 handler
     │  postMessage({ type:'api-      │
     │    response', requestId,       │
     │    result })                   │
     │ <──────────────────────────────│
     │                                │
```

## 安全措施

- 请求验证 `event.data.type === 'api'`
- 权限检查：对照 manifest.permissions 放行
- 30 秒超时
- iframe 使用 `sandbox="allow-scripts"`（禁止 top-navigation、弹窗、表单提交）
