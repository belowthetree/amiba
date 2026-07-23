---
name: widget-dev
description: Amiba 快捷页面（Widget 悬浮块）开发完整指南
keywords:
  - 悬浮块
  - widget
  - 快捷页面
  - 快捷入口
  - 侧边栏
  - 小工具
  - 常驻显示
  - 悬浮按钮
  - 开发widget
  - 创建widget
---

# Amiba Widget（快捷页面）开发完整指南

当用户需求涉及「快捷入口」「悬浮按钮」「侧边栏小工具」「快速查看」「常驻显示」「桌面小部件」等场景时，使用本指南开发 Widget。

---

## 1. Widget 概述

Widget 是以 emoji 图标吸附在屏幕边缘的轻量悬浮块，点击展开面板。与服务主页面不同：

| 特性 | 服务主页面 | Widget（快捷页面） |
|------|-----------|-------------------|
| iframe sandbox | `allow-scripts allow-same-origin` | `allow-scripts` |
| 可加载宿主库 | ✅ `/libs/*` | ❌ 不可加载 |
| `__amiba__` API | ✅ 全部 8 模块 | ✅ 全部 8 模块（完全一致） |
| 声明方式 | `manifest.json` + files | `widget.json`（声明式）或 `__amiba__.widgets.register()`（编程式） |
| 面板尺寸 | 全屏路由页面 | 宽 180–400px，高 60–520px（内容自适应） |

---

## 2. 权限与配置

### 权限声明

服务的 `manifest.permissions` 必须包含 `"widgets"`。

### widget.json（声明式配置）

放在服务 files 根目录，服务加载时自动注册：

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
      "showOn": [],
      "trigger": "manual",
      "lifecycle": "persistent"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识，kebab-case |
| `icon` | string | ✅ | 单个 emoji 字符 |
| `label` | string | — | 悬停提示文字（2–4 字） |
| `page` | string | ✅ | Widget HTML 文件路径（如 `widgets/quick-note.html`） |
| `edge` | `"left"` \| `"right"` | ✅ | 吸附边缘 |
| `position` | number | ✅ | 距顶部 y 像素，建议 100–300 |
| `showOn` | string[] | ✅ | 生命周期路由列表；`[]` = 全局；仅 `trigger: "page"` 时有效 |
| `trigger` | `"manual"` \| `"page"` | ✅ | `"manual"`=API 控制（默认），`"page"`=进入 showOn 路由自动显示 |
| `lifecycle` | `"service"` \| `"persistent"` | — | `"service"`=随服务卸载销毁；`"persistent"`=跨路由驻留 |

### trigger 模式

| 模式 | 行为 |
|------|------|
| `"manual"` | 注册后初始隐藏，调用 `__amiba__.widgets.show(id)` 显示 |
| `"page"` | 进入 `showOn` 路由自动显示，离开自动隐藏并折叠面板 |

### lifecycle 模式

| 模式 | 行为 | 关闭方式 |
|------|------|---------|
| `"service"`（默认） | 随服务页面卸载自动销毁 | 离开服务路由即消失 |
| `"persistent"` | 跨路由驻留 | 用户点击图标 ✕ 关闭 |

---

## 3. Widget HTML 模板规范

### 结构

```html
<!-- AMIBA_BRIDGE -->
<style>
  .widget-root { /* 根容器 */ }
</style>
<div class="widget-root">
  <!-- 内容 -->
</div>
<script>
  // 逻辑
</script>
```

### 硬约束

