// ============================================================
// @amiba/soul — 人格系统服务插件
// ============================================================
// ============================================================

import { soulManager } from '../../ai/soul'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/soul'
export const inject = ['storage']
export const provides = ['soul']

/** `ctx.get('soul')` 返回的服务面。 */
export type AmibaSoulService = typeof soulManager

export function apply(ctx: AmibaContext): void {
  ctx.provide('soul', soulManager)
}
