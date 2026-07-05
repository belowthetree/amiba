// ============================================================
// 变形虫 (Amiba) — 更新检查 + 下载 + 安装服务
// 纯前端驱动：调 GitHub Releases API 检查 → 匹配平台资产 →
// Rust reqwest 下载（绕过浏览器 CORS）→ openPath 拉起安装
// 全平台统一：桌面 / Android / Web 同一套逻辑
// ============================================================

const GITHUB_API = 'https://api.github.com/repos/belowthetree/amiba/releases/latest'
const TIMEOUT_MS = 15_000

// ---- 类型 ----

export interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  currentVersion: string
  body: string
  htmlUrl: string
  /** 当前平台匹配的下载直链 */
  downloadUrl: string
  /** 下载文件名 */
  downloadName: string
}

export type UpdateStatus =
  | { stage: 'idle' }
  | { stage: 'checking' }
  | { stage: 'error'; message: string }
  | { stage: 'upToDate'; currentVersion: string; latestVersion: string }
  | { stage: 'available'; info: UpdateInfo }
  | { stage: 'downloading'; received: number; total: number; cancel: () => void }
  | { stage: 'downloaded'; filePath: string; fileName: string }
  | { stage: 'installing' }
  | { stage: 'cancelled' }

// ---- 当前版本 ----

let cachedVersion: string | null = null

export async function getCurrentVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion

  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    cachedVersion = await getVersion()
    return cachedVersion!
  } catch {
    cachedVersion = (
      typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
    )
    return cachedVersion
  }
}

// ---- 版本比较 ----

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

// ---- 平台检测 ----

export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'web'

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'web'
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'

  const p = (navigator as any).userAgentData?.platform || navigator.platform || ''
  if (/win/i.test(p)) return 'windows'
  if (/mac/i.test(p)) return 'macos'
  if (/linux/i.test(p)) return 'linux'
  return 'web'
}

// ---- 资产匹配 ----

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
}

function matchAsset(assets: GhAsset[], platform: Platform): GhAsset | null {
  const patterns: Record<Platform, RegExp[]> = {
    windows: [/\.exe$/i, /\.msi$/i],
    macos: [/\.dmg$/i, /aarch64\.dmg/i, /x64\.dmg/i],
    linux: [/\.AppImage$/i, /amd64\.AppImage$/i, /\.deb$/i, /amd64\.deb$/i],
    android: [/\.apk$/i],
    web: [],
  }

  const rules = patterns[platform] || []
  if (!rules.length) return null

  // 优先精确匹配（含架构），其次模糊匹配
  for (const rule of rules) {
    const exact = assets.find(a => rule.test(a.name))
    if (exact) return exact
  }
  return null
}

// ---- 核心 API：检查更新 ----

export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = await getCurrentVersion()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(GITHUB_API, { signal: controller.signal })
  } catch (e: any) {
    clearTimeout(timer)
    if (e.name === 'AbortError') {
      throw new Error('连接更新服务器超时，请检查网络后重试')
    }
    throw new Error('无法连接到更新服务器，请检查网络连接')
  }
  clearTimeout(timer)

  if (!response.ok) {
    throw new Error(`服务器返回错误 (${response.status})`)
  }

  const release = (await response.json()) as {
    tag_name: string
    body: string | null
    html_url: string
    assets: GhAsset[]
  }

  const latestVersion = (release.tag_name || '').replace(/^v/, '')
  const body = release.body || ''
  const htmlUrl = release.html_url || ''

  const platform = detectPlatform()
  const asset = matchAsset(release.assets || [], platform)

  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0

  return {
    hasUpdate,
    latestVersion,
    currentVersion,
    body,
    htmlUrl,
    downloadUrl: asset?.browser_download_url || htmlUrl,
    downloadName: asset?.name || '',
  }
}

// ---- 流式下载（Tauri Rust reqwest，绕过浏览器 CORS） ----

export interface DownloadResult {
  filePath: string
  fileName: string
}

/**
 * 通过 Tauri Rust 命令下载文件（绕过浏览器 CORS 限制）。
 * GitHub 下载链接会 302 重定向到 objects.githubusercontent.com，
 * 浏览器 fetch 因 CORS 拦截失败，故走 Rust reqwest。
 *
 * @param url    下载地址
 * @param onProgress  进度回调 (received, total)
 * @param signal AbortSignal 用于取消（注意：Rust 下载不支持中断，signal 仅用于状态同步）
 * @returns     本地文件路径
 */
export async function downloadUpdate(
  url: string,
  version: string,
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const fileName = url.split('/').pop()?.split('?')[0] || 'update.bin'

  const { join } = await import('@tauri-apps/api/path')
  const { appCacheDir } = await import('@tauri-apps/api/path')

  // 使用 cache 目录（已配置 FileProvider cache-path；不再清理旧文件，下载后持久保留）
  const baseDir = await appCacheDir()
  const dirPath = await join(baseDir, 'amiba-update')
  const filePath = await join(dirPath, fileName)
  const result = await doDownloadWithPaths(url, filePath, fileName, onProgress, signal)

  // 保存版本元数据，下次检查时判断是否需要重新下载
  await saveDownloadMeta({
    version,
    fileName: result.fileName,
    filePath: result.filePath,
    downloadUrl: url,
    downloadedAt: new Date().toISOString(),
  })

  return result
}

