# 工具系统（Tools）

## 概述

`src/tools/` 实现工具注册、发现、调度系统。所有工具通过 `toolRegistry.register()` 注册，
`import.meta.glob` 自动发现 `*.tool.ts` 文件。

## 核心组件

| 文件 | 职责 |
|------|------|
| `tool-registry.ts` | ToolRegistry 类（register/dispatch/getDefinitions）+ deferred queue |
| `discover.ts` | `import.meta.glob` 自发现 + `flush()` |
| `toolsets.ts` | 工具集定义（core/chat/create）+ `resolveToolset()` 递归解析 |

## 已注册工具（8 个）

| 工具 | 工具集 | 用途 |
|------|--------|------|
| `memory` | core | 持久记忆读写 |
| `generate_service` | core | 生成 Web 应用 |
| `catalog_search` | core | UI 组件目录查询 |
| `skill_view` | core | 查看技能内容 |
| `skills_list` | core | 列出可用技能 |
| `service_list` | core | 列出用户服务 |
| `service_file_list` | core | 列出服务文件 |
| `service_file_read` | core | 读取服务文件 |
| `service_file_write` | core | 编辑服务文件 |

## 工具集

| 工具集 | 包含工具 |
|--------|----------|
| `core` | 全部 8 个工具 |
| `chat` | memory + core |
| `create` | generate_service + catalog_search + core |

## 添加新工具

```ts
// src/tools/my-tool.tool.ts
import { toolRegistry } from './tool-registry'

toolRegistry.register({
  name: 'my_tool',
  toolset: 'core',
  description: '工具描述',
  schema: { type: 'function', function: { name: 'my_tool', parameters: { ... } } },
  handler: async (args) => { ... },
  emoji: '🔧',
})
```

文件保存后自动被发现，无需修改任何配置。
