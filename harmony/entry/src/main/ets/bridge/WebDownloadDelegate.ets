import { webview } from '@kit.ArkWeb'
import { fileIo as fs } from '@kit.CoreFileKit'
import { ensureParentDir, getFilesDir } from './FsCommands'
import { HarmonyBridge } from './HarmonyBridge'

const TAG = '[AmibaDownload]'

// Web 下载落盘（前端 <a download> + blob/data URL 导出：记账本导出、技能 ZIP 导出、日志/备份导出）。
// Tauri 侧现状（grep src-tauri/src 结论）：无任何 webview 下载事件接管——桌面端 <a download> 由
// 系统 WebView（Windows WebView2 等）原生下载 UI 存入系统下载目录，前端对完成无感知（无事件/通知），
// src-tauri 里仅有 download_file 命令（更新包专用，与本链路无关）。
// 鸿蒙映射方案：onDownloadStart 事件（web.d.ts，载荷仅 url/mimetype/contentDisposition/contentLength 元数据，
// 无 WebDownloadItem——回调形态已退化）仅用于记日志；真正接管靠 WebDownloadDelegate：
// onBeforeDownload 拿 WebDownloadItem → start(path) 指定落盘文件 → updated/finish/failed 回调跟踪。
// 落盘目录对齐 fs 沙箱根：${filesDir}/amiba/downloads/（复用 FsCommands 的 getFilesDir/ensureParentDir）。
// 完成后经 HarmonyBridge.emitToWeb('download-complete', {path, name}) 通知前端
// （Tauri 无同名事件，前端当前不监听——属预留能力，已在 src/types/native-bridge.ts 事件注释区登记）。
// 注意：data: URL 下载 ArkWeb 不保证触发 onDownloadStart/delegate，不强行支持；blob: URL 可正常走本链路。
// setDownloadDelegate/WebDownloadDelegate 需 API 18+：Index.ets 注册处 try/catch 降级为仅日志。

interface DownloadMeta {
  path: string
  name: string
}

// download-complete 事件载荷（native-bridge.ts 事件注释区登记）
interface DownloadCompletePayload {
  path: string
  name: string
}

let bridge: HarmonyBridge | null = null

// guid → 落盘目标（onBeforeDownload 建立，finish/failed 消费清理）
const activeDownloads = new Map<string, DownloadMeta>()
// guid → 上次日志百分比（按每 10% 节流，避免逐块刷屏）
const lastLoggedPct = new Map<string, number>()

export function initDownloadBridge(b: HarmonyBridge): void {
  bridge = b
  console.log(`${TAG} 桥已注入`)
}

// 文件名清洗：剥离路径分隔与非法字符；blob: URL 无 contentDisposition 时 suggestedFileName 为空
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned
}

// 解析落盘目标：suggestedFileName 优先，空则 download-<guid>；重名时扩展名前追加序号
function resolveTargetPath(item: webview.WebDownloadItem): DownloadMeta {
  let name = sanitizeFileName(item.getSuggestedFileName())
  if (name.length === 0) {
    name = `download-${item.getGuid()}`
  }
  const dir = `${getFilesDir()}/amiba/downloads`
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.substring(0, dot) : name
  const ext = dot > 0 ? name.substring(dot) : ''
  let path = `${dir}/${name}`
  let seq = 1
  while (fs.accessSync(path)) {
    path = `${dir}/${stem}-${seq}${ext}`
    seq++
  }
  ensureParentDir(path)
  const meta: DownloadMeta = { path: path, name: path.substring(path.lastIndexOf('/') + 1) }
  return meta
}

function emitComplete(meta: DownloadMeta): void {
  const b = bridge
  if (b === null) {
    console.warn(`${TAG} 桥未注入，download-complete 事件丢失: ${meta.path}`)
    return
  }
  const payload: DownloadCompletePayload = { path: meta.path, name: meta.name }
  b.emitToWeb('download-complete', payload)
}

function deletePartialQuietly(path: string): void {
  try {
    if (fs.accessSync(path)) {
      fs.unlinkSync(path)
    }
  } catch (e) {
    console.warn(`${TAG} 半成品文件清理失败: ${path}`)
  }
}

function finishTracking(guid: string): void {
  activeDownloads.delete(guid)
  lastLoggedPct.delete(guid)
}

// 构造主 Web 的下载代理（Index.ets onControllerAttached 中 controller.setDownloadDelegate 注册）
export function createDownloadDelegate(): webview.WebDownloadDelegate {
  const delegate = new webview.WebDownloadDelegate()

  delegate.onBeforeDownload((item) => {
    const meta = resolveTargetPath(item)
    const guid = item.getGuid()
    activeDownloads.set(guid, meta)
    lastLoggedPct.set(guid, 0)
    console.log(`${TAG} === 开始下载: ${item.getUrl()} → ${meta.path}（mime=${item.getMimeType()} total=${item.getTotalBytes()}B）===`)
    try {
      item.start(meta.path)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`${TAG} ✗ 启动下载失败: ${msg}`)
      finishTracking(guid)
    }
  })

  delegate.onDownloadUpdated((item) => {
    const guid = item.getGuid()
    const pct = item.getPercentComplete()
    const last = lastLoggedPct.get(guid) ?? 0
    if (pct >= last + 10) {
      lastLoggedPct.set(guid, pct)
      console.log(`${TAG} 下载进度 ${pct}% (${item.getGuid()})`)
    }
  })

  delegate.onDownloadFinish((item) => {
    const guid = item.getGuid()
    const meta = activeDownloads.get(guid)
    if (meta) {
      console.log(`${TAG} ✓ 下载完成: ${meta.path} (${item.getTotalBytes()}B)`)
      emitComplete(meta)
    } else {
      console.log(`${TAG} ✓ 下载完成（无目标记录）: ${guid}`)
    }
    finishTracking(guid)
  })

  delegate.onDownloadFailed((item) => {
    const guid = item.getGuid()
    const meta = activeDownloads.get(guid)
    console.error(`${TAG} ✗ 下载失败: code=${item.getLastErrorCode()} url=${item.getUrl()}`)
    if (meta) {
      deletePartialQuietly(meta.path)
    }
    finishTracking(guid)
  })

  return delegate
}
