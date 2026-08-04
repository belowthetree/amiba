import { fileIo as fs } from '@kit.CoreFileKit'
import { util } from '@kit.ArkTS'
import { common } from '@kit.AbilityKit'

const TAG = '[AmibaFs]'

// BaseDirectory 数值镜像（与 @tauri-apps/api/path v2 / src/config/native-fs.ts 一致），当前前端仅用 AppData
const BASE_APP_DATA: number = 14
const BASE_APP_CACHE: number = 16

// ---- fs_* 线协议结果类型（与 src/types/native-bridge.ts 对应）----
interface DataResult {
  data: string
}
interface ExistsResult {
  exists: boolean
}
interface PathResult {
  path: string
}
interface FsDirEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
  isSymlink: boolean
}
interface EntriesResult {
  entries: FsDirEntry[]
}
interface FsStat {
  size: number
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  mtimeMs: number
  atimeMs: number
  btimeMs: number | null
}

let appFilesDir = ''
let appCacheDirPath = ''

// 由 EntryAbility.onCreate 调用，建立沙箱根
export function initFsDirs(context: common.UIAbilityContext): void {
  appFilesDir = context.filesDir
  appCacheDirPath = context.cacheDir
  console.log(`${TAG} filesDir=${appFilesDir}`)
  console.log(`${TAG} cacheDir=${appCacheDirPath}`)
}

