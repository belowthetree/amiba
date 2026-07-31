---
name: desktop-widget-dev
description: Amiba 安卓系统桌面卡片（AppWidget）开发完整指南
keywords:
  - 桌面卡片
  - 桌面小组件
  - 系统桌面
  - AppWidget
  - 安卓桌面
  - desktop-widget
  - 桌面插件
  - 手机桌面
  - 创建桌面卡片
---

# Amiba 安卓系统桌面卡片开发完整指南

当用户需求涉及「放到手机桌面」「系统桌面小组件」「桌面卡片」「在桌面上显示」等场景时，使用本指南开发桌面卡片。

> ⚠️ 桌面卡片 ≠ 悬浮块（widget-dev）：悬浮块浮在**应用内**页面上，桌面卡片显示在**安卓系统桌面**（Launcher）。两者目录、配置、API 完全不同，不要混淆。

---

## 1. 桌面卡片概述

桌面卡片由服务自带定义，经宿主推送到安卓系统桌面，原生 RemoteViews 渲染（结构化文本 + 图片，**不支持 HTML/CSS**）。

| 特性 | 悬浮块（widget-dev） | 桌面卡片（本指南） |
|------|---------------------|-------------------|
| 显示位置 | 应用内页面边缘 | 安卓系统桌面 |
| 渲染方式 | iframe HTML | 原生 RemoteViews |
| 定义文件 | `widget.json` + `widgets/*.html` | `desktop-widgets/{cardId}/` 目录 |
| 权限 | `widgets` | `desktopWidgets` |
| 数据产出 | 实时渲染 | `logic.js` → `publish()` 结构化数据 |
| 平台 | 全平台 | 仅 Android |

---

## 2. 目录结构与权限

### 权限声明

服务的 `manifest.permissions` 必须包含 `"desktopWidgets"`，否则卡片不注册。**全局卡片无权限要求**（见 2.5 节）。

### 卡片目录

每个服务可有多张卡片，每张一个目录：

```
services/{serviceId}/desktop-widgets/{cardId}/
├── widget.json      # 界面 + 行为配置（必填）
├── logic.js         # 数据逻辑（必填）
└── assets/          # 图片资源（可选，png/jpg）
```

用 `service_file_write` 创建这些文件（路径如 `desktop-widgets/todo-card/widget.json`）。cardId 用 kebab-case。

### 2.5 全局卡片（不依附服务）

用户直接要求"在桌面上放一张卡片"且不需要完整服务时，用 `android_widget_create` 工具创建**全局卡片**：

```
{AppData}/amiba/desktop-widgets/cards/{cardId}/
├── widget.json      # 与卡片 widget.json 同格式
├── logic.js         # 同一套规范（publish + storage）
└── assets/          # 图片资源
```

| 对比 | 服务卡片 | 全局卡片 |
|------|---------|---------|
| 目录 | `services/{id}/desktop-widgets/{cardId}/` | `desktop-widgets/cards/{cardId}/` |
| key | `serviceId/cardId` | `global/{cardId}` |
| 权限 | 需 `desktopWidgets` | 无需（无 manifest） |
| storage 落点 | 服务自身 `data/`（与服务页面共享） | `desktop-widgets/data/{cardId}/`（卡片专属） |
| 创建方式 | `service_file_write` | `android_widget_create` |

widget.json / logic.js 规范与 publish 数据格式两者完全一致，下文不再区分。

---

## 3. widget.json 配置规范

