// ============================================================
// Amiba Kernel — 全局内核状态（供 UI 诊断/市场读取）
// ============================================================
import { reactive } from 'vue'
import type { PermissionAudit } from './permissions'
import type { KernelLoader } from './loader'

export interface KernelAuditEntry extends PermissionAudit {}

export const kernelState = reactive({
  loader: undefined as KernelLoader | undefined,
  auditLog: [] as KernelAuditEntry[],
})

/** 记录权限审计；最多保留 500 条，避免无界增长。 */
export function recordPermissionAudit(audit: PermissionAudit): void {
  kernelState.auditLog.push(audit)
  if (kernelState.auditLog.length > 500) {
    kernelState.auditLog.splice(0, kernelState.auditLog.length - 500)
  }
}
