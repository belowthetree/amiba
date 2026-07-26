# 服务 AI 对话能力

## 概述

让 iframe 沙箱中的服务可以通过 JSBridge 发起 AI 对话（多轮、流式、可带工具调用）。每个服务的可用工具由用户在服务设置中逐服务配置，**默认只开放只读工具**。API Key、工具执行、对话历史全部留在宿主侧，服务只收发消息。

## 设计目标

- **能力下沉**：服务无需知道 provider / API Key，经 `ai` 模块桥接即可获得对话能力
- **最小授权**：新权限 `ai`；工具双层白名单，默认仅只读工具，敏感工具逐服务手动开启
- **沙箱不破**：工具在宿主侧经全局 `toolRegistry.dispatch` 执行，继承错误隔离与结果截断
- **架构同构**：会话代理 + 事件流复用现有 `network.connect` → session proxy / `session-event` 模式

## 架构

```
┌─ 服务 (iframe) ─────────────────────────────┐
│  conv = await __amiba__.ai.createConversation│
│  conv.on('chunk' | 'tool' | 'done' | 'error')│
│  await conv.send('帮我查一下…')              │
│  await conv.abort() / conv.close()           │
└──────────┬───────────────────────────────────┘
           │ postMessage (JSBridge, 权限检查 'ai')
┌──────────▼───────────────────────────────────┐
│  bridge.ts（传输层 + 权限检查）               │
│  service-container.vue · makeApiHandler      │
│    case 'ai' ──► ServiceAiRunner             │
│  background-manager.ts · handleBgAPI /       │
│    handleGlobalAPI（补 serviceId 权限校验）   │
│                                              │
│  ServiceAiRunner (src/ai/service-ai.ts)      │
│  · conversations Map — 每服务多会话           │
│  · 服务级系统提示构建（不走 buildSystemPrompt）│
│  · streamChat 控制码流解析 → ai-event 推送    │
│  · 限制：maxIterations 10 / 每服务 3 会话     │
└──┬───────────────────────────────────────────┘
   │ streamChat（复用 agent.ts）
   ▼
┌──────────────────────────────────────────────┐
│  toAISdkTools(['chat'], allowedTools)        │
│  toolRegistry.dispatch — 白名单交集过滤       │
└──────────────────────────────────────────────┘
```

关键决策：**绕开 `agent-runner` 全局单例**（它绑定 ChatPage 的 `running`/`streamingReasoning` 状态，服务调用会污染聊天页），新建独立的 `ServiceAiRunner`，复用底层 `streamChat`。`skill-reviewer.ts` 已有在 agent-runner 之外独立发 LLM 调用的先例。

## JSBridge `ai` 模块协议

BRIDGE_SCRIPT 现有 30s 超时（bridge.ts）与 AI 长响应矛盾，因此采用**会话代理 + 事件流**：桥调用立即返回 ack，内容经宿主 `sendEvent` 推送。

### 服务侧 API

```js
const conv = await __amiba__.ai.createConversation({
  system: '你是一个记账助手…',   // 可选，追加到宿主系统提示末尾
})
conv.on('chunk', (text) => {})  // 流式文本增量
conv.on('tool',  (name) => {})  // 工具调用通知，如 "doc_search"
conv.on('done',  (full) => {})  // 完成，携带完整回复
conv.on('error', (err) => {})
await conv.send('帮我查一下…')   // 多轮：历史由宿主按 conversationId 维护
await conv.abort()               // 中止当前生成
conv.close()                     // 销毁会话，释放宿主侧历史
```

### 协议细节

