// ============================================================
// 变形虫 (Amiba) — AI 任务中断恢复
// ============================================================
// App 切后台时保存中断快照，回前台时 ChatPage 在最后一条
// assistant 消息旁显示刷新按钮，点击后重新发送前文获取新输出。
// ============================================================

import { running } from './agent-runner'
import { getCurrentSessionId, flushHistory } from './session'
import { storageSetJSON, storageGetJSON } from '../config/storage'

const RECOVERY_KEY = 'recovery/current_task'

// ---- 类型 ----

export interface TaskSnapshot {
  /** 被中断时所在的 session ID */
  sessionId: string
  /** 中断发生时间（ISO 8601） */
  interruptedAt: string
}

// ---- App 进入后台时调用 ----

export async function onAppBackground(): Promise<void> {
  console.log('[TaskRecovery] onAppBackground 触发, running=', running.value)

  if (!running.value) {
    console.log('[TaskRecovery] 无运行中的 AI 任务，跳过快照')
    return
  }

  const sessionId = getCurrentSessionId()
  if (!sessionId) {
    console.log('[TaskRecovery] 无活跃 session，跳过快照')
    return
  }

  const snapshot: TaskSnapshot = {
    sessionId,
    interruptedAt: new Date().toISOString(),
  }

  // 1. 强制刷新所有未保存消息到磁盘（跳过 debounce）
  await flushHistory()

  // 2. 保存中断快照
  await storageSetJSON(RECOVERY_KEY, snapshot)

  console.log('[TaskRecovery] ✓ 中断快照已保存:', snapshot)
}

// ---- App 回到前台时调用 ----

/** 检查是否有待恢复的中断任务，有则返回快照 */
export async function checkRecoveryNeeded(): Promise<TaskSnapshot | null> {
  const snapshot = await storageGetJSON<TaskSnapshot>(RECOVERY_KEY)
  if (!snapshot) {
    console.log('[TaskRecovery] 无中断快照')
    return null
  }

  console.log('[TaskRecovery] === 检测到中断快照 ===', snapshot)
  return snapshot
}

/** 清除中断快照 */
export async function clearSnapshot(): Promise<void> {
  await storageSetJSON(RECOVERY_KEY, null)
  console.log('[TaskRecovery] 中断快照已清除')
}
