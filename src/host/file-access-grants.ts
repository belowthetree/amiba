// ============================================================
// 变形虫 (Amiba) — FileAccessGrants
// ============================================================
// 管理服务的文件访问授权。授权仅本次应用生命周期有效，不落盘。
// ============================================================

import type { FileAccessRequest, FileAccessGrant, FileInfo } from '../types/service'
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

function _arrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

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

// 单次 read_dir 调用获取整个目录树（recursive 由 pattern 是否含 ** 决定），
// 避免逐目录多次 IPC；注意 FileEntry.children 仅在 recursive:true 时填充。
async function _scanDir(basePath: string, pattern: string, results: FileInfo[]): Promise<void> {
  let isTauri = false
  try { await import('@tauri-apps/api/core'); isTauri = true } catch { /* web */ }
  if (!isTauri) throw new Error('文件访问仅在 Tauri 环境（桌面/移动端）可用')

  const recursive = pattern.includes('**')
  let entries: { name: string; children?: any[]; size?: number }[]
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    entries = await invoke('plugin:fs|read_dir', { path: basePath, recursive })
  } catch (e: any) {
    throw new Error('无法读取目录: ' + (e?.message || String(e)))
  }

  const walk = (list: typeof entries, relativeDir: string): void => {
    for (const entry of list) {
      const relPath = relativeDir ? relativeDir + '/' + entry.name : entry.name
      if (entry.children) {
        walk(entry.children, relPath)
      } else if (_matchesPattern(relPath, pattern) || _matchesPattern(entry.name, pattern)) {
        results.push({
          name: entry.name,
          path: relPath,
          size: entry.size ?? 0,
          isDir: false,
        })
      }
    }
  }
  walk(entries, '')
}

// ---- 公共 API ----

export async function requestAccess(serviceId: string, req: FileAccessRequest): Promise<FileAccessGrant> {
  let folderPath = req.path

  // 如果没有指定路径，弹出系统文件夹选择器
  if (!folderPath) {
    let isTauri = false
    try { await import('@tauri-apps/api/core'); isTauri = true } catch { /* web */ }
    if (isTauri) {
      // 统一使用 pickFolder（Android → Rust JNI / 桌面 → plugin-dialog）
      const picked = await pickFolder('选择文件夹')
      if (!picked) throw new Error('未选择文件夹')
      folderPath = picked
    } else {
      // 浏览器环境：使用 prompt 输入路径
      folderPath = prompt('请输入文件夹路径:', '') || undefined
      if (!folderPath) throw new Error('未指定文件夹路径')
    }
  }

  if (!folderPath) throw new Error('未指定文件夹路径')

  const pattern = req.pattern || '*'

  // 静默模式（path 已指定 + silent=true）：跳过 confirm
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
  console.log('[FileAccess] 授权: ' + serviceId + ' -> ' + grant.path + ' (' + grant.pattern + ')')

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
  const fullPath = grant.path + '/' + relativePath
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('plugin:fs|read_text_file', { path: fullPath })
  } catch (e: any) {
    throw new Error('无法读取文件: ' + (e?.message || String(e)))
  }
}

export async function readBinaryFile(serviceId: string, token: string, relativePath: string): Promise<string> {
  const grant = validate(serviceId, token)
  if (!grant) throw new Error('文件访问授权无效或已过期')
  const fullPath = grant.path + '/' + relativePath
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const bytes = await invoke<number[]>('plugin:fs|read_file', { path: fullPath })
    return _arrayToBase64(new Uint8Array(bytes))
  } catch (e: any) {
    throw new Error('无法读取文件: ' + (e?.message || String(e)))
  }
}