import { http } from '@kit.NetworkKit'
import { fileIo as fs } from '@kit.CoreFileKit'
import { util } from '@kit.ArkTS'
import { HarmonyBridge } from './HarmonyBridge'
import { resolveSafe, ensureParentDir, BASE_APP_DATA } from './FsCommands'

const TAG = '[AmibaHttp]'

// HTTP 三命令（对应 Tauri Rust 侧 src-tauri/src/lib.rs；docs/harmonyos-migration.md §5.5）
export const HTTP_COMMANDS: string[] = [
  'download_file',
  'cancel_download',
  'service_http_request'
]

// ---- 线协议返回类型 ----
// service_http_request 返回结构（与 docs/jsbridge.md fetch 模块 / Rust serde_json 输出一致）
interface ServiceHttpResult {
  status: number
  body: string
}

// download-progress 事件载荷（与 src/config/updater.ts nativeListen 载荷一致）
interface DownloadProgress {
  received: number
  total: number
}

// 进度事件节流间隔（Rust 侧每 chunk 直推；ArkWeb runJavaScript 有桥开销，按时间节流）
const PROGRESS_EMIT_INTERVAL_MS = 200

// 下载 read 超时上限（对齐 Rust reqwest 600s 总超时的宽松语义）
const DOWNLOAD_READ_TIMEOUT_MS = 600000

// 桥实例：由 Index.ets 在 attachController 后注入（emitToWeb 推送 download-progress）
let bridge: HarmonyBridge | null = null

export function initHttpBridge(b: HarmonyBridge): void {
  bridge = b
  console.log(`${TAG} 桥已注入`)
}

// 下载状态：同一时间仅一个下载（与 Rust DownloadCancel 单令牌语义一致）
let activeDownload: http.HttpRequest | null = null
let downloadCancelled = false