// ---- 参数提取 ----
function reqStr(v: Object | undefined, name: string): string {
  if (typeof v !== 'string' || (v as string).length === 0) {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

function optBaseDir(v: Object | undefined): number {
  return typeof v === 'number' ? (v as number) : BASE_APP_DATA
}

// ---- 路径解析与防穿越（前端 storage.ts 另有 safePath，此为第二道防线）----
function resolveSafe(path: string, baseDir: number): string {
  const root = baseDir === BASE_APP_CACHE ? appCacheDirPath : appFilesDir
  let full: string
  if (path.startsWith('/')) {
    // 绝对路径：必须落在沙箱根内（卡片图片缓存等场景）
    full = path
  } else {
    const segs = path.split('/')
    if (segs.indexOf('..') >= 0) {
      throw new Error(`非法路径（含 ..）: ${path}`)
    }
    full = `${root}/${path}`
  }
  if (!full.startsWith(appFilesDir) && !full.startsWith(appCacheDirPath)) {
    throw new Error(`路径越出沙箱: ${path}`)
  }
  return full
}

// ---- 基础读写（不使用 offset 选项，语义无歧义；文件均为 KB 级）----
function readAllBytes(path: string): Uint8Array {
  const st = fs.statSync(path)
  const size = st.size
  const file = fs.openSync(path, fs.OpenMode.READ_ONLY)
  try {
    const out = new Uint8Array(size)
    let total = 0
    while (total < size) {
      const chunk = new ArrayBuffer(size - total)
      const n = fs.readSync(file.fd, chunk)
      if (n <= 0) {
        throw new Error(`读取不完整: ${total}/${size}`)
      }
      out.set(new Uint8Array(chunk, 0, n), total)
      total += n
    }
    return out
  } finally {
    fs.closeSync(file)
  }
}

function writeAllBytes(path: string, data: Uint8Array): void {
  ensureParentDir(path)
  const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
  try {
    let total = 0
    while (total < data.byteLength) {
      const n = fs.writeSync(file.fd, data.buffer.slice(total))
      if (n <= 0) {
        throw new Error(`写入失败: ${total}/${data.byteLength}`)
      }
      total += n
    }
  } finally {
    fs.closeSync(file)
  }
}

function mkdirRecursive(path: string): void {
  const segs = path.split('/')
  let cur = ''
  for (const s of segs) {
    if (s.length === 0) {
      continue
    }
    cur += '/' + s
    if (!fs.accessSync(cur)) {
      try {
        fs.mkdirSync(cur)
      } catch (e) {
        // 并发/已存在：忽略
      }
    }
  }
}

function ensureParentDir(path: string): void {
  const idx = path.lastIndexOf('/')
  if (idx > 0) {
    mkdirRecursive(path.substring(0, idx))
  }
}

async function removeRecursive(path: string): Promise<void> {
  if (!fs.accessSync(path)) {
    return
  }
  const st = fs.statSync(path)
  if (st.isDirectory()) {
    const names = fs.listFileSync(path)
    for (const name of names) {
      await removeRecursive(`${path}/${name}`)
    }
    fs.rmdirSync(path)
  } else {
    await fs.unlink(path)
  }
}

const base64Helper = new util.Base64Helper()

// ---- 命令入口（cmd 见 src/types/native-bridge.ts FS_COMMANDS）----
export async function handleFsCommand(cmd: string, args: Record<string, Object>): Promise<Object | null> {
  const baseDir = optBaseDir(args['baseDir'])
  switch (cmd) {
    case 'fs_read_text_file': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      const bytes = readAllBytes(p)
      const r: DataResult = { data: util.TextDecoder.create('utf-8').decodeToString(bytes) }
      return r
    }
    case 'fs_write_text_file': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      const text = reqStr(args['data'], 'data')
      writeAllBytes(p, new util.TextEncoder().encodeInto(text))
      return null
    }
    case 'fs_read_file': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      const r: DataResult = { data: base64Helper.encodeToStringSync(readAllBytes(p)) }
      return r
    }
    case 'fs_write_file': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      const bytes = base64Helper.decodeSync(reqStr(args['data'], 'data'))
      writeAllBytes(p, bytes)
      return null
    }
    case 'fs_read_dir': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      const names = fs.listFileSync(p)
      const entries: FsDirEntry[] = []
      for (const name of names) {
        const st = fs.statSync(`${p}/${name}`)
        entries.push({
          name: name,
          isDirectory: st.isDirectory(),
          isFile: st.isFile(),
          isSymlink: st.isSymbolicLink()
        })
      }
      const r: EntriesResult = { entries: entries }
      return r
    }
    case 'fs_mkdir': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      if (args['recursive'] === true) {
        mkdirRecursive(p)
      } else {
        ensureParentDir(p)
        if (!fs.accessSync(p)) {
          fs.mkdirSync(p)
        }
      }
      return null
    }
    case 'fs_remove': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      if (args['recursive'] === true) {
        await removeRecursive(p)
      } else if (fs.accessSync(p)) {
        const st = fs.statSync(p)
        if (st.isDirectory()) {
          fs.rmdirSync(p)
        } else {
          await fs.unlink(p)
        }
      }
      return null
    }
    case 'fs_exists': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      const r: ExistsResult = { exists: fs.accessSync(p) }
      return r
    }
    case 'fs_rename': {
      const oldBase = typeof args['oldPathBaseDir'] === 'number' ? args['oldPathBaseDir'] as number : BASE_APP_DATA
      const newBase = typeof args['newPathBaseDir'] === 'number' ? args['newPathBaseDir'] as number : BASE_APP_DATA
      const oldP = resolveSafe(reqStr(args['oldPath'], 'oldPath'), oldBase)
      const newP = resolveSafe(reqStr(args['newPath'], 'newPath'), newBase)
      ensureParentDir(newP)
      fs.renameSync(oldP, newP)
      return null
    }
    case 'fs_stat': {
      const p = resolveSafe(reqStr(args['path'], 'path'), baseDir)
      const st = fs.statSync(p)
      const r: FsStat = {
        size: st.size,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        isSymlink: st.isSymbolicLink(),
        mtimeMs: st.mtime * 1000,
        atimeMs: st.atime * 1000,
        btimeMs: null
      }
      return r
    }
    case 'fs_app_data_dir': {
      const r: PathResult = { path: appFilesDir }
      return r
    }
    case 'fs_app_cache_dir': {
      const r: PathResult = { path: appCacheDirPath }
      return r
    }
    default:
      throw new Error(`未知 fs 命令: ${cmd}`)
  }
}
