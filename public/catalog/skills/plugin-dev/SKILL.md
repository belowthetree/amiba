---
name: plugin-dev
description: Amiba 宿主插件与统一插件包开发指南（页面/Slot/工具/服务二合一）
keywords:
  - 插件
  - plugin
  - 宿主插件
  - 插件包
  - 扩展
  - 设置页签
  - 页面插件
  - 运行时插件
  - 插件开发
  - 打包插件
  - amiba-plugin
---

# Amiba 插件开发指南 (plugin-dev)

当用户要求「开发插件 / 扩展宿主 / 新增设置页 / 新增聊天挂件 / 打包成插件 / 服务和插件合一」时，先阅读本技能。

## 0. 先判断形态

| 需求 | 选择 |
| --- | --- |
| 独立小程序、沙箱页面、后台任务、局域网小工具 | 用 `service-dev` 创建沙箱服务，不要做宿主插件 |
| 新增宿主页面、设置页签、聊天区挂件、AI 工具、宿主服务 | 宿主插件 |
| 既要宿主扩展，又要沙箱小程序 | 统一 `.amiba-plugin` 包：`service/` 目录 + 宿主 bundle |
| 已打包 App 运行时安装 | 必须先构建成 `.amiba-plugin` 预编译包，不能下发源码 |

## 1. 开发期宿主插件结构

```
src/plugins-local/<id>/
├── amiba.plugin.json
├── src/
│   ├── index.ts
│   └── *.vue
└── service/            # 可选：沙箱服务部分
    └── index.html
```

`amiba.plugin.json`：

```json
{
  "apiVersion": 1,
  "id": "my-plugin",
  "kind": "plugin",
  "version": "1.0.0",
  "description": "...",
  "entry": "src/index.ts",
  "inject": ["pageRegistry", "uiSlots", "toolRegistry"],
  "provides": {
    "services": [],
    "tools": ["my_tool"],
    "pages": ["my-page"],
    "slots": ["ui.slot.settings.section", "ui.slot.chat.below-input"]
  },
  "permissions": { "allow": [], "deny": [] },
  "service": {
    "enabled": true,
    "entry": "index.html",
    "permissions": ["storage"]
  }
}
```

## 2. 插件入口契约

```ts
import { defineAmibaPlugin } from '../../../sdk'

const plugin = defineAmibaPlugin({
  name: '@amiba/my-plugin',
  inject: ['pageRegistry', 'uiSlots'],
  provides: [],

  apply(ctx) {
    // 所有资源必须 ctx.effect 包裹，卸载时自动清理
  },
})

export const name = plugin.name
export const inject = plugin.inject
export const provides = plugin.provides
export const apply = plugin.apply
```

## 3. 可用扩展点

### 页面

```ts
const pages = ctx.get('pageRegistry')
const page = pages.register({
  id: 'my-page',
  path: '/my-page',
  name: 'my-page',
  component: MyPage,
  title: () => '我的页面',
  order: 100,
  mainNav: false,
  keepAlive: false,
  keepAliveName: 'MyPage',
})
ctx.effect(() => page.dispose, 'my-plugin: page')
```

### UI Slot

```ts
const slots = ctx.get('uiSlots')
const h = slots.register({
  name: 'ui.slot.settings.section',
  id: 'my-plugin:settings',
  order: 100,
  component: SettingsPanel,
  label: () => '我的插件',
})
ctx.effect(() => h.dispose, 'my-plugin: settings slot')
```

可用 Slot：`ui.slot.app.global`、`ui.slot.chat.above-messages`、`ui.slot.chat.below-input`、`ui.slot.settings.section`、`ui.slot.services.above-list`、`ui.slot.memory.tab`。

### AI 工具

```ts
const tools = ctx.get('toolRegistry')
tools.registry.register({
  name: 'my_tool',
  toolset: 'svc',
  category: 'view',
  emoji: '🧩',
  description: '工具说明',
  schema: { type: 'function', function: { name: 'my_tool', description: '...', parameters: { type: 'object', properties: {} } } },
  handler: async (args) => JSON.stringify({ ok: true }),
})
ctx.effect(() => tools.registry.deregister('my_tool'), 'my-plugin: tool')
```

### 宿主服务

```ts
ctx.provide('myService', service)
// 其他插件 inject: ['myService']，再 ctx.get('myService')
```

## 4. 开发期启用

```bash
npm run plugin:validate -- <pluginDir>
npm run plugin:add -- <pluginDir>
npm run dev
```

## 5. 打包成统一 `.amiba-plugin`

```bash
npm run plugin:package -- <pluginDir>
# 输出 dist-plugins/<id>-<version>.amiba-plugin.zip
```

包结构：

```
manifest.json       # 宿主 + service 声明
plugin.js           # 预编译宿主 bundle
plugin.css          # 可选样式
service/            # 可选沙箱服务文件
checksums.json      # sha256
```

## 6. 运行时安装

- 打包后的 App：设置 → 本地插件 → 导入 `.amiba-plugin`。
- 宿主部分即时生效（页面/Slot/工具）。
- 沙箱服务部分写入 `services/<id>/`，重启后进入服务列表。

## 7. 约束

- 宿主插件默认无权限，敏感能力必须写 `permissions.allow`。
- 宿主插件是受信代码：不得在插件里读明文密钥；使用 `credentials` 服务。
- 预编译包只允许依赖 `vue` / `vue-router` / `pinia` / `@amiba/sdk` / `@amiba/kernel`，其他依赖必须打进 bundle。
- 所有注册都必须 `ctx.effect`，否则卸载会残留。
- 生产环境安装第三方包前应验证 `checksums.json`，并逐步启用签名。
