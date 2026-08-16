// ============================================================
// Amiba — 内置插件注册表（P1 组合入口）
// ============================================================
// 只声明“装哪些插件、按什么顺序”，不执行任何业务。
// 后续接入 amiba.plugins.yaml 时，本表作为最低优先级的 base 层。
// ============================================================

import type { AmibaPluginModule, PluginDefinition, PluginManifest } from '../kernel'
import * as platform from './platform'
import * as storage from './storage'
import * as settings from './settings'
import * as toolRegistry from './tool-registry'
import * as toolsets from './toolsets'
import * as modelProviders from './model-providers'
import * as credentials from './credentials'
import * as session from './session'
import * as memory from './memory'
import * as uiShell from './ui-shell'
import * as uiDiagnostics from './ui-diagnostics'
import * as legacyBootstrap from './legacy-bootstrap'
import platformManifest from './platform/amiba.plugin.json'
import storageManifest from './storage/amiba.plugin.json'
import settingsManifest from './settings/amiba.plugin.json'
import toolRegistryManifest from './tool-registry/amiba.plugin.json'
import toolsetsManifest from './toolsets/amiba.plugin.json'
import modelProvidersManifest from './model-providers/amiba.plugin.json'
import credentialsManifest from './credentials/amiba.plugin.json'
import sessionManifest from './session/amiba.plugin.json'
import memoryManifest from './memory/amiba.plugin.json'
import uiShellManifest from './ui-shell/amiba.plugin.json'
import uiDiagnosticsManifest from './ui-diagnostics/amiba.plugin.json'
import legacyBootstrapManifest from './legacy-bootstrap/amiba.plugin.json'

interface BuiltinPluginRegistration {
  module: AmibaPluginModule
  manifest: PluginManifest
  order: number
}

const BUILTIN_PLUGINS: BuiltinPluginRegistration[] = [
  { module: platform, manifest: platformManifest as unknown as PluginManifest, order: 10 },
  { module: storage, manifest: storageManifest as unknown as PluginManifest, order: 20 },
  { module: settings, manifest: settingsManifest as unknown as PluginManifest, order: 30 },
  { module: toolRegistry, manifest: toolRegistryManifest as unknown as PluginManifest, order: 35 },
  { module: toolsets, manifest: toolsetsManifest as unknown as PluginManifest, order: 36 },
  { module: modelProviders, manifest: modelProvidersManifest as unknown as PluginManifest, order: 38 },
  { module: credentials, manifest: credentialsManifest as unknown as PluginManifest, order: 39 },
  { module: uiShell, manifest: uiShellManifest as unknown as PluginManifest, order: 40 },
  { module: session, manifest: sessionManifest as unknown as PluginManifest, order: 42 },
  { module: memory, manifest: memoryManifest as unknown as PluginManifest, order: 43 },
  { module: uiDiagnostics, manifest: uiDiagnosticsManifest as unknown as PluginManifest, order: 50 },
  { module: legacyBootstrap, manifest: legacyBootstrapManifest as unknown as PluginManifest, order: 90 },
]

/** 生成 base 装配层的插件定义。 */
export function builtinPluginDefinitions(): PluginDefinition[] {
  return BUILTIN_PLUGINS.map((registration) => ({
    instanceId: registration.manifest.id,
    pluginId: registration.manifest.id,
    name: registration.module.name,
    kind: registration.manifest.kind,
    manifest: registration.manifest,
    module: registration.module,
    config: { ...(registration.manifest.config?.defaults ?? {}) },
    order: registration.order,
  }))
}
