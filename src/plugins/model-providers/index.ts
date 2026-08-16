// ============================================================
// @amiba/model-providers — AI 供应商与模型工厂服务插件
// ============================================================
// 包装 ai/provider-store.ts、provider-factory.ts、api-check.ts。
// 现有其他模块仍可 import 原路径；后续逐步改为 ctx.get('modelProviders')。
// ============================================================

import {
  addProvider,
  deleteProvider,
  getActiveProviders,
  getProvider,
  initProviderStore,
  providers,
  updateProvider,
} from '../../ai/provider-store'
import { createModelFromConfig, createWebSearchTool } from '../../ai/provider-factory'
import { testApiConnection } from '../../ai/api-check'
import type { AiProvider } from '../../types/service'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/model-providers'
export const inject = ['settings']
export const provides = ['modelProviders']

/** `ctx.get('modelProviders')` 返回的服务面。 */
export interface AmibaModelProvidersService {
  state: AiProvider[]
  init(): Promise<void>
  list(): AiProvider[]
  get(id: string): AiProvider | undefined
  add(provider: AiProvider): void
  update(id: string, patch: Partial<AiProvider>): void
  remove(id: string): void
  createModel(baseUrl: string, apiKey: string, modelName: string, protocol?: NonNullable<AiProvider['protocol']>): ReturnType<typeof createModelFromConfig>
  createWebSearchTool(baseUrl: string, apiKey: string, protocol: NonNullable<AiProvider['protocol']>): ReturnType<typeof createWebSearchTool>
  testApiConnection(baseUrl: string, apiKey: string, model: string, timeoutMs?: number, protocol?: 'chat' | 'responses'): ReturnType<typeof testApiConnection>
}

export async function apply(ctx: AmibaContext): Promise<void> {
  await initProviderStore()

  const service: AmibaModelProvidersService = {
    state: providers as AiProvider[],
    init: () => initProviderStore(),
    list: () => getActiveProviders(),
    get: (id) => getProvider(id),
    add: (provider) => addProvider(provider),
    update: (id, patch) => updateProvider(id, patch),
    remove: (id) => deleteProvider(id),
    createModel: (baseUrl, apiKey, modelName, protocol) => createModelFromConfig(baseUrl, apiKey, modelName, protocol),
    createWebSearchTool: (baseUrl, apiKey, protocol) => createWebSearchTool(baseUrl, apiKey, protocol),
    testApiConnection: (baseUrl, apiKey, model, timeoutMs, protocol) => testApiConnection(baseUrl, apiKey, model, timeoutMs, protocol),
  }
  ctx.provide('modelProviders', service)
}