// ---- 参数提取（风格同 FsCommands）----
function reqStr(v: Object | undefined, name: string): string {
  if (typeof v !== 'string' || (v as string).length === 0) {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

function optStr(v: Object | undefined): string | null {
  return typeof v === 'string' ? (v as string) : null
}

// ---- 小工具 ----
function emitProgress(received: number, total: number): void {
  const b = bridge
  if (b === null) {
    console.warn(`${TAG} 桥未注入，进度事件丢失: ${received}/${total}`)
    return
  }
  const payload: DownloadProgress = { received: received, total: total }
  b.emitToWeb('download-progress', payload)
}

function destroyQuietly(req: http.HttpRequest): void {
  try {
    req.destroy()
  } catch (e) {
    // 已销毁/已结束：忽略
  }
}

function closeQuietly(file: fs.File): void {
  try {
    fs.closeSync(file)
  } catch (e) {
    // 忽略
  }
}

function deletePartialQuietly(dest: string): void {
  try {
    if (fs.accessSync(dest)) {
      fs.unlinkSync(dest)
    }
  } catch (e) {
    console.warn(`${TAG} 半成品文件清理失败: ${dest}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

// ============================================================
// download_file：流式下载 + download-progress 事件 + cancel_download 可取消
// 语义对齐 Rust download_file（reqwest 流式循环），错误文案一致
// ============================================================
async function cmdDownloadFile(args: Record<string, Object>): Promise<string> {
  const url = reqStr(args['url'], 'url')
  // dest 为沙箱内绝对路径（前端 updater 拼接的 appDataDir 路径），复用 fs 防穿越校验
  const dest = resolveSafe(reqStr(args['dest'], 'dest'), BASE_APP_DATA)
  if (activeDownload !== null) {
    throw new Error('已有下载任务进行中')
  }
  try {
    ensureParentDir(dest)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`创建目录失败: ${msg}`)
  }
  let file: fs.File
  try {
    file = fs.openSync(dest, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`创建文件失败: ${msg}`)
  }

  const req = http.createHttp()
  activeDownload = req
  downloadCancelled = false
  let written = 0
  let total = 0
  let lastEmitMs = 0
  let lastLoggedPct = -1
  let writeError: string | null = null
  let dataEnded = false

  // 流式写文件：逐块追加；写失败记录错误并主动断开（由下方统一收尾抛错）
  req.on('dataReceive', (chunk: ArrayBuffer) => {
    if (downloadCancelled || writeError !== null) {
      return
    }
    try {
      let off = 0
      while (off < chunk.byteLength) {
        const n = fs.writeSync(file.fd, chunk.slice(off))
        if (n <= 0) {
          throw new Error(`writeSync 返回 ${n}`)
        }
        off += n
      }
      written += chunk.byteLength
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      writeError = `写入文件失败: ${msg}`
      destroyQuietly(req)
    }
  })

  // 进度推送：dataReceiveProgress 逐块触发，经时间节流后 emitToWeb；日志按每 10% 节流
  req.on('dataReceiveProgress', (info: http.DataReceiveProgressInfo) => {
    // totalSize 未知（chunked）时对齐 Rust content_length().unwrap_or(0)
    total = info.totalSize > 0 ? info.totalSize : 0
    const now = Date.now()
    if (now - lastEmitMs < PROGRESS_EMIT_INTERVAL_MS) {
      return
    }
    lastEmitMs = now
    emitProgress(info.receiveSize, total)
    if (total > 0) {
      const pct = Math.floor(info.receiveSize * 100 / total)
      if (pct >= lastLoggedPct + 10) {
        lastLoggedPct = pct
        console.log(`${TAG} 下载进度 ${pct}% (${info.receiveSize}/${total})`)
      }
    }
  })

  req.on('dataEnd', () => {
    dataEnded = true
  })

  let succeeded = false
  try {
    console.log(`${TAG} === 开始下载: ${url} → ${dest} ===`)
    const dlHeader: Record<string, string> = { 'User-Agent': 'amiba-updater' }
    const opts: http.HttpRequestOptions = {
      method: http.RequestMethod.GET,
      header: dlHeader,
      connectTimeout: 60000,
      readTimeout: DOWNLOAD_READ_TIMEOUT_MS
    }
    const code = await req.requestInStream(url, opts)

    // requestInStream resolve（响应码）与 dataEnd（数据写完）的先后时序随系统版本不固定，两者都等；
    // 中途断流不出 dataEnd 由超时轮询兜底；取消/写失败经标志位及时跳出
    const deadline = Date.now() + DOWNLOAD_READ_TIMEOUT_MS + 10000
    while (!dataEnded) {
      if (downloadCancelled) {
        throw new Error('下载已取消')
      }
      const we = writeError
      if (we !== null) {
        throw new Error(we)
      }
      if (Date.now() > deadline) {
        throw new Error('下载请求失败: 数据流超时未完成')
      }
      await sleep(50)
    }

    // 状态码校验对齐 Rust status.is_success()（2xx）
    if (code < 200 || code >= 300) {
      throw new Error(`服务器返回 HTTP ${code}`)
    }
    // 终值进度（节流可能吞掉最后一次 emit，对齐 Rust 末 chunk 必发）
    emitProgress(written, total)
    succeeded = true
    console.log(`${TAG} ✓ 下载完成: ${url} → ${dest} (${written} bytes)`)
    return dest
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const we = writeError
    let finalMsg: string
    if (downloadCancelled) {
      finalMsg = '下载已取消'
      console.log(`${TAG} 已取消: ${url}`)
    } else if (we !== null) {
      finalMsg = we
    } else if (msg.startsWith('服务器返回') || msg.startsWith('下载')) {
      finalMsg = msg
    } else {
      finalMsg = `下载请求失败: ${msg}`
    }
    console.error(`${TAG} ✗ 下载失败: ${finalMsg}`)
    throw new Error(finalMsg)
  } finally {
    closeQuietly(file)
    destroyQuietly(req)
    activeDownload = null
    // 失败/取消一律删除半成品（Rust 仅取消时删除；HTTP 错误时 Rust 尚未建文件——此处统一收口）
    if (!succeeded) {
      deletePartialQuietly(dest)
    }
  }
}

// ============================================================
// cancel_download：取消进行中的下载（无下载时静默成功，与 Rust 一致）
// ============================================================
function cmdCancelDownload(): Object | null {
  const req = activeDownload
  if (req !== null) {
    downloadCancelled = true
    destroyQuietly(req)
    console.log(`${TAG} 已发送取消信号`)
  }
  return null
}

// ============================================================
// service_http_request：服务沙箱 fetch 权限的代理实现（绕 CORS）
// 语义对齐 Rust service_http_request：10s 超时、仅 http/https、透传 headers/body
// ============================================================
async function cmdServiceHttpRequest(args: Record<string, Object>): Promise<ServiceHttpResult> {
  const url = reqStr(args['url'], 'url')
  const method = reqStr(args['method'], 'method').toUpperCase()
  const body = optStr(args['body'])

  // 协议白名单（错误文案与 Rust 一致）
  const schemeIdx = url.indexOf(':')
  if (schemeIdx <= 0) {
    throw new Error(`Invalid URL: ${url}`)
  }
  const scheme = url.substring(0, schemeIdx).toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') {
    throw new Error(`Blocked protocol: ${scheme}`)
  }

  let reqMethod: http.RequestMethod
  switch (method) {
    case 'GET':
      reqMethod = http.RequestMethod.GET
      break
    case 'POST':
      reqMethod = http.RequestMethod.POST
      break
    case 'PUT':
      reqMethod = http.RequestMethod.PUT
      break
    case 'DELETE':
      reqMethod = http.RequestMethod.DELETE
      break
    default:
      throw new Error(`Unsupported HTTP method: ${method}`)
  }

  // 透传 headers；UA 固定 AmibaService/1.0（调用方未显式指定时，对齐 Rust client 级 user_agent）
  const header: Record<string, string> = {}
  const rawHeaders = args['headers']
  if (typeof rawHeaders === 'object' && rawHeaders !== null) {
    const h = rawHeaders as Record<string, Object>
    const keys = Object.keys(h)
    for (const k of keys) {
      const v = h[k]
      if (typeof v === 'string') {
        header[k] = v
      }
    }
  }
  const hasUA = Object.keys(header).some((k: string) => k.toLowerCase() === 'user-agent')
  if (!hasUA) {
    header['user-agent'] = 'AmibaService/1.0'
  }

  const opts: http.HttpRequestOptions = {
    method: reqMethod,
    header: header,
    connectTimeout: 10000,
    readTimeout: 10000,
    expectDataType: http.HttpDataType.STRING
  }
  if (body !== null) {
    opts.extraData = body
  }

  const req = http.createHttp()
  try {
    const resp = await req.request(url, opts)
    let bodyText: string
    if (typeof resp.result === 'string') {
      bodyText = resp.result
    } else if (resp.result instanceof ArrayBuffer) {
      bodyText = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(resp.result))
    } else {
      bodyText = ''
    }
    const result: ServiceHttpResult = { status: resp.responseCode as number, body: bodyText }
    console.log(`${TAG} ✓ service_http_request ${method} ${url} → ${result.status} (${bodyText.length}B)`)
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Request failed: ${msg}`)
  } finally {
    destroyQuietly(req)
  }
}

// ---- 命令入口 ----
// download_file 返回写入路径字符串（前端 nativeInvoke<string> 直接取用）；
// cancel_download 返回 null；service_http_request 返回 {status, body}
export async function handleHttpCommand(cmd: string, args: Record<string, Object>): Promise<Object | null> {
  try {
    switch (cmd) {
      case 'download_file':
        return await cmdDownloadFile(args)
      case 'cancel_download':
        return cmdCancelDownload()
      case 'service_http_request':
        return await cmdServiceHttpRequest(args)
      default:
        throw new Error(`未知 http 命令: ${cmd}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ ${cmd} 失败: ${msg}`)
    // ArkTS 限制 throw 只能抛 Error：统一重抛 Error 实例
    throw new Error(msg)
  }
}
