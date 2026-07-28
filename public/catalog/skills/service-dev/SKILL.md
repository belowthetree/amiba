---
name: service-dev
description: Amiba 服务开发完整指南
keywords:
  - 开发服务
  - 创建服务
  - 服务开发
  - 开发
  - service
  - service-dev
  - 写一个
  - 做一个
  - 帮我写
  - 帮我做
---

# Amiba 服务开发完整指南 (service-dev)

当用户要求「开发服务 / 创建应用 / 写一个 XX」时，通过工具链分步创建服务，严格遵循以下规范。

---

## 1. 生成服务

**使用工具链分步创建**（不输出整包 JSON）：

```
1. service_list / requirements_summary — 检查是否已有类似服务
2. service_create({ id, name, description, permissions }) — 创建服务骨架
3. service_file_write × N — 逐个写入 index.html、style.css、app.js
4. service_validate — 校验代码合法性
```

**permissions 选择指南：**

| 场景 | 需要的权限 |
|------|----------|
| 数据需要持久化（刷新不丢） | `"storage"` |
| 需要弹 Toast 通知 | `"notification"` |
| 需要悬浮块 | `"widgets"` |
| 多人/聊天/协作/联机/房间/局域网 | `"network"` |
| 需要后台定时任务/事件监听 | `"background"` |
| 需要读取本地磁盘文件 | `"fileAccess"` |
| 需要 HTTP 请求外部 API | `"fetch"` |
| 服务内需要 AI 对话/智能问答 | 声明 `ai` 权限 |
| 希望主聊天 AI 能调用服务能力（如"帮我开始番茄钟"） | 声明 `tools` 权限 |
| 以上组合 | 多项并列，如 `["storage","network"]` |

**生成前务必先检查：**
- 用 `service_list` 确认没有重复服务
- 用 `requirements_summary` 确认不能通过修改现有服务满足需求

**service_create 参数示例：**
```json
{
  "id": "user.chatroom",
  "name": "聊天室",
  "description": "局域网多人聊天室",
  "version": "1.0.0",
  "permissions": ["storage", "network"]
}
```

---

## 1.5 Sandbox 约束（必读！）

**完整规范用 doc_read("sandbox.md") 查看。** 核心要点：
- 禁止 localStorage / BroadcastChannel / alert / 外部 CDN
- 数据持久化用 `__amiba__.storage.*`
- 多人通信用 `network` 权限 + P2P API
- 生成后用 `service_validate` 自动检测违规

---

## 2. Manifest 规范

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，必须以 `"user."` 开头，如 `"user.todo"` |
| `name` | string | 显示名称（中文优先） |
| `version` | string | 语义化版本，如 `"1.0.0"` |
| `description` | string | 简短描述（≤30 字） |
| `permissions` | string[] | 允许的值：`"storage"`、`"notification"`、`"widgets"`、`"network"`、`"background"`、`"fileAccess"`、`"fetch"`、`"ai"`、`"tools"` |
| `aiTools` | object[] | 可选，服务工具静态声明（不含 handler），与运行时 `__amiba__.tools.register` 的元数据同构，用于设置页展示与校验 |

---

## 3. Files 规范

- 必须包含 `{ "path": "index.html", "content": "..." }`
- CSS 放在 `style.css`，JS 放在 `app.js`（**不要内联在 HTML 中**）
- `index.html` 中通过 `<link href="style.css">` 和 `<script src="app.js">` 引用
- **多文件组件结构**（可选，仅复杂服务使用）：
  - CSS 可用 `styles/*.css` 拆分，`<link href="styles/theme.css">` 引用
  - JS 组件可用 `components/*.js` 拆分，`<script src="components/TodoItem.js">` 引用
  - 所有被引用的文件都由 packager 自动内联到单个 HTML 中
  - 文件路径可包含目录前缀（如 `"utils/format.js"`），不限于扁平结构
  - `service_file_write` 的 `file_path` 参数直接写入对应路径
- 所有 `content` 中的代码必须语法正确、可直接运行

---

## 4. HTML 规范

