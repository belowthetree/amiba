// ============================================================
// @amiba/storage — 低层存储服务插件
// ============================================================
// 包装现有 config/storage.ts；不改变任何存储语义。
// 后续 domain repository（session/memory/skill）必须经此服务，
// 不得再直接 import config/storage。
// ============================================================

import * as storage from '../../config/storage'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/storage'
export const inject = ['platform']
export const provides = ['storage']

/** `ctx.get('storage')` 返回的服务面：与 config/storage.ts 完全一致。 */
export type AmibaStorageService = typeof storage

export async function apply(ctx: AmibaContext): Promise<void> {
  await storage.initStorage()
  ctx.provide('storage', storage)
}