| 规则 | 说明 |
|------|------|
| **第一行必须是** `<!-- AMIBA_BRIDGE -->` | 宿主自动注入 JSBridge 和 serviceId |
| **不要包含** `<html>` / `<body>` 标签 | 直接以 `<div class="widget-root">` 开始 |
| **不要设固定宽高** | 面板尺寸由内容驱动（ResizeObserver 自动测量） |
| **不要设 `body` 样式** | `body` margin/padding 由宿主 iframe 控制 |
| **背景色自管理** | 宿主面板背景透明，widget 必须设自己的背景色 |
| **字体** | 系统栈：`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| **宽度范围** | 180–400px（由 `.widget-root` 自然宽度决定） |
| **高度范围** | 60–520px（由内容自然高度决定） |

---

## 4. 完整 API 能力

Widget iframe 内可使用**全部 8 个 `__amiba__` API 模块**，与服务主页面完全一致。API 调用自动携带 `serviceId`，通过宿主全局消息处理器路由。

### 4.1 storage — 持久化存储

**权限**：`"storage"`

```js
await __amiba__.storage.set('key', { data: 42 })
const val = await __amiba__.storage.get('key')
await __amiba__.storage.remove('key')
```

### 4.2 notification — 通知

**权限**：`"notification"`

```js
await __amiba__.showToast('保存成功', 'success')
// icon: 'success' | 'error' | 'loading' | 'none'
```

### 4.3 ui — 页面导航

无需权限。

```js
__amiba__.navigateTo('/chat')
__amiba__.navigateBack()
```

### 4.4 widgets — 动态 Widget 管理

**权限**：`"widgets"`

```js
// 运行时动态注册
await __amiba__.widgets.register({
  id: 'alert-box', icon: '🔔',
  page: 'widgets/alert.html',
  edge: 'right', position: 300,
  showOn: [], trigger: 'manual'
})

__amiba__.widgets.show('alert-box')
__amiba__.widgets.hide('alert-box')
__amiba__.widgets.remove('alert-box')
```

### 4.5 network — 局域网 P2P

**权限**：`"network"`

```js
await __amiba__.network.setVisibility({ lan: true })
await __amiba__.network.startDiscovery('lan')

__amiba__.network.onPeerDiscovered((peer) => {
  console.log('发现设备:', peer.name)
})

const session = await __amiba__.network.connect(peerId, 'my-service')
session.send('hello')
session.on('message', (msg) => { /* ... */ })
```

详见 `doc_read("network.md")`。

### 4.6 background — 后台服务交互

**权限**：`"background"`

```js
// Widget → 后台：启动 + 发消息
await __amiba__.background.start()
await __amiba__.background.postMessage({ action: 'play' })

// 接收后台推送
__amiba__.background.onMessage((msg) => {
  console.log('后台消息:', msg)
})

// 查询后台状态
const state = await __amiba__.background.getState()
// → { running: true, startCount: 1, ... }
```

> ⚠️ `postMessage` 前必须先 `start()` 确保后台已启动。Widget 无法直接接收后台 `postMessage`（需通过 storage 轮询或 `onMessage` 监听 `bg-message` 事件）。

### 4.7 fileAccess — 磁盘文件访问

**权限**：`"fileAccess"`

```js
const grant = await __amiba__.fileAccess.requestAccess({
  pattern: '{*.mp3,*.flac}',
  purpose: '扫描音乐文件'
})
const files = await __amiba__.fileAccess.listFiles(grant.token)
const text = await __amiba__.fileAccess.readText(grant.token, 'readme.txt')
// readBinary 返回 base64
```

### 4.8 fetch — HTTP 请求

**权限**：`"fetch"`

```js
const res = await __amiba__.fetch.request({
  url: 'https://api.example.com/data',
  method: 'GET',
  headers: { 'Accept': 'application/json' }
})
// → { status: 200, body: "..." }
```

---

## 5. 编程式 API（运行时动态注册）

无需 `widget.json`，在服务代码中动态创建：

```js
await __amiba__.widgets.register({
  id: 'my-widget',
  icon: '🔔',
  label: '提醒',
  page: 'widgets/alert.html',
  edge: 'right',
  position: 200,
  showOn: [],
  trigger: 'manual'
})

__amiba__.widgets.show('my-widget')
__amiba__.widgets.hide('my-widget')
__amiba__.widgets.remove('my-widget')
```

---

## 6. 完整示例

### 基础示例：快速笔记（storage + notification）

```html
<!-- AMIBA_BRIDGE -->
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .widget-root {
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #fff;
    color: #333;
    border-radius: 8px;
    min-width: 240px;
  }
  h3 { font-size: 14px; margin-bottom: 8px; }
  textarea {
    width: 100%; min-height: 80px;
    border: 1px solid #ddd; border-radius: 6px;
    padding: 8px; font-size: 13px; resize: vertical;
  }
  button {
    margin-top: 8px; padding: 6px 16px;
    background: #1976D2; color: #fff; border: none;
    border-radius: 6px; cursor: pointer; font-size: 13px;
  }
