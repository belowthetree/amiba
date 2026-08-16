// ============================================================
// @amiba/settings — 统一设置服务插件
// ============================================================
// 包装现有 config/config.ts 的 reactive settings 单例。
// 当前保持兼容：其他业务模块仍可直接 import settings；
// 后续逐步改为 ctx.get('settings') 并注册命名空间。
// ============================================================

import { getSettings, initConfig, settings, updateSettings } from '../../config/config'
import type { AppSettings } from '../../types/service'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/settings'
export const inject = ['storage']
export const provides = ['settings']

/** `ctx.get('settings')` 返回的服务面。 */
export interface AmibaSettingsService {
  /** 响应式设置状态（当前与 config.ts 的 settings 是同一实例）。 */
  state: AppSettings
  init(): Promise<void>
  get(): AppSettings
  update(patch: Partial<AppSettings>): void
}

export async function apply(ctx: AmibaContext): Promise<void> {
  await initConfig()

  const service: AmibaSettingsService = {
    state: settings as AppSettings,
    init: () => initConfig(),
    get: () => getSettings(),
    update: (patch) => updateSettings(patch),
  }
  ctx.provide('settings', service)
}
