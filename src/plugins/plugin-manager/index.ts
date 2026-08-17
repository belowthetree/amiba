// ============================================================
// @amiba/plugin-manager — 插件管理服务插件
// ============================================================
import type { AmibaContext } from '../../kernel'
import { pluginManagerService } from './service'
import { ensureRuntimeLoader } from './runtime-loader'

export const name = '@amiba/plugin-manager'
export const inject: string[] = []
export const provides = ['pluginManager']

export type { LocalPluginView } from './service'
export { PluginManagerService, pluginManagerService } from './service'

export function apply(ctx: AmibaContext): void {
  ensureRuntimeLoader()
  ctx.provide('pluginManager', pluginManagerService)
}
