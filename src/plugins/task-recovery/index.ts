// ============================================================
// @amiba/task-recovery — 任务中断恢复服务插件
// ============================================================
// ============================================================

import { checkRecoveryNeeded, onAppBackground } from '../../ai/task-recovery'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/task-recovery'
export const inject = ['session', 'memory']
export const provides = ['taskRecovery']

export interface AmibaTaskRecoveryService {
  onBackground(): void
  checkRecoveryNeeded(): Promise<void>
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaTaskRecoveryService = {
    onBackground: () => onAppBackground(),
    checkRecoveryNeeded: async () => {
      await checkRecoveryNeeded()
    },
  }
  ctx.provide('taskRecovery', service)
}
