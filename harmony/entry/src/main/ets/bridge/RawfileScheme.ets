import { webview, WebNetErrorList } from '@kit.ArkWeb'
import { common } from '@kit.AbilityKit'

const TAG = '[AmibaRaw]'

// 离线 H5 包方案（API 12+ WebSchemeHandler 自定义协议）：
// 旧 resource:// + onInterceptRequest 已从新 SDK 移除；页面与子资源全部走 amiba://local/*，
// 由本 handler 从 rawfile 读数据经 didReceiveResponse/Body/Finish 返回。
// 时序：EntryAbility.onCreate → customizeSchemes(静态，引擎初始化前) + initRawfileContext
//       Index.aboutToAppear → controller.setWebSchemeHandler('amiba', createRawfileSchemeHandler())
export const AMIBA_SCHEME = 'amiba'
export const AMIBA_HOST = 'local'

const MIME_MAP: Record<string, string> = {
  'html': 'text/html',
  'js': 'application/javascript',
  'mjs': 'application/javascript',
  'css': 'text/css',
  'json': 'application/json',
  'map': 'application/json',
  'svg': 'image/svg+xml',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'ico': 'image/x-icon',
  'woff': 'font/woff',
  'woff2': 'font/woff2',
  'ttf': 'font/ttf',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'yaml': 'text/yaml',
  'yml': 'text/yaml',
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav'
}

function mimeOf(path: string): string {
  const idx = path.lastIndexOf('.')
  if (idx < 0) {
    return 'application/octet-stream'
  }
  const ext = path.substring(idx + 1).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

let appContext: common.UIAbilityContext | null = null

export function initRawfileContext(context: common.UIAbilityContext): void {
  appContext = context
}

// amiba://local/assets/x.js?hash → assets/x.js
function urlToRawfilePath(url: string): string | null {
  let rest = url
  const schemeIdx = rest.indexOf('://')
  if (schemeIdx >= 0) {
    rest = rest.substring(schemeIdx + 3)
  }
  // 剥离 host（local）
  const slash = rest.indexOf('/')
  if (slash < 0) {
    return null
  }
  let path = rest.substring(slash + 1)
  const q = path.search(/[?#]/)
  if (q >= 0) {
    path = path.substring(0, q)
  }
  return path.length === 0 ? 'index.html' : path
}

export function createRawfileSchemeHandler(): webview.WebSchemeHandler {
  const handler = new webview.WebSchemeHandler()
  handler.onRequestStart(
    (request: webview.WebSchemeHandlerRequest, resourceHandler: webview.WebResourceHandler): boolean => {
      const url = request.getRequestUrl()
      const path = urlToRawfilePath(url)
      if (path === null || appContext === null) {
        return false
      }
      const ctx = appContext
      // 异步回包：在 onRequestStart 内同步 didReceiveResponse/Body/Finish 时，
      // 并发 fetch（2 个及以上）会让 ArkWeb 网络栈死锁、请求永不完成（真机实测）。
      // 改为立即返回 true，由事件循环下一拍完成回包。
      setTimeout(() => {
        let content: Uint8Array
        try {
          content = ctx.resourceManager.getRawFileContentSync(path)
        } catch (e) {
          console.warn(`${TAG} ✗ 未找到 rawfile(404): ${path}`)
          // didFail 在本平台版本不会终结 fetch 请求（前端挂起，真机实测）；
          // 改用 HTTP 404 响应，前端 resp.ok 判定语义不变
          try {
            const notFound = new webview.WebSchemeHandlerResponse()
            notFound.setMimeType('text/plain')
            notFound.setEncoding('utf-8')
            notFound.setStatus(404)
            notFound.setStatusText('Not Found')
            resourceHandler.didReceiveResponse(notFound)
            resourceHandler.didFinish()
          } catch (e2) {
            resourceHandler.didFail(WebNetErrorList.ERR_FAILED)
          }
          return
        }
        try {
          const response = new webview.WebSchemeHandlerResponse()
          response.setMimeType(mimeOf(path))
          response.setEncoding('utf-8')
          response.setStatus(200)
          response.setStatusText('OK')
          resourceHandler.didReceiveResponse(response)
          // 零字节 rawfile（如 default 主题空 custom.css）：跳过 body 直发 Finish，
          // didReceiveResponseBody 对空 buffer 会抛异常
          if (content.length > 0) {
            resourceHandler.didReceiveResponseBody(content.buffer)
          }
          resourceHandler.didFinish()
        } catch (e) {
          console.warn(`${TAG} ✗ rawfile 回包失败: ${path}`)
          resourceHandler.didFail(WebNetErrorList.ERR_FAILED)
        }
      }, 0)
      return true
    }
  )
  return handler
}
