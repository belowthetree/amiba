---
title: JSBridge API 参考
description: window.__amiba__ 所有宿主 API 的完整参考，含参数和示例
keywords: [JSBridge, API, storage, notification, navigation, showToast, 存储, 通知, 导航]
category: api
---

# JSBridge API 参考

服务通过 `window.__amiba__` 全局对象调用宿主能力。所有 API 返回 Promise，部分需要 manifest 声明权限。

## 存储 (storage)

**权限**: `"storage"`

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `set(key, data)` | key: string, data: any | `Promise<void>` | 持久化存储 |
| `get(key)` | key: string | `Promise<any>` | 读取存储 |
| `remove(key)` | key: string | `Promise<void>` | 删除存储 |

```js
await __amiba__.storage.set('username', '张三')
const name = await __amiba__.storage.get('username')
await __amiba__.storage.remove('username')
```

## 通知 (notification)

**权限**: `"notification"`

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `showToast(title, icon)` | title: string, icon: 'success'/'error'/'loading'/'none' | `Promise<void>` | 显示 Toast |

```js
await __amiba__.showToast('保存成功', 'success')
```

## 导航

无需权限。

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `navigateTo(url)` | url: string | `Promise<void>` | 页面跳转 |
| `navigateBack(delta)` | delta?: number (默认1) | `Promise<void>` | 返回上级 |

```js
__amiba__.navigateTo('page2.html')
__amiba__.navigateBack()
```

## Widget 悬浮块

**权限**: `"widgets"`

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `register(config)` | config: WidgetConfig | `Promise<void>` | 动态注册悬浮块 |
| `remove(id)` | id: string | `Promise<void>` | 移除悬浮块 |
| `show(id)` | id: string | `Promise<void>` | 显示悬浮块 |
| `hide(id)` | id: string | `Promise<void>` | 隐藏悬浮块 |

```js
await __amiba__.widgets.register({
  id: 'quick-note', icon: '📝', page: 'widgets/note.html',
  edge: 'right', position: 200, showOn: [], trigger: 'manual'
})
__amiba__.widgets.show('quick-note')
```

## 网络 P2P

**权限**: `"network"`

详见 `network.md` 完整文档。

| 方法 | 说明 |
|------|------|
| `setVisibility(opts)` | 设置可见性 `{lan, ble}` |
| `getVisibility()` | 获取可见性 |
| `startDiscovery(transport)` | 开始设备发现 |
| `stopDiscovery(transport)` | 停止发现 |
| `getVisibleDevices()` | 列出已发现设备 |
| `onPeerDiscovered(cb)` | 监听新设备 |
| `startListening(serviceKey)` | 启动 TCP 监听 |
| `stopListening(serviceKey)` | 停止监听 |
| `connect(peerId, serviceKey)` | 连接设备，返回 session |
| `onSession(cb)` | 监听外来会话 |

## 后台服务 (background)

**权限**: `"background"`

需要服务目录下配置 `background.json`（声明 entry 和 schedule/onEvents），通过 `start()` 显式启动。

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `start(opts?)` | 可选配置覆盖 | `Promise<void>` | 启动后台 worker（隐藏 iframe） |
| `stop()` | — | `Promise<void>` | 停止后台 worker |
| `getState()` | — | `Promise<{running, startCount}>` | 查询运行状态 |
| `postMessage(msg)` | msg: any | `Promise<void>` | 向同服务前台 iframe 发消息 |
| `onMessage(cb)` | cb: (msg) => void | — | 接收前台发来的消息 |
| `on(event, cb)` | event: 'tick'\|host事件 | — | 监听定时/主机事件 |

```js
// 后台入口 background.js
__amiba__.background.on('tick', async () => {
  const count = await __amiba__.storage.get('counter') || 0
  await __amiba__.storage.set('counter', count + 1)
})
```

**约束**：最多 3 个后台服务并发，必须显式 start()，崩溃静默重启。

## 文件访问 (fileAccess)

**权限**: `"fileAccess"`

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `requestAccess(opts)` | `{ path?, pattern?, purpose? }` | `Promise<{token, path}>` | 请求文件访问授权 |
| `listFiles(token)` | token: string | `Promise<Array>` | 扫描文件列表 |
| `readText(token, path)` | token, path | `Promise<string>` | 读取文本文件 |
| `readBinary(token, path)` | token, path | `Promise<string>` (base64) | 读取二进制文件 |

## HTTP 请求 (fetch)

**权限**: `"fetch"`

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `request(opts)` | `{ url, method?, headers?, body? }` | `Promise<{status, body}>` | 代理 HTTP 请求（绕过 CORS） |

## Widget 与服务 API 一致性

Widget（悬浮块）iframe 与服务主页面 iframe 支持**完全相同的 `__amiba__` API**（以上全部 8 个模块）。Widget API 调用通过宿主全局消息处理器路由，自动注入 `serviceId` 识别来源服务。

## 禁止事项

- ❌ 不要用 `localStorage` / `sessionStorage`
- ❌ 不要用 `alert()` / `confirm()` / `prompt()`
- ❌ 不要用 `fetch()` 访问外部 API
- ❌ 不要引用外部 CDN
