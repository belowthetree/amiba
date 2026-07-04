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

## 1.5 Sandbox 约束（必读！违反将导致服务不可用）

服务运行在 `<iframe sandbox="allow-scripts">` 中，以下 API **不可用**：

| 禁用 API | 替代方案 |
|----------|----------|
| `localStorage` / `sessionStorage` | `__amiba__.storage.set/get/remove` |
| `BroadcastChannel` | `network` 权限 + `__amiba__.network.*` P2P API |
| `SharedWorker` | 同上 |
| `alert()` / `confirm()` / `prompt()` | `__amiba__.showToast()` 或自定义弹窗 |
| `fetch()` 访问外部 URL | 避免使用，同源或静态资源可内联 |
| 外部 CDN `<script src="https://...">` | 预置库：`/libs/chart.umd.min.js` |

**关键点：**
- 每个服务运行在**单个 iframe 实例**中，无法多开标签页/窗口
- "多人"功能必须通过局域网 P2P 实现（见第 9 节），不是在本地模拟多角色
- `service_validate` 工具可以自动检测以上问题，生成后务必调用

---

## 2. Manifest 规范

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，必须以 `"user."` 开头，如 `"user.todo"` |
| `name` | string | 显示名称（中文优先） |
| `version` | string | 语义化版本，如 `"1.0.0"` |
| `description` | string | 简短描述（≤30 字） |
| `permissions` | string[] | 允许的值：`"storage"`、`"notification"`、`"widgets"`、`"network"` |

---

## 3. Files 规范

- 必须包含 `{ "path": "index.html", "content": "..." }`
- CSS 放在 `style.css`，JS 放在 `app.js`（**不要内联在 HTML 中**）
- `index.html` 中通过 `<link href="style.css">` 和 `<script src="app.js">` 引用
- 所有 `content` 中的代码必须语法正确、可直接运行

---

## 4. HTML 规范

- 使用 HTML5 标准：`<!DOCTYPE html>` + `<meta charset="utf-8">`
- viewport: `width=device-width, initial-scale=1.0`
- UI 自由设计，参考平台风格：
  - 主色 `#1976D2`、辅色 `#9C27B0`、背景 `#fafafa`、文字 `#333`
  - 圆角 8–12px、间距 4/8/16/24/32、字体 13–14px
- **不要使用外部 CDN 资源**（iframe 沙箱限制）

---

## 5. JS 规范 (app.js)

使用 `window.__amiba__` 调用宿主 API，所有方法返回 Promise：

| API | 说明 | 所需权限 |
|-----|------|----------|
| `__amiba__.storage.set(key, data)` | 持久化存储 | `"storage"` |
| `__amiba__.storage.get(key)` | 读取存储，返回 `Promise<any>` | `"storage"` |
| `__amiba__.storage.remove(key)` | 删除存储 | `"storage"` |
| `__amiba__.showToast(title, icon)` | 显示 Toast，icon: `'success'/'error'/'loading'/'none'` | `"notification"` |
| `__amiba__.navigateTo(url)` | 页面跳转 | — |
| `__amiba__.navigateBack(delta)` | 返回上级 | — |
| `__amiba__.widgets.register(config)` | 动态注册悬浮块 | `"widgets"` |
| `__amiba__.widgets.remove(id)` | 移除悬浮块 | `"widgets"` |
| `__amiba__.widgets.show(id)` | 显示悬浮块 | `"widgets"` |
| `__amiba__.widgets.hide(id)` | 隐藏悬浮块 | `"widgets"` |
| `__amiba__.network.setVisibility(opts)` | 设置可见性 `{lan,ble}` | `"network"` |
| `__amiba__.network.getVisibility()` | 获取可见性设置 | `"network"` |
| `__amiba__.network.startDiscovery('lan')` | 开始设备发现 | `"network"` |
| `__amiba__.network.stopDiscovery('lan')` | 停止发现 | `"network"` |
| `__amiba__.network.getVisibleDevices()` | 列出已发现设备，返回 `[{id,name,transport,address}]` | `"network"` |
| `__amiba__.network.onPeerDiscovered(cb)` | 监听新设备上线，`cb(peer)` | `"network"` |
| `__amiba__.network.startListening(serviceKey)` | 启动 TCP 监听并注册服务标识（必须先调用才能接收连接） | `"network"` |
| `__amiba__.network.stopListening(serviceKey)` | 停止监听（host 在服务卸载时自动调用） | `"network"` |
| `__amiba__.network.connect(peerId, serviceKey)` | 连接设备，返回 `{id,peerId,peerName,send,close,on}` session 对象 | `"network"` |
| `__amiba__.network.onSession(cb)` | 监听外来会话，`cb(session)`。仅在 `startListening` 后、服务匹配成功时自动触发 | `"network"` |
| `session.send(message)` | 发送字符串消息（建议 JSON 序列化） | `"network"` |
| `session.close()` | 断开此次会话 | `"network"` |
| `session.on('message', cb)` | 监听收到消息，`cb(rawString)` | `"network"` |
| `session.on('close', cb)` | 监听会话断开 | `"network"` |

