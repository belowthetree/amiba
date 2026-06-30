// ============================================================
// 变形虫 (Amiba) — Web Browser 工具（WebView + HTTP fallback）
// ============================================================
// 桌面端：Tauri 隐藏 WebView（完整浏览器引擎，JS 渲染、反反爬）
// 移动端：HTTP fallback（reqwest + HTML 解析）
// ============================================================
import { toolRegistry } from './tool-registry'

// ---- Types ----

interface FetchResult {
  url: string
  title: string
  text: string
  content_type: string
}

// ---- Tauri invoke wrapper ----

async function isTauri(): Promise<boolean> {
  try {
    const mod = await import('@tauri-apps/api/core')
    return typeof mod.invoke === 'function'
  } catch {
    return false
  }
}

async function invokeWebFetch(url: string, useWebview = true): Promise<FetchResult> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<FetchResult>('web_fetch', { url, useWebview })
}

// ---- Tool params ----

interface WebFetchParams {
  url: string
  /** 是否使用 WebView（默认 true，桌面端启用完整渲染）。false 则用 HTTP 快速抓取 */
  use_webview?: boolean
}

// ---- Tool registration ----

toolRegistry.register({
  name: 'web_fetch',
  toolset: 'core',
  emoji: '🌐',
  description:
    '获取网页可读文本内容。桌面端使用系统 WebView（支持 JS 渲染、反反爬），移动端使用 HTTP 抓取。适合获取文档、文章、API 响应等。',
  maxResultSizeChars: 6000,
  schema: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        '获取指定 URL 的网页可读文本内容。\n' +
        '桌面端（Windows/macOS/Linux）：使用系统 WebView 引擎，可渲染 JavaScript、通过 Cloudflare 等反爬检测。\n' +
        '移动端（Android/iOS）：使用 HTTP 请求 + HTML 解析，不支持 JS 渲染。\n' +
        '适合获取：文档页面、博客文章、Wikipedia、公开 API 响应、新闻网站等。\n' +
        '不适合：需要登录的页面、验证码页面、大文件下载。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要获取的网页 URL（必须以 http:// 或 https:// 开头）',
          },
          use_webview: {
            type: 'boolean',
            description: '是否使用 WebView 渲染（默认 true）。设为 false 可快速抓取纯 HTML 页面，不执行 JS。',
          },
        },
        required: ['url'],
      },
    },
  },
  handler: async (args) => {
    const params = args as unknown as WebFetchParams
    if (!params.url || !params.url.trim()) {
      return 'Error: url is required'
    }
    if (!/^https?:\/\//.test(params.url.trim())) {
      return 'Error: url must start with http:// or https://'
    }
    return handleWebFetch(params)
  },
})

// ---- Handler ----

async function handleWebFetch(params: WebFetchParams): Promise<string> {
  const url = params.url.trim()
  const useWebview = params.use_webview ?? true

  if (!(await isTauri())) {
    return '⚠️ web_fetch requires Tauri runtime (desktop or mobile app). In dev mode, this tool is unavailable.'
  }

  try {
    const result = await invokeWebFetch(url, useWebview)

    let out = `## ${result.title || 'No title'}\n`
    out += `URL: ${result.url}\n`
    out += `Type: ${result.content_type}\n\n`

    // 截断过长文本
    const text = result.text.length > 5000
      ? result.text.slice(0, 5000) + `\n\n…[truncated: ${result.text.length} chars total]`
      : result.text

    if (text.trim()) {
      out += text
    } else {
      out += '（页面无文本内容，可能是纯图片/视频页面，或需要 JS 渲染的 SPA）'
    }

    return out
  } catch (e: any) {
    // 提取错误信息
    const msg = typeof e === 'string' ? e : (e.message || String(e))
    return `❌ 获取页面失败: ${msg}`
  }
}
