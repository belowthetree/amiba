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
  const { writeTextFile, BaseDirectory, mkdir } = await import('@tauri-apps/plugin-fs')
  // 确保父目录存在
  const fullKey = APP_ROOT + '/' + key
  const lastSlash = fullKey.lastIndexOf('/')
  if (lastSlash > 0) {
    const dir = fullKey.substring(0, lastSlash)
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
  }
  await writeTextFile(fullKey, value, { baseDir: BaseDirectory.AppData })
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
    // Ensure skills/ subdirectory exists
    const skillOk = await exists(SKILLS_ROOT, { baseDir: BaseDirectory.AppData })
    if (!skillOk) {
      await mkdir(SKILLS_ROOT, { baseDir: BaseDirectory.AppData, recursive: true })
      console.log('[Storage] 已创建Skill目录:', dataDir + SKILLS_ROOT)
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
  await storageSet(key, JSON.stringify(value, null, 2))
}

// ============================================================
// Service file storage (services/{serviceId}/)
// ============================================================

const SVC_ROOT = 'services'
const SKILLS_ROOT = 'skills'

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

// ============================================================
// Skill file storage (skills/{skillName}.json)
// ============================================================

function skillRelPath(skillName: string): string {
  return `${SKILLS_ROOT}/${safePath(skillName)}.json`
}

export async function readSkillFile(skillName: string): Promise<string | null> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const val = await readTextFile(skillRelPath(skillName), { baseDir: BaseDirectory.AppData })
    console.log('[Storage] READ SKILL', logPath(skillRelPath(skillName)), `(${(val.length / 1024).toFixed(1)}KB)`)
    return val
  } catch { return null }
}

export async function writeSkillFile(skillName: string, content: string): Promise<void> {
  const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  console.log('[Storage] WRITE SKILL', logPath(skillRelPath(skillName)), `(${(content.length / 1024).toFixed(1)}KB)`)
  await writeTextFile(skillRelPath(skillName), content, { baseDir: BaseDirectory.AppData })
}

export async function removeSkillFile(skillName: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(skillRelPath(skillName), { baseDir: BaseDirectory.AppData })
    console.log('[Storage] DEL SKILL', logPath(skillRelPath(skillName)))
  } catch {}
}

export async function listSkillFiles(): Promise<string[]> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(SKILLS_ROOT, { baseDir: BaseDirectory.AppData })
    const names: string[] = []
    for (const e of entries as any[]) {
      if (e.name.endsWith('.json')) {
        names.push(e.name.replace(/\.json$/, ''))
      } else if (e.isDirectory) {
        // Check if directory contains skill.json
        try {
          const { exists } = await import('@tauri-apps/plugin-fs')
          const hasManifest = await exists(`${SKILLS_ROOT}/${e.name}/skill.json`, { baseDir: BaseDirectory.AppData })
          if (hasManifest) names.push(e.name)
        } catch { /* skip */ }
      }
    }
    return names
  } catch { return [] }
}

// Read skill JSON — supports both flat .json and directory/skill.json
export async function readSkillJson(skillName: string): Promise<string | null> {
  // Try flat file first
  let raw = await readSkillFile(skillName)
  if (raw) return raw
  // Try directory/skill.json
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    raw = await readTextFile(`${SKILLS_ROOT}/${safePath(skillName)}/skill.json`, { baseDir: BaseDirectory.AppData })
    return raw
  } catch { return null }
}

// Recursively copy a source folder into skills/{skillName}/
export async function copySkillFolder(sourceDir: string, skillName: string): Promise<void> {
  const { readDir, readFile, writeFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')

  async function copyRecursive(src: string, destRel: string) {
    const entries = await readDir(src)
    for (const entry of entries as any[]) {
      const srcPath = src + '/' + entry.name
      const destRelPath = destRel ? destRel + '/' + entry.name : entry.name
      if (entry.isDirectory) {
        await mkdir(`${SKILLS_ROOT}/${safePath(skillName)}/${safePath(destRelPath)}`, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
        await copyRecursive(srcPath, destRelPath)
      } else {
        const bytes = await readFile(srcPath)
        await writeFile(`${SKILLS_ROOT}/${safePath(skillName)}/${safePath(destRelPath)}`, new Uint8Array(bytes), { baseDir: BaseDirectory.AppData })
      }
    }
  }

  // Ensure target directory exists
  await mkdir(`${SKILLS_ROOT}/${safePath(skillName)}`, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
  await copyRecursive(sourceDir, '')
  console.log('[Storage] COPY SKILL FOLDER', sourceDir, '→', logPath(`${SKILLS_ROOT}/${skillName}`))
}

// Remove a skill directory (for folder-based skills)
export async function removeSkillDir(skillName: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`${SKILLS_ROOT}/${safePath(skillName)}`, { baseDir: BaseDirectory.AppData, recursive: true })
    console.log('[Storage] DEL SKILL DIR', logPath(`${SKILLS_ROOT}/${skillName}`))
  } catch {}
}