- 使用 HTML5 标准：`<!DOCTYPE html>` + `<meta charset="utf-8">`
- viewport: `width=device-width, initial-scale=1.0`
- **禁止在 index.html 中手动添加 `<!-- AMIBA_BRIDGE -->`**——packager 在 `<body>` 后自动注入，手动添加会导致双标记、bridge 注入到 DOCTYPE 前触发怪异模式
- UI 必须遵循平台统一的玉石玻璃风格：**先用 doc_read("service-style.md") 读取《服务界面风格指南》**（含可直接复制的 CSS 令牌、玻璃背景、组件样式）
  - 主色 `#2FA98C`（玉青）、背景 `#EDF3F0`（玉白）、表面半透明白 + 背景模糊
  - 圆角 8/12/18px、柔和分层阴影、间距 4/8/16/24、字体 13–15px
  - 简洁直出：不要重型顶栏/返回栏（宿主已提供左上角浮动返回按钮）
- **不要使用外部 CDN 资源**（iframe 沙箱限制）

---

## 5. JS 规范 (app.js)

使用 `window.__amiba__` 调用宿主 API，所有方法返回 Promise。

**完整 API 参考用 doc_read("jbridge.md") 和 doc_read("storage.md") 查看。**

核心 API 速查：

| 场景 | API |
|------|-----|
| 持久化存储 | `__amiba__.storage.set/get/remove(key, data)` — 需 `storage` 权限 |
| 弹通知 | `__amiba__.showToast(title, icon)` — 需 `notification` 权限 |
| 页面跳转 | `__amiba__.navigateTo(url)` / `navigateBack(delta)` — 无需权限 |
| Widget | `__amiba__.widgets.register/remove/show/hide(...)` — 需 `widgets` 权限，详见 doc_read("widgets.md") |
| 局域网 P2P | `__amiba__.network.*` — 需 `network` 权限，详见 doc_read("network.md") |
| 后台服务 | `__amiba__.background.start/stop/getState/postMessage(...)` — 需 `background` 权限 |
| 文件访问 | `__amiba__.fileAccess.requestAccess/listFiles/readText(...)` — 需 `fileAccess` 权限 |
| HTTP 请求 | `__amiba__.fetch.request({ url, method?, headers?, body? })` — 需 `fetch` 权限 |
| AI 对话 | `__amiba__.ai.createConversation({ system? })` → conv.send/on/abort/close — 需 `ai` 权限，详见 doc_read("jbridge.md") |
| 服务工具 | `__amiba__.tools.register/unregister(...)` — 需 `tools` 权限，向主聊天 AI 暴露服务能力，详见 doc_read("jbridge.md") |

- **禁止** `alert()`、`prompt()`、`localStorage`、`BroadcastChannel`
- **禁止** `fetch()` 访问外部 API（CORS + 沙箱限制）

---

## 6. CSS 规范

- **风格统一：在 index.html 中通过 `<link href="/libs/jade.css" rel="stylesheet">` 引入平台玉石玻璃风基础样式**（含设计令牌、玻璃辉光背景、.card/.btn-primary/.btn-ghost/.input/.modal 等类），服务的 style.css 只写业务布局，颜色/圆角/阴影一律引用 `var(--*)` 令牌
- 细节与定制方法：doc_read("service-style.md")《服务界面风格指南》
- 移动端优先，flexbox 布局
- 按钮至少 40px 高度（触控友好）

---

## 7. 完整示例

### index.html

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>计数器</title>
  <link href="/libs/jade.css" rel="stylesheet">
  <link href="style.css" rel="stylesheet">
</head>
<body>
  <div class="glass-bg" aria-hidden="true">
    <div class="gb-glow gb-glow-1"></div>
    <div class="gb-glow gb-glow-2"></div>
    <div class="gb-streak"></div>
  </div>
  <div id="app" class="page">
    <h1>计数器</h1>
    <p id="count">0</p>
    <button id="plus" class="btn-primary">+1</button>
    <button id="minus" class="btn-ghost">-1</button>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

### app.js

```js
let count = 0;

async function init() {
  const saved = await __amiba__.storage.get('value');
  if (saved != null) count = saved;
  document.getElementById('count').textContent = count;
}

document.getElementById('plus').onclick = async () => {
  count++;
  document.getElementById('count').textContent = count;
  await __amiba__.storage.set('value', count);
};

document.getElementById('minus').onclick = async () => {
  count--;
  document.getElementById('count').textContent = count;
  await __amiba__.storage.set('value', count);
};

init();
```

