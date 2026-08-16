// ============================================================
// @amiba/toolsets — 工具集服务插件
// ============================================================
// 包装现有 tools/toolsets.ts；后续工具集定义也应注册化。
// ============================================================

import * as toolsets from '../../tools/toolsets'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/toolsets'
export const inject = ['toolRegistry']
export const provides = ['toolsets']

/** `ctx.get('toolsets')` 返回的服务面：与 tools/toolsets.ts 完全一致。 */
export type AmibaToolsetsService = typeof toolsets

export function apply(ctx: AmibaContext): void {
  ctx.provide('toolsets', toolsets)
}
