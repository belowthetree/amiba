import { picker } from '@kit.CoreFileKit'
import { fileIo as fs, fileShare } from '@kit.CoreFileKit'
import { common } from '@kit.AbilityKit'
import { util } from '@kit.ArkTS'
import { ensureParentDir, getFilesDir } from './FsCommands'

const TAG = '[AmibaPicker]'

// 文件夹选取器 + fileAccess 授权链命令（对应 Android SAF Picker 模型；docs/harmonyos-migration.md §5.7）。
// 模型对齐 Android：DocumentViewPicker 选目录拿 picker URI（file://docs/...）→ 前端持有 URI 作为 grant.path →
// 列目录/读文件经本族命令直读 URI（沙箱外目录，fs_* 的 resolveSafe 会拒绝，故独立成族）。
// 与 Android 的差异：授权持久化靠 fileShare.persistPermission（需 ohos.permission.FILE_ACCESS_PERSIST，
// ACL 受限权限，默认签名拿不到 → best-effort 尝试，失败降级为「仅本次应用生命周期有效」，
// 与前端 file-access-grants.ts 的既有设计一致，无功能缺口）。
export const PICKER_COMMANDS: string[] = [
  'file_access_pick_folder',
  'file_access_list',
  'file_access_read_text',
  'file_access_read_binary'
]

// ---- 线协议返回类型（与 src/types/native-bridge.ts PICKER_COMMANDS 对应）----
// 返回对象本身（非 JSON 字符串）——HarmonyBridge.invoke 统一 JSON.stringify 一层，
// 前端 nativeInvoke 只 JSON.parse 一次即得（同 WebFetchCommands 注释说明的序列化约定）
interface PickFolderResult {
  uri: string
}

// 对齐 src/types/service.ts FileInfo（path 为相对授权根目录的路径）；
// 与 Android/桌面分支语义一致：仅返回文件（isDir 恒 false），pattern 过滤由前端 _matchesPattern 完成
interface FileAccessEntry {
  name: string
  path: string
  size: number
  isDir: boolean
}

interface DataResult {
  data: string
}

// 递归深度保护（防符号链接环；docs 目录树实际场景远浅于此）
const MAX_WALK_DEPTH = 20

// DocumentViewPicker 需要 UIAbilityContext：由 EntryAbility.onCreate 注入（initDb 同款模式）
let abilityContext: common.UIAbilityContext | null = null

export function initPickerContext(context: common.UIAbilityContext): void {
  abilityContext = context
  console.log(`${TAG} UIAbilityContext 已注入`)
}

// 供 Index.ets onShowFileSelector 复用同一上下文
export function getPickerContext(): common.UIAbilityContext | null {
  return abilityContext
}