---

## 8. 常见错误（含 Vue 专项）

- ❌ 在 HTML 中内联 `<script>` 和 `<style>` → 必须用独立文件
- ❌ `manifest.id` 不以 `"user."` 开头
- ❌ `permissions` 使用了 `"storage"` / `"notification"` / `"widgets"` / `"network"` / `"background"` / `"fileAccess"` / `"fetch"` / `"ai"` / `"tools"` 以外的值
- ❌ 使用 `localStorage` / `sessionStorage` → 必须用 `__amiba__.storage.*`
- ❌ 使用 `BroadcastChannel` / `SharedWorker` → 多人通信必须用 `network` 权限 + P2P API
- ❌ 使用 `alert()` / `confirm()` / `prompt()` → 用 `__amiba__.showToast()` 替代
- ❌ 使用外部 CDN 或 `fetch` 外部 API
- ❌ `content` 中的代码有语法错误
- ❌ "多人聊天"在本地模拟多角色 → 局域网场景必须用 network 权限 + P2P
- ❌ 生成后未调用 `service_validate` 校验 → 务必校验！
- ❌ 修改已安装服务时重新生成整个服务 → 应用 `service_file_write` 直接编辑文件
- ❌ 目录导入时 manifest.json 包含外层 `files` 包裹 → 目录导入 manifest.json 只含 id/name/version/description/permissions
- ❌ P2P 服务未调用 `startListening(SERVICE_KEY)` → 无法被其他设备连接
- ❌ P2P 服务使用旧 API `connect(peerId)` 而非 `connect(peerId, SERVICE_KEY)` → hello 缺少 service 字段，连接被拒绝

**Vue 专项：**
- ❌ Vue 模板中使用 `__amiba__.storage.get('key')` 返回值 → 会返回 Promise 对象，显示 `[object Promise]` → 必须在 `mounted()` 中 `await` 后再赋值到 data
- ❌ 使用 Composition API `setup()` / `ref()` 而非 Options API → 增加 AI 生成错误概率，统一用 `data()` + `methods` + `mounted()`
- ❌ `data()` 函数中直接调异步方法 → `__amiba__` 方法返回 Promise，不能同步赋值
- ❌ 未加载 Vue 库就用 `Vue.createApp` → 必须在 Vue 脚本之后加载 `app.js`
- ❌ `v-html` 绑定用户输入 → 存在 XSS 风险，仅用于可信静态内容
- ❌ 不使用 Vue 时也加了 Vue 脚本 → 简单服务用原生 JS，避免 130KB 不必要加载

---

## 9. 网络服务开发（P2P 通信）⭐

**决策树：用户需求包含以下任一关键词 → 必须使用网络 P2P 方案！**

| 触发词 | 含义 | 动作 |
|--------|------|------|
| 聊天/聊天室/群聊/消息 | 多设备通信 | 声明 `network` 权限 |
| 协作/协同/共同编辑 | 多设备同步 | 声明 `network` 权限 |
| 联机/对战/比赛/房间 | 多设备实时交互 | 声明 `network` 权限 |
| 传输/发送文件/分享 | 设备间数据传输 | 声明 `network` 权限 |
| 局域网/内网/本地网络 | 多设备发现 | 声明 `network` 权限 |
| 其他人加入/多人在线 | 非单机场景 | 声明 `network` 权限 |

> ⚠️ **绝对不要**用 BroadcastChannel / localStorage 事件 / 本地多角色模拟来实现"多人"。

**完整代码模板和 API 细节用 doc_read("network.md") 查看。** 关键步骤：

1. 声明 `network` 权限
2. `setVisibility({ lan: true })` → `startDiscovery('lan')` → `startListening(SERVICE_KEY)`
3. `connect(peerId, SERVICE_KEY)` 主动连接 / `onSession(cb)` 接收连接
4. `session.send(msg)` 通信 / `session.close()` 断开

---

## 10. Chart.js 图表（统一图表库）

需要使用图表时，**统一使用 Chart.js v4**（已预置在平台中）：

