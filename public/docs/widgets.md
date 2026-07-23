---
title: Widget 悬浮块开发
description: 悬浮块 widget.json 配置规范、HTML 模板和运行时 API
keywords: [widget, 悬浮块, 小部件, 侧边栏, 快捷入口, widget.json]
category: guide
---

# Widget 悬浮块开发

服务可附带悬浮快捷块（widget），以 emoji 图标吸附在屏幕边缘，点击展开面板。

> 📖 **AI 生成 Widget 代码时请查阅 `widget-dev` 内置 skill**（`public/catalog/skills/widget-dev/SKILL.md`），包含完整规范、示例和检查清单。本文档为 API 参考。

## 权限声明

manifest.permissions 必须包含 `"widgets"`。

## 配置方式

在 files 中添加 `widget.json`：

```json
{
  "path": "widget.json",
  "content": "{ \"widgets\": [...] }"
}
```

### widget.json 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识，kebab-case（如 `"quick-notes"`） |
| `icon` | string | ✅ | 单个 emoji 字符（如 `"📝"`） |
| `label` | string | — | 悬停提示文字（2-4 字） |
| `page` | string | ✅ | Widget HTML 文件路径（如 `"widgets/quick-notes.html"`） |
| `edge` | `"left"` \| `"right"` | ✅ | 吸附边缘，默认 `"right"` |
| `position` | number | ✅ | 距顶部 y 像素，建议 100–300 |
| `showOn` | string[] | ✅ | 生命周期路由列表，`[]` = 全局；`trigger: "page"` 时进入显示 |
| `trigger` | `"manual"` \| `"page"` | ✅ | `"manual"`=API 控制（默认），`"page"`=进入 showOn 自动显示 |
| `lifecycle` | `"service"` \| `"persistent"` | — | `"service"`=随服务页面卸载销毁（默认）；`"persistent"`=跨路由驻留，直到用户点击关闭按钮 |

### trigger 模式

| 模式 | 行为 |
|------|------|
| `"manual"` | 注册后隐藏，调用 `__amiba__.widgets.show(id)` 显示 |
| `"page"` | 进入 `showOn` 路由自动显示，离开自动隐藏并折叠面板。`showOn: []` = 全局生命周期 |

### lifecycle 模式

| 模式 | 行为 | 关闭方式 |
|------|------|---------|
| `"service"`（默认） | 随服务页面卸载自动销毁 | 离开服务路由即消失 |
| `"persistent"` | 跨路由驻留，不随服务页面卸载 | 用户点击图标上 ✕ 或面板内 ✕ 关闭 |

`persistent` 适用于：音乐播放器、快捷笔记、剪贴板等需要跨页面常驻的轻量工具。图标右上角会显示一个小关闭按钮，面板标题栏的 ✕ 也会彻底移除 widget。

## Widget 内可用 API

Widget iframe 内可使用**全部 `__amiba__` API 模块**（8 个），与服务主页面完全一致：

| 模块 | 常用方法 |
|------|---------|
| `__amiba__.storage` | `set(key, data)`, `get(key)`, `remove(key)` |
| `__amiba__.showToast` | `(title, icon?)` |
| `__amiba__.navigateTo` / `navigateBack` | `(url)` / `(delta?)` |
| `__amiba__.widgets` | `register(config)`, `remove(id)`, `show(id)`, `hide(id)` |
| `__amiba__.network` | `setVisibility`, `connect`, `startListening`, session API 等 |
| `__amiba__.background` | `start()`, `stop()`, `getState()`, `postMessage(msg)`, `onMessage(cb)`, `on(event, cb)` |
| `__amiba__.fileAccess` | `requestAccess(opts)`, `listFiles(token)`, `readText(token, path)` 等 |
| `__amiba__.fetch` | `request({ url, method?, headers?, body? })` |

API 调用自动携带 `serviceId`（由 BRIDGE_SCRIPT 注入），宿主通过 `background-manager.ts` 全局处理器路由。

## Widget HTML 模板

- 文件放在 `widgets/<name>.html`
- **第一行必须写** `<!-- AMIBA_BRIDGE -->`（宿主自动注入 JSBridge）
- **不要包含** `<html>` / `<body>` 标签
- 直接以 `<div class="widget-root">` 开始
- 内嵌 `<style>` 和 `<script>`
- 面板宽度固定 280px

```html
<!-- AMIBA_BRIDGE -->
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .widget-root { padding: 12px; font-family: sans-serif; }
</style>
<div class="widget-root">
  <h3>快速笔记</h3>
  <textarea id="note" rows="4" style="width:100%"></textarea>
  <button id="save" style="margin-top:8px">保存</button>
</div>
<script>
  async function loadNote() {
    const saved = await __amiba__.storage.get('quick-note')
    if (saved) document.getElementById('note').value = saved
  }
  document.getElementById('save').onclick = async () => {
    const text = document.getElementById('note').value
    await __amiba__.storage.set('quick-note', text)
    __amiba__.showToast('已保存', 'success')
  }
  loadNote()
</script>
```

## 编程式 API（运行时动态注册）

```js
await __amiba__.widgets.register({
  id: 'my-widget',
  icon: '🔔',
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
