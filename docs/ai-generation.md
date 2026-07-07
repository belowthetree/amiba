# AI 生成系统

## 概述

AI 生成系统是变形虫的核心能力。用户在聊天界面用自然语言描述需求，Chat AI 通过工具链分步创建完整的迷你 Web 应用并安装运行。

## 生成流程

```
用户输入需求（聊天界面）
    │
    ▼
┌──────────────┐
│  前置检查     │  service_list（查重）+ requirements_summary（查已有需求）
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  skill 加载   │  skill_view("service-dev") 读开发规范（sandbox 约束、JSBridge API、P2P 模板）
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  创建骨架     │  service_create({ id, name, description, permissions })
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  写入代码     │  service_file_write × N（index.html / style.css / app.js）
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  校验合法性   │  service_validate（检测 localStorage/BroadcastChannel/权限一致性等）
└──────┬───────┘
       │
       ▼
  安装完成，可运行
```

关键变化：不再有独立的 Generator 页面和 `generateService()` 单片生成器。Chat AI 拥有完整上下文（system prompt + skill + 文档系统），通过工具链分步创建。

## 工具链规范

| 步骤 | 工具 | 分类 | 说明 |
|------|------|------|------|
| 1 | `service_list` | view | 检查是否已有类似服务 |
| 2 | `skill_view("service-dev")` | - | 读取开发规范（必读） |
| 3 | `service_create(...)` | manage | 创建服务骨架（manifest） |
| 4 | `service_file_write × N` | edit | 写入代码文件 |
| 5 | `service_validate` | view | 校验代码合法性 |

修改已有服务时优先用 `service_file_edit`（精确查找替换），大范围改动用 `service_file_write`。

## Manifest 规范

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，`"user."` 开头，如 `"user.chatroom"` |
| `name` | string | 显示名称（中文优先） |
| `version` | string | 默认 `"1.0.0"` |
| `description` | string | 简短描述（≤30 字） |
| `permissions` | string[] | `storage`/`notification`/`widgets`/`network` |

## 服务文件结构

每个服务至少包含三个文件：

```
services/user.xxx/
├── manifest.json    # 元数据（service_create 自动写入）
├── index.html       # 入口页面
├── style.css        # 样式（独立文件）
└── app.js           # 业务逻辑（独立文件）
```

- `index.html` 通过 `<link href="style.css">` 和 `<script src="app.js">` 引用
- CSS 和 JS 不要内联在 HTML 中

**多文件组件结构（可选）**：复杂服务可拆分 CSS 和 JS 到子目录：

```
services/user.xxx/
├── manifest.json
├── index.html             # 入口，显式引用所有子文件
├── styles/
│   ├── base.css           # <link href="styles/base.css">
│   └── theme.css          # <link href="styles/theme.css">
├── components/
│   ├── TodoItem.js        # <script src="components/TodoItem.js">
│   └── TodoList.js        # <script src="components/TodoList.js">
├── utils/
│   └── helpers.js         # <script src="utils/helpers.js">
└── app.js                 # <script src="app.js">
```

所有子文件在 `index.html` 中通过 `<link>` / `<script>` 显式声明，packager 按文件路径内联。不支持隐式 `import` / `require`。

## Sandbox 约束

服务运行在 `<iframe sandbox="allow-scripts allow-same-origin">` 中，以下 API 不可用：

| 禁止 | 替代 |
|------|------|
| `localStorage` / `sessionStorage` | `__amiba__.storage` |
| `BroadcastChannel` / `SharedWorker` | `network` 权限 + `__amiba__.network.*` P2P |
| `alert()` / `confirm()` / `prompt()` | `__amiba__.showToast()` |
| 外部 CDN / `fetch()` 外部 URL | 预置库 `/libs/chart.umd.min.js`、`/libs/vue.global.prod.js` |
| 多窗口/多标签页 | 局域网 P2P 实现多设备通信 |

完整 sandbox 规范见 `public/docs/sandbox.md`（AI 可通过 `doc_read("sandbox.md")` 查阅）。

## JSBridge API

服务通过 `window.__amiba__` 调用宿主能力。完整 API 参考见 `public/docs/jbridge.md` 和 `public/docs/storage.md`。

核心 API 速查：

| 场景 | API | 所需权限 |
|------|-----|----------|
| 持久化存储 | `__amiba__.storage.set/get/remove` | `storage` |
| Toast 通知 | `__amiba__.showToast(title, icon)` | `notification` |
| 页面跳转 | `__amiba__.navigateTo/Back` | — |
| 悬浮块 | `__amiba__.widgets.*` | `widgets` |
| 局域网 P2P | `__amiba__.network.*` | `network`，详见 `public/docs/network.md` |

## 运行时渲染

`inlinePackage()` 函数（`src/ai/packager.ts`）将多文件 ServicePackage 编译为单个 HTML：

1. 以 `index.html` 为骨架
2. `<link href="style.css">` → 内联为 `<style>...</style>`
3. `<link href="styles/*.css">` → 内联（支持多文件目录结构）
4. `<script src="app.js">` → 内联为 `<script>...</script>`
5. `<script src="components/*.js">` → 内联（支持多文件组件结构）
6. `<script src="/libs/vue.global.prod.js">` → 透传不内联（预置库）
7. 注入 `<!-- AMIBA_BRIDGE -->` 占位符
8. 宿主通过 `injectBridge()` 覆写为真实 JSBridge

## 文档系统

AI 可通过工具查询平台知识库（`public/docs/` + 用户自定义 `{AppData}/docs/`）：

| 工具 | 说明 |
|------|------|
| `doc_list` | 列出所有可用文档 |
| `doc_read({ path })` | 读取完整文档 |
| `doc_search({ keyword })` | 按关键词搜索文档片段 |

生成服务前应阅读关键文档：`sandbox.md`（沙箱约束）、`jbridge.md`（API 参考）、`network.md`（P2P 通信）。

## Widget 生成

服务可通过 `widget.json` 声明式配置悬浮块，或运行时调用 `__amiba__.widgets.register()` 动态注册。完整规范见 `public/docs/widgets.md`。

## 经验教训

- **2025-07-05**: 旧 `generateService()` 单片生成器使用独立 LLM 调用，缺少主 system prompt 的完整上下文，导致 AI 无视 sandbox 约束（用 localStorage/BroadcastChannel）。改为 Chat AI 工具链分步创建：AI 通过 `skill_view` 和 `doc_read` 主动加载规范，在完整上下文中生成代码。
- **2025-07-05**: 服务校验模块 (`service-validator.ts`) 可在生成后自动检测 10 种常见错误（localStorage 使用、BroadcastChannel 使用、权限不一致等），应该作为生成流程的收尾步骤强制执行。
- **2025-07-07**: 新增 Vue 3 预置库支持 (`public/libs/vue.global.prod.js`)，服务可通过 `<script src="/libs/vue.global.prod.js">` 使用 Vue 3 的 Options API 构建响应式 UI。同时支持多文件组件目录结构（`components/*.js`、`styles/*.css`），所有引用文件通过 packager 自动内联。