- **禁止** `alert()`、`prompt()`（iframe 沙箱不支持）
- **禁止** `fetch()` 访问外部 API（CORS + 沙箱限制）

---

## 6. CSS 规范

- 自由设计，不必照搬 Catalog 组件
- 推荐 CSS 变量定义主题色
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
  <link href="style.css" rel="stylesheet">
</head>
<body>
  <div id="app">
    <h1>计数器</h1>
    <p id="count">0</p>
    <button id="plus">+1</button>
    <button id="minus">-1</button>
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

## 8. 常见错误

- ❌ 在 HTML 中内联 `<script>` 和 `<style>` → 必须用独立文件
- ❌ `manifest.id` 不以 `"user."` 开头
- ❌ `permissions` 使用了 `"storage"` / `"notification"` / `"widgets"` / `"network"` 以外的值
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

> ⚠️ **绝对不要**用 BroadcastChannel / localStorage 事件 / 本地多角色模拟 来实现"多人"——这些在 iframe sandbox 中都不可用。必须用 P2P。

当生成的服务需要局域网 P2P 通信时（如聊天、文件传输、协作工具），需遵循以下模板。

### 必需步骤

服务**入口处**必须依次调用：

```js
// ① 声明 network 权限
// manifest.json: { "permissions": ["network", "notification"] }

// ② 使设备可见（UDP 发现）
await __amiba__.network.setVisibility({ lan: true })

// ③ 开始扫描局域网
await __amiba__.network.startDiscovery('lan')

// ④ ★ 启动监听并注册服务标识（必须先调用，否则无法接收连接）
const SERVICE_KEY = 'user.todo'  // 建议用 manifest.id
await __amiba__.network.startListening(SERVICE_KEY)
```

### 主动连接

```js
const session = await __amiba__.network.connect(peerId, SERVICE_KEY)
// 成功返回 session 对象，失败抛出错误（如"该设备暂未开放连接"）
```

### 接收外来连接

```js
__amiba__.network.onSession((session) => {
  // 同服务对端连接时自动触发，无需手动确认
  session.on('message', (raw) => { /* 处理消息 */ })
  session.on('close', () => { /* 对方断开 */ })
})
```

### 发现设备

```js
__amiba__.network.onPeerDiscovered((peer) => {
  // peer: { id, name, transport, address }
})
const devices = await __amiba__.network.getVisibleDevices()
// 不要每秒都轮询，建议 4-5 秒间隔
```

### 完整示例

参考 `example/p2p-chat/` 和 `SKILL.md`（p2p-network）。关键：**所有网络服务都必须先调 `startListening(SERVICE_KEY)`，`connect` 必须传 `SERVICE_KEY` 作为第二个参数。**

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

## 11. 迭代修改已安装服务

生成服务后如需修改，**不要重新生成整个服务**。使用服务工具按类型分步操作：

| 类型 | 工具 | 用途 |
|------|------|------|
| **查看** | `service_list` | 列出所有已安装用户服务 |
| **查看** | `service_view` | 查看单个服务的 manifest、文件列表、安装状态 |
| **编辑** | `service_file_list` | 列出某服务的所有文件 |
| **编辑** | `service_file_read` | 读取某个文件的完整内容 |
| **编辑** | `service_file_write` | 覆盖式写入文件（需传完整内容） |

**推荐工作流：**
1. `service_list` → 确定要修改哪个服务
2. `service_view` → 了解服务整体结构
3. `service_file_list` → 查看有哪些文件可编辑
4. `service_file_read` → 阅读现有代码
5. `service_file_write` → 写入修改后的代码

