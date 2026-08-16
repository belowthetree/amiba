// ============================================================
// @amiba/memory — 记忆存储服务插件
// ============================================================
// 包装现有 memoryStore 单例；init() 仍由 legacy-bootstrap
// 在原 Promise.all 位置调用，保持启动时序不变。
// ============================================================

import { memoryStore } from '../../ai/memory-store'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/memory'
export const inject = ['storage']
export const provides = ['memory']

/** `ctx.get('memory')` 返回的服务面：与 memoryStore 单例一致。 */
export type AmibaMemoryService = typeof memoryStore

export function apply(ctx: AmibaContext): void {
  ctx.provide('memory', memoryStore)
}
