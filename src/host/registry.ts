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
import type { ServiceEntry, ServiceManifest, ServicePackage, ServiceFile, BackgroundConfig } from '../types/service'

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
  // 扫描已有服务的 background.json
  for (const svc of Object.values(userServices)) {
    if (svc.manifest.permissions.includes('background')) {
      await cacheBackgroundConfig(svc.manifest.id)
    }
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

/** 标记服务有悬浮块配置，并设置可见性 */
export async function setServiceWidgetConfig(serviceId: string, hasWidgets: boolean, visible?: boolean) {
  if (userServices[serviceId]) {
    userServices[serviceId].hasWidgets = hasWidgets
    if (visible !== undefined) userServices[serviceId].widgetsVisible = visible
    await saveRegistry()
  }
}

/** 设置服务的悬浮块可见性 */
export async function setServiceWidgetsVisible(serviceId: string, visible: boolean) {
  if (userServices[serviceId]) {
    userServices[serviceId].widgetsVisible = visible
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

  // Write each file (skip manifest.json — already written above)
  for (const f of pkg.files) {
    if (f.path === 'manifest.json') continue
    await writeServiceFile(serviceId, f.path, f.content)
  }

  // Write tasks if present
  if (pkg.tasks && pkg.tasks.length > 0) {
    await writeServiceFile(serviceId, 'tasks.json', JSON.stringify(pkg.tasks, null, 2))
  }

  // Parse and cache background.json if present
  await cacheBackgroundConfig(serviceId, pkg.files)
}

/** 从服务文件中读取并缓存 background.json 配置到 ServiceEntry */
export async function cacheBackgroundConfig(serviceId: string, files?: ServiceFile[]): Promise<BackgroundConfig | null> {
  const svc = getService(serviceId)
  if (!svc) return null

  let raw: string | null = null
  if (files) {
    const bgFile = files.find(f => f.path === 'background.json')
    if (bgFile) raw = bgFile.content
  } else {
    raw = await readServiceFile(serviceId, 'background.json')
  }

  if (!raw) {
    svc.backgroundConfig = null
    return null
  }

  try {
    const config = JSON.parse(raw) as BackgroundConfig
    if (!config.entry) {
      console.warn('[Registry] background.json 缺少 entry 字段:', serviceId)
      svc.backgroundConfig = null
      return null
    }
    svc.backgroundConfig = config
    console.log('[Registry] background.json 已解析:', serviceId, 'entry=', config.entry)
    return config
  } catch {
    console.warn('[Registry] background.json 解析失败:', serviceId)
    svc.backgroundConfig = null
    return null
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
    if (name === 'manifest.json' || name === 'tasks.json' || name === 'data' || name === 'background.json' || name.startsWith('.versions')) continue
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

// ============================================================
// 统一服务运行时资源销毁（删除服务 / 服务卸载时统一收口）
// ============================================================

/**
 * 释放服务持有的所有运行时资源（后台、悬浮块、文件授权、前台 handler）。
 * 删除服务时调用，ServiceContext.destroy() 也走此收口。
 */
export async function destroyServiceRuntime(serviceId: string): Promise<void> {
  console.log('[Registry] ==== 销毁服务运行时: ' + serviceId + ' ====')

  // 1. 停止后台服务（清理隐藏 iframe、定时器、网络事件订阅）
  try {
    const { stopService } = await import('./background-manager')
    await stopService(serviceId)
  } catch (e) { console.warn('[Registry] stopService 失败:', e) }

  // 2. 清除前台消息 handler（防止后台向前台推送时落空）
  try {
    const { registerForegroundHandler } = await import('./background-manager')
    registerForegroundHandler(serviceId, null)
  } catch (e) { console.warn('[Registry] registerForegroundHandler 清理失败:', e) }

  // 3. 吊销文件访问授权
  try {
    const { revokeService } = await import('./file-access-grants')
    revokeService(serviceId)
  } catch (e) { console.warn('[Registry] revokeService 失败:', e) }

  // 4. 注销所有悬浮块（含 persistent/* 生命周期 — 删除时必须全部清理）
  try {
    const { widgetStates } = await import('./floating-widget-manager')
    const ids = Object.keys(widgetStates).filter((id) => widgetStates[id]?.config?.serviceId === serviceId)
    for (const id of ids) { delete widgetStates[id] }
    console.log('[Registry] ✓ 服务运行时已销毁: ' + serviceId)
  } catch (e) { console.warn('[Registry] 清理悬浮块失败:', e) }
}

// ============================================================
// 预置服务安装（public/services/）
// ============================================================

const PREBUILT_SERVICES_URL = '/services/index.json'

export async function installPrebuiltServices(): Promise<number> {
  let installed = 0

  let indexData: any
  try {
    const res = await fetch(PREBUILT_SERVICES_URL)
    if (!res.ok) {
      console.log('[Registry] 预置服务索引不可用:', res.status)
      return 0
    }
    indexData = await res.json()
  } catch (e) {
    console.log('[Registry] 预置服务索引加载失败:', e)
    return 0
  }

  // 动态导入 settings 读取安装记录（避免循环依赖）
  const { settings } = await import('../config/config')
  const installedRecord: Record<string, string> = settings.prebuilt_services_installed ?? {}
  if (!settings.prebuilt_services_installed) {
    settings.prebuilt_services_installed = {}
  }

  const serviceList = indexData?.services ?? []
  for (const entry of serviceList) {
    const serviceId = entry.id
    const fileList: string[] = entry.files ?? []

    // 已注册则比较版本，版本一致才跳过
    if (getService(serviceId)) {
      const existingPkg = await getServicePackage(serviceId)
      // 先获取最新 manifest 做版本对比
      if (fileList.includes('manifest.json')) {
        try {
          const manifestRes = await fetch(`/services/${serviceId}/manifest.json`)
          if (manifestRes.ok) {
            const parsed = await manifestRes.json()
            const svc = getService(serviceId)
            if (svc && svc.manifest.version === parsed.version && existingPkg && existingPkg.files.length > 0) {
              console.log('[Registry] 预置服务已存在，版本相同，跳过:', serviceId)
              // 同步更新安装记录版本
              installedRecord[serviceId] = parsed.version
              continue
            }
          }
        } catch { /* fall through to reinstall */ }
      }
      if (!existingPkg || existingPkg.files.length === 0) {
        console.log('[Registry] 预置服务文件损坏，重新安装:', serviceId)
      } else {
        console.log('[Registry] 预置服务版本变更，重新安装:', serviceId)
      }
    }

    // 获取所有文件
    const files: ServiceFile[] = []
    let manifest: ServiceManifest | null = null
    let fetchFailed = false

    for (const fp of fileList) {
      try {
        const res = await fetch(`/services/${serviceId}/${fp}`)
        if (!res.ok) { fetchFailed = true; break }
        const content = await res.text()
        files.push({ path: fp, content })

        // 解析 manifest.json
        if (fp === 'manifest.json') {
          try {
            const parsed = JSON.parse(content)
            manifest = {
              id: serviceId,
              name: parsed.name,
              version: parsed.version,
              description: parsed.description || '',
              permissions: parsed.permissions || [],
            }
          } catch {
            console.warn('[Registry] 预置服务 manifest.json 解析失败:', serviceId)
          }
        }
      } catch {
        fetchFailed = true
        break
      }
    }

    if (fetchFailed) {
      console.log('[Registry] 预置服务文件下载失败，跳过:', serviceId)
      continue
    }

    if (!manifest) {
      console.log('[Registry] 预置服务缺少 manifest.json，跳过:', serviceId)
      continue
    }

    if (files.length === 0) continue

    const pkg: ServicePackage = { manifest, files }
    // 如果已注册但文件损坏，只更新文件，不重复注册
    const alreadyRegistered = !!getService(serviceId)
    if (!alreadyRegistered) {
      // 如果安装记录中已存在 → 用户曾删除，跳过自动重装
      if (installedRecord[serviceId]) {
        console.log('[Registry] 预置服务已被用户删除，跳过自动重装:', serviceId)
        continue
      }
      await registerService(manifest, 'builtin')
    }
    await storeServicePackage(serviceId, pkg)
    // 更新安装记录
    installedRecord[serviceId] = manifest.version
    installed++
    console.log(`[Registry] ✓ 预置服务${alreadyRegistered ? '已修复' : '已安装'}: ${serviceId} (${files.length} 个文件)`)
  }

  return installed
}
