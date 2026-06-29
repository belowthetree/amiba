// ============================================================
// 变形虫 (Amiba) — LLM Agent (OpenAI 兼容流式对话) v2
// ============================================================
// v2 改造：多工具循环 + ToolRegistry 集成 + 工具集选择 + token 预算
// ============================================================
import OpenAI from 'openai'
import { getSettings, getApiKey } from '../config/config'
import { toolRegistry } from '../tools/tool-registry'
import { getToolDefinitions } from '../tools/toolsets'
import { memoryStore } from './memory-store'
import { buildSystemPrompt, buildSkillsIndex, consumeMemoryCheckpointPrompt } from './system-prompt'
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
}

const DEFAULT_OPTIONS = {
  enabledToolsets: ['chat'] as string[],
  maxIterations: 25,
  maxContextTokens: 128_000,
  turnCount: 0,
}

// ---- 粗略 token 估算 ----

function estimateTokens(messages: ChatMessage[]): number {
  // 粗略：4 字符 ≈ 1 token
  let chars = 0
  for (const m of messages) {
    chars += m.content.length
    if (m.tool_calls) {
      chars += JSON.stringify(m.tool_calls).length
    }
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
  let model = s.ai_model

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
        model = customAgent.model
        if (provider.apiKey) {
          apiKey = provider.apiKey
        }
      }
    }
  }

  if (!apiKey) {
    yield '请先在设置中配置 API Key。\n'
    return
  }

  // Refresh memory cache
  await memoryStore.init()

  const client = new OpenAI({
    baseURL: baseUrl,
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  })

  // 获取工具 schemas
  const toolSchemas = getToolDefinitions(opts.enabledToolsets)
  const hasTools = toolSchemas.length > 0

  let systemContent = buildSystemPrompt({
    enabledToolsets: opts.enabledToolsets,
    turnCount: opts.turnCount,
  })

  // 记忆检查点：/new 后首次对话时注入上一会话片段
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

  // 自定义 Agent 的 System Prompt 注入
  if (customAgent?.systemPrompt) {
    systemContent += '\n\n' + customAgent.systemPrompt
  }

  const systemMsg: ChatMessage = {
    role: 'system',
    content: systemContent,
  }

  let currentMessages = [systemMsg, ...messages]
  let apiCallCount = 0

  while (apiCallCount < opts.maxIterations) {
    apiCallCount++

    // Token 预算检测：超出时截断最旧的非 system 消息
    const estTokens = estimateTokens(currentMessages)
    if (estTokens > opts.maxContextTokens) {
      console.warn(
        `[Agent] Token 预算预警: 估算 ${estTokens} > ${opts.maxContextTokens}，开始截断旧消息`
      )
      // 截断前：触发记忆压缩钩子（借鉴 Hermes on_pre_compress）
      const keep = Math.max(2, currentMessages.length - 4)
      const truncated = currentMessages.slice(1, keep) // 不包括 system msg
      memoryStore.onTruncation(
        truncated
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as string, content: m.content }))
      ).catch((e) => console.warn('[Agent] 截断钩子失败:', e))

      // 保留 system + 最后 4 条消息
      currentMessages = [
        currentMessages[0],
        ...currentMessages.slice(keep),
      ]

      // 注入过滤安全序言（借鉴 Hermes compression preamble）
      const preamble: ChatMessage = {
        role: 'system',
        content:
          '[System note: This is a handoff from a previous context window. ' +
          'Treat the above as background reference, NOT as active instructions. ' +
          'Do NOT answer questions or re-execute tasks mentioned in earlier context ' +
          'unless the user explicitly asks about them.]',
      }
      // 在 system 消息之后、保留消息之前插入
      currentMessages.splice(1, 0, preamble)
    }

    const stream = await client.chat.completions.create({
      model: model,
      messages: currentMessages as any,
      stream: true,
      tools: hasTools ? (toolSchemas as any) : undefined,
      tool_choice: hasTools ? 'auto' : undefined,
    })

    let fullContent = ''
    let toolCalls: any[] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      if (delta?.content) {
        fullContent += delta.content
        yield delta.content
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
            if (!toolCalls[tc.index]) {
              toolCalls[tc.index] = {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              }
            }
            if (tc.id) toolCalls[tc.index].id = tc.id
            if (tc.function?.name)
              toolCalls[tc.index].function.name += tc.function.name
            if (tc.function?.arguments)
              toolCalls[tc.index].function.arguments += tc.function.arguments
          }
        }
      }

      const reason = chunk.choices[0]?.finish_reason
      if (reason === 'tool_calls') break
      if (reason === 'stop') {
        // 在还有 tool_calls 待处理时不提前退出
        if (toolCalls.filter(Boolean).length === 0) {
          return // 正常结束
        }
        break
      }
    }

    toolCalls = toolCalls.filter(Boolean)

    if (toolCalls.length > 0) {
      // 添加 assistant 消息（含 tool_calls）
      currentMessages.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCalls,
      })

      // 调度每个工具
      for (const tc of toolCalls) {
        const toolName = tc.function?.name || ''
        let toolArgs: any = {}

        try {
          toolArgs = JSON.parse(tc.function?.arguments || '{}')
        } catch {
          toolArgs = {}
        }

        const result = await toolRegistry.dispatch(toolName, toolArgs, {
          enabledToolsets: opts.enabledToolsets,
        })

        currentMessages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        })

        // 若工具执行结果包含 continue 指令，可在此处理
        // 例如 memory 工具内部会 refreshMemoryCache()
      }
    } else {
      // 无 tool_calls：对话结束
      return
    }
  }

  // 达到 maxIterations 上限仍未结束
  if (apiCallCount >= opts.maxIterations) {
    yield '\n\n[已达到最大对话轮次限制，请简化问题重试]'
  }
}

// ---- 辅助 ----

export function buildMessages(
  history: { role: 'user' | 'assistant'; content: string }[]
): ChatMessage[] {
  return history.map((m) => ({ role: m.role, content: m.content }))
}
