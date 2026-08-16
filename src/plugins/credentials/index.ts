// ============================================================
// @amiba/credentials — 凭据访问服务插件
// ============================================================
// 本阶段不迁移存储格式，只收口访问：
//   - settings.api_key            ref: "default" / "settings.api_key" / "DEEPSEEK_API_KEY"
//   - providers[id].apiKey        ref: "provider:<id>"（或直接传 provider id）
// 后续再改为独立 credentials 存储，调用方无需变化。
// ============================================================

import type { AmibaContext } from '../../kernel'
import type { AmibaSettingsService } from '../settings'
import type { AmibaModelProvidersService } from '../model-providers'

export const name = '@amiba/credentials'
export const inject = ['settings', 'modelProviders']
export const provides = ['credentials']

export type CredentialRef = string

export interface CredentialRecord {
  ref: CredentialRef
  value: string | undefined
  source: 'settings' | 'provider'
}

/** `ctx.get('credentials')` 返回的服务面。 */
export interface AmibaCredentialsService {
  resolve(ref: CredentialRef): Promise<CredentialRecord | undefined>
  has(ref: CredentialRef): Promise<boolean>
  set(ref: CredentialRef, value: string): Promise<void>
  clear(ref: CredentialRef): Promise<void>
}

const SETTINGS_REFS = new Set(['default', 'settings.api_key', 'DEEPSEEK_API_KEY'])

function providerIdOf(ref: CredentialRef): string | undefined {
  if (ref.startsWith('provider:')) return ref.slice('provider:'.length)
  return undefined
}

export function apply(ctx: AmibaContext): void {
  const settingsService = ctx.get<AmibaSettingsService>('settings')
  const modelProviderService = ctx.get<AmibaModelProvidersService>('modelProviders')
  if (!settingsService || !modelProviderService) {
    throw new Error('[credentials] 缺少 settings / modelProviders 服务')
  }
  // 复制为非空局部引用，便于在嵌套函数中稳定收窄。
  const settings = settingsService
  const modelProviders = modelProviderService

  function readProviderApiKey(providerId: string): { value: string | undefined; source: 'provider' } | undefined {
    const provider = modelProviders.get(providerId)
    return provider ? { value: provider.apiKey, source: 'provider' as const } : undefined
  }

  async function resolveRef(ref: CredentialRef): Promise<CredentialRecord | undefined> {
    if (SETTINGS_REFS.has(ref)) {
      return { ref, value: settings.state.api_key, source: 'settings' }
    }
    const providerId = providerIdOf(ref) ?? ref
    const record = readProviderApiKey(providerId)
    return record ? { ref, ...record } : undefined
  }

  async function setRef(ref: CredentialRef, value: string): Promise<void> {
    if (SETTINGS_REFS.has(ref)) {
      settings.update({ api_key: value })
      return
    }
    const providerId = providerIdOf(ref)
    if (!providerId) throw new Error(`[credentials] 未知凭据引用: ${ref}`)
    modelProviders.update(providerId, { apiKey: value })
  }

  const service: AmibaCredentialsService = {
    resolve: (ref) => resolveRef(ref),
    has: async (ref) => {
      const record = await resolveRef(ref)
      return record !== undefined && record.value !== undefined && record.value.length > 0
    },
    set: (ref, value) => setRef(ref, value),
    clear: (ref) => setRef(ref, ''),
  }

  ctx.provide('credentials', service)
}
