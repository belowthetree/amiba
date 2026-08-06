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
  listServiceDirs,
  removeServiceDir,
  serviceDataGet,
  serviceDataSet,
  serviceDataRemove,
  serviceDataKeys,
} from '../config/storage'
import type { ServiceEntry, ServiceManifest, ServicePackage, ServiceFile, BackgroundConfig, ServiceAiConfig, ServiceToolsConfig, Permission } from '../types/service'

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

/** 持久化层只存元数据（不含 manifest——以服务目录 manifest.json 为准） */
type ServiceMeta = Omit<ServiceEntry, 'manifest'>

async function saveRegistry() {
  const stored: Record<string, ServiceMeta> = {}
  for (const [id, entry] of Object.entries(userServices)) {
    const { manifest: _omit, ...meta } = entry
    stored[id] = meta
  }
  await storageSetJSON(REGISTRY_KEY, stored)
}

/** 从服务目录 manifest.json 读取并校验 manifest（服务信息的唯一权威来源） */
async function loadManifestFromFile(id: string): Promise<ServiceManifest | null> {
  try {
    const raw = await readServiceFile(id, 'manifest.json')
    if (!raw) return null
    const m = JSON.parse(raw) as ServiceManifest
    if (!m || !m.id || !m.name || !Array.isArray(m.permissions)) {
      console.warn('[Registry] manifest.json 格式无效:', id)
      return null
    }
    if (m.id !== id) {
      console.warn(`[Registry] manifest id 与目录不一致 (${m.id} != ${id})，跳过`)
      return null
    }
    return m
  } catch (e) {
    console.warn('[Registry] manifest.json 读取失败:', id, e)
    return null
  }
}

export async function initRegistry(): Promise<void> {
  if (registryLoaded) return
  registryLoaded = true
  const saved = (await storageGetJSON<Record<string, Partial<ServiceEntry>>>(REGISTRY_KEY)) ?? {}

  // 以服务目录为准：扫描 services/{id}/manifest.json 重建内存注册表，
  // 持久化的旧快照（含 manifest）只取元数据字段，manifest 一律读文件
  const dirs = await listServiceDirs()
  for (const id of dirs) {
    const manifest = await loadManifestFromFile(id)
    if (!manifest) continue
    const meta = saved[id]
    const entry: ServiceEntry = {
      manifest,
      enabled: meta?.enabled ?? true,
      installedAt: meta?.installedAt ?? new Date().toISOString(),
      source: meta?.source ?? 'ai-generated',
    }
    // 迁移持久化的可选元数据（不含 manifest）
    for (const k of ['aiConfig', 'toolsConfig', 'hasWidgets', 'widgetsVisible', 'backgroundConfig'] as const) {
      if (meta?.[k] !== undefined) (entry as any)[k] = meta[k]
    }
    userServices[id] = entry
  }

  // 清理无文件残留的孤儿元数据（服务文件已删但注册表还在）
  const orphans = Object.keys(saved).filter((id) => !userServices[id])
  if (orphans.length > 0) {
    console.log('[Registry] 清理无文件的服务元数据:', orphans.join(', '))
  }
  await saveRegistry()

  // 扫描已有服务的 background.json
  for (const svc of Object.values(userServices)) {
    if (svc.manifest.permissions.includes('background')) {
      await cacheBackgroundConfig(svc.manifest.id)
    }
  }
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
  // manifest 以服务目录文件为准：注册即落盘（持久层不存快照）
  await writeServiceFile(manifest.id, 'manifest.json', JSON.stringify(manifest, null, 2))
  await saveRegistry()
  return entry
}

/** manifest.json 被直接改写后热刷新内存注册表（无需重启） */
export async function refreshServiceManifest(id: string): Promise<boolean> {
  const entry = userServices[id]
  if (!entry) return false
  const manifest = await loadManifestFromFile(id)
  if (!manifest) return false
  if (JSON.stringify(entry.manifest) === JSON.stringify(manifest)) return false
  console.log('[Registry] manifest 已从文件刷新:', id, '权限:', manifest.permissions.join(',') || '(无)')
  entry.manifest = manifest
  return true
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

/** 更新服务的 AI 对话配置（enabled / tools） */
export async function updateServiceAiConfig(id: string, config: ServiceAiConfig) {
  if (userServices[id]) {
    userServices[id].aiConfig = config
    await saveRegistry()
  }
}

/** 更新服务的工具配置（enabled / enabledTools） */
export async function updateServiceToolsConfig(id: string, config: ServiceToolsConfig) {
  if (userServices[id]) {
    userServices[id].toolsConfig = config
    await saveRegistry()
  }
}

/** 为服务补充声明权限（用户在服务设置中授权时调用），同步写回 manifest.json（服务的权威配置） */
export async function grantServicePermission(id: string, permission: Permission) {
  const svc = userServices[id]
  if (!svc) return
  if (svc.manifest.permissions.includes(permission)) return
  svc.manifest.permissions.push(permission)
  await saveRegistry()
  // 同步写回 manifest.json（服务信息以文件为准，内存同步供桥检查即时生效）
  try {
    await writeServiceFile(id, 'manifest.json', JSON.stringify(svc.manifest, null, 2))
  } catch (e) {
    console.warn('[Registry] manifest.json 回写失败:', e)
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

// 数据变更监听：所有写入收口于此处通知（服务主页面 / 后台 worker / 卡片 logic.js
// 都经 setServiceData/removeServiceData），桌面卡片运行器等消费方订阅后自动感知
export type ServiceDataListener = (serviceId: string, key: string) => void
const serviceDataListeners = new Set<ServiceDataListener>()

/** 订阅服务数据变更（set/remove 写入成功后触发）；返回取消订阅函数 */
export function onServiceDataChanged(cb: ServiceDataListener): () => void {
  serviceDataListeners.add(cb)
  return () => { serviceDataListeners.delete(cb) }
}

function notifyServiceDataChanged(serviceId: string, key: string) {
  for (const cb of serviceDataListeners) {
    try { cb(serviceId, key) } catch (e) { console.warn('[Registry] 数据变更监听异常:', e) }
  }
}

export async function setServiceData(serviceId: string, key: string, data: any) {
  const value = typeof data === 'string' ? data : JSON.stringify(data)
  await serviceDataSet(serviceId, key, value)
  notifyServiceDataChanged(serviceId, key)
}

export async function getServiceData(serviceId: string, key: string): Promise<any> {
  const raw = await serviceDataGet(serviceId, key)
  if (!raw) return undefined
  try { return JSON.parse(raw) } catch { return raw }
}

export async function removeServiceData(serviceId: string, key: string) {
  await serviceDataRemove(serviceId, key)
  notifyServiceDataChanged(serviceId, key)
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

  // 5. 清理服务 AI 会话
  try {
    const { dropServiceAi } = await import('../ai/service-ai')
    dropServiceAi(serviceId)
  } catch (e) { console.warn('[Registry] dropServiceAi 失败:', e) }

  // 6. 清理安卓桌面卡片周期调度
  try {
    const { stopServiceWidgetCards } = await import('./desktop-widget-runner')
    stopServiceWidgetCards(serviceId)
  } catch (e) { console.warn('[Registry] stopServiceWidgetCards 失败:', e) }
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
