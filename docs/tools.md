# 工具系统（Tools）

## 概述

`src/tools/` 提供 AI Agent 可调用的工具集。通过 `ToolRegistry` 注册，`import.meta.glob` 自发现。

## 工具集

| 工具集 | 工具数 | 说明 |
|--------|--------|------|
| `core` | 22+ | 所有核心工具 |
| `chat` | 继承 core | 对话模式 |
| `create` | 继承 core + generate_service | 创建模式 |

## 工具清单

### 记忆 & 人格

| 工具 | 文件 | 说明 |
|------|------|------|
| `memory` | `memory.tool.ts` | 写入 MEMORY.md / USER.md |
| `soul_save` | `soul.tool.ts` | 创建/更新人格文件 |

### 服务生成 & 编辑

| 工具 | 文件 | 说明 |
|------|------|------|
| `generate_service` | `generate.tool.ts` | 自然语言生成迷你应用 |
| `catalog_search` | `catalog.tool.ts` | 搜索组件目录 |
| `service_file_list` | `service-file.tool.ts` | 列出服务文件 |
| `service_file_read` | `service-file.tool.ts` | 读取服务文件 |
| `service_file_write` | `service-file.tool.ts` | 写入服务文件 |

### 技能管理

| 工具 | 文件 | 说明 |
|------|------|------|
| `skill_view` | `skill.tool.ts` | 查看技能内容 |
| `skills_list` | `skill.tool.ts` | 列出可用技能 |
| `skill_manage_create` | `skill-manage.tool.ts` | 创建新技能 |
| `skill_manage_patch` | `skill-manage.tool.ts` | 精确查找替换（首选） |
| `skill_manage_edit` | `skill-manage.tool.ts` | 完整重写（重大重构） |
| `skill_manage_delete` | `skill-manage.tool.ts` | 归档技能 |
| `skill_manage_write_file` | `skill-manage.tool.ts` | 添加支持文件 |

### 需求追踪

| 工具 | 文件 | 说明 |
|------|------|------|
| `requirement_view` | `requirement.tool.ts` | 查看服务需求文档 |
| `requirement_update` | `requirement.tool.ts` | 追加需求/反馈/优化/完成 |
| `requirements_summary` | `requirement.tool.ts` | 全局需求汇总 |

### 网页浏览

| 工具 | 文件 | 说明 |
|------|------|------|
| `web_fetch` | `web-browser.tool.ts` | 获取网页可读文本。桌面 WebView JS 渲染，移动端平台原生 WebView，失败降级 HTTP |
| `web_browse` | `web-browser.tool.ts` | 浏览器交互操作：`navigate` 导航、`click` 点击 CSS 选择器、`input_text` 输入文本、`get_content` 提取页面 DOM 结构、`close` 关闭释放资源 |

**架构**: `web-bridge.ts` 封装 Tauri invoke → `web.rs` 三平台引擎 → Android 上通过 `libloading` 获取 JVM → Kotlin `WebViewHelper` 主线程管理 WebView → `JsCallback` 跨线程返回 JS 结果。

## 注册方式

```ts
// src/tools/xxx.tool.ts
import { toolRegistry } from './tool-registry'

toolRegistry.register({
  name: 'my_tool',
  toolset: 'core',
  emoji: '🔧',
  description: '...',
  schema: { /* OpenAI function schema */ },
  handler: async (args) => { /* ... */ },
})
```

文件放在 `src/tools/*.tool.ts` 即被 `discoverTools()` 自动发现。