- `createConversation` / `send` / `abort` 走标准 `api` / `api-response` 通道，立即返回（`createConversation` 的 result 含 `conversationId`），不触碰 30s 超时。
- 内容推送：宿主 `sendEvent('ai-event', { conversationId, event, data })`，`event ∈ chunk | tool | done | error`；iframe 侧分发逻辑仿照 `session-event`。
- 类型扩展：`Permission` 与 `ServiceRequest.module` 新增 `'ai'`；`HostEvent.name` 新增 `'ai-event'`。
- `createBridge` 权限块仿照现有 if 加一条 `'ai'` 检查。
- **后台服务路径**：`background-manager.ts` 的 `handleBgAPI` / `handleGlobalAPI` 目前无权限检查，而 AI 调用涉及计费，不能照旧放行 —— 为 `ai` 模块单独按 `params.serviceId` → registry 查 manifest 补权限校验。

## 工具暴露模型

### 双层白名单

不直接复用 `ToolCategory`（现有 category 标注不完整：core/skills 系工具大多无 category，且 `service_file_read` 被标为 `edit`），改为在 `src/ai/service-ai.ts` 维护**服务可暴露工具清单**，每个工具标注风险级别：

```ts
export const SERVICE_AI_TOOLS: Record<string, { level: 'readonly' | 'sensitive' }> = {
  // —— 只读（默认开启）——
  doc_list:             { level: 'readonly' },
  doc_read:             { level: 'readonly' },
  doc_search:           { level: 'readonly' },
  catalog_search:       { level: 'readonly' },
  service_list:         { level: 'readonly' },
  service_view:         { level: 'readonly' },
  skills_list:          { level: 'readonly' },
  skill_view:           { level: 'readonly' },
  requirement_view:     { level: 'readonly' },
  requirements_summary: { level: 'readonly' },
  web_fetch:            { level: 'readonly' },
  // —— 敏感（需用户在服务设置中手动开启）——
  session_search:          { level: 'sensitive' },  // 可读用户聊天记录
  web_browse:              { level: 'sensitive' },  // 会弹出浏览器 WebView
  ui_theme_set_variables:  { level: 'sensitive' },
  ui_slot_set:             { level: 'sensitive' },
  // …按此模式可逐步扩充
}
```

- 清单之外的工具**永不暴露给服务**：`memory`（写全局 MEMORY.md，有被服务投毒风险）、`service_file_*` 写工具（无属主隔离）、`service_create`、主题删除/重置等。
- 不新增 toolset：runner 以 `'chat'` 为工具全集调用 `toAISdkTools(['chat'], allowedTools)`，`allowedTools` = 每服务配置 ∩ `SERVICE_AI_TOOLS` 白名单（双重过滤，安全性等价且避免双份名单同步）。

### 每服务配置

`ServiceEntry` 新增字段，随 `amiba_service_registry` 持久化：

```ts
aiConfig?: {
  enabled: boolean
  tools?: string[]   // undefined = 默认（全部 readonly 级）；显式数组 = 精确子集
}
```

- 运行时过滤双条件：`aiConfig.enabled` 且 `manifest.permissions` 含 `'ai'`，缺一不可。
- **声明即启用**：服务 manifest 声明 `ai` 权限后默认 enabled，工具 = readonly 集合。
- registry.ts 新增 `updateServiceAiConfig(id, config)`，走现有响应式 + 防抖持久化。

### 执行链路改造（最小侵入）

`StreamChatOptions`（agent.ts）增加三个可选项：

| 选项 | 作用 |
|---|---|
| `allowedTools?: string[]` | 透传 `toAISdkTools`，解析后按名字交集过滤 |
| `systemPromptOverride?: string` | 跳过 `buildSystemPrompt`（避开 stable 全局缓存与主聊天互相冲刷） |
| `skipMemoryCheckpoint?: boolean` | 不消费主聊天的记忆检查点（agent.ts 目前无条件消费，会被服务调用偷走） |

## ServiceAiRunner（src/ai/service-ai.ts）

```ts
interface ServiceConversation {
  messages: ModelMessage[]   // 宿主侧维护的多轮历史
  abort: AbortController
  lastActive: number
}
// Map key = `${serviceId}:${conversationId}`
```

职责：

