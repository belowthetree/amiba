# P3 — 界面 Slot 化（进行中）

> 对应路线：`docs/plugin/plugin-migration-roadmap.md` 的 P3。
> 原则：先建类型化 Slot 注册表，再逐页替换宿主；现有 HTML Slot 保持兼容。

## 步骤清单

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 建立 `@amiba/ui-slots` 类型化 Vue Slot 注册表服务 | ✅ 已验证 |
| 2 | `ui-shell` 接入全局 Slot 容器（App 层） | 🔄 待验证 |
| 3 | 设置页 `settings.section` 宿主化 | ⬜ |
| 4 | 聊天页 `chat.above-messages` / `chat.below-input` 宿主化 | ⬜ |
| 5 | 服务列表 `services.above-list` 宿主化 | ⬜ |
| 6 | 页面注册表 + 动态路由（pageRegistry） | ⬜ |
| 7 | 官方页面迁为页面插件，清理 App/router 硬编码 | ⬜ |

## 第 1 步目标

- 新增 `src/plugins/ui-slots/`，提供 `ctx.get('uiSlots')`。
- 支持 `register / list / get / update / dispose`，同 Slot 内按 `order` 排序。
- 首批 `UISlotMap` 只声明、不渲染，现有页面零改动。