```html
<script src="/libs/chart.umd.min.js"></script>
```

```js
new Chart(canvas, {
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'radar',
  data: { labels: [...], datasets: [{ label: '...', data: [...], backgroundColor: [...] }] },
  options: { responsive: true, maintainAspectRatio: false }
})
```

推荐配色：`['#1976D2','#9C27B0','#E53935','#43A047','#FB8C00','#00ACC1']`
Canvas 必须显式设置 width/height。示例：`example/chart-demo/`

---

## 11. Vue 3 使用（响应式 UI 框架）

当服务需要复杂的数据绑定、列表渲染、表单交互或仪表盘时，可使用 Vue 3（预置在平台中）。

### 引入方式

```html
<script src="/libs/vue.global.prod.js"></script>
```

Packager 会透传该脚本引用（不内联），与 Chart.js 的加载方式相同。

### 何时用 Vue vs 原生 JS

| 场景 | 推荐 | 理由 |
|------|------|------|
| 计数器、单按钮、纯展示 | **原生 JS** | 杀鸡不用牛刀，Vue 130KB 不值得 |
| 表单、列表、数据绑定多 | **Vue** | `v-model`、`v-for` 大幅减少代码量 |
| 仪表盘、统计面板 | **Vue** | 多数据区响应式联动 |
| 聊天室、实时消息流 | **Vue** | 消息列表自动更新，无需手动操作 DOM |
| 仅用 Chart.js 图表 | **原生 JS** | Chart.js 自身无 Reactivity 需求 |

### 文件结构（可选分层）

简单 Vue 服务可用扁平结构（`index.html` + `style.css` + `app.js`）。复杂服务推荐：

```
services/user.xxx/
├── manifest.json
├── index.html             ← 入口，显式引用所有子文件
├── styles/
│   ├── base.css           ← <link href="styles/base.css">
│   └── theme.css          ← <link href="styles/theme.css">
├── components/
│   ├── TodoItem.js        ← <script src="components/TodoItem.js">
│   └── TodoList.js        ← <script src="components/TodoList.js">
├── utils/
│   └── helpers.js         ← <script src="utils/helpers.js">
└── app.js                 ← <script src="app.js">
```

**硬约束：**
- 所有子文件必须在 `index.html` 中用 `<link>` 或 `<script>` **显式声明**（按依赖顺序）
- 不支持的隐式 `import` / `require` — 打包器不做模块解析

### app.js 编码规范

**统一用 Options API**（`data()` + `methods` + `mounted()`），不用 Composition API `setup()` / `ref()`：

```js
const { createApp } = Vue

createApp({
  data() {
    return {
      title: '我的应用',
      items: [],
      input: ''
    }
  },
  async mounted() {
    // ✅ 异步获取数据
    const saved = await __amiba__.storage.get('items')
    if (saved) this.items = saved
  },
  methods: {
    async addItem() {
      if (!this.input.trim()) return
      this.items.push({ id: Date.now(), text: this.input })
      await __amiba__.storage.set('items', this.items)
      this.input = ''
    }
  }
}).mount('#app')
```

**核心约束：**
| 规则 | 说明 |
|------|------|
| ✅ Options API 优先 | `data()` + `methods` + `mounted()`，AI 生成稳定性高 |
| ✅ `__amiba__` 只在 `methods` / `mounted` 中调用 | 不要在 `data()` 中直接调用异步方法 |
| ✅ 解构 `const { createApp } = Vue` | 避免重复 `Vue.` 前缀 |
| ❌ 禁止 `{{ }}` 中调 `__amiba__` | 模板插值同步，`__amiba__` 返回 Promise 会显示 `[object Promise]` |
| ⚠️ `v-html` 仅用于静态内容 | 渲染用户输入存在 XSS 风险 |

### 组件定义模式

组件定义在独立 `.js` 文件中，全局注册或局部注册：

```js
// components/TodoItem.js
const TodoItem = {
  template: `
    <div class="todo-item" @click="$emit('toggle')">
      <span class="check">{{ item.done ? '✓' : '○' }}</span>
      <span class="text">{{ item.text }}</span>
    </div>
  `,
  props: { item: Object },
  emits: ['toggle']
}
```

