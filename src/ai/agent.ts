// ============================================================
// 变形虫 (Amiba) — LLM Agent (OpenAI 兼容流式对话)
// ============================================================
import OpenAI from 'openai'
import { getSettings, getApiKey } from '../config/config'
import { getMemoryContextForPrompt } from './memory'
import type { MemoryToolParams } from '../types/service'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: any[]
  tool_call_id?: string
}

// Tool definition for memory
const MEMORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'memory',
    description:
      '保存跨会话的持久记忆。MEMORY.md 存 AI 笔记，USER.md 存用户画像。条目用 § 分隔，字符有限额。满时需分批删除旧条目再加新条目。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'replace', 'remove'],
          description: '单操作时使用。批量时用 operations 字段。',
        },
        target: {
          type: 'string',
          enum: ['memory', 'user'],
          description: '写入目标',
        },
        content: {
          type: 'string',
          description: 'add/replace 时的内容',
        },
        old_text: {
          type: 'string',
          description: 'replace/remove 时用于匹配的子串',
        },
        operations: {
          type: 'array',
          description: '批量操作 [{action, content?, old_text?}]，原子执行',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'replace', 'remove'] },
              content: { type: 'string' },
              old_text: { type: 'string' },
            },
            required: ['action'],
          },
        },
      },
      required: ['target'],
    },
  },
}

export function createSystemPrompt(): string {
  const memCtx = getMemoryContextForPrompt()
  return `你是变形虫 (Amiba) 平台的 AI 助手。你可以帮助用户完成各种任务，包括使用工具保存记忆。

## 当前平台信息
- 变形虫是一个跨平台应用，允许用户使用 AI 自由生成类似小程序的即时应用
- 内置功能: 首页、AI 对话、AI 生成服务、设置、我的服务、记忆管理
- 用户生成的服务运行在安全的 iframe 沙箱中

${memCtx}

请用中文回复，保持简洁有帮助。`
}

export async function* streamChat(
  messages: ChatMessage[],
  onMemoryCall?: (params: MemoryToolParams) => Promise<string>
): AsyncGenerator<string> {
  const s = getSettings()
  const apiKey = getApiKey()

  if (!apiKey) {
    yield '请先在设置中配置 API Key。\n'
    return
  }

  const client = new OpenAI({
    baseURL: s.ai_base_url,
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  })

  const systemMsg: ChatMessage = {
    role: 'system',
    content: createSystemPrompt(),
  }

  const allMessages = [systemMsg, ...messages]

  let loop = true
  let currentMessages = [...allMessages]

  while (loop) {
    const stream = await client.chat.completions.create({
      model: s.ai_model,
      messages: currentMessages as any,
      stream: true,
      tools: [MEMORY_TOOL] as any,
      tool_choice: 'auto',
    })

    let fullContent = ''
    let toolCalls: any[] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      // Text content
      if (delta?.content) {
        fullContent += delta.content
        yield delta.content
      }

      // Tool calls
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
            if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name
            if (tc.function?.arguments)
              toolCalls[tc.index].function.arguments += tc.function.arguments
          }
        }
      }

      if (chunk.choices[0]?.finish_reason === 'tool_calls') {
        // Tool call detected
        break
      }

      if (chunk.choices[0]?.finish_reason === 'stop') {
        loop = false
        break
      }
    }

    // Process tool calls
    toolCalls = toolCalls.filter(Boolean)
    if (toolCalls.length > 0) {
      // Add assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCalls,
      })

      for (const tc of toolCalls) {
        if (tc.function.name === 'memory' && onMemoryCall) {
          try {
            const params = JSON.parse(tc.function.arguments) as MemoryToolParams
            const result = await onMemoryCall(params)
            currentMessages.push({
              role: 'tool',
              content: result,
              tool_call_id: tc.id,
            })
          } catch (e: any) {
            currentMessages.push({
              role: 'tool',
              content: `Error: ${e.message}`,
              tool_call_id: tc.id,
            })
          }
        } else {
          currentMessages.push({
            role: 'tool',
            content: 'Unknown tool',
            tool_call_id: tc.id,
          })
        }
      }
    } else {
      loop = false
    }
  }
}

export function buildMessages(
  history: { role: 'user' | 'assistant'; content: string }[]
): ChatMessage[] {
  return history.map((m) => ({ role: m.role, content: m.content }))
}
