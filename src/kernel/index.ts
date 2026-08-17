// ============================================================
// Amiba Kernel — 公共入口
// ============================================================
// P1 第 1 步：仅导出内核机制，未接入 main.ts，不影响现有功能。
// ============================================================

export { AmibaContext, createRootContext } from './context'
export type { AmibaContextOptions, EffectDisposer, KernelEnv } from './context'

export { EventBus, nextScopeId } from './events'
export type { EventListener, WaterfallListener } from './events'

export { ConsoleLogger, createLogger } from './logger'
export type { LogLevel, Logger, LoggerOptions } from './logger'

export { PermissionError, PermissionManager, capabilityMatches } from './permissions'
export type { PermissionAudit, PermissionManagerOptions } from './permissions'

export {
  CompositionError,
  enabledEntries,
  isCompositionAction,
  normalizeLayer,
  parseCompositionYaml,
  resolveComposition,
} from './composition'
export type {
  CompositionAction,
  CompositionEntry,
  CompositionLayer,
  InsertAction,
  ModifyAction,
  RemoveAction,
} from './composition'

export { KernelLoader, isPluginManifest } from './loader'
export type { KernelLoaderOptions } from './loader'

export { startKernel } from './start'
export type { StartKernelResult } from './start'

export { kernelState, recordPermissionAudit } from './state'
export type { KernelAuditEntry } from './state'

export type {
  AmibaPluginModule,
  PermissionPolicy,
  PluginDefinition,
  PluginId,
  PluginInstanceInfo,
  PluginKind,
  PluginManifest,
  PluginStatus,
} from './types'
