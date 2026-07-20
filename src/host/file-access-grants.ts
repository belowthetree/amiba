// ============================================================
// 变形虫 (Amiba) — FileAccessGrants
// ============================================================
// 管理服务的文件访问授权。Android 端通过 tauri-plugin-android-fs
// 的 SAF API 操作；桌面端使用 tauri-plugin-fs；浏览器不可用。
// 授权仅本次应用生命周期有效，不落盘。
// ============================================================

import type { FileAccessRequest, FileAccessGrant, FileInfo } from '../types/service'
import { pickFolder } from '../config/folder-picker'
import type { AndroidFsUri } from 'tauri-plugin-android-fs-api'

interface GrantEntry {
  grant: FileAccessGrant
  serviceId: string
}

const _grants = new Map<string, GrantEntry>()

export function getServiceGrant(serviceId: string): FileAccessGrant | null {
  for (const [, entry] of _grants) {
    if (entry.serviceId === serviceId) return entry.grant
  }
  return null
}

export function validate(serviceId: string, token: string): FileAccessGrant | null {
  const entry = _grants.get(token)
  if (!entry) return null
  if (entry.serviceId !== serviceId) return null
  return entry.grant
}

export function revokeService(serviceId: string): void {
  for (const [token, entry] of _grants) {
    if (entry.serviceId === serviceId) {
      _grants.delete(token)
      console.log('[FileAccess] 吊销: ' + serviceId)
      // Android: 释放持久化权限
      releaseAndroidPermission(entry.grant).catch(() => {})
    }
  }
}

function _generateToken(): string {
  return 'fa_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36)
}

function _arrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))))
  }
  return btoa(chunks.join(''))
}

function _matchesPattern(testPath: string, pattern: string): boolean {
  if (!pattern) return false
  if (pattern.startsWith('**/')) return _matchesPattern(testPath, pattern.slice(3))
  const globMatch = pattern.match(/^\*\*\/\*(\.\w+)$/)
  if (globMatch) return testPath.toLowerCase().endsWith(globMatch[1].toLowerCase())
  if (pattern.startsWith('{') && pattern.endsWith('}')) {
    const exts = pattern.slice(1, -1).split(',').map(s => s.trim().toLowerCase())
    return exts.some(ext => testPath.toLowerCase().endsWith(ext.replace('*', '').toLowerCase()))
  }
  if (pattern.startsWith('*.')) return testPath.toLowerCase().endsWith(pattern.slice(1).toLowerCase())
  return testPath === pattern
}

// ---- Android SAF 工具 ----

let _androidFs: any = null
async function _getAndroidFs() {
  if (!_androidFs) {
    const mod = await import('tauri-plugin-android-fs-api')
    if (!mod.isAndroid()) throw new Error('Android FS 插件仅在 Android 平台可用')
    _androidFs = mod.AndroidFs
  }
  return _androidFs
}

async function releaseAndroidPermission(grant: FileAccessGrant): Promise<void> {
  try {
    const AndroidFs = await _getAndroidFs()
    // 尝试释放持久化权限（best-effort）
    await AndroidFs.releasePersistedPickerUriPermission({ uri: grant.path, documentTopTreeUri: null })
  } catch { /* 非 Android 或权限非持久化 */ }
}

// ---- 目录扫描 ----

