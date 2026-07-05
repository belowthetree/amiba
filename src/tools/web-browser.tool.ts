// ============================================================
// 变形虫 (Amiba) — Web Browser 工具
// ============================================================
// 依赖 web-bridge.ts 封装所有 Tauri invoke 调用。
// 提供 web_fetch / web_browse 两个 AI 工具。
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  isTauri,
  fetchPage,
  getContent,
  clickElement,
  inputText,
  closeBrowser,
  captureScreenshot,
} from '../config/web-bridge'
import { startBrowsing, updateBrowsingContent, stopBrowsing } from '../host/webview-overlay-state'

// ---- web_fetch ----

toolRegistry.register({
  name: 'web_fetch',
  toolset: 'core',
  emoji: '🌐',
  description: '获取网页可读文本。WebView 渲染 JS 页面，失败自动降级 HTTP。',
  maxResultSizeChars: 6000,
  schema: {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '获取指定 URL 的网页可读文本。全平台 WebView 引擎。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '网页 URL（http/https）',
          },
        },
        required: ['url'],
      },
    },
  },
  handler: async (args) => {
    const { url } = args as Record<string, unknown>
    const urlStr = String(url ?? '').trim()
    if (!urlStr) return 'Error: url is required'
    if (!/^https?:\/\//.test(urlStr)) return 'Error: url must start with http:// or https://'
    if (!(await isTauri())) return '⚠️ web_fetch requires Tauri runtime.'

    try {
      const result = await fetchPage(urlStr)
      let out = `## ${result.title || 'No title'}\nURL: ${result.url}\n\n`
      const text = result.text.length > 5000
        ? result.text.slice(0, 5000) + `\n\n…[${result.text.length} chars total]`
        : result.text
      out += text.trim() || '（页面无文本内容）'
      return out
    } catch (e: any) {
      return `❌ 获取失败: ${e.message ?? e}`
    }
  },
})

// ---- web_browse ----

toolRegistry.register({
  name: 'web_browse',
  toolset: 'core',
  emoji: '🌐',
  description:
    '浏览器交互操作。navigate=导航到URL, click=点击元素, get_content=获取页面结构, close=关闭释放资源。',
  maxResultSizeChars: 8000,
  schema: {
    type: 'function',
    function: {
      name: 'web_browse',
      description:
        '浏览器交互操作：navigate 导航到 URL、click 点击 CSS 选择器元素、get_content 获取页面 DOM 结构（标签/id/class）、close 关闭释放资源。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['navigate', 'click', 'input_text', 'get_content', 'close'],
            description: '操作类型',
          },
          url: { type: 'string', description: '[navigate] 目标 URL' },
          selector: { type: 'string', description: '[click/input_text] CSS 选择器' },
          text: { type: 'string', description: '[input_text] 输入文本' },
          session_id: { type: 'string', description: '[close] 指定会话 ID，不传则关闭全部' },
        },
        required: ['action'],
      },
    },
  },
  handler: async (args) => {
    const p = args as Record<string, unknown>
    const action = String(p.action ?? '')
    console.log('[web_browse] action:', action, JSON.stringify(p))
    if (!(await isTauri())) return '⚠️ web_browse requires Tauri runtime.'

    try {
      switch (action) {
        case 'navigate': {
          const url = String(p.url ?? '').trim()
          if (!url) return 'Error: url required'
          console.log('[web_browse] navigate →', url)
          const r = await fetchPage(url)
          console.log('[web_browse] navigate ← title:', r.title, 'text:', r.text.length, 'chars')
          startBrowsing(url, r.title, r.text.slice(0, 5000))
          captureScreenshot().catch(() => {})
          return `✅ 已导航到 ${r.url}\n标题: ${r.title}\n\n${r.text.slice(0, 3000)}`
        }
        case 'click': {
          const sel = String(p.selector ?? '')
          if (!sel) return 'Error: selector required'
          const clickResult = await clickElement(sel)
          const content = await getContent()
          console.log('[web_browse] click →', clickResult.result, '\n', content.result)
          updateBrowsingContent('', content.result.slice(0, 5000))
          captureScreenshot().catch(() => {})
          const navNote = clickResult.result.startsWith('navigated:')
            ? `\n⚠️ 页面已导航到 ${clickResult.result.slice(11)}，以下内容可能仍是旧页面 DOM（需重新 navigate 获取）`
            : ''
          return `✅ 已点击 "${sel}"（${clickResult.result}）${navNote}\n\n页面结构:\n${content.result.slice(0, 6000)}`
        }
        case 'input_text': {
          const sel = String(p.selector ?? '')
          const txt = String(p.text ?? '')
          if (!sel) return 'Error: selector required'
          if (!txt) return 'Error: text required'
          await inputText(sel, txt)
          const content = await getContent()
          console.log('[web_browse] input_text → get_content:\n', content.result)
          updateBrowsingContent('', content.result.slice(0, 5000))
          captureScreenshot().catch(() => {})
          return `✅ 已在 "${sel}" 输入 ${txt.length} 个字符\n\n页面结构:\n${content.result.slice(0, 6000)}`
        }
        case 'get_content': {
          const content = await getContent()
          console.log('[web_browse] get_content:\n', content.result)
          updateBrowsingContent('', content.result.slice(0, 5000))
          captureScreenshot().catch(() => {})
          return content.result.slice(0, 7000)
        }
        case 'close': {
          await closeBrowser((p.session_id as string) || undefined)
          console.log('[web_browse] close done')
          stopBrowsing()
          return '✅ 会话已关闭'
        }
        default:
          return `Error: unknown action "${action}"`
      }
    } catch (e: any) {
      console.error('[web_browse] error:', e)
      return `❌ ${action} 失败: ${e.message ?? e}`
    }
  },
})