```json
{
  "label": "待办速览",
  "description": "显示最近 5 条待办",
  "layout": "lines",
  "accentColor": "#5f8f7b",
  "maxLines": 5,
  "tapPath": "/service/user.note-service",
  "updateIntervalMin": 30,
  "enabled": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `label` | string | ✅ | 选卡页显示名称（2-8 字） |
| `description` | string | — | 选卡页副标题说明 |
| `layout` | `"lines"` \| `"image"` \| `"bigText"` | — | 布局骨架，默认 `"lines"` |
| `accentColor` | string | — | 标题颜色，如 `"#5f8f7b"` |
| `maxLines` | number | — | lines 布局最多行数，1-6，默认 6 |
| `tapPath` | string | — | 点击卡片的应用内跳转路径，必须 `/` 开头，如 `/service/user.xxx` |
| `updateIntervalMin` | number | — | 逻辑重跑间隔（分钟），0 = 仅启动/手动刷新，默认 0 |
| `enabled` | boolean | — | 首次扫描的默认启用状态，默认 true |

### layout 三种骨架

| 布局 | 显示内容 | 适用场景 |
|------|---------|---------|
| `lines` | 标题行 + 最多 6 行文本 + footer | 列表类：待办、账单、消息 |
| `bigText` | 标题行 + 大字内容（lines[0]，≤3 行）+ footer | 单值类：计数、状态、名言 |
| `image` | 标题行 + 图片 + footer | 图表、封面、二维码 |

---

## 4. logic.js 规范

logic.js 在隐藏沙箱 iframe 中执行（自动注入 JSBridge，**脚本会被自动包在 `async function` 中**，可直接顶层 `await`，无需手写 IIFE），**只能使用两个模块**：

| 模块 | 说明 |
|------|------|
| `__amiba__.desktopWidget.publish(data)` | 发布渲染数据，必须且只调用一次 |
| `__amiba__.storage` | `set/get/remove`，读写本服务数据（与服务主页面共享） |

其余模块（network / fetch / ai 等）一律拒绝。10 秒内未 publish 视为超时跳过。

### publish 数据字段

```js
__amiba__.desktopWidget.publish({
  title: '待办清单',        // 卡片标题（缺省用 widget.json 的 label）
  icon: '📝',               // 标题前 emoji
  lines: ['买牛奶', '写周报'], // ≤6 条，每条 ≤60 字（超出截断）
  image: 'assets/chart.png',  // 可选，相对卡片目录；image 布局必填
  footer: '更新于 14:30'      // 可选底部小字
})
```

### 执行时机

- App 启动（全量刷新一次）
- `updateIntervalMin > 0` 的周期定时
- AI 调用 `android_widget_refresh` 工具

App 被杀期间桌面卡片显示最后一次推送的内容（原生缓存），属正常行为。

---

## 5. AI 管理工具

| 工具 | 说明 |
|------|------|
| `android_widget_create` | 创建全局卡片（不依附服务），参数含 widget.json 字段 + logicJs 内容 |
| `android_widget_list` | 列出全部卡片（key/启用状态/最近推送时间） |
| `android_widget_enable` | 启用/停用卡片，key 格式 `serviceId/cardId` 或 `global/{cardId}` |
| `android_widget_refresh` | 立即重跑 logic.js 并推送桌面（不传 key 刷全部） |
| `android_widget_delete` | 删除卡片（文件 + 启用状态 + 缓存）；桌面已放置的实例需用户手动移除 |

服务数据变更后应调用 `android_widget_refresh` 让桌面同步。

---

## 6. 完整示例

为 `user.expense_book`（记账本）服务添加一张桌面卡片：

**`desktop-widgets/recent-expense/widget.json`**

```json
{
  "label": "最近支出",
  "description": "显示今日支出与最近 4 笔账",
  "layout": "lines",
  "maxLines": 5,
  "accentColor": "#E67E22",
  "tapPath": "/service/user.expense_book",
  "updateIntervalMin": 60,
  "enabled": true
}
```

**`desktop-widgets/recent-expense/logic.js`**

```js
(async function () {
  const records = (await __amiba__.storage.get('records')) || []
  const today = new Date().toDateString()
  const todaySum = records
    .filter(r => new Date(r.time).toDateString() === today)
    .reduce((s, r) => s + r.amount, 0)

  const lines = ['今日支出 ¥' + todaySum.toFixed(2)]
  for (const r of records.slice(-4).reverse()) {
    lines.push(`${r.category} ¥${r.amount}`)
  }

  __amiba__.desktopWidget.publish({
    title: '记账本',
    icon: '💰',
    lines: lines,
    footer: '更新于 ' + new Date().toLocaleTimeString()
  })
})()
```

创建后调用 `android_widget_enable` 确认启用，再 `android_widget_refresh` 推送一次。用户在系统桌面长按添加"变形虫"小组件即可选到。

---

## 7. 常见错误清单

- ❌ 与悬浮块混淆：悬浮块是 `widget.json` + `widgets/*.html`（应用内），桌面卡片是 `desktop-widgets/` 目录（系统桌面）
- ❌ `manifest.permissions` 遗漏 `"desktopWidgets"` → 卡片不注册
- ❌ 在 logic.js 里写 HTML/DOM 操作 → 桌面卡片是原生渲染，DOM 无效且无人看
- ❌ 忘记调用 `publish()` → 10s 超时，卡片无数据
- ❌ publish 多次 → 只有第一次生效
- ❌ `image` 写绝对路径或含 `..` → 宿主拒绝（安全校验）
- ❌ logic.js 使用 network/fetch/ai 等模块 → 宿主拒绝，仅 desktopWidget + storage 可用
- ❌ 手写 `(async () => { ... })()` 又担心顶层 await → 不必，runner 已自动 async 包裹，直接顶层 `await` 即可（IIFE 写法也兼容）
- ❌ `tapPath` 不以 `/` 开头 → 点击跳转被忽略
- ❌ 期望 App 被杀后卡片还自动更新 → 逻辑只在 App 存活时执行，被杀显示最后缓存（正常行为）
- ❌ 认为卡片必须等 logic.js 跑成功才出现在选卡页 → 启用后即推送占位（显示 label + "加载中…"），首次 publish 后替换为真实数据
- ❌ 选卡页显示"暂无可用卡片"就怀疑原生侧 → 排查顺序：① `android_widget_list` 确认卡片已注册且 enabled ② 设置页日志搜 `[DesktopWidget]` 确认"已推送原生: N 张" ③ logcat 搜 `[amiba-widget]` 确认 `updateCards ✓`

---

## 8. 检查清单

- [ ] `manifest.permissions` 包含 `"desktopWidgets"`
- [ ] 卡片目录为 `desktop-widgets/{cardId}/`，含 `widget.json` + `logic.js`
- [ ] `widget.json` 有 `label`，`tapPath` 以 `/` 开头
- [ ] logic.js 恰好调用一次 `publish()`，数据字段合法
- [ ] `lines` ≤6 条且每条 ≤60 字
- [ ] `layout: "image"` 时 publish 带 `image`（相对路径，文件真实存在于 `assets/`）
- [ ] 创建后 `android_widget_enable` 启用 + `android_widget_refresh` 推送验证
- [ ] 已告知用户：需在系统桌面长按添加"变形虫"小组件并选择该卡片