```js
// app.js — 注册并使用
const { createApp } = Vue
createApp({
  components: { TodoItem, TodoList },
  // ...
}).mount('#app')
```

不在模板中存放大量 HTML — 推荐使用模板字符串 `template: \`...\`` 或 HTML 中的 `<template id="x">` 标签。

### v-cloak 防闪烁

Vue 未加载时模板插值会暴露 `{{ }}`，必须加防闪烁样式：

```css
[v-cloak] { display: none; }
```

```html
<div id="app" v-cloak>
```

### index.html 完整示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Vue 计数器</title>
  <link href="style.css" rel="stylesheet">
</head>
<body>
  <div id="app" v-cloak>
    <h1>{{ title }}</h1>
    <p>计数: {{ count }}</p>
    <button @click="add">+1</button>
    <button @click="sub">-1</button>
  </div>
  <script src="/libs/vue.global.prod.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

```js
// app.js
const { createApp } = Vue

createApp({
  data() {
    return { title: 'Vue 计数器', count: 0 }
  },
  async mounted() {
    const saved = await __amiba__.storage.get('count')
    if (saved != null) this.count = saved
  },
  methods: {
    async add() {
      this.count++
      await __amiba__.storage.set('count', this.count)
    },
    async sub() {
      this.count--
      await __amiba__.storage.set('count', this.count)
    }
  }
}).mount('#app')
```

---

## 12. 迭代修改已安装服务

生成服务后如需修改，**不要重新生成整个服务**。使用服务工具按类型分步操作：

| 类型 | 工具 | 用途 |
|------|------|------|
| **查看** | `service_list` | 列出所有已安装用户服务 |
| **查看** | `service_view` | 查看单个服务的 manifest、文件列表、安装状态 |
| **编辑** | `service_file_list` | 列出某服务的所有文件 |
| **编辑** | `service_file_read` | 读取某个文件的完整内容 |
| **编辑** | `service_file_edit` | 精确查找替换（**首选**，只改目标行） |
| **编辑** | `service_file_write` | 覆盖式写入文件（仅大范围改动时用） |
| **归档** | `service_archive` | 保存当前服务状态为版本快照（重大修改前务必归档） |
| **回退** | `service_rollback` | 回退到之前的归档版本（未指定版本时回退到最新） |
| **校验** | `service_validate` | 修改后校验代码合法性 |

**推荐工作流：**
1. `service_list` → 确定要修改哪个服务
2. `service_view` → 了解服务整体结构
3. `service_file_list` → 查看有哪些文件可编辑
4. `service_file_read` → 阅读现有代码
5. `service_file_edit` → 精确替换目标代码（优先！比全量写入省 token）
6. `service_validate` → 校验修改是否引入问题

---

## 13. 服务版本归档与回退

**每次重大修改前务必先归档！** 在调用 `service_file_edit` 或 `service_file_write` 修改已安装服务的代码之前，先调用 `service_archive` 保存当前快照：

```
1. service_archive({ service_id: "user.xxx" })  → 保存快照
2. service_file_edit / service_file_write         → 修改代码
3. service_validate                                → 校验

如果修改后出现问题：
4. service_rollback({ service_id: "user.xxx" })   → 恢复到最新快照
```

`service_rollback` 不传 `version` 参数时自动选择最新归档版本。

### 归档存储

归档文件存储在 `services/{id}/.versions/v_{timestamp}/` 下，完整保留所有文件快照。`getServicePackage` 会自动跳过 `.versions/` 目录，不会把历史快照混入服务包。

## 14. 多页面服务

如需多个页面，在 `files` 中添加多个 `.html` 文件，页面间通过 `__amiba__.navigateTo('page2.html')` 跳转。

---

## 15. 悬浮块（Widget）开发

当用户需求涉及「快捷入口」「悬浮按钮」「侧边栏小工具」「快速查看」「常驻显示」等场景时，在服务中附带悬浮块。

> 📖 **Widget 开发请优先查阅 `widget-dev` 内置 skill**（`public/catalog/skills/widget-dev/SKILL.md`），包含完整模板、8 模块 API 示例和检查清单。