// ---- 参数提取（风格同 HttpCommands）----
function reqStr(v: Object | undefined, name: string): string {
  if (typeof v !== 'string' || (v as string).length === 0) {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

function optStr(v: Object | undefined): string | null {
  return typeof v === 'string' && (v as string).length > 0 ? (v as string) : null
}

// ---- URI 工具 ----
// picker URI 为分层结构（file://docs/storage/Users/currentUser/...，映射真实路径层级），
// 子项 URI 直接按段编码拼接（前端 file-access-grants.ts 读文件时同款拼法，两侧须保持一致）
function joinUri(dirUri: string, name: string): string {
  return `${dirUri}/${encodeURIComponent(name)}`
}

// fs.stat(uri) 的 URI 入参自 API 22 才支持（工程 compatibleSdkVersion 为 API 12），
// 统一走 openSync(URI) → statSync(fd)；目录同样可用 READ_ONLY 打开取 fd
function statUri(uri: string): fs.Stat {
  const file = fs.openSync(uri, fs.OpenMode.READ_ONLY)
  try {
    return fs.statSync(file.fd)
  } finally {
    fs.closeSync(file)
  }
}

// 读取 URI 指向文件的全部字节（风格同 FsCommands.readAllBytes；文件均为 KB 级）
function readAllBytesByUri(uri: string): Uint8Array {
  const file = fs.openSync(uri, fs.OpenMode.READ_ONLY)
  try {
    const size = fs.statSync(file.fd).size
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

// ============================================================
// file_access_pick_folder：DocumentViewPicker 文件夹选择模式
// 返回 {uri}；用户取消（空结果数组）返回 null（前端 pickFolder 据此回 null，不再下落）
// ============================================================
async function cmdPickFolder(): Promise<PickFolderResult | null> {
  const ctx = abilityContext
  if (ctx === null) {
    throw new Error('Picker 上下文未初始化')
  }
  const opts = new picker.DocumentSelectOptions()
  opts.selectMode = picker.DocumentSelectMode.FOLDER
  opts.maxSelectNumber = 1
  console.log(`${TAG} === 拉起文件夹选取器 ===`)
  const docPicker = new picker.DocumentViewPicker(ctx)
  const uris = await docPicker.select(opts)
  if (uris.length === 0) {
    console.log(`${TAG} 用户取消选择`)
    return null
  }
  const uri = uris[0]
  console.log(`${TAG} ✓ 选中文件夹: ${uri}`)
  await persistUriPermission(uri)
  const r: PickFolderResult = { uri: uri }
  return r
}

// 授权持久化（best-effort）：FILE_ACCESS_PERSIST 为 ACL 受限权限，普通签名不授予，
// 失败时降级为「仅本次应用生命周期有效」（picker 授权本身在当前进程内持续可读，
// 与前端 file-access-grants 不落盘设计语义一致，可接受）
async function persistUriPermission(uri: string): Promise<void> {
  try {
    const policy: fileShare.PolicyInfo = {
      uri: uri,
      operationMode: fileShare.OperationMode.READ_MODE
    }
    await fileShare.persistPermission([policy])
    console.log(`${TAG} ✓ URI 权限已持久化`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`${TAG} ✗ persistPermission 失败（降级为本次生命周期有效）: ${msg}`)
  }
}

// ============================================================
// file_access_list：{uri, pattern} → FileAccessEntry[]
// pattern 仅用于判定递归（含 '**'，与前端 _scanDir 同款规则）；glob 过滤留在前端做。
// 枚举方式：listFileSync(URI) 列名 → 逐项 stat(fd) 判型取大小（URI 是否可直读见文件头注释，
// fs.openSync 文档明确支持 URI；listFileSync(URI) 未在 d.ts 标注，为社区通用做法，需真机回归）
// ============================================================
async function cmdFileAccessList(args: Record<string, Object>): Promise<FileAccessEntry[]> {
  const uri = reqStr(args['uri'], 'uri')
  const pattern = optStr(args['pattern']) ?? '*'
  const recursive = pattern.includes('**')
  const results: FileAccessEntry[] = []
  walkUri(uri, '', recursive, 0, results)
  console.log(`${TAG} ✓ file_access_list: ${results.length} 个文件（recursive=${recursive}）`)
  return results
}

function walkUri(dirUri: string, relDir: string, recursive: boolean,
  depth: number, results: FileAccessEntry[]): void {
  if (depth > MAX_WALK_DEPTH) {
    console.warn(`${TAG} 超出最大递归深度，截断: ${relDir}`)
    return
  }
  const names = fs.listFileSync(dirUri)
  for (const name of names) {
    const childUri = joinUri(dirUri, name)
    const relPath = relDir.length > 0 ? `${relDir}/${name}` : name
    let st: fs.Stat
    try {
      st = statUri(childUri)
    } catch (e) {
      // 单个条目失败不中断整体枚举（对齐前端 Android 分支子目录失败仅 warn 的语义）
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`${TAG} 条目 stat 失败（跳过）: ${relPath}: ${msg}`)
      continue
    }
    if (st.isDirectory()) {
      if (recursive) {
        walkUri(childUri, relPath, recursive, depth + 1, results)
      }
    } else if (st.isFile()) {
      const entry: FileAccessEntry = {
        name: name,
        path: relPath,
        size: st.size,
        isDir: false
      }
      results.push(entry)
    }
  }
}

// ============================================================
// file_access_read_text：{uri}（前端已拼好子路径）→ {data: string}
// ============================================================
function cmdFileAccessReadText(args: Record<string, Object>): DataResult {
  const uri = reqStr(args['uri'], 'uri')
  const bytes = readAllBytesByUri(uri)
  const r: DataResult = { data: util.TextDecoder.create('utf-8').decodeToString(bytes) }
  console.log(`${TAG} ✓ file_access_read_text: ${bytes.length}B`)
  return r
}

// ============================================================
// file_access_read_binary：{uri} → {data: base64}
// ============================================================
const base64Helper = new util.Base64Helper()

function cmdFileAccessReadBinary(args: Record<string, Object>): DataResult {
  const uri = reqStr(args['uri'], 'uri')
  const bytes = readAllBytesByUri(uri)
  const r: DataResult = { data: base64Helper.encodeToStringSync(bytes) }
  console.log(`${TAG} ✓ file_access_read_binary: ${bytes.length}B`)
  return r
}

// ---- 命令入口 ----
// pick_folder 返回 {uri} 或 null；list 返回 FileAccessEntry[]；read_* 返回 {data}。
// 均直接返回对象/数组（HarmonyBridge.invoke 统一 JSON.stringify，前端 JSON.parse 一次）
export async function handlePickerCommand(cmd: string, args: Record<string, Object>): Promise<Object | null> {
  try {
    switch (cmd) {
      case 'file_access_pick_folder':
        return await cmdPickFolder()
      case 'file_access_list':
        return await cmdFileAccessList(args)
      case 'file_access_read_text':
        return cmdFileAccessReadText(args)
      case 'file_access_read_binary':
        return cmdFileAccessReadBinary(args)
      default:
        throw new Error(`未知 picker 命令: ${cmd}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ ${cmd} 失败: ${msg}`)
    // ArkTS 限制 throw 只能抛 Error：统一重抛 Error 实例
    throw new Error(msg)
  }
}

// ============================================================
// Web 文件选择桥接（Index.ets onShowFileSelector 调用，非桥命令）
// <input type=file>（技能 ZIP 导入、图片选择等）→ DocumentViewPicker 选文件 →
// 拷贝进沙箱 amiba/uploads/ 暂存 → 返回 file:// 沙箱 URI 列表给 FileSelectorResult.handleFileList。
// 回传格式结论：handleFileList 接受 fd:// 或 file:// URI；picker URI（file://docs/...）
// 归文档提供者所有，ArkWeb 内核渲染进程直读不可靠（社区与官方示例的通用做法是
// 先拷入应用沙箱再以 file:// 沙箱路径回传），故统一走「拷贝 + file://」路径，不用 fd://。
// ============================================================

// FileSelectorParam.getMode() 数值（component/web.d.ts 全局枚举 FileSelectorMode，取数值避免依赖全局声明）：
// 0=FileOpenMode 单选，1=FileOpenMultipleMode 多选，2=FileOpenFolderMode，3=FileSaveMode（Web 侧不会触发）
const FILE_SELECTOR_MODE_MULTIPLE = 1

// 从 URI 末段提取文件名（picker URI 末段为编码后的真实文件名），剥离路径分隔与非法字符
function webUploadFileName(uri: string): string {
  const seg = uri.substring(uri.lastIndexOf('/') + 1)
  let name = seg
  try {
    name = decodeURIComponent(seg)
  } catch (e) {
    // 非法转义序列：保留原段
  }
  name = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return name.length > 0 ? name : 'upload.bin'
}

// 拷贝 picker 选中文档到沙箱暂存目录（风格同 FsCommands.writeAllBytes；上传文件均为 MB 级以下）
function copyToUploads(uri: string): string {
  const bytes = readAllBytesByUri(uri)
  const dest = `${getFilesDir()}/amiba/uploads/${webUploadFileName(uri)}`
  ensureParentDir(dest)
  const file = fs.openSync(dest, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
  try {
    let total = 0
    while (total < bytes.byteLength) {
      const n = fs.writeSync(file.fd, bytes.buffer.slice(total))
      if (n <= 0) {
        throw new Error(`写入失败: ${total}/${bytes.byteLength}`)
      }
      total += n
    }
  } finally {
    fs.closeSync(file)
  }
  return dest
}

// onShowFileSelector 入口：返回 handleFileList 需要的 file:// 沙箱 URI 列表；用户取消返回空列表。
// acceptTypes 为 FileSelectorParam.getAcceptType() 原值（'.zip' 后缀或 'image/*' MIME），
// 仅后缀项可映射为 picker fileSuffixFilters；MIME 项 DocumentViewPicker 不支持过滤，忽略并记日志。
// isCapture 为 true 时表示要求拍摄采集（<input capture>），不支持摄像头，回落为普通文件选择。
export async function pickFilesForWeb(acceptTypes: string[], mode: number, isCapture: boolean): Promise<string[]> {
  const ctx = abilityContext
  if (ctx === null) {
    throw new Error('Picker 上下文未初始化')
  }
  const multi = mode === FILE_SELECTOR_MODE_MULTIPLE
  if (isCapture) {
    console.warn(`${TAG} isCapture=true（拍摄采集不支持，回落为文件选择）`)
  }
  const opts = new picker.DocumentSelectOptions()
  opts.selectMode = picker.DocumentSelectMode.FILE
  opts.maxSelectNumber = multi ? 500 : 1
  const suffixes: string[] = []
  for (const t of acceptTypes) {
    if (t.startsWith('.')) {
      suffixes.push(t)
    }
  }
  if (suffixes.length > 0) {
    opts.fileSuffixFilters = suffixes
  } else if (acceptTypes.length > 0) {
    console.log(`${TAG} accept 为 MIME 类型（picker 不支持过滤，放开全类型）: ${acceptTypes.join(',')}`)
  }
  console.log(`${TAG} === 拉起文件选取器（multi=${multi}）===`)
  const docPicker = new picker.DocumentViewPicker(ctx)
  const uris = await docPicker.select(opts)
  if (uris.length === 0) {
    console.log(`${TAG} 用户取消选择`)
    return []
  }
  const out: string[] = []
  for (const uri of uris) {
    const dest = copyToUploads(uri)
    console.log(`${TAG} ✓ 上传暂存: ${uri} → ${dest}`)
    out.push(`file://${dest}`)
  }
  return out
}