- `chat(serviceId, conversationId, text)` → 内部 async generator，产出 `{ type: 'chunk' | 'tool' | 'done' | 'error' }`；`makeApiHandler` 的 `case 'ai'` 调用它并用 `bridge.sendEvent('ai-event', …)` 转发。
- 系统提示由 runner 自拼（不走 `buildSystemPrompt`）：身份（"你是内嵌在服务「X」中的 AI 助手"）+ 服务 description + 当前可用工具简表 + 服务传入的 `system` 追加。
- 解析 `streamChat` 的控制码流（`\x00REASONING\x00` / `\x00TOOL:name\x00` / `\x00STEP_LIMIT:n\x00`）转成桥事件 —— 解析逻辑与 agent-runner 相同，抽小函数共用。
- 限制：`maxIterations: 10`（服务场景不宜 25 轮）；每服务最多 3 个活跃会话；会话空闲 30 分钟回收；超限返回结构化 error 事件。
- 模型 / provider 直接用全局 settings（与主聊天一致），v1 不支持每服务换模型。

## 服务设置 UI

当前无独立服务设置页，入口放在服务卡片上（ServiceBrowsePage）：

- 服务卡片新增 ⚙ 按钮，打开新组件 `src/components/ServiceAiSettingsDialog.vue`：
  - 「AI 对话」开关 —— 若 manifest 未声明 `ai` 权限，开启时提示"将为该服务补充 ai 权限声明"（用户授权 = 写回 manifest.json + registry，manifest 仍是桥检查的唯一事实源）。
  - 工具列表：按「只读工具」「敏感工具」分组 checkbox，各附一句话说明；「敏感工具」默认全不勾；顶部「恢复默认」按钮（= 只读集合）。
- i18n 字符串同步加 `zh-CN.ts` / `en.ts`。

## 权限声明对齐（顺手修复现有漂移）

新增 `'ai'` 时把 4 处分散定义补齐对齐（它们当前已互相落后，缺 `background`/`fileAccess`/`fetch`）：

- `src/types/service.ts` — `Permission` 联合类型
- `src/tools/service.tool.ts` — `VALID_PERMISSIONS`
- `src/ai/catalog.ts` — `KNOWN_PERMISSIONS`
- `src/ai/service-validator.ts` — 仿规则 5-8 加 `__amiba__.ai` 使用 vs 声明一致性检查
- `public/catalog/skills/service-dev/SKILL.md` — 权限清单文档

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/ai/service-ai.ts` | **新建**：工具白名单、ServiceAiRunner、服务系统提示构建 |
| `src/types/service.ts` | Permission / module / HostEvent 加 `'ai'` / `'ai-event'`；`ServiceEntry.aiConfig` |
| `src/host/bridge.ts` | BRIDGE_SCRIPT 加 `ai` 命名空间 + 会话代理；权限检查加一条 |
| `src/host/service-container.vue` | `makeApiHandler` 加 `case 'ai'`，转发 runner 事件 |
| `src/host/background-manager.ts` | 两处 handler 加 `case 'ai'` + 按 serviceId 的权限校验 |
| `src/ai/agent.ts` | `StreamChatOptions` 加 `allowedTools` / `systemPromptOverride` / `skipMemoryCheckpoint` |
| `src/tools/toolsets.ts` | `toAISdkTools` 加 `allowedTools` 过滤参数 |
| `src/host/registry.ts` | `updateServiceAiConfig` |
| `src/components/ServiceAiSettingsDialog.vue` | **新建**设置弹窗；ServiceBrowsePage 接入 |
| i18n / validator / catalog / service.tool | 权限与校验对齐 |
| 文档 | `public/docs/jbridge.md`（ai 模块一节）、`docs/jsbridge.md`、本文档、`AGENTS.md` 同步 |

## v1 边界（明确不做）

- 每服务自定义 provider / 模型（`CustomAgent` 接线本身是断的，不在本次修）
- 服务读写全局记忆（`memory` 工具）—— 未来可考虑 per-service 记忆文件
- 快捷页 `/quick` 支持（它只是静态自定义视图，shim 不含完整桥）
- Token 用量统计、费率限制（只有会话数 / 轮数软限制）
