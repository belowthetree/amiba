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

当用户要求「开发服务 / 创建应用 / 写一个 XX」时，严格遵循以下规范。

---

## 1. 输出格式

**必须输出纯 JSON**（无 markdown 代码块包裹，无解释文字）：

```json
{
  "manifest": { "id": "user.xxx", "name": "...", "version": "1.0.0", "description": "...", "permissions": [...] },
  "files": [
    { "path": "index.html", "content": "..." },
    { "path": "style.css", "content": "..." },
    { "path": "app.js", "content": "..." }
  ]
}
```

> 平台收到后拆解存储为 `manifest.json`（纯 manifest）+ 独立文件。磁盘格式与目录导入完全一致。

---

## 2. Manifest 规范

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，必须以 `"user."` 开头，如 `"user.todo"` |
| `name` | string | 显示名称（中文优先） |
| `version` | string | 语义化版本，如 `"1.0.0"` |
| `description` | string | 简短描述（≤30 字） |
| `permissions` | string[] | 仅允许 `"storage"`、`"notification"`、`"widgets"` |

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
| `__amiba__.network.startDiscovery({transport})` | 开始设备发现 | `"network"` |
| `__amiba__.network.stopDiscovery(transport)` | 停止发现 | `"network"` |
| `__amiba__.network.getVisibleDevices()` | 列出已发现设备 | `"network"` |
| `__amiba__.network.connect(peerId)` | 连接设备 | `"network"` |
| `__amiba__.network.send(peerId, msg)` | 发送消息 | `"network"` |
| `__amiba__.network.disconnect(peerId)` | 断开连接 | `"network"` |

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
- ❌ `permissions` 使用了 `"storage"` / `"notification"` 以外的值
- ❌ 返回了 markdown 代码块包裹 → 必须纯 JSON
- ❌ 使用外部 CDN 或 `fetch` 外部 API
- ❌ `content` 中的代码有语法错误
- ❌ 修改已安装服务时重新生成整个 JSON → 应用 `service_file_write` 直接编辑文件
- ❌ 目录导入时 manifest.json 包含外层 `files` 包裹 → 目录导入 manifest.json 只含 id/name/version/description/permissions

---

## 9. Chart.js 图表（统一图表库）

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

## 10. 迭代修改已安装服务

生成服务后如需修改，**不要重新生成整个服务**，使用 Agent Tools：

| 工具 | 用途 |
|------|------|
| `service_list` | 列出已安装服务 |
| `service_file_list` | 列出某服务的文件 |
| `service_file_read` | 读取文件内容 |
| `service_file_write` | 覆写文件（需传完整内容） |

流程：`service_list` → `service_file_read` → 修改代码 → `service_file_write`

---

## 11. 多页面服务

如需多个页面，在 `files` 中添加多个 `.html` 文件，页面间通过 `__amiba__.navigateTo('page2.html')` 跳转。

---

## 12. 悬浮块（Widget）开发

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

## 13. 检查清单

- [ ] 输出是纯 JSON，无 markdown 包裹
- [ ] `manifest` 含 `id` / `name` / `version` / `description` / `permissions`
- [ ] `manifest.id` 以 `"user."` 开头
- [ ] `files` 非空且含 `index.html`
- [ ] `index.html` 通过 `<link>` 和 `<script src>` 引用 CSS/JS
- [ ] `app.js` 中正确使用 `window.__amiba__` API
- [ ] 如含 widget，`manifest.permissions` 包含 `"widgets"`
- [ ] widget.json 格式正确，引用路径与 files 一致
- [ ] 无外部依赖、无 fetch 外部 API
- [ ] 代码语法正确、可直接运行
