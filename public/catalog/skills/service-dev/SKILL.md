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
  "manifest": { ... },
  "files": [ ... ]
}
```

---

## 2. Manifest 规范

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，必须以 `"user."` 开头，如 `"user.todo"` |
| `name` | string | 显示名称（中文优先） |
| `version` | string | 语义化版本，如 `"1.0.0"` |
| `description` | string | 简短描述（≤30 字） |
| `permissions` | string[] | 仅允许 `"storage"` 和 / 或 `"notification"` |

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

---

## 9. 多页面服务

如需多个页面，在 `files` 中添加多个 `.html` 文件，页面间通过 `__amiba__.navigateTo('page2.html')` 跳转。

---

## 10. 检查清单

- [ ] 输出是纯 JSON，无 markdown 包裹
- [ ] `manifest` 含 `id` / `name` / `version` / `description` / `permissions`
- [ ] `manifest.id` 以 `"user."` 开头
- [ ] `files` 非空且含 `index.html`
- [ ] `index.html` 通过 `<link>` 和 `<script src>` 引用 CSS/JS
- [ ] `app.js` 中正确使用 `window.__amiba__` API
- [ ] 无外部依赖、无 fetch 外部 API
- [ ] 代码语法正确、可直接运行
