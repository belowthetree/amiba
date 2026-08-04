// ==== 文件系统桥：@tauri-apps/plugin-fs（+ @tauri-apps/api/path 子集）兼容 shim ====
// 签名与插件完全一致，业务代码把 import 来源从 '@tauri-apps/plugin-fs' / '@tauri-apps/api/path'
// 换成本模块即可零改动。分发规则：
//   tauri   — 动态 import 真实插件透传（行为与迁移前完全一致）
//   harmony — nativeInvoke('fs_*') 走鸿蒙壳（协议见 src/types/native-bridge.ts）
//   browser — 走真实插件并由其抛错（保留既有浏览器降级行为）
//
// 注意：BaseDirectory 为本地镜像（数值与 @tauri-apps/api/path v2 枚举一致， semver 稳定），
// 避免在 shim 内静态引入插件运行时。当前全库仅使用 BaseDirectory.AppData。

import type {
  DirEntry,
  ExistsOptions,
  FileInfo,
  MkdirOptions,
  ReadDirOptions,
  ReadFileOptions,
  RemoveOptions,
  RenameOptions,
  StatOptions,
  WriteFileOptions,
} from '@tauri-apps/plugin-fs'
import { FS_COMMANDS, type FsDirEntryWire, type FsStatWire } from '../types/native-bridge'
import { isHarmonyRuntime, nativeInvoke } from './platform-bridge'

// ---- BaseDirectory 本地镜像（值 = @tauri-apps/api/path v2 枚举）----
export const BaseDirectory = {
  Audio: 1,
  Cache: 2,
  Config: 3,
  Data: 4,
  LocalData: 5,
  Document: 6,
  Download: 7,
  Picture: 8,
  Public: 9,
  Video: 10,
  Resource: 11,
  Temp: 12,
  AppConfig: 13,
  AppData: 14,
  AppLocalData: 15,
  AppCache: 16,
  AppLog: 17,
  Desktop: 18,
  Executable: 19,
  Font: 20,
  Home: 21,
  Runtime: 22,
  Template: 23,
} as const
export type BaseDirectory = (typeof BaseDirectory)[keyof typeof BaseDirectory]

// ---- base64 <-> 字节（鸿蒙桥二进制线协议）----
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function pathString(path: string | URL): string {
  return typeof path === 'string' ? path : path.toString()
}

// ================================================================
// plugin-fs 兼容 API
// ================================================================

