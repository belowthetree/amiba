// ============================================================
// @amiba/sdk — 插件开发 SDK
// ============================================================
// 供第三方插件在编译期使用；本文件不会进入任何运行路径。
// ============================================================

import type { AmibaContext, AmibaPluginModule } from '../kernel'

export type {
  AmibaContext,
  AmibaContextOptions,
  AmibaPluginModule,
  KernelLoaderOptions,
  LogLevel,
  Logger,
  PermissionPolicy,
  PluginDefinition,
  PluginId,
  PluginInstanceInfo,
  PluginKind,
  PluginManifest,
  PluginStatus,
} from '../kernel'

export type {
  UISlotEntry,
  UISlotHandle,
  UISlotMap,
  UISlotName,
  UISlotRegistration,
} from '../plugins/ui-slots'

export type {
  PageEntry,
  PageHandle,
  PageRegistration,
} from '../plugins/page-registry'

/**
 * 类型化插件定义助手。
 * 开发期执行轻量校验：name / inject / provides / apply 必须合法。
 */
export function defineAmibaPlugin<Config = Record<string, unknown>>(
  plugin: AmibaPluginModule<Config>,
): AmibaPluginModule<Config> {
  if (typeof plugin.name !== 'string' || plugin.name.trim() === '') {
    throw new Error('[sdk] 插件必须提供非空 name')
  }
  if (plugin.inject !== undefined && (!Array.isArray(plugin.inject) || plugin.inject.some((item) => typeof item !== 'string'))) {
    throw new Error('[sdk] inject 必须是 string[]')
  }
  if (plugin.provides !== undefined && (!Array.isArray(plugin.provides) || plugin.provides.some((item) => typeof item !== 'string'))) {
    throw new Error('[sdk] provides 必须是 string[]')
  }
  if (typeof plugin.apply !== 'function') {
    throw new Error('[sdk] 插件必须提供 apply(ctx, config)')
  }
  return plugin
}
