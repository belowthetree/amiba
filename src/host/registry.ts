// ============================================================
// 变形虫 (Amiba) — 服务注册表
// ============================================================
import { reactive } from 'vue'
import { storageGetJSON, storageSetJSON } from '../config/storage'
import {
  writeServiceFile,
  readServiceFile,
  removeServiceFile,
  listServiceFiles,
  removeServiceDir,
  serviceDataGet,
  serviceDataSet,
  serviceDataRemove,
  serviceDataKeys,
} from '../config/storage'
import type { ServiceEntry, ServiceManifest, ServicePackage, ServiceFile } from '../types/service'

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

// ============================================================
// Service data storage (sandboxed — services/{id}/data/)
// ============================================================

export async function setServiceData(serviceId: string, key: string, data: any) {
  const value = typeof data === 'string' ? data : JSON.stringify(data)
  await serviceDataSet(serviceId, key, value)
}

export async function getServiceData(serviceId: string, key: string): Promise<any> {
  const raw = await serviceDataGet(serviceId, key)
  if (!raw) return undefined
  try { return JSON.parse(raw) } catch { return raw }
}

export async function removeServiceData(serviceId: string, key: string) {
  await serviceDataRemove(serviceId, key)
}

// ============================================================
// Service package storage (services/{id}/ — file-per-resource)
// ============================================================

export async function storeServicePackage(serviceId: string, pkg: ServicePackage) {
  console.log('[Registry] 存储服务包:', serviceId, `${pkg.files.length} 个文件`)

  // Write manifest.json
  await writeServiceFile(serviceId, 'manifest.json', JSON.stringify(pkg.manifest, null, 2))

  // Write each file
  for (const f of pkg.files) {
    await writeServiceFile(serviceId, f.path, f.content)
  }

  // Write tasks if present
  if (pkg.tasks && pkg.tasks.length > 0) {
    await writeServiceFile(serviceId, 'tasks.json', JSON.stringify(pkg.tasks, null, 2))
  }
}

export async function getServicePackage(serviceId: string): Promise<ServicePackage | null> {
  // Read manifest
  const manifestRaw = await readServiceFile(serviceId, 'manifest.json')
  if (!manifestRaw) return null

  let manifest: ServiceManifest
  try { manifest = JSON.parse(manifestRaw) } catch { return null }

  // List all files in the service directory
  const allFiles = await listServiceFiles(serviceId)
  console.log(`[Registry] getServicePackage: ${serviceId} → ${allFiles.length} files:`, allFiles.join(', '))

  // Read each file (skip manifest.json, tasks.json, and data/ directory)
  const files: ServiceFile[] = []
  for (const name of allFiles) {
    if (name === 'manifest.json' || name === 'tasks.json' || name === 'data') continue
    const content = await readServiceFile(serviceId, name)
    if (content !== null) {
      files.push({ path: name, content })
    }
  }

  // Read tasks if present
  let tasks = undefined
  const tasksRaw = await readServiceFile(serviceId, 'tasks.json')
  if (tasksRaw) {
    try { tasks = JSON.parse(tasksRaw) } catch { /* ignore */ }
  }

  const pkg: ServicePackage = { manifest, files }
  if (tasks) pkg.tasks = tasks
  return pkg
}

export async function removeServiceStorage(serviceId: string) {
  console.log('[Registry] 删除服务存储:', serviceId)
  await removeServiceDir(serviceId)
}
