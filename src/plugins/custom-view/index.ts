// ============================================================
// @amiba/custom-view — 自定义视图服务插件
// ============================================================
// ============================================================

import * as customView from '../../config/custom-view-store'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/custom-view'
export const inject = ['storage']
export const provides = ['customView']

/** `ctx.get('customView')` 返回的服务面。 */
export type AmibaCustomViewService = typeof customView

export function apply(ctx: AmibaContext): void {
  ctx.provide('customView', customView)
}
