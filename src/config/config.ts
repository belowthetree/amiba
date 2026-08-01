// ============================================================
// 变形虫 (Amiba) — 统一配置（amiba_settings）
// ============================================================
// 所有普通设置项合并到一个 JSON 文件，通过 reactive + watch 自动持久化。
// 首次加载时自动从旧的分散 key 迁移数据。
// ============================================================
import { reactive, watch } from 'vue'
import { storageGetJSON, storageSetJSON, storageGet, storageSet } from './storage'
import type { AppSettings } from '../types/service'

const STORAGE_KEY = 'amiba_settings'

const defaults: AppSettings = {
  ai_base_url: 'https://api.deepseek.com',
  ai_model: 'deepseek-v4-flash',
  api_key: '',
  theme_mode: 'system',
  active_theme: 'default',
  language: 'zh-CN',
  device_id: '',
  network_lan_visible: true,
  active_agent_id: '',
  background_services_enabled: true,
  max_background_services: 3,
  log_enabled: true,
  log_level: 1, // INFO
  log_max_files: 5,
  log_max_size_mb: 10,
  prebuilt_services_installed: {},
  dismissed_update_version: '',
  service_registry_url: 'https://gitee.com/belowthetree/servicehub',
}

export const settings = reactive<AppSettings>({ ...defaults })

// ---- Init + Migration ----

let initialized = false

export async function initConfig(): Promise<void> {
  if (initialized) return
  initialized = true

  const saved = await storageGetJSON<Partial<AppSettings>>(STORAGE_KEY)

  // 迁移旧分散 key
  await migrateOldKeys(saved)

  if (saved) {
    Object.assign(settings, defaults, saved)
  }

  // Debounced auto-save
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

async function migrateOldKeys(saved: Partial<AppSettings> | null) {
  if (!saved) return

  // amiba_api_key → settings.api_key
  if (!saved.api_key) {
    const oldKey = await storageGet('amiba_api_key')
    if (oldKey) {
      saved.api_key = oldKey
      await storageSet('amiba_api_key', '') // 清除旧 key
      console.log('[Config] 迁移: amiba_api_key → settings.api_key')
    }
  }

  // amiba_network_visibility → settings.network_lan_visible
  if (saved.network_lan_visible === undefined) {
    const vis = await storageGetJSON<{ lan: boolean }>('amiba_network_visibility')
    if (vis) {
      saved.network_lan_visible = vis.lan ?? true
      await storageSetJSON('amiba_network_visibility', null)
      console.log('[Config] 迁移: amiba_network_visibility → settings.network_lan_visible')
    }
  }

  // amiba_active_agent → settings.active_agent_id
  if (!saved.active_agent_id) {
    const oldId = await storageGet('amiba_active_agent')
    if (oldId) {
      saved.active_agent_id = oldId
      await storageSet('amiba_active_agent', '')
      console.log('[Config] 迁移: amiba_active_agent → settings.active_agent_id')
    }
  }
}

// ---- Public API ----

export function getSettings(): AppSettings {
  return { ...settings }
}

export function updateSettings(patch: Partial<AppSettings>) {
  Object.assign(settings, patch)
}

/** @deprecated 使用 settings.api_key 替代 */
export async function getApiKey(): Promise<string> {
  return settings.api_key || ''
}

/** @deprecated 直接赋值 settings.api_key 即可 */
export async function setApiKey(key: string) {
  settings.api_key = key
}
