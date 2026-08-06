// ============================================================
// 变形虫 (Amiba) — FileAccessGrants
// ============================================================
// 管理服务的文件访问授权。Android 端通过 tauri-plugin-android-fs
// 的 SAF API 操作；鸿蒙端经壳层 PickerCommands 直读 picker URI
// （file://docs/...，沙箱外目录，native-fs 的 resolveSafe 会拒绝）；
// 桌面端使用 tauri-plugin-fs；浏览器不可用。
// 授权仅本次应用生命周期有效，不落盘。
// ============================================================

import type { FileAccessRequest, FileAccessGrant, FileInfo } from '../types/service'
import { pickFolder } from '../config/folder-picker'
import { isHarmonyRuntime, nativeInvoke } from '../config/platform-bridge'
import { PICKER_COMMANDS } from '../types/native-bridge'
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

// 把 glob 过滤模式映射为 picker 后缀过滤数组（鸿蒙手机端降级多选时用）：
// '{*.mp3,*.flac}' / '*.{mp3,flac}' → ['.mp3','.flac']；'*.txt' / '**/*.txt' → ['.txt']；
// '*' / '**' 等 → []（不过滤）
function _patternToSuffixes(pattern: string): string[] {
  let p = pattern.trim()
  if (p.startsWith('**/')) p = p.slice(3)
  const out: string[] = []
  const brace = p.match(/^\*?\.\{(.+)\}$/)   // '*.{mp3,flac}'
  if (p.startsWith('{') && p.endsWith('}')) {
    for (const ext of p.slice(1, -1).split(',')) {
      const e = ext.trim()
      if (e.startsWith('*.')) out.push(e.slice(1))
    }
  } else if (brace) {
    for (const ext of brace[1].split(',')) {
      out.push('.' + ext.trim())
    }
  } else if (p.startsWith('*.')) {
    out.push(p.slice(1))
  }
  return out.filter(s => /^\.\w{1,10}$/.test(s))
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

// ---- 鸿蒙 picker URI 工具 ----
// picker URI 形态 file://docs/storage/Users/currentUser/...（分层结构）；grant.path 以此开头才走鸿蒙桥，
// 沙箱内普通路径继续落 native-fs（fs_* shim 可处理）

function _isHarmonyPickerUri(path: string): boolean {
  return path.startsWith('file://docs/')
}

// 子项 URI 按段编码拼接（风格对齐 Android 分支的 URI 拼接；与壳层 PickerCommands.joinUri 拼法保持一致）
function _harmonyChildUri(rootUri: string, relativePath: string): string {
  const segs = relativePath.split('/').filter(s => s.length > 0).map(encodeURIComponent)
  return segs.length > 0 ? `${rootUri}/${segs.join('/')}` : rootUri
}

// ---- 目录扫描 ----

async function _scanDir(grant: FileAccessGrant, pattern: string, results: FileInfo[]): Promise<void> {
  // 鸿蒙手机端降级：多选文件清单按 pattern 过滤直接返回（无目录可递归，path 为文件名）
  if (isHarmonyRuntime() && grant.files) {
    for (const f of grant.files) {
      if (_matchesPattern(f.name, pattern)) {
        results.push({ name: f.name, path: f.name, size: f.size, isDir: false })
      }
    }
    return
  }

  const basePath = grant.path

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
  } catch { /* 回退到鸿蒙桥 / 桌面 tauri-plugin-fs */ }

  // 鸿蒙: 壳层递归枚举 picker URI 目录（pattern 仅决定递归），glob 过滤在前端 _matchesPattern
  if (isHarmonyRuntime() && _isHarmonyPickerUri(basePath)) {
    const entries = await nativeInvoke<FileInfo[]>(PICKER_COMMANDS.fileAccessList, { uri: basePath, pattern })
    for (const e of entries) {
      if (e.isDir) continue
      if (_matchesPattern(e.path, pattern) || _matchesPattern(e.name, pattern)) {
        results.push({ name: e.name, path: e.path, size: e.size ?? 0, isDir: false })
      }
    }
    return
  }

  // 桌面: 使用 tauri-plugin-fs
  const { readDir, join } = await import('../config/native-fs')

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
  const pattern = req.pattern || '*'
  let folderPath = req.path
  let pickedFiles: FileAccessGrant['files']

  if (!folderPath) {
    if (isHarmonyRuntime()) {
      // 鸿蒙直走桥命令：{uri} = 文件夹授权；无 FolderSelection syscap 的设备（手机，
      // FOLDER 模式系统弹「功能暂不支持」）壳层自动降级 FILE 多选返回 {files}
      const r = await nativeInvoke<{ uri?: string; files?: { uri: string; name: string; size: number }[] } | null>(
        PICKER_COMMANDS.pickFolder, { suffixes: _patternToSuffixes(pattern) })
      if (r?.files) {
        pickedFiles = r.files
        folderPath = `已选 ${r.files.length} 个文件`
      } else if (r?.uri) {
        folderPath = r.uri
      } else {
        throw new Error('未选择文件夹')
      }
    } else {
      folderPath = (await pickFolder('选择文件夹')) ?? undefined
      if (!folderPath) throw new Error('未选择文件夹')
    }
  }

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
  // 鸿蒙: persistPermission 已在壳层 file_access_pick_folder 内 best-effort 完成，此处无需重复

  const token = _generateToken()
  const grant: FileAccessGrant = {
    token, path: folderPath, pattern, createdAt: new Date().toISOString(),
    ...(pickedFiles ? { files: pickedFiles } : {})
  }
  _grants.set(token, { grant, serviceId })
  console.log('[FileAccess] ✓ 授权:', serviceId, '->', folderPath)
  return grant
}

