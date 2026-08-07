// ============================================================
// 变形虫 (Amiba) — AI 供应商管理 Store
// ============================================================
import { reactive, watch } from 'vue'
import { storageGetJSON, storageSetJSON } from '../config/storage'
import type { AiProvider } from '../types/service'

const STORAGE_KEY = 'amiba_providers'

export const providers = reactive<AiProvider[]>([])

let initialized = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const PRESET_PROVIDERS: AiProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    protocol: 'responses',   // Responses API（服务端 web_search 唯一通道；仅支持 v4 模型）
    webSearch: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3'],
  },
  {
    id: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-235b-a22b'],
  },
  {
    id: 'custom-api',
    name: 'CustomAPI',
    baseUrl: '',
    apiKey: '',
    models: [],
  },
]

// ---- 初始化 ----

export async function initProviderStore(): Promise<void> {
  if (initialized) return
  initialized = true

  const saved = await storageGetJSON<AiProvider[]>(STORAGE_KEY)
  if (saved && Array.isArray(saved) && saved.length > 0) {
    // 存量数据迁移：DeepSeek 预置固定 Responses 端点类型 + 默认开启联网搜索，
    // 并合并 v4 模型列表（Responses 端点仅支持 v4 模型）
    const preset = PRESET_PROVIDERS.find(p => p.id === 'deepseek')!
    const migrated = saved.map(p => p.id === 'deepseek'
      ? {
          ...p,
          protocol: 'responses' as const,
          webSearch: p.webSearch ?? true,
          models: [...new Set([...p.models, ...preset.models])],
        }
      : p)
    providers.splice(0, providers.length, ...migrated)
  } else {
    // 首次初始化：写入预置供应商
    providers.splice(0, providers.length, ...PRESET_PROVIDERS)
  }

  // 自动持久化（300ms 防抖）
  watch(
    () => providers.map(p => ({ ...p })),
    () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        storageSetJSON(STORAGE_KEY, [...providers])
      }, 300)
    },
    { deep: true }
  )
}

// ---- CRUD ----

export function addProvider(p: AiProvider): void {
  if (providers.some(existing => existing.id === p.id)) {
    throw new Error(`供应商 ID "${p.id}" 已存在`)
  }
  providers.push({ ...p })
}

export function updateProvider(id: string, patch: Partial<AiProvider>): void {
  const idx = providers.findIndex(p => p.id === id)
  if (idx === -1) throw new Error(`供应商 "${id}" 不存在`)
  // 如果修改了 id，检查新 id 不冲突
  if (patch.id && patch.id !== id && providers.some(p => p.id === patch.id)) {
    throw new Error(`供应商 ID "${patch.id}" 已存在`)
  }
  Object.assign(providers[idx], patch)
}

export function deleteProvider(id: string): void {
  const idx = providers.findIndex(p => p.id === id)
  if (idx === -1) throw new Error(`供应商 "${id}" 不存在`)
  providers.splice(idx, 1)
}

export function getProvider(id: string): AiProvider | undefined {
  return providers.find(p => p.id === id)
}

export function getActiveProviders(): AiProvider[] {
  return [...providers]
}