async function _scanDir(basePath: string, pattern: string, results: FileInfo[]): Promise<void> {
  // Android: 使用 SAF readDir
  try {
    const AndroidFs = await _getAndroidFs()
    const recursive = pattern.includes('**')
    const androidUri: AndroidFsUri = { uri: basePath, documentTopTreeUri: null }

    const walk = async (dirUri: AndroidFsUri, relativeDir: string): Promise<void> => {
      try {
        const entries = await AndroidFs.readDir(dirUri)
        for (const entry of entries) {
          const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
          if (entry.type === 'Dir') {
            if (recursive) {
              const childUri = await AndroidFs.getUri(`${dirUri.uri}%2F${encodeURIComponent(entry.name)}`)
              await walk(childUri, relPath)
            }
          } else if (_matchesPattern(relPath, pattern) || _matchesPattern(entry.name, pattern)) {
            results.push({ name: entry.name, path: relPath, size: entry.size ?? 0, isDir: false })
          }
        }
      } catch (e: any) {
        console.warn('[FileAccess] 无法读取子目录: ' + (e?.message || String(e)))
      }
    }
    await walk(androidUri, '')
    return
  } catch { /* 回退到桌面 tauri-plugin-fs */ }

  // 桌面: 使用 tauri-plugin-fs
  const [{ readDir }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])

  const recursive = pattern.includes('**')
  const w = async (dirPath: string, relDir: string): Promise<void> => {
    let entries: any[]
    try { entries = await readDir(dirPath) } catch { return }
    for (const e of entries) {
      const rp = relDir ? await join(relDir, e.name) : e.name
      if (e.isDirectory) {
        if (recursive) await w(await join(dirPath, e.name), rp)
      } else if (_matchesPattern(rp, pattern) || _matchesPattern(e.name, pattern)) {
        results.push({ name: e.name, path: rp, size: 0, isDir: false })
      }
    }
  }
  await w(basePath, '')
}

// ---- 公共 API ----

export async function requestAccess(serviceId: string, req: FileAccessRequest): Promise<FileAccessGrant> {
  let folderPath = req.path

  if (!folderPath) {
    folderPath = (await pickFolder('选择文件夹')) ?? undefined
    if (!folderPath) throw new Error('未选择文件夹')
  }

  const pattern = req.pattern || '*'

  if (!req.silent) {
    const confirmed = confirm(
      `服务请求访问文件夹\n\n路径: ${folderPath}\n用途: ${req.purpose || '读取文件'}\n模式: ${pattern}\n\n允许访问？`
    )
    if (!confirmed) throw new Error('用户拒绝了文件访问')
  }

  // Android: 持久化权限
  try {
    const AndroidFs = await _getAndroidFs()
    await AndroidFs.persistPickerUriPermission({ uri: folderPath, documentTopTreeUri: null })
  } catch { /* 非 Android 或非 picker URI */ }

  const token = _generateToken()
  const grant: FileAccessGrant = { token, path: folderPath, pattern, createdAt: new Date().toISOString() }
  _grants.set(token, { grant, serviceId })
  console.log('[FileAccess] ✓ 授权:', serviceId, '->', folderPath)
  return grant
}

export async function listFiles(serviceId: string, token: string): Promise<FileInfo[]> {
  const grant = validate(serviceId, token)
  if (!grant) throw new Error('文件访问授权无效或已过期')
  const items: FileInfo[] = []
  await _scanDir(grant.path, grant.pattern, items)
  return items
}

export async function readTextFile(serviceId: string, token: string, relativePath: string): Promise<string> {
  const grant = validate(serviceId, token)
  if (!grant) throw new Error('文件访问授权无效或已过期')

  // 尝试 Android SAF
  try {
    const AndroidFs = await _getAndroidFs()
    const androidUri: AndroidFsUri = { uri: grant.path, documentTopTreeUri: null }
    const childUri = await AndroidFs.getUri(`${androidUri.uri}%2F${encodeURIComponent(relativePath)}`)
    return await AndroidFs.readTextFile(childUri)
  } catch { /* fall through */ }

  // 桌面/fallback
  const [{ readTextFile: fsReadTextFile }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  return await fsReadTextFile(await join(grant.path, relativePath))
}

export async function readBinaryFile(serviceId: string, token: string, relativePath: string): Promise<string> {
  const grant = validate(serviceId, token)
  if (!grant) throw new Error('文件访问授权无效或已过期')

  // 尝试 Android SAF
  try {
    const AndroidFs = await _getAndroidFs()
    const androidUri: AndroidFsUri = { uri: grant.path, documentTopTreeUri: null }
    const childUri = await AndroidFs.getUri(`${androidUri.uri}%2F${encodeURIComponent(relativePath)}`)
    const bytes = await AndroidFs.readFile(childUri)
    return _arrayToBase64(bytes)
  } catch { /* fall through */ }

  // 桌面/fallback
  const [{ readFile: fsReadFile }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  const bytes = await fsReadFile(await join(grant.path, relativePath))
  return _arrayToBase64(bytes)
}
