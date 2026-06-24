// ============================================================
// 变形虫 (Amiba) — 服务注册表
// ============================================================
import { reactive } from 'vue'
import type { ServiceEntry, ServiceManifest } from '../types/service'

const REGISTRY_KEY = 'amiba_service_registry'

// Built-in services (not stored in registry, only for navigation)
export const BUILTIN_SERVICES: ServiceEntry[] = [
  {
    manifest: {
      id: 'system.home',
      name: '首页',
      version: '1.0.0',
      description: '功能入口',
      permissions: [],
    },
    enabled: true,
    installedAt: new Date().toISOString(),
    source: 'builtin',
  },
  {
    manifest: {
      id: 'system.chat',
      name: 'AI 对话',
      version: '1.0.0',
      description: '与 AI 对话',
      permissions: [],
    },
    enabled: true,
    installedAt: new Date().toISOString(),
    source: 'builtin',
  },
  {
    manifest: {
      id: 'system.generate',
      name: 'AI 生成',
      version: '1.0.0',
      description: '生成迷你应用',
      permissions: [],
    },
    enabled: true,
    installedAt: new Date().toISOString(),
    source: 'builtin',
  },
  {
    manifest: {
      id: 'system.settings',
      name: '设置',
      version: '1.0.0',
      description: '配置管理',
      permissions: [],
    },
    enabled: true,
    installedAt: new Date().toISOString(),
    source: 'builtin',
  },
  {
    manifest: {
      id: 'system.my_services',
      name: '我的服务',
      version: '1.0.0',
      description: '已安装服务列表',
      permissions: [],
    },
    enabled: true,
    installedAt: new Date().toISOString(),
    source: 'builtin',
  },
  {
    manifest: {
      id: 'system.memory',
      name: '记忆管理',
      version: '1.0.0',
      description: '查看管理记忆',
      permissions: [],
    },
    enabled: true,
    installedAt: new Date().toISOString(),
    source: 'builtin',
  },
]

// User services registry (reactive)
const userServices = reactive<Record<string, ServiceEntry>>(loadUserServices())

function loadUserServices(): Record<string, ServiceEntry> {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return {}
}

function saveUserServices() {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(userServices))
}

export function getAllServices(): ServiceEntry[] {
  return [...BUILTIN_SERVICES, ...Object.values(userServices)]
}

export function getUserServices(): ServiceEntry[] {
  return Object.values(userServices)
}

export function getService(id: string): ServiceEntry | undefined {
  const builtin = BUILTIN_SERVICES.find((s) => s.manifest.id === id)
  if (builtin) return builtin
  return userServices[id]
}

export function registerService(manifest: ServiceManifest, source: ServiceEntry['source'] = 'ai-generated'): ServiceEntry {
  const entry: ServiceEntry = {
    manifest,
    enabled: true,
    installedAt: new Date().toISOString(),
    source,
  }
  userServices[manifest.id] = entry
  saveUserServices()
  return entry
}

export function unregisterService(id: string): boolean {
  if (id.startsWith('system.')) return false // Cannot remove built-in
  if (userServices[id]) {
    delete userServices[id]
    saveUserServices()
    return true
  }
  return false
}

export function toggleService(id: string, enabled: boolean) {
  if (userServices[id]) {
    userServices[id].enabled = enabled
    saveUserServices()
  }
}

export function getServiceStorageKey(serviceId: string): string {
  return `amiba_svc_${serviceId}`
}

export function setServiceData(serviceId: string, key: string, data: any) {
  const storeKey = getServiceStorageKey(serviceId)
  let store: Record<string, any>
  try {
    const raw = localStorage.getItem(storeKey)
    store = raw ? JSON.parse(raw) : {}
  } catch {
    store = {}
  }
  store[key] = data
  localStorage.setItem(storeKey, JSON.stringify(store))
}

export function getServiceData(serviceId: string, key: string): any {
  const storeKey = getServiceStorageKey(serviceId)
  try {
    const raw = localStorage.getItem(storeKey)
    if (raw) {
      const store = JSON.parse(raw)
      return store[key]
    }
  } catch {
    // ignore
  }
  return undefined
}

export function removeServiceData(serviceId: string, key: string) {
  const storeKey = getServiceStorageKey(serviceId)
  try {
    const raw = localStorage.getItem(storeKey)
    if (raw) {
      const store = JSON.parse(raw)
      delete store[key]
      localStorage.setItem(storeKey, JSON.stringify(store))
    }
  } catch {
    // ignore
  }
}

// Store generated service HTML content
const serviceHtmlStore: Record<string, string> = {}

export function storeServiceHtml(serviceId: string, html: string) {
  serviceHtmlStore[serviceId] = html
  // Also try localStorage for large support
  try {
    localStorage.setItem(`amiba_html_${serviceId}`, html)
  } catch {
    // May exceed quota; use in-memory fallback
  }
}

export function getServiceHtml(serviceId: string): string {
  if (serviceHtmlStore[serviceId]) return serviceHtmlStore[serviceId]
  try {
    return localStorage.getItem(`amiba_html_${serviceId}`) || ''
  } catch {
    return ''
  }
}
