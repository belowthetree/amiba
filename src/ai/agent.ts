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

// ---- Nudge 配置 ----
const NUDGE_INTERVAL = 10 // 每 N 轮提示一次记忆保存

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
  /** 附加到 system prompt 的技能索引文本（可选） */
  skillIndex?: string
}

const DEFAULT_OPTIONS: Required<StreamChatOptions> = {
  enabledToolsets: ['chat'],
  maxIterations: 25,
  maxContextTokens: 128_000,
  skillIndex: '',
}

// ---- System Prompt ----

export function createSystemPrompt(skillIndex?: string, turnCount?: number): string {
  const memCtx = memoryStore.getContextForPrompt()

  let prompt = `你是变形虫 (Amiba) 平台的 AI 助手。你可以帮助用户完成各种任务，包括使用工具保存记忆。

## 当前平台信息
- 变形虫是一个跨平台应用，允许用户使用 AI 自由生成类似小程序的即时应用
- 内置功能: 首页、AI 对话、AI 生成服务、设置、我的服务、记忆管理
- 用户生成的服务运行在安全的 iframe 沙箱中

${memCtx}`

  // 注入技能索引（若有）
  if (skillIndex) {
    prompt += `\n\n## 可用技能\n以下是用户已安装的技能，可通过 /name 触发：\n${skillIndex}`
  }

  // Nudge 提示：每隔 N 轮提醒 AI 可以保存记忆
  if (turnCount !== undefined && turnCount > 0 && turnCount % NUDGE_INTERVAL === 0) {
    prompt += `\n\n[提示：当前已是第 ${turnCount} 轮对话。如果对话中出现了值得长期保存的信息，可以用 memory 工具保存。]`
  }

  prompt += `\n\n请用中文回复，保持简洁有帮助。`
  return prompt
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
  const apiKey = await getApiKey()

  if (!apiKey) {
    yield '请先在设置中配置 API Key。\n'
    return
  }

  // Refresh memory cache
  await memoryStore.init()

  const client = new OpenAI({
    baseURL: s.ai_base_url,
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  })

  // 获取工具 schemas
  const toolSchemas = getToolDefinitions(opts.enabledToolsets)
  const hasTools = toolSchemas.length > 0

  const systemMsg: ChatMessage = {
    role: 'system',
    content: createSystemPrompt(opts.skillIndex),
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
      // 保留 system + 最后 4 条消息
      const keep = Math.max(2, currentMessages.length - 4)
      currentMessages = [
        currentMessages[0],
        ...currentMessages.slice(keep),
      ]
    }

    const stream = await client.chat.completions.create({
      model: s.ai_model,
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
