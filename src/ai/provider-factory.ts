// ============================================================
// 变形虫 (Amiba) — AI SDK Provider 工厂
// ============================================================
// 根据 baseUrl + 协议自动选择 DeepSeek / OpenAI 兼容 provider，
// 统一返回 LanguageModel + providerName，供 streamText / generateText 使用。
//
// 协议说明：
//   chat      — Chat Completions（默认）。DeepSeek 走 @ai-sdk/deepseek（原生推理支持）
//   responses — OpenAI 兼容 Responses API。DeepSeek 的 Responses 端点与 OpenAI 线格式兼容
//               （POST {baseUrl}/responses，不支持的参数静默忽略），经 @ai-sdk/openai 的
//               .responses() 接入；服务端 web_search 仅由此协议提供，且 DeepSeek 侧仅支持
//               v4 模型（v4-flash / v4-pro）
// ============================================================

import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { AiProvider } from '../types/service'

export interface ModelConfig {
  model: LanguageModel
  /** providerOptions 中的 key（如 'deepseek'、'openai'） */
  providerName: string
}

/**
 * 根据 baseUrl + 协议创建对应的 provider 和 model 实例
 * - protocol 'responses' → @ai-sdk/openai 的 Responses 模型（DeepSeek/OpenAI 均兼容）
 * - URL 含 'deepseek' → @ai-sdk/deepseek（chat 协议）
 * - 其他 → @ai-sdk/openai（chat 协议）
 */
export function createModelFromConfig(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  protocol: NonNullable<AiProvider['protocol']> = 'chat',
): ModelConfig {
  if (protocol === 'responses') {
    const provider = createOpenAI({ baseURL: baseUrl, apiKey })
    return {
      model: provider.responses(modelName),
      providerName: 'openai',
    }
  }

  const isDeepSeek = baseUrl.toLowerCase().includes('deepseek')
  const provider = isDeepSeek
    ? createDeepSeek({ baseURL: baseUrl, apiKey })
    : createOpenAI({ baseURL: baseUrl, apiKey })

  return {
    model: provider(modelName),
    providerName: isDeepSeek ? 'deepseek' : 'openai',
  }
}

/**
 * 服务端联网搜索工具（provider-executed）：responses 协议时返回可并入 streamText
 * tools 表的工具映射（键名 web_search），否则返回 null。
 * 线格式 {"type":"web_search"} 与 DeepSeek Responses 期望一致；SDK 内置解析
 * response.web_search_call.* 流事件与 web_search_call 输入项回放。工具由服务端执行，
 * 不经 ToolRegistry、不占本地工具轮次上限。
 */
export function createWebSearchTool(
  baseUrl: string,
  apiKey: string,
  protocol: NonNullable<AiProvider['protocol']>,
): Record<string, any> | null {
  if (protocol !== 'responses') return null
  const provider = createOpenAI({ baseURL: baseUrl, apiKey })
  return { web_search: provider.tools.webSearch() }
}
