// ============================================================
// 变形虫 (Amiba) — FileAccessGrants
// ============================================================
// 管理服务的文件访问授权。授权仅本次应用生命周期有效，不落盘。
//
// 使用 Tauri 官方 typed API（非裸 invoke），参照：
//   https://v2.tauri.app/plugin/file-system/
// ============================================================

import type { FileAccessRequest, FileAccessGrant, FileInfo } from '../types/service'
import type { DirEntry } from '@tauri-apps/plugin-fs'
import { pickFolder } from '../config/folder-picker'

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
    }
  }
}

// ---- 内部工具 ----

function _generateToken(): string {
  return 'fa_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36)
}

/**
 * Uint8Array → Base64。使用分块方式避免大文件 O(n²) 字符串拼接。
 * 参照 MDN btoa 大字符串最佳实践。
 */
function _arrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000 // 32KB chunks — 避免 call stack overflow
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))))
  }
  return btoa(chunks.join(''))
}

// ---- Glob 匹配 ----

function _matchesPattern(testPath: string, pattern: string): boolean {
  if (!pattern) return false
  // **/*.ext or **/{*.ext1,*.ext2} → 先剥离 **/ 前缀再匹配
  if (pattern.startsWith('**/')) {
    return _matchesPattern(testPath, pattern.slice(3))
  }
  // **/*.ext
  const globMatch = pattern.match(/^\*\*\/\*(\.\w+)$/)
  if (globMatch) {
    return testPath.toLowerCase().endsWith(globMatch[1].toLowerCase())
  }
  // {*.ext1,*.ext2}
  if (pattern.startsWith('{') && pattern.endsWith('}')) {
    const exts = pattern.slice(1, -1).split(',').map(s => s.trim().toLowerCase())
    return exts.some(ext => testPath.toLowerCase().endsWith(ext.replace('*', '').toLowerCase()))
  }
  // *.ext
  if (pattern.startsWith('*.')) {
    return testPath.toLowerCase().endsWith(pattern.slice(1).toLowerCase())
  }
  return testPath === pattern
}

// ---- 目录扫描 ----
// 使用 Tauri 官方 typed API readDir（@tauri-apps/plugin-fs）。
// 官方 API 不暴露 recursive 参数；参照官方示例通过 isDirectory 手动递归。
// 参照：https://v2.tauri.app/plugin/file-system/#read-1

async function _scanDir(basePath: string, pattern: string, results: FileInfo[]): Promise<void> {
  const [{ readDir }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])

  const recursive = pattern.includes('**')

  /**
   * 官方推荐方式：手动递归遍历。
   * 参照 Tauri 官方 readDir 示例中的 processEntriesRecursively 模式：
   *   for entry of entries:
   *     if entry.isDirectory → readDir(dir) → processEntriesRecursively(...)
   */
  const walk = async (dirPath: string, relativeDir: string): Promise<void> => {
    let entries: DirEntry[]
    try {
      entries = await readDir(dirPath)
    } catch (e: any) {
      console.warn('[FileAccess] 无法读取子目录: ' + dirPath + ' — ' + (e?.message || String(e)))
      return
    }

    for (const entry of entries) {
      const relPath = relativeDir ? await join(relativeDir, entry.name) : entry.name

      if (entry.isDirectory) {
        if (recursive) {
          const nextDir = await join(dirPath, entry.name)
          await walk(nextDir, relPath)
        }
      } else if (entry.isFile || entry.isSymlink) {
        if (_matchesPattern(relPath, pattern) || _matchesPattern(entry.name, pattern)) {
          results.push({
            name: entry.name,
            path: relPath,
            size: 0, // DirEntry 不含 size；如需文件大小可额外调用 stat()
            isDir: false,
          })
        }
      }
    }
  }
  await walk(basePath, '')
}

// ---- 公共 API ----

export async function requestAccess(serviceId: string, req: FileAccessRequest): Promise<FileAccessGrant> {
  let folderPath = req.path

  if (!folderPath) {
    let isTauri = false
    try { await import('@tauri-apps/api/core'); isTauri = true } catch { /* web */ }
    if (isTauri) {
      const picked = await pickFolder('选择文件夹')
      if (!picked) throw new Error('未选择文件夹')
      folderPath = picked
    } else {
      folderPath = prompt('请输入文件夹路径:', '') || undefined
      if (!folderPath) throw new Error('未指定文件夹路径')
    }
  }

  if (!folderPath) throw new Error('未指定文件夹路径')

  const pattern = req.pattern || '*'

  if (!req.silent) {
    const purpose = req.purpose || '读取文件'
    const confirmed = confirm(
      '服务请求访问文件夹\n\n' +
      '路径: ' + folderPath + '\n' +
      '用途: ' + purpose + '\n' +
      '模式: ' + pattern + '\n\n' +
      '允许访问？'
    )
    if (!confirmed) throw new Error('用户拒绝了文件访问')
  } else {
    console.log('[FileAccess] 静默授权: ' + serviceId + ' -> ' + folderPath + ' (' + pattern + ')')
  }

  const token = _generateToken()
  const grant: FileAccessGrant = {
    token,
    path: folderPath,
    pattern,
    createdAt: new Date().toISOString(),
  }

  _grants.set(token, { grant, serviceId })
  console.log('[FileAccess] ✓ 授权: ' + serviceId + ' -> ' + grant.path + ' (' + grant.pattern + ')')

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

  const [{ readTextFile: fsReadTextFile }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  const fullPath = await join(grant.path, relativePath)

  try {
    return await fsReadTextFile(fullPath)
  } catch (e: any) {
    throw new Error('无法读取文件: ' + (e?.message || String(e)))
  }
}

export async function readBinaryFile(serviceId: string, token: string, relativePath: string): Promise<string> {
  const grant = validate(serviceId, token)
  if (!grant) throw new Error('文件访问授权无效或已过期')

  const [{ readFile: fsReadFile }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  const fullPath = await join(grant.path, relativePath)

  try {
    const bytes = await fsReadFile(fullPath)
    return _arrayToBase64(bytes)
  } catch (e: any) {
    throw new Error('无法读取文件: ' + (e?.message || String(e)))
  }
}
