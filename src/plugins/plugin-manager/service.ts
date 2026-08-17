// ============================================================
// @amiba/plugin-manager — 插件管理服务（只读运行时视图）
// ============================================================
import type { PermissionPolicy, PluginInstanceInfo } from '../../kernel'
import { kernelState } from '../../kernel/state'
import { userPluginDefinitions } from '../user-registry.generated'
import {
  installPluginPackage,
  restoreInstalledPlugins,
  uninstallPluginPackage,
} from './installer'
import type { InstallResult } from './installer'

export interface LocalPluginView {
  id: string
  name: string
  kind: string
  order: number
  config: Record<string, unknown>
}

export class PluginManagerService {
  listInstances(): PluginInstanceInfo[] {
    return kernelState.loader?.listInstances() ?? []
  }

  listLocalPlugins(): LocalPluginView[] {
    return userPluginDefinitions.map((definition) => ({
      id: definition.instanceId,
      name: definition.name,
      kind: definition.kind,
      order: definition.order ?? 1000,
      config: { ...definition.config },
    }))
  }

  isLocalPluginEnabled(id: string): boolean {
    return this.listLocalPlugins().some((plugin) => plugin.id === id)
  }

  listPolicies(): Array<{ pluginId: string; policy: PermissionPolicy }> {
    return kernelState.loader?.permissions.listPolicies() ?? []
  }

  getAuditLog() {
    return [...kernelState.auditLog]
  }

  installFromBuffer(data: ArrayBuffer | Uint8Array): Promise<InstallResult> {
    return installPluginPackage(data)
  }

  async installFromFile(file: File): Promise<InstallResult> {
    return installPluginPackage(await file.arrayBuffer())
  }

  uninstall(id: string): Promise<void> {
    return uninstallPluginPackage(id)
  }

  restore(): Promise<void> {
    return restoreInstalledPlugins()
  }
}

export const pluginManagerService = new PluginManagerService()