export async function readTextFile(path: string | URL, options?: ReadFileOptions): Promise<string> {
  if (isHarmonyRuntime()) {
    const r = await nativeInvoke<{ data: string }>(FS_COMMANDS.readTextFile, { path: pathString(path), baseDir: options?.baseDir })
    return r.data
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.readTextFile(path, options)
}

export async function writeTextFile(path: string | URL, data: string, options?: WriteFileOptions): Promise<void> {
  if (isHarmonyRuntime()) {
    await nativeInvoke(FS_COMMANDS.writeTextFile, { path: pathString(path), data, baseDir: options?.baseDir })
    return
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.writeTextFile(path, data, options)
}

export async function readFile(path: string | URL, options?: ReadFileOptions): Promise<Uint8Array> {
  if (isHarmonyRuntime()) {
    const r = await nativeInvoke<{ data: string }>(FS_COMMANDS.readFile, { path: pathString(path), baseDir: options?.baseDir })
    return base64ToBytes(r.data)
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.readFile(path, options)
}

export async function writeFile(
  path: string | URL,
  data: Uint8Array | ReadableStream<Uint8Array>,
  options?: WriteFileOptions,
): Promise<void> {
  if (isHarmonyRuntime()) {
    if (!(data instanceof Uint8Array)) throw new Error('[NativeFs] 鸿蒙桥 writeFile 仅支持 Uint8Array')
    await nativeInvoke(FS_COMMANDS.writeFile, { path: pathString(path), data: bytesToBase64(data), baseDir: options?.baseDir })
    return
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.writeFile(path, data, options)
}

export async function readDir(path: string | URL, options?: ReadDirOptions): Promise<DirEntry[]> {
  if (isHarmonyRuntime()) {
    const r = await nativeInvoke<{ entries: FsDirEntryWire[] }>(FS_COMMANDS.readDir, { path: pathString(path), baseDir: options?.baseDir })
    return r.entries
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.readDir(path, options)
}

export async function mkdir(path: string | URL, options?: MkdirOptions): Promise<void> {
  if (isHarmonyRuntime()) {
    await nativeInvoke(FS_COMMANDS.mkdir, { path: pathString(path), recursive: options?.recursive ?? false, baseDir: options?.baseDir })
    return
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.mkdir(path, options)
}

export async function remove(path: string | URL, options?: RemoveOptions): Promise<void> {
  if (isHarmonyRuntime()) {
    await nativeInvoke(FS_COMMANDS.remove, { path: pathString(path), recursive: options?.recursive ?? false, baseDir: options?.baseDir })
    return
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.remove(path, options)
}

export async function exists(path: string | URL, options?: ExistsOptions): Promise<boolean> {
  if (isHarmonyRuntime()) {
    const r = await nativeInvoke<{ exists: boolean }>(FS_COMMANDS.exists, { path: pathString(path), baseDir: options?.baseDir })
    return r.exists
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.exists(path, options)
}

export async function rename(oldPath: string | URL, newPath: string | URL, options?: RenameOptions): Promise<void> {
  if (isHarmonyRuntime()) {
    await nativeInvoke(FS_COMMANDS.rename, {
      oldPath: pathString(oldPath),
      newPath: pathString(newPath),
      oldPathBaseDir: options?.oldPathBaseDir,
      newPathBaseDir: options?.newPathBaseDir,
    })
    return
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.rename(oldPath, newPath, options)
}

export async function stat(path: string | URL, options?: StatOptions): Promise<FileInfo> {
  if (isHarmonyRuntime()) {
    const r = await nativeInvoke<FsStatWire>(FS_COMMANDS.stat, { path: pathString(path), baseDir: options?.baseDir })
    return {
      isFile: r.isFile,
      isDirectory: r.isDirectory,
      isSymlink: r.isSymlink,
      size: r.size,
      mtime: r.mtimeMs == null ? null : new Date(r.mtimeMs),
      atime: r.atimeMs == null ? null : new Date(r.atimeMs),
      birthtime: r.btimeMs == null ? null : new Date(r.btimeMs),
      readonly: false,
      fileAttributes: null,
      dev: null,
      ino: null,
      mode: null,
      nlink: null,
      uid: null,
      gid: null,
      rdev: null,
      blksize: null,
      blocks: null,
    }
  }
  const mod = await import('@tauri-apps/plugin-fs')
  return mod.stat(path, options)
}

// ================================================================
// @tauri-apps/api/path 子集（当前调用面：appDataDir / appCacheDir / join / dirname）
// ================================================================

export async function appDataDir(): Promise<string> {
  if (isHarmonyRuntime()) {
    const r = await nativeInvoke<{ path: string }>(FS_COMMANDS.appDataDir)
    return r.path
  }
  const mod = await import('@tauri-apps/api/path')
  return mod.appDataDir()
}

export async function appCacheDir(): Promise<string> {
  if (isHarmonyRuntime()) {
    const r = await nativeInvoke<{ path: string }>(FS_COMMANDS.appCacheDir)
    return r.path
  }
  const mod = await import('@tauri-apps/api/path')
  return mod.appCacheDir()
}

// 鸿蒙为 POSIX 环境，join/dirname 纯 JS 实现；tauri 透传原生（Windows 分隔符由原生处理）
function posixJoin(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/')
}

function posixDirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx < 0) return '.'
  if (idx === 0) return '/'
  return trimmed.slice(0, idx)
}

export async function join(...paths: string[]): Promise<string> {
  if (isHarmonyRuntime()) return posixJoin(...paths)
  const mod = await import('@tauri-apps/api/path')
  return mod.join(...paths)
}

export async function dirname(path: string): Promise<string> {
  if (isHarmonyRuntime()) return posixDirname(path)
  const mod = await import('@tauri-apps/api/path')
  return mod.dirname(path)
}
