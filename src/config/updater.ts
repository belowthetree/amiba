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
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  // 构建保存路径
  let tempDir: string
  try {
    const { tempDir: getTempDir } = await import('@tauri-apps/api/path')
    tempDir = await getTempDir()
  } catch {
    throw new Error('无法获取临时目录')
  }

  const fileName = url.split('/').pop()?.split('?')[0] || 'update.bin'
  const dirPath = `${tempDir}amiba-update`
  const filePath = `${dirPath}/${fileName}`

  // 确保目录存在并清理旧文件
  const { mkdir, exists, readDir, remove } = await import('@tauri-apps/plugin-fs')
  try {
    const dirExists = await exists(dirPath)
    if (dirExists) {
      const entries = await readDir(dirPath)
      for (const entry of entries) {
        try { await remove(`${dirPath}/${entry.name}`) } catch { /* 忽略 */ }
      }
    } else {
      await mkdir(dirPath, { recursive: true })
    }
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
    if (cancelled || e.name === 'AbortError') {
      try { await remove(filePath) } catch { /* ignore */ }
      throw new DOMException('Download cancelled', 'AbortError')
    }
    throw new Error(typeof e === 'string' ? e : (e.message || '下载失败'))
  } finally {
    unlisten()
  }
}

// ---- 拉起安装 ----

/** 用系统默认程序打开下载好的文件（安装包） */
export async function installUpdate(filePath: string): Promise<void> {
  const { openPath } = await import('@tauri-apps/plugin-opener')
  await openPath(filePath)
}
