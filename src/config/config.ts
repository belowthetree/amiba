// ============================================================
// 变形虫 (Amiba) — 统一配置
// ============================================================
import { reactive, watch } from 'vue'
import { storageGetJSON, storageSetJSON, storageGet, storageSet } from './storage'
import type { AppSettings } from '../types/service'

const STORAGE_KEY = 'amiba_settings'
const API_KEY_KEY = 'amiba_api_key'

const defaults: AppSettings = {
  ai_base_url: 'https://api.deepseek.com/v1',
  ai_model: 'deepseek-v4-flash',
  ai_generation_model: 'deepseek-v4-flash',
  theme_mode: 'system',
  language: 'zh-CN',
}

export const settings = reactive<AppSettings>({ ...defaults })

// Async init
let initialized = false

export async function initConfig(): Promise<void> {
  if (initialized) return
  initialized = true

  const saved = await storageGetJSON<AppSettings>(STORAGE_KEY)
  if (saved) {
    Object.assign(settings, defaults, saved)
  }

  // Start watching for changes
  let saveTmr: ReturnType<typeof setTimeout> | null = null
  watch(
    () => ({ ...settings }),
    (val) => {
      if (saveTmr) clearTimeout(saveTmr)
      saveTmr = setTimeout(() => storageSetJSON(STORAGE_KEY, val), 300)
    },
    { deep: true }
  )
}

export function getSettings(): AppSettings {
  return { ...settings }
}

export function updateSettings(patch: Partial<AppSettings>) {
  Object.assign(settings, patch)
}

export async function getApiKey(): Promise<string> {
  return (await storageGet(API_KEY_KEY)) || ''
}

export async function setApiKey(key: string) {
  await storageSet(API_KEY_KEY, key)
}
