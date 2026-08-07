// ============================================================
// 变形虫 (Amiba) — LLM Agent (AI SDK v7 流式对话) v3
// ============================================================
// v3 改造：使用 Vercel AI SDK streamText + stopWhen 替代手动 while 循环
// ============================================================

import { streamText, pruneMessages, tool } from 'ai'
import type { LanguageModel, ModelMessage } from 'ai'
import { getSettings, getApiKey } from '../config/config'
import { memoryStore } from './memory-store'
import { buildSystemPrompt, consumeMemoryCheckpointPrompt } from './system-prompt'
import { toAISdkTools } from '../tools/toolsets'
import { createModelFromConfig, createWebSearchTool } from './provider-factory'
import type { CustomAgent } from '../types/service'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: any[]
  tool_call_id?: string
}

/** 流式对话配置 */
export interface StreamChatOptions {
  /** 启用的工具集名称（默认 ['chat']） */
  enabledToolsets?: string[]
  /** 最大 API 调用轮次（默认 25） */
  maxIterations?: number
  /** 最大 context token 数估算（默认 128k） */
  maxContextTokens?: number
  /** 当前会话已进行轮次（用于 nudge 提示） */
  turnCount?: number
  /** 指定使用的自定义 Agent ID（可选，不传则用默认配置） */
  agentId?: string
  /** 中止信号（用于停止流式生成） */
  abortSignal?: AbortSignal
  /** 额外注入的 system prompt 内容（追加在 stable+volatile 之后） */
  extraInstructions?: string
  /** 完整覆盖 system prompt（跳过 buildSystemPrompt，用于服务内嵌对话等非主聊天场景） */
  systemPromptOverride?: string
  /** 跳过记忆检查点消费（非主聊天场景必须 true，避免偷走主聊天的检查点） */
  skipMemoryCheckpoint?: boolean
  /** 工具名白名单过滤（在 enabledToolsets 解析结果上再求交集，用于服务场景的最小授权） */
  allowedTools?: string[]
  /** 允许注入服务端联网搜索工具（provider-executed web_search）。
   *  生效前提：当前供应商 protocol === 'responses' 且其 webSearch 开关打开；
   *  默认 false —— 服务内嵌 AI 等复用方不传入即不注入，白名单语义不受影响 */
  webSearch?: boolean
}

const DEFAULT_OPTIONS = {
  enabledToolsets: ['chat'] as string[],
  maxIterations: 25,
  maxContextTokens: 128_000,
  turnCount: 0,
}

// ---- 粗略 token 估算 ----

function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0
  for (const m of messages) {
    chars += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
  }
  return Math.ceil(chars / 4)
}

// ---- 核心流式对话 ----

