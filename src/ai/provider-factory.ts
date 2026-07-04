// ============================================================
// 变形虫 (Amiba) — AI SDK Provider 工厂
// ============================================================
// 根据 baseUrl 自动选择 DeepSeek 或 OpenAI 兼容 provider，
// 统一返回 LanguageModel + providerName，供 streamText / generateText 使用。
// ============================================================

import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

export interface ModelConfig {
  model: LanguageModel
  /** providerOptions 中的 key（如 'deepseek'、'openai'） */
  providerName: string
}

/**
 * 根据 baseUrl 创建对应的 provider 和 model 实例
 * - URL 含 'deepseek' → 使用 @ai-sdk/deepseek（原生推理支持）
 * - 其他 → 使用 @ai-sdk/openai（OpenAI 兼容 API）
 */
export function createModelFromConfig(
  baseUrl: string,
  apiKey: string,
  modelName: string,
): ModelConfig {
  const isDeepSeek = baseUrl.toLowerCase().includes('deepseek')
  const provider = isDeepSeek
    ? createDeepSeek({ baseURL: baseUrl, apiKey })
    : createOpenAI({ baseURL: baseUrl, apiKey })

  return {
    model: provider(modelName),
    providerName: isDeepSeek ? 'deepseek' : 'openai',
  }
}
