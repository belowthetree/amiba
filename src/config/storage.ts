// ============================================================
// 变形虫 (Amiba) — 存储层（Tauri FS）
// ============================================================

const APP_ROOT = 'amiba'

let _dataDir = ''

function logPath(key: string): string {
  return _dataDir ? _dataDir + APP_ROOT + '/' + key : APP_ROOT + '/' + key
}

// --- Tauri FS backend ---
async function tauriGet(key: string): Promise<string | null> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(APP_ROOT + '/' + key, { baseDir: BaseDirectory.AppData })
  } catch { return null }
}

async function tauriSet(key: string, value: string): Promise<void> {
  const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(APP_ROOT + '/' + key, value, { baseDir: BaseDirectory.AppData })
}

async function tauriRemove(key: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(APP_ROOT + '/' + key, { baseDir: BaseDirectory.AppData })
  } catch {}
}

async function tauriKeys(): Promise<string[]> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(APP_ROOT, { baseDir: BaseDirectory.AppData })
    return entries.map((e: any) => e.name)
  } catch { return [] }
}

async function tauriClear(): Promise<void> {
  try {
    const ks = await tauriKeys()
    for (const k of ks) await tauriRemove(k)
  } catch {}
}

// --- Init ---
export async function initStorage() {
  try {
    const { exists, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const { appDataDir } = await import('@tauri-apps/api/path')
    const dataDir = await appDataDir()
    _dataDir = dataDir
    console.log('[Storage] AppData 目录:', dataDir)
    const ok = await exists(APP_ROOT, { baseDir: BaseDirectory.AppData })
    if (!ok) {
      await mkdir(APP_ROOT, { baseDir: BaseDirectory.AppData, recursive: true })
      console.log('[Storage] 已创建数据目录:', dataDir + APP_ROOT)
    }
    // Ensure services/ subdirectory exists
    const svcOk = await exists(SVC_ROOT, { baseDir: BaseDirectory.AppData })
    if (!svcOk) {
      await mkdir(SVC_ROOT, { baseDir: BaseDirectory.AppData, recursive: true })
      console.log('[Storage] 已创建服务目录:', dataDir + SVC_ROOT)
    }
    console.log('[Storage] 数据目录就绪:', dataDir + APP_ROOT)
  } catch (e) {
    console.error('[Storage] 初始化失败:', e)
  }
}

// --- Public API ---
export async function storageGet(key: string): Promise<string | null> {
  const val = await tauriGet(key)
  console.log('[Storage] GET', logPath(key), val ? `(${(val.length / 1024).toFixed(1)}KB)` : '(null)')
  return val
}

export async function storageSet(key: string, value: string): Promise<void> {
  console.log('[Storage] SET', logPath(key), `(${(value.length / 1024).toFixed(1)}KB)`)
  return tauriSet(key, value)
}

export async function storageRemove(key: string): Promise<void> {
  console.log('[Storage] DEL', logPath(key))
  return tauriRemove(key)
}

export async function storageKeys(): Promise<string[]> {
  return tauriKeys()
}

export async function storageClear(): Promise<void> {
  return tauriClear()
}

export async function storageGetJSON<T>(key: string): Promise<T | null> {
  const raw = await storageGet(key)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export async function storageSetJSON(key: string, value: any): Promise<void> {
  await storageSet(key, JSON.stringify(value))
}

// ============================================================
// Service file storage (services/{serviceId}/)
// ============================================================

const SVC_ROOT = 'services'

/** Sanitize a file path inside a service directory — rejects traversal */
function safePath(subPath: string): string {
  if (!subPath || subPath.includes('..') || subPath.startsWith('/') || subPath.startsWith('\\')) {
    throw new Error(`[Storage] 非法路径: ${subPath}`)
  }
  // Also reject Windows absolute paths (e.g. C:\...)
  if (/^[a-zA-Z]:/.test(subPath)) {
    throw new Error(`[Storage] 非法路径(绝对路径): ${subPath}`)
  }
  return subPath
}

function svcRelPath(serviceId: string, filePath?: string): string {
  const base = `${SVC_ROOT}/${serviceId}`
  return filePath ? `${base}/${safePath(filePath)}` : base
}

// --- Raw Tauri ops on service paths ---
async function svcFileGet(serviceId: string, filePath: string): Promise<string | null> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(svcRelPath(serviceId, filePath), { baseDir: BaseDirectory.AppData })
  } catch { return null }
}