async function doDownloadWithPaths(
  url: string,
  filePath: string,
  fileName: string,
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const { join, dirname } = await import('@tauri-apps/api/path')
  const dirPath = await dirname(filePath)

  // 确保目录存在（不删除已有文件，支持断点续装）
  const { mkdir, remove } = await import('@tauri-apps/plugin-fs')
  try {
    await mkdir(dirPath, { recursive: true })
  } catch {
    // 目录可能已存在
  }

  // 监听 Rust 下载进度事件
  const { listen } = await import('@tauri-apps/api/event')
  const { invoke } = await import('@tauri-apps/api/core')

  let cancelled = false
  if (signal) {
    signal.addEventListener('abort', () => { cancelled = true })
  }

  const unlisten = await listen<{ received: number; total: number }>(
    'download-progress',
    (event) => {
      onProgress(event.payload.received, event.payload.total)
    }
  )

  try {
    const resultPath = await invoke<string>('download_file', {
      url,
      dest: filePath,
    })

    if (cancelled) {
      try { await remove(filePath) } catch { /* ignore */ }
      throw new DOMException('Download cancelled', 'AbortError')
    }

    return { filePath: resultPath, fileName }
  } catch (e: any) {
    console.error('[Updater] 下载失败:', e)
    if (cancelled || e.name === 'AbortError') {
      try { await remove(filePath) } catch { /* ignore */ }
      throw new DOMException('Download cancelled', 'AbortError')
    }
    const errMsg = typeof e === 'string' ? e : (e.message || String(e) || '下载失败')
    throw new Error(errMsg)
  } finally {
    try { unlisten() } catch { /* ignore */ }
  }
}

// ---- 拉起安装 ----

/** 用系统默认程序打开下载好的文件（安装包） */
export async function installUpdate(filePath: string): Promise<void> {
  console.log('[Updater] 准备安装:', filePath)
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('open_downloaded_file', { filePath })
  console.log('[Updater] ✓ 已启动安装程序')
}

// ---- 下载元数据 ----

export interface DownloadMeta {
  version: string
  fileName: string
  filePath: string
  downloadUrl: string
  downloadedAt: string
}

const META_FILE = 'download_info.json'

/** 保存下载元数据，下次检查更新时用于判断是否需要重新下载 */
async function saveDownloadMeta(meta: DownloadMeta): Promise<void> {
  try {
    const { join } = await import('@tauri-apps/api/path')
    const { appCacheDir } = await import('@tauri-apps/api/path')
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const baseDir = await appCacheDir()
    const dirPath = await join(baseDir, 'amiba-update')
    await mkdir(dirPath, { recursive: true })
    const metaPath = await join(dirPath, META_FILE)
    await writeTextFile(metaPath, JSON.stringify(meta, null, 2))
    console.log('[Updater] 元数据已保存:', meta.version)
  } catch (e) {
    console.error('[Updater] 保存元数据失败:', e)
  }
}

/** 读取下载元数据 */
async function readDownloadMeta(): Promise<DownloadMeta | null> {
  try {
    const { join } = await import('@tauri-apps/api/path')
    const { appCacheDir } = await import('@tauri-apps/api/path')
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const baseDir = await appCacheDir()
    const metaPath = await join(baseDir, 'amiba-update', META_FILE)
    if (!(await exists(metaPath))) return null
    const raw = await readTextFile(metaPath)
    return JSON.parse(raw) as DownloadMeta
  } catch {
    return null
  }
}

/**
 * 检查本地缓存的更新文件：
 * - 若版本与 latestVersion 一致且文件存在 → 返回 DownloadMeta（跳过下载）
 * - 若版本 <= currentVersion → 删除过期文件，返回 null
 * - 其他 → 返回 null（需重新下载）
 */
export async function getCachedUpdate(
  latestVersion: string,
  currentVersion: string,
): Promise<DownloadMeta | null> {
  try {
    const meta = await readDownloadMeta()
    if (!meta) return null

    // 缓存的版本 <= 当前版本 → 已过期，清理
    if (compareVersions(meta.version, currentVersion) <= 0) {
      console.log('[Updater] 缓存版本 %s <= 当前版本 %s，清理', meta.version, currentVersion)
      await deleteCachedUpdate()
      return null
    }

    // 缓存的版本与最新版一致 → 可用
    if (meta.version === latestVersion) {
      const { exists } = await import('@tauri-apps/plugin-fs')
      if (await exists(meta.filePath)) {
        console.log('[Updater] 发现已缓存的最新版本:', meta.version, meta.filePath)
        return meta
      }
    }
  } catch { /* ignore */ }
  return null
}

/** 删除缓存的更新文件及元数据 */
async function deleteCachedUpdate(): Promise<void> {
  try {
    const meta = await readDownloadMeta()
    if (meta) {
      const { remove, exists } = await import('@tauri-apps/plugin-fs')
      if (await exists(meta.filePath)) {
        await remove(meta.filePath)
      }
      // 删除元数据文件
      const { join } = await import('@tauri-apps/api/path')
      const { appCacheDir } = await import('@tauri-apps/api/path')
      const metaPath = await join(await appCacheDir(), 'amiba-update', META_FILE)
      if (await exists(metaPath)) {
        await remove(metaPath)
      }
      console.log('[Updater] 已清理过期缓存:', meta.version)
    }
  } catch (e) {
    console.error('[Updater] 清理缓存失败:', e)
  }
}
