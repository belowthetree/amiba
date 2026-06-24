// ============================================================
// 变形虫 (Amiba) — 统一配置
// ============================================================
import { reactive, watch } from 'vue'
import type { AppSettings } from '../types/service'

const STORAGE_KEY = 'amiba_settings'

const defaults: AppSettings = {
  ai_base_url: 'https://api.deepseek.com/v1',
  ai_model: 'deepseek-chat',
  ai_generation_model: 'deepseek-chat',
  theme_mode: 'system',
  language: 'zh-CN',
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...defaults, ...JSON.parse(raw) }
    }
  } catch {
    // ignore
  }
  return { ...defaults }
}

export const settings = reactive<AppSettings>(load())

watch(
  () => ({ ...settings }),
  (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  },
  { deep: true }
)

export function getSettings(): AppSettings {
  return { ...settings }
}

export function updateSettings(patch: Partial<AppSettings>) {
  Object.assign(settings, patch)
}

export function getApiKey(): string {
  return localStorage.getItem('amiba_api_key') || ''
}

export function setApiKey(key: string) {
  localStorage.setItem('amiba_api_key', key)
}
