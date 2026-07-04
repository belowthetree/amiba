// ============================================================
// 变形虫 (Amiba) — 自定义 Agent 管理 Store
// ============================================================
import { reactive } from 'vue'
import { storageGetJSON, storageSetJSON } from '../config/storage'
import { settings } from '../config/config'
import type { CustomAgent } from '../types/service'

const STORAGE_KEY = 'amiba_custom_agents'

export const customAgents = reactive<CustomAgent[]>([])

let initialized = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

// ---- 初始化 ----

export async function initCustomAgentStore(): Promise<void> {
  if (initialized) return
  initialized = true

  const saved = await storageGetJSON<CustomAgent[]>(STORAGE_KEY)
  if (saved && Array.isArray(saved)) {
    customAgents.splice(0, customAgents.length, ...saved)
  }

  // 自动持久化 agent 列表（300ms 防抖）
  const { watch } = await import('vue')
  watch(
    () => customAgents.map(a => ({ ...a })),
    () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        storageSetJSON(STORAGE_KEY, [...customAgents])
      }, 300)
    },
    { deep: true }
  )
}

// ---- CRUD ----

export function addCustomAgent(a: CustomAgent): void {
  if (customAgents.some(existing => existing.id === a.id)) {
    throw new Error(`Agent ID "${a.id}" 已存在`)
  }
  customAgents.push({ ...a })
}

export function updateCustomAgent(id: string, patch: Partial<CustomAgent>): void {
  const idx = customAgents.findIndex(a => a.id === id)
  if (idx === -1) throw new Error(`Agent "${id}" 不存在`)
  if (patch.id && patch.id !== id && customAgents.some(a => a.id === patch.id)) {
    throw new Error(`Agent ID "${patch.id}" 已存在`)
  }
  Object.assign(customAgents[idx], patch)
}

export function deleteCustomAgent(id: string): void {
  const idx = customAgents.findIndex(a => a.id === id)
  if (idx === -1) throw new Error(`Agent "${id}" 不存在`)
  customAgents.splice(idx, 1)
  if (settings.active_agent_id === id) {
    settings.active_agent_id = ''
  }
}

export function getCustomAgent(id: string): CustomAgent | undefined {
  return customAgents.find(a => a.id === id)
}

export function setActiveAgent(id: string | null): void {
  settings.active_agent_id = id || ''
}