async function svcFileSet(serviceId: string, filePath: string, content: string): Promise<void> {
  const { writeTextFile, BaseDirectory, mkdir } = await import('@tauri-apps/plugin-fs')
  // Always ensure the service directory (and subdirs) exist
  await mkdir(svcRelPath(serviceId), { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
  const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : ''
  if (dir) {
    await mkdir(svcRelPath(serviceId, dir), { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
  }
  await writeTextFile(svcRelPath(serviceId, filePath), content, { baseDir: BaseDirectory.AppData })
}

async function svcFileRemove(serviceId: string, filePath: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(svcRelPath(serviceId, filePath), { baseDir: BaseDirectory.AppData })
  } catch {}
}

async function svcFileList(serviceId: string, subPath?: string): Promise<string[]> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const dirPath = subPath ? svcRelPath(serviceId, safePath(subPath)) : svcRelPath(serviceId)
    const entries = await readDir(dirPath, { baseDir: BaseDirectory.AppData })
    return entries.map((e: any) => e.name)
  } catch { return [] }
}

async function svcDirRemove(serviceId: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(svcRelPath(serviceId), { baseDir: BaseDirectory.AppData, recursive: true })
    console.log('[Storage] 已删除服务目录:', logPath(svcRelPath(serviceId)))
  } catch (e) {
    console.error('[Storage] 删除服务目录失败:', e)
  }
}

// --- Public Service File API ---
export async function writeServiceFile(serviceId: string, filePath: string, content: string) {
  console.log('[Storage] WRITE', logPath(svcRelPath(serviceId, filePath)), `(${(content.length / 1024).toFixed(1)}KB)`)
  await svcFileSet(serviceId, filePath, content)
}

export async function readServiceFile(serviceId: string, filePath: string): Promise<string | null> {
  const val = await svcFileGet(serviceId, filePath)
  console.log('[Storage] READ', logPath(svcRelPath(serviceId, filePath)), val ? `(${(val.length / 1024).toFixed(1)}KB)` : '(null)')
  return val
}

export async function removeServiceFile(serviceId: string, filePath: string) {
  console.log('[Storage] RM', logPath(svcRelPath(serviceId, filePath)))
  await svcFileRemove(serviceId, filePath)
}

export async function listServiceFiles(serviceId: string, subPath?: string): Promise<string[]> {
  return svcFileList(serviceId, subPath)
}

export async function removeServiceDir(serviceId: string) {
  await svcDirRemove(serviceId)
}

/** List all service directories under services/ */
export async function listServiceDirs(): Promise<string[]> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(SVC_ROOT, { baseDir: BaseDirectory.AppData })
    return entries.filter((e: any) => e.isDirectory).map((e: any) => e.name)
  } catch { return [] }
}

// --- Sandboxed service data API (services/{id}/data/) ---
export async function serviceDataGet(serviceId: string, key: string): Promise<string | null> {
  return svcFileGet(serviceId, `data/${key}`)
}

export async function serviceDataSet(serviceId: string, key: string, value: string) {
  await svcFileSet(serviceId, `data/${key}`, value)
}

export async function serviceDataRemove(serviceId: string, key: string) {
  await svcFileRemove(serviceId, `data/${key}`)
}

export async function serviceDataKeys(serviceId: string): Promise<string[]> {
  return svcFileList(serviceId, 'data')
}
