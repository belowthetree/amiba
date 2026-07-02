# 服务模型

## 服务概念

在变形虫中，"服务"是一个统一的抽象。系统内置功能和用户生成的迷你应用都是服务，它们通过统一的方式注册、切换和运行。

## 系统内置服务（6 个，不可变）

| 服务 | 路由 | 描述 |
|------|------|------|
| 首页 | `/` | 功能入口卡片 + 最近使用 |
| AI 对话 | `/chat` | 消息气泡 + 输入框，流式 LLM 对话 |
| AI 生成 | `/generate` | 输入需求 → 流式进度 → 生成服务包 |
| 设置 | `/settings` | API Key / Base URL / Model / 主题 |
| 我的服务 | `/my-services` | 已安装列表 + 开关 + 删除 |
| 记忆管理 | `/memory` | MEMORY.md / USER.md 查看管理 |

内置服务的 ID 以 `system.` 为前缀（如 `system.chat`），不可删除、不可禁用。

## 用户服务（动态，可变）

由 AI 生成或下载获得。每个服务是一个 **多文件 Web 应用包 (ServicePackage)**：

```ts
interface ServicePackage {
  manifest: {
    id: string          // "user.xxx"，用户服务以 user. 为前缀
    name: string
    version: string
    description: string
    permissions: ('storage' | 'notification')[]
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
| `network` | 允许服务使用局域网/蓝牙互联通信 |

## 服务注册

```
首次启动: 复制预置 demo → 注册到 ServiceRegistry
AI 生成:  写入 ServicePackage JSON → 注册 → 首页可见
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
