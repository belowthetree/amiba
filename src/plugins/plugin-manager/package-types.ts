// ============================================================
// @amiba/plugin-manager — 统一插件包格式
// ============================================================
import type { PluginManifest } from '../../kernel'

export type ServicePermission =
  | 'storage'
  | 'notification'
  | 'widgets'
  | 'network'
  | 'background'
  | 'fileAccess'
  | 'fetch'
  | 'ai'
  | 'tools'
  | 'desktopWidgets'

/** 统一包：一个 zip 可同时携带宿主插件与沙箱服务。 */
export interface AmibaPackageManifest extends PluginManifest {
  /** 包版本。 */
  version: string
  description?: string
  /** 预编译插件 bundle 文件，默认 plugin.js。 */
  pluginEntry?: string
  /** 可选沙箱服务部分。 */
  service?: {
    enabled: boolean
    /** 服务入口，如 index.html。 */
    entry: string
    permissions: ServicePermission[]
    /** 可选服务名，默认 id。 */
    name?: string
  }
}

export interface InstalledPluginRecord {
  id: string
  version: string
  installedAt: string
  files: Record<string, string>
  permissions?: PluginManifest['permissions']
}