---

## 12. 多页面服务

如需多个页面，在 `files` 中添加多个 `.html` 文件，页面间通过 `__amiba__.navigateTo('page2.html')` 跳转。

---

## 13. 悬浮块（Widget）开发

当用户需求涉及「快捷入口」「悬浮按钮」「侧边栏小工具」「快速查看」「常驻显示」等场景时，在服务中附带悬浮块。

### 配置方式

在 `files` 中添加 `widget.json`：

```json
{
  "path": "widget.json",
  "content": "{ \"widgets\": [...] }"
}
```

**widget.json 字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识，kebab-case（如 `\"quick-notes\"`） |
| `icon` | string | ✅ | 单个 emoji 字符（如 `\"📝\"`） |
| `label` | string | — | 悬停提示文字（2-4 字） |
| `page` | string | ✅ | Widget HTML 文件路径（如 `\"widgets/quick-notes.html\"`） |
| `edge` | `\"left\"` \| `\"right\"` | ✅ | 吸附边缘，默认用 `\"right\"` |
| `position` | number | ✅ | 距顶部 y 像素，建议 100–300 |
| `showOn` | string[] | ✅ | 生命周期路由列表，`[]` 表示全局；`trigger: "page"` 时进入显示 |
| `trigger` | `\"manual\"` \| `\"page\"` | ✅ | `\"manual\"`=API 控制（默认），`\"page\"`=进入 showOn 自动显示 |

**trigger 模式**：
- `\"manual\"`：注册后隐藏，调用 `__amiba__.widgets.show(id)` 显示
- `\"page\"`：进入 `showOn` 路由自动显示，离开自动隐藏并折叠。`showOn: []` = 全局生命周期

**manifest.permissions 必须包含 `\"widgets\"`**，否则 widget.json 被忽略。

### Widget HTML 文件规范

- 文件放在 `widgets/<name>.html`，与 widget.json 中的 `page` 路径一致
- **第一行必须写** `<!-- AMIBA_BRIDGE -->`（宿主自动注入 JSBridge）
- **不要包含** `<html>`、`<body>` 标签，直接以 `<div class=\"widget-root\">` 开始
- 内嵌 `<style>` 和 `<script>`，可正常使用 `window.__amiba__`
- 面板宽度固定 280px（宿主控制），内容高度建议 200–400px

### Widget HTML 模板

```html
<!-- AMIBA_BRIDGE -->
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .widget-root { padding: 12px; font-family: sans-serif; }
</style>
<div class="widget-root">
  <!-- widget 内容 -->
</div>
<script>
  // 可使用 window.__amiba__.storage / showToast / widgets 等
</script>
```

### 编程式 API（运行时动态注册）

```js
await __amiba__.widgets.register({
  id: 'my-widget',
  icon: '🔔',
  page: 'widgets/alert.html',
  edge: 'right',
  position: 200,
  showOn: [],
  trigger: 'page'
})
```

### Widget 示例

参见 `example/floating-demo/` — 含「快速笔记」（右侧📝）和「快速计算器」（左侧🧮）两个完整 widget 示例。

---

## 14. 检查清单

- [ ] 已用 `service_list` 检查无重复服务
- [ ] `service_create` 的 `id` 以 `"user."` 开头，无非法字符
- [ ] `permissions` 根据功能需求正确选择（多人/聊天/协作 → network）
- [ ] `index.html` 已通过 `service_file_write` 写入
- [ ] `index.html` 通过 `<link>` 和 `<script src>` 引用 CSS/JS
- [ ] `app.js` 中数据持久化使用 `__amiba__.storage.*`，不用 `localStorage`
- [ ] `app.js` 中正确使用 `window.__amiba__` API
- [ ] 未使用 `alert()`/`confirm()`/`prompt()`/`BroadcastChannel`/`SharedWorker`
- [ ] 如含 widget，`manifest.permissions` 包含 `"widgets"`
- [ ] 如含网络功能，`manifest.permissions` 包含 `"network"`，且 `app.js` 调用了 `startListening(SERVICE_KEY)` + `connect(peerId, SERVICE_KEY)`
- [ ] widget.json 格式正确，引用路径与 files 一致
- [ ] 无外部依赖、无 fetch 外部 API
- [ ] 代码语法正确、可直接运行
- [ ] **已调用 `service_validate` 校验通过** ⭐
