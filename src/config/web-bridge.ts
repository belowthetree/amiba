// ============================================================
// 变形虫 (Amiba) — Web Bridge 模块
// ============================================================
// 封装所有 Tauri web_* invoke 调用，提供统一的前端接口。
// 被 web-browser.tool.ts 和其他模块使用。
// ============================================================

// ---- Types ----

export interface FetchResult {
  url: string
  title: string
  text: string
  content_type: string
}

export interface EvalResult {
  result: string
}

// ---- 检测 Tauri 环境 ----

let _tauriAvailable: boolean | null = null

export async function isTauri(): Promise<boolean> {
  if (_tauriAvailable !== null) return _tauriAvailable
  try {
    const mod = await import('@tauri-apps/api/core')
    _tauriAvailable = typeof mod.invoke === 'function'
  } catch {
    _tauriAvailable = false
  }
  return _tauriAvailable
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(cmd, args)
}

// ---- 页面抓取 ----

/**
 * 获取网页内容。桌面端默认使用 WebView（JS 渲染），移动端使用平台原生 WebView。
 * 失败时自动降级到 HTTP 抓取。
 */
export async function fetchPage(
  url: string,
  useWebview = true,
): Promise<FetchResult> {
  if (!(await isTauri())) {
    throw new Error('Tauri runtime required')
  }
  console.log('[web-bridge] fetchPage:', url)
  return invoke<FetchResult>('web_fetch', { url, useWebview })
}

// ---- 交互操作 ----

/**
 * 获取当前页面的简化 DOM 结构（只保留标签名、id、class）。
 */
export async function getContent(): Promise<EvalResult> {
  console.log('[web-bridge] getContent')
  return invoke<EvalResult>('web_get_content', {})
}

/**
 * 点击匹配 CSS 选择器的第一个元素。
 */
export async function clickElement(selector: string): Promise<EvalResult> {
  console.log('[web-bridge] clickElement:', selector)
  return invoke<EvalResult>('web_click', { selector })
}

/**
 * 向匹配 CSS 选择器的输入框输入文本（focus → value → input event → change event → 等待 DOM 稳定）。
 */
export async function inputText(
  selector: string,
  text: string,
): Promise<EvalResult> {
  console.log('[web-bridge] inputText:', selector, `(${text.length} chars)`)
  return invoke<EvalResult>('web_input_text', { selector, text })
}

// ---- 会话管理 ----

/**
 * 关闭浏览器会话。不传 sessionId 则关闭所有。
 */
export async function closeBrowser(sessionId?: string): Promise<void> {
  console.log('[web-bridge] closeBrowser:', sessionId || 'all')
  await invoke('web_close', { sessionId: sessionId ?? null })
}

// ---- 截图 ----

/**
 * 触发隐藏 WebView 的截图捕获（fire-and-forget）。
 * 截图结果通过 Tauri 事件 `webview-screenshot` 推送。
 */
export async function captureScreenshot(): Promise<void> {
  console.log('[web-bridge] captureScreenshot')
  await invoke('web_capture_screenshot')
}
