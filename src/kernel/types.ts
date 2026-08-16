// ============================================================
// Amiba Kernel — 公共类型定义
// ============================================================
// 本目录是插件化内核的最小边界，禁止 import 任何业务模块。
// 允许依赖：js-yaml（通用 YAML 解析）、浏览器/Node 内置对象。
// ============================================================

import type { AmibaContext } from './context'

/** 插件实例 id，kebab-case。 */
export type PluginId = string

/** 插件 kind（与 ADR-0003 保持一致）。 */
export type PluginKind =
  | 'plugin'
  | 'tool-pack'
  | 'preset'
  | 'skill'
  | 'theme'
  | 'locale'
  | 'resource'

/** 插件清单（`amiba.plugin.json` 或 `package.json#amiba`）。 */
export interface PluginManifest {
  apiVersion: number
  id: PluginId
  kind: PluginKind
  entry?: string
  inject?: string[]
  provides?: {
    services?: string[]
    tools?: string[]
    pages?: string[]
    slots?: string[]
    commands?: string[]
  }
  permissions?: {
    allow?: string[]
    deny?: string[]
  }
  config?: {
    schema?: string
    defaults?: Record<string, unknown>
  }
}

/** 权限策略：用户层只能收紧，不能扩大。 */
export interface PermissionPolicy {
  allow?: string[]
  deny?: string[]
}

/** 插件 ESM 模块运行时契约。 */
export interface AmibaPluginModule<Config = Record<string, unknown>> {
  name: string
  inject?: string[]
  /** 本插件会注册到全局服务容器的服务名（供拓扑排序）。 */
  provides?: string[]
  apply: (ctx: AmibaContext, config: Config) => void | Promise<void> | (() => void) | Promise<() => void>
}

/** 插件定义：清单 + 已解析的 ESM 模块。 */
export interface PluginDefinition {
  /** 装配实例 id；与包 id 不同时表示多实例。 */
  instanceId: PluginId
  /** 包/目录 id，来自清单。 */
  pluginId: PluginId
  name: string
  kind: PluginKind
  manifest?: PluginManifest
  module: AmibaPluginModule
  config: Record<string, unknown>
  /** 稳定排序，缺省 0。 */
  order?: number
}

/** 插件实例状态。 */
export type PluginStatus = 'pending' | 'active' | 'failed' | 'disabled' | 'unloaded'

/** loader 返回的运行实例信息。 */
export interface PluginInstanceInfo {
  instanceId: PluginId
  pluginId: PluginId
  name: string
  status: PluginStatus
  error?: string
}

/** 权限检查失败错误。 */
export class PermissionError extends Error {
  readonly pluginId: string
  readonly capability: string
  readonly target?: string

  constructor(pluginId: string, capability: string, target?: string) {
    const suffix = target === undefined ? '' : `:${target}`
    super(`[kernel] 插件 "${pluginId}" 没有权限调用 "${capability}${suffix}"`)
    this.name = 'PermissionError'
    this.pluginId = pluginId
    this.capability = capability
    this.target = target
  }
}