export async function* streamChat(
  messages: ChatMessage[],
  options?: StreamChatOptions
): AsyncGenerator<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const s = getSettings()
  let apiKey = await getApiKey()
  let baseUrl = s.ai_base_url
  let modelName = s.ai_model
  // 协议与联网搜索开关随供应商配置走；默认 API 配置（未选供应商）固定 Responses + 联网搜索
  let protocol: 'chat' | 'responses' = 'responses'
  let providerWebSearch = true

  // 默认路径：经默认供应商解析（settings.default_provider_id）
  if (s.default_provider_id) {
    const { getProvider } = await import('./provider-store')
    const p = getProvider(s.default_provider_id)
    if (p) {
      protocol = p.protocol ?? 'responses'
      providerWebSearch = !!p.webSearch
    }
  }

  // 如果指定了自定义 Agent，使用其供应商配置
  let customAgent: CustomAgent | undefined
  if (opts.agentId) {
    const { getCustomAgent } = await import('./custom-agent-store')
    const { getProvider } = await import('./provider-store')
    customAgent = getCustomAgent(opts.agentId)
    if (customAgent) {
      const provider = getProvider(customAgent.providerId)
      if (provider) {
        baseUrl = provider.baseUrl
        modelName = customAgent.model
        if (provider.apiKey) {
          apiKey = provider.apiKey
        }
        protocol = provider.protocol ?? 'responses'
        providerWebSearch = !!provider.webSearch
      }
    }
  }

  if (!apiKey) {
    yield '请先在设置中配置 API Key。\n'
    return
  }

  // Refresh memory cache（服务内嵌 AI 走 systemPromptOverride，system prompt 不含记忆，跳过刷新）
  if (!opts.systemPromptOverride) {
    await memoryStore.init()
  }

  // === AI SDK: 创建 provider + model ===
  const { model: languageModel, providerName } = createModelFromConfig(baseUrl, apiKey, modelName, protocol)

  // === AI SDK: 构建工具 ===
  const tools = toAISdkTools(opts.enabledToolsets, opts.allowedTools)
  // 服务端联网搜索（provider-executed web_search）：不经 ToolRegistry、不占本地工具轮次；
  // 仅调用方显式允许（webSearch 选项）且供应商 responses 协议 + 开关打开时注入
  if (opts.webSearch && providerWebSearch) {
    const wsTool = createWebSearchTool(baseUrl, apiKey, protocol)
    if (wsTool) {
      Object.assign(tools, wsTool)
      console.log('[Agent] 🌐 服务端联网搜索已注入（responses 协议）')
    }
  }
  const hasTools = Object.keys(tools).length > 0

  // === 推理强度 ===
  const reasoningEffort = customAgent?.reasoning_effort || s.reasoning_effort

  // === 构建 system prompt（服务场景可整体覆盖，避开主聊天的 stable 缓存） ===
  let systemContent = opts.systemPromptOverride ?? buildSystemPrompt({
    enabledToolsets: opts.enabledToolsets,
    turnCount: opts.turnCount,
  })

  // 记忆检查点：/new 后首次对话时注入上一会话片段（仅主聊天场景消费）
  if (!opts.skipMemoryCheckpoint) {
    const checkpoint = await consumeMemoryCheckpointPrompt()
    if (checkpoint) {
      console.log('[Agent] 📋 记忆检查点已注入 —', checkpoint.length, '字符')
      systemContent +=
        '\n\n' +
        '=== 记忆检查点 ===\n' +
        '以下是你上一次会话的对话片段。请回顾其中是否有值得长期保存的信息（用户偏好、重要决策、待办事项等），如有请使用 memory 工具保存：\n\n' +
        checkpoint +
        '\n\n' +
        '请在回复用户之前先处理记忆保存（如果发现有价值信息的话）。'
    }
  }

  // 自定义 Agent 的 System Prompt 注入
  if (customAgent?.systemPrompt) {
    systemContent += '\n\n' + customAgent.systemPrompt
  }

  // 额外注入的 instructions（如 onboarding 引导指令）
  if (opts.extraInstructions) {
    systemContent += '\n\n' + opts.extraInstructions
  }

  // === 转换消息为 ModelMessage（仅 user / assistant） ===
  const modelMessages: ModelMessage[] = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // 防御：如果没有 user/assistant 消息（如首次 onboarding），插入空 user 消息
  if (modelMessages.length === 0) {
    modelMessages.push({ role: 'user', content: '' })
  }

  // === AI SDK streaming ===
  let hitLimit = false

  try {
    const result = streamText({
      model: languageModel,
      messages: modelMessages,
      instructions: systemContent,
      tools: hasTools ? tools : undefined,
      stopWhen: ({ steps }) => {
        if (steps.length >= opts.maxIterations) {
          hitLimit = true
          return true
        }
        return false
      },
      abortSignal: opts.abortSignal,
      providerOptions: reasoningEffort ? { [providerName]: { reasoningEffort } } as any : undefined,
      prepareStep: async ({ messages: stepMsgs }) => {
        const est = estimateTokens(stepMsgs)
        if (est > opts.maxContextTokens) {
          console.warn(
            `[Agent] Token 预算预警: 估算 ${est} > ${opts.maxContextTokens}，开始截断`
          )
          // 触发记忆压缩钩子（借鉴 Hermes on_pre_compress）
          memoryStore.onTruncation(
            stepMsgs
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ role: m.role as string, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
          ).catch((e) => console.warn('[Agent] 截断钩子失败:', e))

          return {
            messages: pruneMessages({
              messages: stepMsgs,
              reasoning: 'all',
              toolCalls: 'before-last-3-messages',
              emptyMessages: 'remove',
            }),
          }
        }
      },
      onError: ({ error }) => {
        console.error('[Agent] 流式错误:', error)
      },
      onToolExecutionStart: ({ toolCall }) => {
        console.log('[Agent] 🔧', toolCall.toolName)
      },
      onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }) => {
        if (toolOutput.type === 'tool-error') {
          console.warn('[Agent] 🔧✗', toolCall.toolName, `(${toolExecutionMs}ms)`, String(toolOutput.error).slice(0, 200))
        } else {
          console.log('[Agent] 🔧✓', toolCall.toolName, `(${toolExecutionMs}ms)`)
        }
      },
    })

    for await (const part of result.stream) {
      if (part.type === 'text-delta') {
        yield part.text
      } else if (part.type === 'reasoning-delta') {
        yield `\x00REASONING\x00${part.text}`
      } else if (part.type === 'tool-call') {
        yield `\x00TOOL:${part.toolName}\x00`
      } else if (part.type === 'tool-error') {
        console.warn('[Agent] 工具执行异常:', part.toolName, String(part.error).slice(0, 300))
      } else if (part.type === 'error') {
        console.error('[Agent] 流事件错误:', part.error)
      }
    }

    // 工具调用轮次达到上限
    if (hitLimit) {
      console.log(`[Agent] 已达到 ${opts.maxIterations} 轮工具调用上限`)
      yield `\x00STEP_LIMIT:${opts.maxIterations}\x00`
    }

    // 记录用量
    const usage = await result.usage
    console.log('[Agent] 用量:', usage)
  } catch (e: any) {
    console.error('[Agent] streamText 异常:', e)
    yield `\n\n[AI 调用异常: ${e.message || String(e)}]`
  }
}

// ---- 辅助 ----

export function buildMessages(
  history: { role: 'user' | 'assistant'; content: string }[]
): ChatMessage[] {
  return history.map((m) => ({ role: m.role, content: m.content }))
}