export async function listFiles(serviceId: string, token: string): Promise<FileInfo[]> {
  const grant = validate(serviceId, token)
  if (!grant) throw new Error('文件访问授权无效或已过期')
  const items: FileInfo[] = []
  await _scanDir(grant, grant.pattern, items)
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

  // 鸿蒙手机端降级：按文件名在多选清单中定位直读（同名取第一个，已知限制）
  if (isHarmonyRuntime() && grant.files) {
    const f = grant.files.find(f => f.name === relativePath)
    if (!f) throw new Error(`文件不在授权清单内: ${relativePath}`)
    const r = await nativeInvoke<{ data: string }>(PICKER_COMMANDS.fileAccessReadText, { uri: f.uri })
    return r.data
  }

  // 鸿蒙: picker URI 经壳层直读（native-fs 的 resolveSafe 会拒绝沙箱外目录）
  if (isHarmonyRuntime() && _isHarmonyPickerUri(grant.path)) {
    const r = await nativeInvoke<{ data: string }>(PICKER_COMMANDS.fileAccessReadText,
      { uri: _harmonyChildUri(grant.path, relativePath) })
    return r.data
  }

  // 桌面/fallback
  const { readTextFile: fsReadTextFile, join } = await import('../config/native-fs')
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

  // 鸿蒙手机端降级：按文件名在多选清单中定位直读（壳层返回 base64，与 Android 分支出口一致）
  if (isHarmonyRuntime() && grant.files) {
    const f = grant.files.find(f => f.name === relativePath)
    if (!f) throw new Error(`文件不在授权清单内: ${relativePath}`)
    const r = await nativeInvoke<{ data: string }>(PICKER_COMMANDS.fileAccessReadBinary, { uri: f.uri })
    return r.data
  }

  // 鸿蒙: picker URI 经壳层直读（壳层返回 base64，与 Android 分支 _arrayToBase64 出口一致）
  if (isHarmonyRuntime() && _isHarmonyPickerUri(grant.path)) {
    const r = await nativeInvoke<{ data: string }>(PICKER_COMMANDS.fileAccessReadBinary,
      { uri: _harmonyChildUri(grant.path, relativePath) })
    return r.data
  }

  // 桌面/fallback
  const { readFile: fsReadFile, join } = await import('../config/native-fs')
  const bytes = await fsReadFile(await join(grant.path, relativePath))
  return _arrayToBase64(bytes)
}
