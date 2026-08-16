// ============================================================
// @amiba/session — 会话管理服务插件
// ============================================================
// 包装现有 ai/session.ts；本阶段只注册服务，不改变内部实现。
// ============================================================

import * as session from '../../ai/session'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/session'
export const inject = ['storage']
export const provides = ['session']

/** `ctx.get('session')` 返回的服务面：与 ai/session.ts 完全一致。 */
export type AmibaSessionService = typeof session

export function apply(ctx: AmibaContext): void {
  ctx.provide('session', session)
}
