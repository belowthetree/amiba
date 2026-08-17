// ============================================================
// @amiba/page-registry — 页面注册表服务插件
// ============================================================
import type { AmibaContext } from '../../kernel'
import { pageRegistry } from './instance'
import { PageRegistry } from './registry'

export const name = '@amiba/page-registry'
export const inject: string[] = []
export const provides = ['pageRegistry']

export type { PageEntry, PageHandle, PageRegistration } from './registry'
export { PageRegistry } from './registry'
export { pageRegistry } from './instance'

export function apply(ctx: AmibaContext): void {
  ctx.provide('pageRegistry', pageRegistry)
}
