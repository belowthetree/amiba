---
title: 安卓系统桌面卡片
description: 服务自带桌面卡片目录规范（widget.json + logic.js + assets）、publish 数据格式与管理工具
keywords: [桌面卡片, 桌面小组件, 系统桌面, AppWidget, 安卓桌面, desktop-widget, desktopWidgets]
category: guide
---

# 安卓系统桌面卡片

把卡片放到**安卓系统桌面**（Launcher 小组件），原生 RemoteViews 渲染。卡片定义在服务目录内：`desktop-widgets/{cardId}/`。

> 📖 **AI 生成桌面卡片时请查阅 `desktop-widget-dev` 内置 skill**（`public/catalog/skills/desktop-widget-dev/SKILL.md`），包含完整规范、示例和检查清单。本文档为 API 参考。

## 权限声明

服务卡片：`manifest.permissions` 必须包含 `"desktopWidgets"`。
全局卡片（`{AppData}/amiba/desktop-widgets/cards/{cardId}/`，key 为 `global/{cardId}`）：无权限要求，用 `android_widget_create` 工具创建，storage 落到 `desktop-widgets/data/{cardId}/`。

## 卡片目录

```
services/{serviceId}/desktop-widgets/{cardId}/
├── widget.json      # 界面 + 行为配置
├── logic.js         # 数据逻辑（沙箱 iframe 执行）
└── assets/          # 图片资源（png/jpg）
```

## widget.json 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | string | 选卡页显示名称（必填） |
| `description` | string | 选卡页副标题 |
| `layout` | string | `"lines"`（默认）/ `"bigText"` / `"image"` |
| `accentColor` | string | 标题颜色，如 `"#5f8f7b"` |
| `maxLines` | number | lines 布局行数上限 1-6，默认 6 |
| `tapPath` | string | 点击跳转路径，`/` 开头 |
| `updateIntervalMin` | number | 逻辑重跑间隔（分钟），0=仅启动/手动，默认 0 |
| `enabled` | boolean | 首次扫描默认启用状态，默认 true |

## logic.js

隐藏沙箱 iframe 中执行（自动注入 JSBridge + serviceId），仅开放两个模块，10s 超时：

- `__amiba__.desktopWidget.publish(data)` — 发布渲染数据，必须且只调一次
- `__amiba__.storage` — `set/get/remove`，读写本服务数据

publish 数据：

| 字段 | 说明 |
|------|------|
| `title` | 卡片标题（缺省用 label） |
| `icon` | 标题前 emoji |
| `lines` | 文本行，≤6 条、每条 ≤60 字；bigText 布局只取 lines[0] |
| `image` | 相对卡片目录的图片路径（如 `assets/chart.png`），image 布局用；拒绝绝对路径与 `..` |
| `footer` | 底部小字 |

## 执行与刷新

- 时机：App 启动全量刷新 + `updateIntervalMin` 周期 + `android_widget_refresh` 手动
- **占位显示**：卡片启用后即使 logic.js 尚未成功运行，也会以占位载荷（label + "加载中…"）出现在选卡页，首次 publish 后替换为真实数据
- App 被杀期间桌面显示最后一次推送的缓存（原生 SharedPreferences）
- 点击卡片：打开 App 并跳转 `tapPath`

## 排查

选卡页显示"暂无可用卡片"时按序排查：

1. `android_widget_list` 确认卡片已注册且 `enabled: true`
2. 设置页 → 日志搜 `[DesktopWidget]`：应有"已推送原生: N 张启用卡片"；有"推送原生失败"则为桥接问题
3. logcat 搜 `[amiba-widget]`：应有 `updateCards ✓`；报错则为 JNI/原生侧问题

## 管理工具

| 工具 | 说明 |
|------|------|
| `android_widget_create` | 创建全局卡片（不依附服务），含 widget.json 字段 + logicJs |
| `android_widget_list` | 列出全部卡片（key 格式 `serviceId/cardId` 或 `global/{cardId}`） |
| `android_widget_enable` | 启用/停用卡片 |
| `android_widget_refresh` | 立即重跑 logic 并推送桌面 |

## 用户使用

长按安卓桌面 → 小组件 → "变形虫" → 拖上桌面 → 选卡页选择卡片。

## 平台限制

仅 Android 生效。桌面/浏览器端 logic.js 照常执行写缓存，推送原生一步跳过。
