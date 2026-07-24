# 服务模型

## 服务概念

在变形虫中，"服务"是一个统一的抽象。系统内置功能和用户生成的迷你应用都是服务，它们通过统一的方式注册、切换和运行。

## 系统内置页面（7 条路由）

| 页面 | 路由 | 描述 |
|------|------|------|
| 远程服务仓库 | `/registry` | 浏览/导入远程仓库中的服务 |
| 服务浏览 | `/services` | 已安装列表 + 导入/分享 |
| AI 对话 | `/` | 消息气泡 + 输入框，流式 LLM 对话 |
| 快捷页 | `/quick` | 可自定义的快捷页面（widget 宿主） |
| 设置 | `/settings` | API Key / Base URL / Model / 主题 |
| 记忆管理 | `/memory` | MEMORY.md / USER.md 查看管理 |
| 服务容器 | `/service/:id` | iframe 沙箱中运行服务 |

前 6 个主导航页可通过左右滑动/边缘箭头切换（顺序见 `PAGE_ORDER`，从左到右即上表顺序）。

## 用户服务（动态，可变）

由 AI 生成或下载获得。每个服务是一个 **多文件 Web 应用包 (ServicePackage)**：

```ts
interface ServicePackage {
  manifest: {
    id: string          // "user.xxx"，用户服务以 user. 为前缀
    name: string
    version: string
    description: string
    permissions: ('storage' | 'notification' | 'widgets' | 'network' | 'background' | 'fileAccess' | 'fetch')[]
  }
  files: ServiceFile[]  // 多文件列表
  tasks?: GeneratedTask[] // 定时任务（可选）
}

interface ServiceFile {
  path: string    // "index.html", "style.css", "app.js"
  content: string // 文件内容
}
```

整个包作为 JSON 原子存储（键 `amiba_pkg_{serviceId}`），不需要分文件读写。

### 权限

