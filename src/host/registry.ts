// ============================================================
// 变形虫 (Amiba) — 服务注册表
// ============================================================
import { reactive } from 'vue'
import { storageGetJSON, storageSetJSON, storageRemove } from '../config/storage'
import type { ServiceEntry, ServiceManifest, ServicePackage } from '../types/service'

const REGISTRY_KEY = 'amiba_service_registry'

// Built-in services (not stored in registry)
export const BUILTIN_SERVICES: ServiceEntry[] = [
  {
    manifest: { id: 'system.home', name: '首页', version: '1.0.0', description: '功能入口', permissions: [], },
    enabled: true, installedAt: new Date().toISOString(), source: 'builtin',
  },
  {
    manifest: { id: 'system.chat', name: 'AI 对话', version: '1.0.0', description: '与 AI 对话', permissions: [], },
    enabled: true, installedAt: new Date().toISOString(), source: 'builtin',
  },
  {
    manifest: { id: 'system.generate', name: 'AI 生成', version: '1.0.0', description: '生成迷你应用', permissions: [], },
    enabled: true, installedAt: new Date().toISOString(), source: 'builtin',
  },
  {
    manifest: { id: 'system.settings', name: '设置', version: '1.0.0', description: '配置管理', permissions: [], },
    enabled: true, installedAt: new Date().toISOString(), source: 'builtin',
  },
  {
    manifest: { id: 'system.my_services', name: '我的服务', version: '1.0.0', description: '已安装服务列表', permissions: [], },
    enabled: true, installedAt: new Date().toISOString(), source: 'builtin',
  },
  {
    manifest: { id: 'system.memory', name: '记忆管理', version: '1.0.0', description: '查看管理记忆', permissions: [], },
    enabled: true, installedAt: new Date().toISOString(), source: 'builtin',
  },
]

const userServices = reactive<Record<string, ServiceEntry>>({})

let registryLoaded = false

export async function initRegistry(): Promise<void> {
  if (registryLoaded) return
  registryLoaded = true
  const saved = await storageGetJSON<Record<string, ServiceEntry>>(REGISTRY_KEY)
  if (saved) {
    Object.assign(userServices, saved)
  }
}

async function saveRegistry() {
  await storageSetJSON(REGISTRY_KEY, { ...userServices })
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

export async function registerService(manifest: ServiceManifest, source: ServiceEntry['source'] = 'ai-generated'): Promise<ServiceEntry> {
  console.log('[Registry] 注册服务:', manifest.id, manifest.name)
  const entry: ServiceEntry = {
    manifest,
    enabled: true,
    installedAt: new Date().toISOString(),
    source,
  }
  userServices[manifest.id] = entry
  await saveRegistry()
  return entry
}

export async function unregisterService(id: string): Promise<boolean> {
  if (id.startsWith('system.')) return false
  if (userServices[id]) {
    delete userServices[id]
    await saveRegistry()
    return true
  }
  return false
}

export async function toggleService(id: string, enabled: boolean) {
  if (userServices[id]) {
    userServices[id].enabled = enabled
    await saveRegistry()
  }
}

// Service data storage
function serviceDataKey(serviceId: string): string {
  return `amiba_svc_${serviceId}`
}

function servicePkgKey(serviceId: string): string {
  return `amiba_pkg_${serviceId}`
}

export async function setServiceData(serviceId: string, key: string, data: any) {
  const storeKey = serviceDataKey(serviceId)
  const store = (await storageGetJSON<Record<string, any>>(storeKey)) || {}
  store[key] = data
  await storageSetJSON(storeKey, store)
}

export async function getServiceData(serviceId: string, key: string): Promise<any> {
  const storeKey = serviceDataKey(serviceId)
  const store = await storageGetJSON<Record<string, any>>(storeKey)
  return store?.[key]
}

export async function removeServiceData(serviceId: string, key: string) {
  const storeKey = serviceDataKey(serviceId)
  const store = (await storageGetJSON<Record<string, any>>(storeKey)) || {}
  delete store[key]
  await storageSetJSON(storeKey, store)
}

// Service package storage
const pkgCache: Record<string, ServicePackage> = {}

export async function storeServicePackage(serviceId: string, pkg: ServicePackage) {
  console.log('[Registry] 存储服务包:', serviceId, `${pkg.files.length} 个文件`)
  pkgCache[serviceId] = pkg
  await storageSetJSON(servicePkgKey(serviceId), pkg)
}

export async function getServicePackage(serviceId: string): Promise<ServicePackage | null> {
  if (pkgCache[serviceId]) return pkgCache[serviceId]
  const val = await storageGetJSON<ServicePackage>(servicePkgKey(serviceId))
  if (val) pkgCache[serviceId] = val
  return val || null
}

export async function removeServiceStorage(serviceId: string) {
  delete pkgCache[serviceId]
  await storageRemove(servicePkgKey(serviceId))
  await storageRemove(serviceDataKey(serviceId))
}
