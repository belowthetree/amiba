// ============================================================
// @amiba/i18n — 国际化服务插件
// ============================================================
// ============================================================

import { i18n, syncI18nWithSettings } from '../../i18n'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/i18n'
export const inject = ['settings']
export const provides = ['i18n']

export interface AmibaI18nService {
  instance: typeof i18n
  sync(): void
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaI18nService = {
    instance: i18n,
    sync: () => syncI18nWithSettings(),
  }
  ctx.provide('i18n', service)
}
