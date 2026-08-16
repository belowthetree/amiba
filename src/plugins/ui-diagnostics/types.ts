// ============================================================
// @amiba/ui-diagnostics — 公共类型
// ============================================================
import type { EventBus, PluginInstanceInfo } from '../../kernel'

/** 诊断数据源：未来直接传 KernelLoader（结构兼容）。 */
export interface KernelDiagnosticsSource {
  listInstances(): PluginInstanceInfo[]
  bus: EventBus
}
