// ============================================================
// 变形虫 (Amiba) — 自定义 Agent 管理 Store
// ============================================================
import { reactive, ref, watch } from 'vue'
import { storageGetJSON, storageSetJSON, storageGet, storageSet } from '../config/storage'
import type { CustomAgent } from '../types/service'

const STORAGE_KEY = 'amiba_custom_agents'
const ACTIVE_KEY = 'amiba_active_agent'

export const customAgents = reactive<CustomAgent[]>([])
export const activeAgentId = ref<string | null>(null)

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

  const active = await storageGet(ACTIVE_KEY)
  if (active) activeAgentId.value = active

  // 自动持久化 agent 列表（300ms 防抖）
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

  // 自动持久化 activeAgentId
  watch(activeAgentId, (val) => {
    if (val) storageSet(ACTIVE_KEY, val)
    else storageSet(ACTIVE_KEY, '')
  })
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
  if (activeAgentId.value === id) {
    activeAgentId.value = null
  }
}

export function getCustomAgent(id: string): CustomAgent | undefined {
  return customAgents.find(a => a.id === id)
}

export function setActiveAgent(id: string | null): void {
  activeAgentId.value = id
}
