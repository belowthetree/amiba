// ============================================================
// @amiba/theme — 主题服务插件
// ============================================================
// ============================================================

import * as theme from '../../config/theme-store'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/theme'
export const inject = ['storage', 'settings']
export const provides = ['theme']

/** `ctx.get('theme')` 返回的服务面。 */
export type AmibaThemeService = typeof theme

export function apply(ctx: AmibaContext): void {
  ctx.provide('theme', theme)
}
