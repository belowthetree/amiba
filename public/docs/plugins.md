---
title: 插件系统
description: Amiba 宿主插件扩展点：页面、UI Slot、AI 工具、服务、统一插件包。
keywords:
  - 插件
  - plugin
  - 扩展
  - 页面
  - 设置页
  - Slot
  - 工具
  - 插件包
category: platform
---

# Amiba 插件系统

Amiba 采用“一切皆插件”：宿主页面、设置页签、聊天挂件、AI 工具、平台服务都可以由插件扩展。

## 扩展点总表

| 扩展点 | 注册方式 | 运行时效果 |
| --- | --- | --- |
| 页面 | `pageRegistry.register()` | 动态路由 + 主导航 + keep-alive + 手势预览 |
| 全局 Slot | `uiSlots.register('ui.slot.app.global')` | App 根布局插入组件 |
| 聊天区 Slot | `ui.slot.chat.above-messages` / `chat.below-input` | 聊天页插入组件 |
| 设置页签 | `ui.slot.settings.section` | 设置页新增页签 |
| 服务列表 Slot | `ui.slot.services.above-list` | 服务页插入组件 |
| AI 工具 | `toolRegistry.register()` | 主聊天 Agent 可调用 |
| 宿主服务 | `ctx.provide('service', value)` | 其他插件 `inject` / `ctx.get` |
| 事件 | `ctx.on` / `ctx.before` | 事件监听与 waterfall |
| 样式 | 包内 `plugin.css` | 安装时注入 `<style data-plugin-id>` |

## 插件契约

```ts
export const name: string
export const inject?: string[]
export const provides?: string[]
export function apply(ctx, config): void | (() => void)
```

## 关键规则

1. 所有注册必须通过 `ctx.effect` 返回清理函数。
2. 权限默认拒绝，manifest 声明 `permissions.allow`。
3. 秘密值使用 `credentials` 服务，不读 `process.env`。
4. 插件包必须预编译，运行时不能加载 TS 源码。
5. 完整开发流程见内置技能 `plugin-dev`。

## 服务容器

宿主插件可注入这些服务：

`storage` / `settings` / `platform` / `fs` / `lifecycle` / `toolRegistry` / `toolsets` / `modelProviders` / `credentials` / `session` / `memory` / `skills` / `customAgents` / `serviceRuntime` / `network` / `widgets` / `theme` / `soul` / `i18n` / `taskRecovery` / `pluginManager` / `uiSlots` / `pageRegistry` / `router` / `uiShell`。