| 权限 | 说明 |
|------|------|
| `storage` | 允许服务读写其专属的键值存储 |
| `notification` | 允许服务弹出 Toast 通知 |
| `widgets` | 允许服务使用悬浮块功能 |
| `network` | 允许服务使用局域网/蓝牙互联通信，包括设备发现、原始消息收发和结构化协议（protocol）层。详见 [JSBridge 通信协议](jsbridge.md#network) |
| `background` | 允许服务在后台持续运行（隐藏 iframe），支持定时调度、事件驱动、与前台 IPC 通信。详见 [后台服务](#后台服务) |
| `fileAccess` | 允许服务通过授权 token 访问磁盘文件（选择文件夹、列出/读取文件）。详见 [JSBridge 通信协议](jsbridge.md#fileaccess) |
| `fetch` | 允许服务发起 HTTP 请求（Rust reqwest 代理，绕过 CORS）。详见 [JSBridge 通信协议](jsbridge.md#fetch) |

## 服务注册

```
首次启动: 复制预置 demo → 注册到 ServiceRegistry
AI 生成:  写入 ServicePackage JSON → 注册 → 服务列表可见
下载安装:  导入 JSON 文件 → 同上
```

### ServiceRegistry API

```ts
// 注册服务
registerService(manifest, 'ai-generated'): ServiceEntry

// 移除服务（仅用户服务）
unregisterService(id): boolean

// 启/禁用服务
toggleService(id, enabled): void

// 存储/读取服务包
storeServicePackage(id, pkg): void
getServicePackage(id): ServicePackage | null

// 服务专属数据存储
setServiceData(serviceId, key, data): void
getServiceData(serviceId, key): any
removeServiceData(serviceId, key): void
```

## 服务运行

用户服务在 `service-container.vue` 中运行：

1. 根据路由参数找到对应服务
2. 检查服务是否存在且已启用
3. 加载服务的 `ServicePackage` JSON
4. 调用 `inlinePackage()` 将多文件内联为单个 HTML
5. 在 `<iframe sandbox="allow-scripts">` 中通过 `srcdoc` 渲染
6. 注入 `__amiba__` 全局对象建立 JSBridge
7. 根据 manifest 权限放行 API 调用

### 悬浮块（Widget）

服务可通过 `widget.json` 声明式配置悬浮快捷展示块。服务加载时自动注册，卸载时自动清理。

**widget.json 格式**（放在服务文件列表根目录）：

```json
{
  "widgets": [
    {
      "id": "quick-note",
      "icon": "📝",
      "label": "快速笔记",
      "page": "widgets/quick-note.html",
      "edge": "right",
      "position": 120,
      "showOn": ["chat", "home"],
      "trigger": "page"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识，kebab-case |
| `icon` | string | ✅ | emoji 图标 |
| `label` | string | — | 悬停提示文字 |
| `page` | string | ✅ | Widget HTML 文件路径 |
| `edge` | `"left" \| "right"` | ✅ | 吸附边缘 |
| `position` | number | ✅ | 初始 y 位置（px） |
| `showOn` | string[] | ✅ | 生命周期路由名列表，空数组=全局；`trigger: "page"` 时进入自动显示 |
| `trigger` | `"manual" \| "page"` | ✅ | `"manual"`=API 控制（默认），`"page"`=进入 showOn 路由自动显示 |

**trigger 模式说明**：

| 模式 | 行为 |
|------|------|
| `"manual"` | 注册后初始隐藏，需调用 `__amiba__.widgets.show(id)` 显示。不受路由影响。 |
| `"page"` | 进入 `showOn` 中的路由时自动显示，离开时自动隐藏并折叠面板。`showOn: []` 表示全局生命周期。 |

**服务需声明 `widgets` 权限** 才能使用悬浮块功能（包括 widget.json 和编程式 API）。

**Widget API 能力**：Widget iframe 内可使用全部 `__amiba__` API 模块（storage / notification / ui / widgets / network / background / fileAccess / fetch），与服务 iframe 能力一致。API 调用通过 `background-manager.ts` 的全局消息处理器路由，`callHost` 自动在 params 中注入 `serviceId` 以识别来源服务。

**Widget UI 文件规范**：

| 约定 | 说明 |
|------|------|
| 路径 | `widgets/<name>.html`，放在服务 files 中 |
| 命名 | kebab-case，与 widget id 对应 |
| 内容 | 独立 HTML 片段，含 `<style>` 和 `<script>` |
| Bridge | 使用 `<!-- AMIBA_BRIDGE -->` 占位符，宿主自动注入 |
| 尺寸 | 自适应，面板宽 280px，推荐内容高 200-400px |
| 入口 | 不含 `<html>/<body>` 标签，直接是 `<div class="widget-root">...</div>` |

示例：

```html
<!-- AMIBA_BRIDGE -->
<style>
  .widget-root { padding: 12px; font-family: sans-serif; }
  .count { font-size: 24px; font-weight: bold; }
</style>
<div class="widget-root">
  <div class="count" id="count">0</div>
  <button onclick="increment()">+1</button>
</div>
<script>
  function increment() {
    const el = document.getElementById('count');
    el.textContent = parseInt(el.textContent) + 1;
  }
</script>
```

**编程式 API**（运行时动态注册）：

```js
await __amiba__.widgets.register({
  id: 'dynamic-widget',
  icon: '🔔',
  page: 'widgets/alert.html',
  edge: 'right',
  position: 200,
  showOn: [],
  trigger: 'manual'
})
// manual 模式需要手动调用 show
__amiba__.widgets.show('dynamic-widget')
__amiba__.widgets.hide('dynamic-widget')
__amiba__.widgets.remove('dynamic-widget')
```

## 命名规范

- **服务 ID**: 内置 `system.xxx`，用户 `user.yyy`
- **配置键**: 全小写下划线 `ai_base_url`, `ai_model`
- **API 方法**: camelCase `setStorage`, `navigateTo`

## 后台服务

服务可声明 `background` 权限 + `background.json` 配置文件，注册后台运行能力。后台入口 JS 运行在隐藏 `<iframe>` 中，由 `BackgroundServiceManager` 统一管理。

### background.json 格式

```json
{
  "entry": "background.js",
  "schedule": {
    "type": "interval",
    "intervalMs": 60000
  },
  "onEvents": ["peer-discovered", "session-created"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `entry` | string | ✅ | 后台入口 JS 文件（相对于服务根目录） |
| `schedule.type` | `"interval" \| "cron" \| "none"` | — | 调度类型 |
| `schedule.intervalMs` | number | — | interval 类型的毫秒数 |
| `schedule.cron` | string | — | cron 表达式 |
| `onEvents` | string[] | — | 订阅的主机事件名（network-bridge 事件） |

### 约束

- **最多 3 个**后台服务并发运行（可通过 `settings.max_background_services` 调整）
- 后台服务只能与**同服务的前台 iframe**通过 `postMessage`/`onMessage` 通信
- 必须通过 `start()` 显式调用才会启动，禁止自动运行
- 崩溃静默重启，不通知用户

### 使用示例

```js
// 后台入口 background.js
__amiba__.background.on('tick', async (data) => {
  const last = await __amiba__.storage.get('last_check')
  // 检查并通知前台
  __amiba__.background.postMessage({ type: 'check', time: Date.now() })
})

// 前台接收后台消息
__amiba__.background.onMessage((msg) => {
  if (msg.type === 'check') updateUI()
})
```

## 经验教训

- **2026-07-09**: 悬浮块通过 `__amiba__.background.postMessage()` 向后台服务发指令前，**必须先调用 `start()` / `getState()` 确保后台已启动**。widget iframe 不经过 service-container 的路由，它的 `background` API 调用走 background-manager 的全局 `window` message listener，该 listener 在 `postMessage` 时若 worker 未运行会**静默丢弃消息**。同时 `bridge.ts` 中 `background.start/stop/getState` 方法必须传入 `serviceId`（`window.__amiba_service_id__`），否则全局 listener 无法识别调用来源。

- **2026-07-09**: `evaluateWidget()` 必须在任何 lifecycle 规则之前**先检查 `widgetsVisible` 标志**作为主开关。原实现中 `lifecycle: "*"` 无条件返回 `true`，导致 `setServiceWidgetsVisible(id, false)` 设置 `visible = false` 后，紧接着 `onWidgetToggled → reevaluateService → evaluateWidget` 又将 `visible` 覆盖回 `true`，widget 无法关闭且关闭状态不持久。同样 `lifecycle: "persistent"` 已有的 `widgetsVisible !== false` 检查需提升为顶级 guard。

- **2026-07-09**: 删除服务时必须统一释放所有运行时资源，**收口到一处**（`registry.ts:destroyServiceRuntime()`）。原 `deleteService` 仅做了 `unregisterService` + `removeServiceStorage`，遗漏了：后台 worker（隐藏 iframe + 定时器泄漏）、文件访问授权（`_grants` Map 泄漏）、悬浮块状态（persistent widget 残留）、前台 handler（`_foregroundHandlers` 泄漏）。统一收口函数按序清理：stopService → clear foreground handler → revoke file grants → unregister ALL widgets。

- **2026-07-09**: `notifyFront` 的 storage 写入防抖用 `clearTimeout` + 重设定时器是**错误的**。HTML5 Audio 的 `timeupdate` 事件每 ~250ms 触发一次，而防抖阈值 300ms 大于事件间隔 → 定时器被无限重置，storage 永远写不进去，widget 轮询永远读到过期数据。正确做法：检查定时器是否存在，若已存在则仅更新 pending 数据不清除定时器，保证首次写入在 300ms 内完成。

- **2026-07-09**: Widget iframe 只有 `background` 模块有全局 `window` message listener（`background-manager.ts`），`storage`/`fileAccess` 等模块**只在 `service-container.vue` 的 bridge 中处理**。Widget 的 `__amiba__.storage.get()` 发出去的 `postMessage` 无人响应 → Promise 静默超时。修复：`bridge.ts` 的 `storage.*` 调用携带 `serviceId`（`window.__amiba_service_id__`），`background-manager.ts` 新增全局 storage listener 处理 widget 的读写请求。

- **2025-07-23**: Widget 快捷页面 API 能力从仅 `storage`+`background` 2 模块扩展到全部 8 模块（与服务 iframe 一致）。实现方式：(1) `BRIDGE_SCRIPT` 中 `callHost` 自动从 `window.__amiba_service_id__` 注入 `serviceId` 到所有 API 调用的 params；(2) `background-manager.ts` 合并两个分散的全局 listener 为统一的 `handleGlobalAPI`，按 module 路由到 8 个子处理器；(3) 全局处理器通过 `_workers` 的 `event.source` 检查跳过后台 iframe 消息，避免与 `handleBgAPI` 双重处理。Widget 现在可调用 `__amiba__.showToast()`、`__amiba__.navigateTo()`、`__amiba__.widgets.*`、`__amiba__.network.*`、`__amiba__.fileAccess.*`、`__amiba__.fetch.*` 等全部 API。
