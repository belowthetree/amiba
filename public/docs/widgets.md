---
title: Widget 悬浮块开发
description: 悬浮块 widget.json 配置规范、HTML 模板和运行时 API
keywords: [widget, 悬浮块, 小部件, 侧边栏, 快捷入口, widget.json]
category: guide
---

# Widget 悬浮块开发

服务可附带悬浮快捷块（widget），以 emoji 图标吸附在屏幕边缘，点击展开面板。

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

### trigger 模式

| 模式 | 行为 |
|------|------|
| `"manual"` | 注册后隐藏，调用 `__amiba__.widgets.show(id)` 显示 |
| `"page"` | 进入 `showOn` 路由自动显示，离开自动隐藏并折叠面板。`showOn: []` = 全局生命周期 |

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