**完整规范用 doc_read("widgets.md") 查看。** 要点：
- manifest.permissions 需包含 `"widgets"`
- 在 files 中添加 `widget.json` 声明配置
- Widget HTML 放在 `widgets/<name>.html`，第一行写 `<!-- AMIBA_BRIDGE -->`
- 不含 `<html>/<body>` 标签，直接以 `<div class="widget-root">` 开始
- 也可通过 `__amiba__.widgets.register(config)` 运行时动态注册
- **Widget 内可使用几乎全部 `__amiba__` API（tools 模块除外），与服务主页面一致**

---

## 16. 服务工具（向 AI 暴露能力）

当用户希望**主聊天 AI 能直接操作服务**（如"帮我开始一个番茄钟""查一下今天的支出"）时，声明 `tools` 权限并注册服务工具。

**要点：**
- manifest.permissions 包含 `"tools"`；manifest.json 中同步静态声明 `aiTools`（不含 handler 的同构元数据，用于设置页展示与校验）
- `app.js` 中用 `__amiba__.tools.register([{ name, description, parameters?, level?, handler }])` 运行时注册（执行真相）
- 工具名 `^[a-zA-Z0-9_-]{1,32}$`，description ≤512 字符写清何时该用；每服务最多 8 个
- `level: 'sensitive'` 用于会改变状态的操作（默认关闭，用户在服务设置中逐项开启）；只读查询不设或设 `readonly`
- handler 返回可 JSON 序列化的值；仅服务运行时工具可用
- tools 模块仅服务主页面与后台 worker 可用，Widget 不支持

```js
await __amiba__.tools.register([
  {
    name: 'get_stats',
    description: '获取今日番茄钟统计（只读）',
    handler: async () => ({ today: stats.today }),
  },
  {
    name: 'start_timer',
    description: '开始一个番茄钟计时',
    parameters: { type: 'object', properties: { minutes: { type: 'number' } } },
    level: 'sensitive',
    handler: async (args) => { startTimer(args.minutes || 25); return { ok: true } },
  },
])
```

**完整协议用 doc_read("jbridge.md") 的「服务工具 (tools)」一节查看。**

---

## 17. 检查清单

- [ ] 已用 `service_list` 检查无重复服务
- [ ] `service_create` 的 `id` 以 `"user."` 开头，无非法字符
- [ ] `permissions` 根据功能需求正确选择（多人/聊天/协作 → network）
- [ ] `index.html` 已通过 `service_file_write` 写入
- [ ] `index.html` 中**未**手动添加 `<!-- AMIBA_BRIDGE -->`（packager 自动注入）
- [ ] `index.html` 通过 `<link>` 和 `<script src>` 引用 CSS/JS
- [ ] `app.js` 中数据持久化使用 `__amiba__.storage.*`，不用 `localStorage`
- [ ] `app.js` 中正确使用 `window.__amiba__` API
- [ ] 未使用 `alert()`/`confirm()`/`prompt()`/`BroadcastChannel`/`SharedWorker`
- [ ] 如含 widget，`manifest.permissions` 包含 `"widgets"`
- [ ] 如含网络功能，`manifest.permissions` 包含 `"network"`，且 `app.js` 调用了 `startListening(SERVICE_KEY)` + `connect(peerId, SERVICE_KEY)`
- [ ] 如需 AI 调用服务能力：`manifest.permissions` 包含 `"tools"`，manifest.json 声明 `aiTools`，`app.js` 用 `__amiba__.tools.register` 注册
- [ ] widget.json 格式正确，引用路径与 files 一致
- [ ] 无外部依赖、无 fetch 外部 API
- [ ] 如果使用 Vue：已正确引用 `/libs/vue.global.prod.js`，Options API 正确
- [ ] 如果使用 Vue：模板在 HTML 中或 `template` 字符串中，未在 `{{ }}` 中调用异步 API
- [ ] 如果使用 Vue：`app.js` 的 `index.html` 引用位置在 `<script src="/libs/vue.global.prod.js">` 之后
- [ ] 代码语法正确、可直接运行
- [ ] **已调用 `service_validate` 校验通过** ⭐
- [ ] **重大修改前已调用 `service_archive` 归档当前版本**
- [ ] 如果使用多文件组件结构：所有子文件在 `index.html` 中有显式引用
