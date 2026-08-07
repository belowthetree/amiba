# 联网搜索（Responses 协议 + web_search）

变形虫使用「供应商服务端联网搜索」：AI 回答时效性问题时，由模型供应商在服务端执行网页搜索并把结果注入回答。面向 **DeepSeek v4（Responses API）** 设计，聊天主路径统一走 Responses 协议。

## 协议模型

每个 AI 供应商（`AiProvider`，见 `src/types/service.ts`）有两个字段：

| 字段 | 取值 | 含义 |
|------|------|------|
| `protocol` | `'responses'`（UI 固定）/ `'chat'`（仅数据层保留，后台流程用） | 请求走 `{baseUrl}/responses` 还是 `{baseUrl}/chat/completions` |
| `webSearch` | `true` / `false` | 主聊天是否注入服务端 `web_search` 工具（仅 responses 协议生效） |

**默认 API 配置**（未选择供应商，仅填 Base URL + Key + 模型）固定按 `responses + 联网搜索开启` 处理（`src/ai/agent.ts` 默认路径），无任何选项。

`src/ai/provider-factory.ts` 据此创建模型：

- `responses` → `@ai-sdk/openai` 的 `openai.responses(modelId)`；`createWebSearchTool()` 额外返回 `{ web_search: provider.tools.webSearch() }`（provider-executed 工具，线格式 `{"type":"web_search"}`）
- `chat` → OpenAI 兼容 Chat Completions（仅服务内嵌 AI、技能评审/整理等后台流程经 `createModelFromConfig` 三参调用使用）

`src/ai/agent.ts` 在 `streamChat` 中按默认供应商（`settings.default_provider_id`）解析协议；`agent-runner.ts` 的主聊天循环传 `webSearch: true`，当供应商协议为 responses 且 `webSearch` 开启时把 `web_search` 合并进工具表。服务内嵌 AI（`service-ai.ts`）与技能评审/整理（`skill-reviewer.ts` / `skill-curator.ts`）不传该选项，默认关闭。

## 配置方法

1. **默认 API 配置**：无需操作，固定 Responses API + 联网搜索已开启（通用页 Base URL 下方有提示）。
2. **AI 供应商**：编辑表单只有「联网搜索」勾选，协议固定 Responses；该供应商被设为「当前供应商」后，通用页签也会出现「联网搜索」开关。
3. 启动门 / `ApiSetupOverlay` 的连通性检测按协议自动打 `/responses` 或 `/chat/completions`（`src/ai/api-check.ts`，默认 responses）。

存量用户此前保存的 DeepSeek 供应商会在 `initProviderStore()` 启动时自动迁移：协议改 Responses、联网搜索默认开启（用户显式关闭过则尊重）、模型列表合并 v4 模型；其他供应商不动，数据层的 `'chat'` 取值仅为后台流程保留。

## 约束与注意

- DeepSeek Responses 端点仅支持 **v4-flash / v4-pro** 系列模型；不支持的参数会被服务端静默忽略。
- Responses 的 `max_output_tokens` 下限为 16（api-check 探测请求用 16）。
- `web_search` 是供应商计费的服务端工具，搜索调用本身可能产生额外费用（以供应商定价为准）。
- UI 上搜索调用经现有 `\x00TOOL:` 消息标记自动展示为工具调用，无需额外渲染逻辑。

## 相关文件

- `src/ai/provider-factory.ts` — 模型/工具创建
- `src/ai/agent.ts` — 协议解析与 `web_search` 注入
- `src/ai/api-check.ts` — 协议感知的连通性探测
- `src/pages/SettingsPage.vue` — 联网搜索开关 UI（协议固定 Responses）