</style>
<div class="widget-root">
  <h3>📝 快速笔记</h3>
  <textarea id="note" placeholder="写点什么..."></textarea>
  <button id="save">保存</button>
</div>
<script>
  (async function() {
    const saved = await __amiba__.storage.get('quick-note')
    if (saved) document.getElementById('note').value = saved

    document.getElementById('save').onclick = async () => {
      const text = document.getElementById('note').value
      await __amiba__.storage.set('quick-note', text)
      __amiba__.showToast('已保存', 'success')
    }
  })()
</script>
```

### 进阶示例：音乐播放器控件（background + storage 轮询）

```html
<!-- AMIBA_BRIDGE -->
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .widget-root {
    padding: 10px 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #16213e;
    color: #eee;
    border-radius: 8px;
    min-width: 200px;
  }
  .track-info { font-size: 12px; color: #ccc; margin-bottom: 6px; }
  .controls { display: flex; gap: 8px; }
  .controls button {
    width: 32px; height: 32px; border-radius: 50%;
    border: 1px solid #444; background: #0f3460;
    color: #eee; cursor: pointer; font-size: 14px;
  }
</style>
<div class="widget-root">
  <div class="track-info" id="info">未在播放</div>
  <div class="controls">
    <button id="prev">⏮</button>
    <button id="play">▶</button>
    <button id="next">⏭</button>
  </div>
</div>
<script>
  (function() {
    var el = document.getElementById('info')

    // 向后台发指令
    document.getElementById('play').onclick = function() {
      __amiba__.background.postMessage({ action: 'toggle' })
    }
    document.getElementById('prev').onclick = function() {
      __amiba__.background.postMessage({ action: 'prev' })
    }
    document.getElementById('next').onclick = function() {
      __amiba__.background.postMessage({ action: 'next' })
    }

    // 轮询后台写入 storage 的状态
    setInterval(async function() {
      var state = await __amiba__.storage.get('player_state')
      if (state) {
        el.textContent = (state.playing ? '▶ ' : '⏸ ') + state.title
      }
    }, 1000)
  })()
</script>
```

---

## 7. 常见错误清单

- ❌ 忘记第一行写 `<!-- AMIBA_BRIDGE -->` → JSBridge 未注入，`__amiba__` 不可用
- ❌ Widget HTML 中包含 `<html>` / `<body>` 标签 → 导致嵌套文档结构异常
- ❌ 设置固定 `width` / `height` → 面板无法自适应内容
- ❌ 使用 `localStorage` 替代 `__amiba__.storage` → 数据不持久化
- ❌ `__amiba__.background.postMessage()` 前未 `start()` → 消息静默丢弃
- ❌ Widget 直接轮询后台变量而非通过 storage → 后台状态变化 Widget 感知不到
- ❌ 依赖外部 CDN → Widget iframe 无 `allow-same-origin`，无法加载外部脚本
- ❌ `manifest.permissions` 遗漏 `"widgets"` → Widget 无法注册
- ❌ `widget.json` 中 `page` 路径与 files 不一致 → 文件找不到
- ❌ 在 Widget 中使用 `Vue.createApp` → Widget 不可加载 `/libs/vue.global.prod.js`

---

## 8. 检查清单

- [ ] `manifest.permissions` 包含 `"widgets"`
- [ ] `widget.json` 格式正确，`id` 唯一、`page` 路径正确
- [ ] Widget HTML 第一行是 `<!-- AMIBA_BRIDGE -->`
- [ ] 不含 `<html>` / `<body>` 标签
- [ ] 未设置固定宽高，内容自适应
- [ ] 背景色自管理（宿主面板透明）
- [ ] 数据持久化用 `__amiba__.storage`，不用 `localStorage`
- [ ] 与后台交互时先 `start()` 再 `postMessage()`
- [ ] 无外部 CDN 依赖
- [ ] 未使用 `alert()` / `confirm()` / `prompt()`
