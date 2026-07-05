// ============================================================
// 变形虫 (Amiba) — WebView 悬浮预览状态管理
// ============================================================
// 响应式共享状态，在 web-browser.tool.ts 中更新，
// 在 WebviewOverlay.vue 中渲染。
// ============================================================

import { reactive } from 'vue'
import { listen } from '@tauri-apps/api/event'

export interface WebviewOverlayState {
  isBrowsing: boolean
  currentUrl: string
  pageTitle: string
  pageContent: string
  screenshot: string       // base64 data URL
  xPosition: number
  yPosition: number
}

export const webviewOverlay = reactive<WebviewOverlayState>({
  isBrowsing: false,
  currentUrl: '',
  pageTitle: '',
  pageContent: '',
  screenshot: '',
  xPosition: 0,
  yPosition: 80,
})

// ---- Tauri 事件监听：截图推送 ----

let _unlisten: (() => void) | null = null

export async function initScreenshotListener() {
  if (_unlisten) return
  try {
    _unlisten = await listen<string>('webview-screenshot', (event) => {
      if (webviewOverlay.isBrowsing && event.payload && !event.payload.startsWith('ERROR:')) {
        webviewOverlay.screenshot = event.payload
        console.log('[WebviewOverlay] screenshot updated,', event.payload.length, 'chars')
      } else if (event.payload && event.payload.startsWith('ERROR:')) {
        console.warn('[WebviewOverlay] screenshot capture error:', event.payload)
      }
    })
  } catch (e) {
    console.error('[WebviewOverlay] Failed to listen webview-screenshot:', e)
  }
}

export function destroyScreenshotListener() {
  if (_unlisten) {
    _unlisten()
    _unlisten = null
  }
}

// ---- 状态操作 ----

export function startBrowsing(url: string, title: string, content: string) {
  webviewOverlay.isBrowsing = true
  webviewOverlay.currentUrl = url
  webviewOverlay.pageTitle = title || url
  webviewOverlay.pageContent = content || ''
  webviewOverlay.screenshot = ''
  webviewOverlay.xPosition = (window.innerWidth - 460) / 2
  webviewOverlay.yPosition = 80
  console.log('[WebviewOverlay] startBrowsing:', url, title)
}

export function updateBrowsingContent(title: string, content: string) {
  if (title) webviewOverlay.pageTitle = title
  if (content) webviewOverlay.pageContent = content
  console.log('[WebviewOverlay] updateBrowsingContent:', title, 'content:', content.length, 'chars')
}

export function stopBrowsing() {
  webviewOverlay.isBrowsing = false
  webviewOverlay.currentUrl = ''
  webviewOverlay.pageTitle = ''
  webviewOverlay.pageContent = ''
  webviewOverlay.screenshot = ''
  console.log('[WebviewOverlay] stopBrowsing')
}

export function updateOverlayPosition(x: number, y: number) {
  webviewOverlay.xPosition = Math.max(0, Math.min(window.innerWidth - 100, x))
  webviewOverlay.yPosition = Math.max(60, Math.min(window.innerHeight - 200, y))
}
