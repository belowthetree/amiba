// ============================================================
// 变形虫 (Amiba) — BackgroundServiceManager
// ============================================================
// 管理后台服务运行时：隐藏 iframe 池、调度器、IPC、崩溃恢复。
// ============================================================

import { settings } from '../config/config'
import { getService, setServiceData, getServiceData, removeServiceData } from './registry'
import { readServiceFile } from '../config/storage'
import { onEvent as onNetworkEvent, setVisibility, getVisibility, startDiscovery, stopDiscovery, getVisibleDevices, connect, sessions, startListening, stopListening } from './network-bridge'
import { BRIDGE_SCRIPT } from './bridge'
import {
  requestAccess,
  listFiles,
  readTextFile,
  readBinaryFile,
} from './file-access-grants'
import {
  registerWidget,
  unregisterWidget,
  setWidgetVisible,
} from './floating-widget-manager'
import router from '../router'
import type { BackgroundConfig, FloatingWidgetConfig, ToolCallMessage } from '../types/service'
import {
  createServiceConversation,
  sendServiceConversationMessage,
  abortServiceConversation,
  closeServiceConversation,
} from '../ai/service-ai'
import type { ServiceAiSink } from '../ai/service-ai'
import { registerServiceTools, unregisterServiceTools } from './service-tools'
import type { ServiceToolCaller } from './service-tools'

// ---- 类型 ----

interface BackgroundWorker {
  serviceId: string
  iframe: HTMLIFrameElement
  container: HTMLDivElement
  backgroundConfig: BackgroundConfig
  startCount: number
  lastRun: string | null
  state: 'running' | 'error'
  intervalId: ReturnType<typeof setInterval> | null
  eventUnsubs: (() => void)[]
  /** 服务工具调用（host → service 请求/响应） */
  callServiceTool: ServiceToolCaller
  pendingToolCalls: Map<string, {
    resolve: (v: any) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>
}

// ---- 状态 ----

const _workers = new Map<string, BackgroundWorker>()
let _hiddenContainer: HTMLDivElement | null = null

// ---- 全局监听：统一处理 widget / 非标准 iframe 的 API 调用 ----
// widget iframe 没有 service-container 的 bridge，需要宿主层全局转发。
// 后台 iframe 的 storage / background 也有独立的 handleBgAPI 处理，
// 此处通过 event.source 检查避免双重处理。

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data
  if (!data || data.type !== 'api') return

  const { module, method, params, requestId } = data
  const svcId: string | undefined = params?.serviceId
  if (!svcId) return // widget / 后台消息必须有 serviceId

  // 跳过已知后台 worker iframe 的消息（由 handleBgAPI 单独处理）
  for (const worker of _workers.values()) {
    try {
      if (worker.iframe.contentWindow === event.source) return
    } catch { /* contentWindow 可能不可用 */ }
  }

  const reply = (result?: any, error?: string) => {
    try { (event.source as WindowProxy)?.postMessage({ type: 'api-response', requestId, result, error }, '*') } catch { /* ignore */ }
  }

  handleGlobalAPI(event.source as WindowProxy, module, method, params, requestId, svcId, reply)
})

function handleGlobalAPI(
  source: WindowProxy,
  module: string,
  method: string,
  params: Record<string, any>,
  requestId: string,
  svcId: string,
  reply: (result?: any, error?: string) => void
): void {
  switch (module) {
    case 'background':
      handleGlobalBackground(method, params, requestId, svcId, reply)
      return
    case 'storage':
      handleGlobalStorage(method, params, requestId, svcId, reply)
      return
    case 'notification':
      handleGlobalNotification(method, params, requestId, reply)
      return
    case 'ui':
      handleGlobalUI(method, params, requestId, reply)
      return
    case 'widgets':
      handleGlobalWidgets(method, params, requestId, svcId, reply)
      return
    case 'network':
      handleGlobalNetwork(method, params, requestId, svcId, source, reply)
      return
    case 'fileAccess':
      handleGlobalFileAccess(method, params, requestId, svcId, reply)
      return
    case 'fetch':
      handleGlobalFetch(method, params, requestId, reply)
      return
    case 'ai':
      handleGlobalAi(method, params, requestId, svcId, source, reply)
      return
    default:
      reply(undefined, 'Unknown module: ' + module)
  }
}

// AI 涉及计费：全局路径无权限检查，这里按 serviceId 补验 manifest 权限
function handleGlobalAi(
  method: string, params: Record<string, any>, requestId: string,
  svcId: string, source: WindowProxy, reply: (result?: any, error?: string) => void
): void {
  const svc = getService(svcId)
  if (!svc || !svc.manifest.permissions.includes('ai')) {
    console.warn('[BgManager] 全局 AI 权限拒绝:', svcId)
    reply(undefined, 'Permission denied: ai')
    return
  }
  console.log('[BgManager] 全局 AI 请求:', method, svcId)
  const sink: ServiceAiSink = (payload) => {
    try { source.postMessage({ type: 'event', name: 'ai-event', data: payload }, '*') } catch { /* ignore */ }
  }
  switch (method) {
    case 'createConversation': {
      try { reply(createServiceConversation(svcId, params.opts || {}, sink)) }
      catch (e: any) { reply(undefined, e?.message || String(e)) }
      return
    }
    case 'send':
      sendServiceConversationMessage(svcId, params.conversationId, params.text)
        .then(() => reply())
        .catch((e: any) => reply(undefined, e?.message || String(e)))
      return
    case 'abort':
      abortServiceConversation(svcId, params.conversationId)
      reply()
      return
    case 'close':
      closeServiceConversation(svcId, params.conversationId)
      reply()
      return
    default:
      reply(undefined, 'Unknown ai method: ' + method)
  }
}

// ---- 各模块处理器 ----

function handleGlobalBackground(
  method: string, params: Record<string, any>, requestId: string,
  svcId: string, reply: (result?: any, error?: string) => void
): void {
  console.log('[BgManager] 全局 background API: svcId=' + svcId + ' method=' + method)
  const worker = _workers.get(svcId)
  switch (method) {
    case 'postMessage': {
      if (worker && worker.state === 'running') {
        try {
          worker.iframe.contentWindow?.postMessage({
            type: 'event', name: 'bg-message', data: params.message,
          }, '*')
        } catch { /* ignore */ }
      } else {
        console.log('[BgManager] 忽略 postMessage: ' + svcId + ' worker=' + !!worker + ' running=' + (worker ? worker.state : 'null'))
      }
      reply(undefined)
      return
    }
    case 'getState': {
      reply(getBackgroundState(svcId))
      return
    }
    case 'start': {
      startService(svcId).then(() => reply(undefined)).catch((e: any) => reply(undefined, e?.message || String(e)))
      return
    }
    case 'stop': {
      stopService(svcId).then(() => reply(undefined))
      return
    }
    default:
      reply(undefined, 'Unknown background method: ' + method)
  }
}

async function handleGlobalStorage(
  method: string, params: Record<string, any>, requestId: string,
  svcId: string, reply: (result?: any, error?: string) => void
): Promise<void> {
  try {
    switch (method) {
      case 'setStorage':
        await setServiceData(svcId, params.key, params.data)
        reply(undefined)
        return
      case 'getStorage': {
        const v = await getServiceData(svcId, params.key)
        reply(v)
        return
      }
      case 'removeStorage':
        await removeServiceData(svcId, params.key)
        reply(undefined)
        return
      default:
        reply(undefined, 'Unknown storage method: ' + method)
    }
  } catch (e: any) {
    reply(undefined, e?.message || String(e))
  }
}

function handleGlobalNotification(
  method: string, params: Record<string, any>, requestId: string,
  reply: (result?: any, error?: string) => void
): void {
  switch (method) {
    case 'showToast': {
      const iconMap: Record<string, string> = { success: '\u2705', error: '\u274C', loading: '\u23F3', none: '' }
      const toast = document.createElement('div')
      toast.className = 'amiba-toast'
      toast.innerHTML = (iconMap[params.icon] || '') + ' ' + params.title
      document.body.appendChild(toast)
      requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)' })
      setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'
        setTimeout(() => toast.remove(), 300)
      }, 2000)
      reply(undefined)
      return
    }
    default:
      reply(undefined, 'Unknown notification method: ' + method)
  }
}

function handleGlobalUI(
  method: string, params: Record<string, any>, requestId: string,
  reply: (result?: any, error?: string) => void
): void {
  switch (method) {
    case 'navigateTo':
      if (params.url) router.push(params.url)
      reply(undefined)
      return
    case 'navigateBack':
      router.back()
      reply(undefined)
      return
    default:
      reply(undefined, 'Unknown ui method: ' + method)
  }
}

async function handleGlobalWidgets(
  method: string, params: Record<string, any>, requestId: string,
  svcId: string, reply: (result?: any, error?: string) => void
): Promise<void> {
  try {
    switch (method) {
      case 'registerWidget': {
        const config = params.config
        if (!config || !config.id || !config.page) {
          reply(undefined, 'Invalid widget config: id and page required')
          return
        }
        // 从服务文件读取 widget HTML
        const widgetHtml = await readServiceFile(svcId, config.page)
        if (!widgetHtml) {
          reply(undefined, 'Widget page not found: ' + config.page)
          return
        }
        // 注入 bridge 脚本 + serviceId
        const processed = widgetHtml.replace(
          '<!-- AMIBA_BRIDGE -->',
          '<script>window.__amiba_service_id__ = "' + svcId + '"</' + 'script>' +
          '<script>' + BRIDGE_SCRIPT + '<\/script>'
        )
        const fullConfig: FloatingWidgetConfig = { ...config, serviceId: svcId }
        registerWidget(fullConfig, processed)
        console.log('[BgManager] 全局 registerWidget: ' + config.id + ' (svc=' + svcId + ')')
        reply(undefined)
        return
      }
      case 'removeWidget':
        unregisterWidget(params.id)
        reply(undefined)
        return
      case 'showWidget':
        setWidgetVisible(params.id, true)
        reply(undefined)
        return
      case 'hideWidget':
        setWidgetVisible(params.id, false)
        reply(undefined)
        return
      default:
        reply(undefined, 'Unknown widgets method: ' + method)
    }
  } catch (e: any) {
    reply(undefined, e?.message || String(e))
  }
}

async function handleGlobalNetwork(
  method: string, params: Record<string, any>, requestId: string,
  svcId: string, source: WindowProxy,
  reply: (result?: any, error?: string) => void
): Promise<void> {
  try {
    switch (method) {
      case 'setVisibility':
        await setVisibility(params.visibility || { lan: true, ble: false })
        reply(undefined)
        return
      case 'getVisibility': {
        const v = await getVisibility()
        reply(v)
        return
      }
      case 'startDiscovery':
        await startDiscovery(params.transport || 'all')
        reply(undefined)
        return
      case 'stopDiscovery':
        await stopDiscovery(params.transport || 'all')
        reply(undefined)
        return
      case 'getVisibleDevices': {
        const d = getVisibleDevices()
        reply(d)
        return
      }
      case 'connect': {
        const session = await connect(params.peerId, params.serviceKey)
        session.on('message', (msg: string) => {
          source.postMessage({ type: 'event', name: 'session-event', data: { sessionId: session.id, event: 'message', data: msg } }, '*')
        })
        session.on('close', () => {
          source.postMessage({ type: 'event', name: 'session-event', data: { sessionId: session.id, event: 'close', data: null } }, '*')
        })
        reply({ sessionId: session.id, peerId: session.peerId, peerName: session.peerName })
        return
      }
      case 'sessionSend': {
        const s = sessions.get(params.sessionId)
        if (!s) { reply(undefined, '会话不存在'); return }
        await s.send(params.message)
        reply(undefined)
        return
      }
      case 'sessionClose': {
        const s = sessions.get(params.sessionId)
        if (s) await s.close()
        reply(undefined)
        return
      }
      case 'startListening':
        await startListening(params.serviceKey)
        reply(undefined)
        return
      case 'stopListening':
        await stopListening(params.serviceKey)
        reply(undefined)
        return
      default:
        reply(undefined, 'Unknown network method: ' + method)
    }
  } catch (e: any) {
    reply(undefined, e?.message || String(e))
  }
}

async function handleGlobalFileAccess(
  method: string, params: Record<string, any>, requestId: string,
  svcId: string, reply: (result?: any, error?: string) => void
): Promise<void> {
  try {
    switch (method) {
      case 'requestAccess': {
        const result = await requestAccess(svcId, params.opts || {})
        reply(result)
        return
      }
      case 'listFiles': {
        const result = await listFiles(svcId, params.token)
        reply(result)
        return
      }
      case 'readText': {
        const result = await readTextFile(svcId, params.token, params.path)
        reply(result)
        return
      }
      case 'readBinary': {
        const result = await readBinaryFile(svcId, params.token, params.path)
        reply(result)
        return
      }
      default:
        reply(undefined, 'Unknown fileAccess method: ' + method)
    }
  } catch (e: any) {
    reply(undefined, e?.message || String(e))
  }
}

async function handleGlobalFetch(
  method: string, params: Record<string, any>, requestId: string,
  reply: (result?: any, error?: string) => void
): Promise<void> {
  try {
    switch (method) {
      case 'request': {
        const result = await import('@tauri-apps/api/core').then(m =>
          m.invoke('service_http_request', {
            url: params.url,
            method: params.method || 'GET',
            headers: params.headers || {},
            body: params.body || null,
          })
        )
        reply(result)
        return
      }
      default:
        reply(undefined, 'Unknown fetch method: ' + method)
    }
  } catch (e: any) {
    reply(undefined, e?.message || String(e))
  }
}

function getHiddenContainer(): HTMLDivElement {
  if (!_hiddenContainer) {
    _hiddenContainer = document.createElement('div')
    _hiddenContainer.id = 'amiba-bg-workers'
    _hiddenContainer.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;'
    document.body.appendChild(_hiddenContainer)
  }
  return _hiddenContainer
}

// ---- Frontend <-> Background IPC ----

const _foregroundHandlers = new Map<string, ((msg: any) => void) | null>()

export function registerForegroundHandler(serviceId: string, handler: ((msg: any) => void) | null) {
  _foregroundHandlers.set(serviceId, handler)
}

/** 前台 → 后台：向指定服务的后台 iframe 发送消息 */
export function sendToBackground(serviceId: string, message: any): void {
  const worker = _workers.get(serviceId)
  if (!worker || worker.state !== 'running') {
    throw new Error('后台服务未运行')
  }
  try {
    worker.iframe.contentWindow?.postMessage({
      type: 'event',
      name: 'bg-message',
      data: message,
    }, '*')
  } catch { /* ignore */ }
}

// ---- Public API ----

export function getBackgroundState(serviceId: string) {
  const worker = _workers.get(serviceId)
  if (!worker) return { running: false, startCount: 0, lastRun: null, state: null as string | null }
  return {
    running: worker.state === 'running',
    startCount: worker.startCount,
    lastRun: worker.lastRun,
    state: worker.state,
  }
}

export function isRunning(serviceId: string): boolean {
  return _workers.get(serviceId)?.state === 'running'
}

export function getRunningCount(): number {
  let count = 0
  _workers.forEach((w) => { if (w.state === 'running') count++ })
  return count
}

function MAX_CAPACITY(): number {
  return settings.max_background_services ?? 3
}
// ---- 内部函数 ----

function buildBackgroundHTML(entryJS: string): string {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    '<script>' + BRIDGE_SCRIPT + '</' + 'script>' +
    '<script>' + entryJS + '</' + 'script>' +
    '</body></html>'
}

function _destroyWorker(worker: BackgroundWorker) {
  if (worker.intervalId) { clearInterval(worker.intervalId); worker.intervalId = null }
  for (const unsub of worker.eventUnsubs) { try { unsub() } catch { /* ignore */ } }
  worker.eventUnsubs = []
  // 拒绝进行中的工具调用并注销本实例注册的服务工具
  for (const [, p] of worker.pendingToolCalls) {
    clearTimeout(p.timer)
    p.reject(new Error('后台服务已停止'))
  }
  worker.pendingToolCalls.clear()
  unregisterServiceTools(worker.serviceId, undefined, worker.callServiceTool)
  try { worker.iframe.remove(); worker.container.remove() } catch { /* ignore */ }
  worker.state = 'error'
}

async function _recoverWorker(worker: BackgroundWorker) {
  console.log('[BgManager] ' + worker.serviceId + ' 静默重启')
  _destroyWorker(worker)
  _workers.delete(worker.serviceId)
  try { await startService(worker.serviceId) } catch (e) { console.error('[BgManager] ' + worker.serviceId + ' 重启失败:', e) }
}

function _sendResponse(worker: BackgroundWorker, requestId: string, result?: any, error?: string) {
  try {
    worker.iframe.contentWindow?.postMessage({ type: 'api-response', requestId, result, error }, '*')
  } catch { /* ignore */ }
}

// ---- 处理来自后台 iframe 的所有 API 调用 ----

async function handleBgAPI(req: { module: string; method: string; params: Record<string, any>; requestId: string }, worker: BackgroundWorker) {
  const { module, method, params, requestId } = req
  const svcId = worker.serviceId

  switch (module) {
    case 'background': {
      switch (method) {
        case 'getState':
          _sendResponse(worker, requestId, getBackgroundState(svcId))
          return
        case 'start':
          startService(svcId).then(() => _sendResponse(worker, requestId)).catch((e: any) => _sendResponse(worker, requestId, undefined, e?.message || String(e)))
          return
        case 'stop':
          stopService(svcId).then(() => _sendResponse(worker, requestId))
          return
        case 'postMessage': {
          const handler = _foregroundHandlers.get(svcId)
          if (handler) { handler(params.message) }
          // 前台未加载不是错误（悬浮块可能独立使用后台服务）
          _sendResponse(worker, requestId, undefined)
          return
        }
        default:
          _sendResponse(worker, requestId, undefined, 'Unknown background method: ' + method)
          return
      }
    }
    case 'storage': {
      switch (method) {
        case 'setStorage': await setServiceData(svcId, params.key, params.data); _sendResponse(worker, requestId); return
        case 'getStorage': { const v = await getServiceData(svcId, params.key); _sendResponse(worker, requestId, v); return }
        case 'removeStorage': await removeServiceData(svcId, params.key); _sendResponse(worker, requestId); return
        default: _sendResponse(worker, requestId, undefined, 'Unknown storage method: ' + method); return
      }
    }
    case 'notification': {
      switch (method) {
        case 'showToast': {
          const toast = document.createElement('div')
          const iconMap: Record<string, string> = { success: '\u2705', error: '\u274C', loading: '\u23F3', none: '' }
          toast.className = 'amiba-toast'
          toast.innerHTML = (iconMap[params.icon] || '') + ' ' + params.title
          document.body.appendChild(toast)
          requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)' })
          setTimeout(() => {
            toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'
            setTimeout(() => toast.remove(), 300)
          }, 2000)
          _sendResponse(worker, requestId)
          return
        }
        default: _sendResponse(worker, requestId, undefined, 'Unknown notification method: ' + method); return
      }
    }
    case 'network': {
      try {
        switch (method) {
          case 'setVisibility': await setVisibility(params.visibility || { lan: true, ble: false }); _sendResponse(worker, requestId); return
          case 'getVisibility': { const v = await getVisibility(); _sendResponse(worker, requestId, v); return }
          case 'startDiscovery': await startDiscovery(params.transport || 'all'); _sendResponse(worker, requestId); return
          case 'stopDiscovery': await stopDiscovery(params.transport || 'all'); _sendResponse(worker, requestId); return
          case 'getVisibleDevices': { const d = getVisibleDevices(); _sendResponse(worker, requestId, d); return }
          case 'connect': {
            const session = await connect(params.peerId, params.serviceKey)
            session.on('message', (msg: string) => {
              worker.iframe.contentWindow?.postMessage({ type: 'event', name: 'session-event', data: { sessionId: session.id, event: 'message', data: msg } }, '*')
            })
            session.on('close', () => {
              worker.iframe.contentWindow?.postMessage({ type: 'event', name: 'session-event', data: { sessionId: session.id, event: 'close', data: null } }, '*')
            })
            _sendResponse(worker, requestId, { sessionId: session.id, peerId: session.peerId, peerName: session.peerName })
            return
          }
          case 'sessionSend': {
            const s = sessions.get(params.sessionId)
            if (!s) { _sendResponse(worker, requestId, undefined, '会话不存在'); return }
            await s.send(params.message); _sendResponse(worker, requestId); return
          }
          case 'sessionClose': {
            const s = sessions.get(params.sessionId)
            if (s) await s.close(); _sendResponse(worker, requestId); return
          }
          case 'startListening': await startListening(params.serviceKey); _sendResponse(worker, requestId); return
          case 'stopListening': await stopListening(params.serviceKey); _sendResponse(worker, requestId); return
          default: _sendResponse(worker, requestId, undefined, 'Unknown network method: ' + method); return
        }
      } catch (e: any) { _sendResponse(worker, requestId, undefined, e?.message || String(e)); return }
    }
    case 'fileAccess': {
      try {
        switch (method) {
          case 'requestAccess': {
            const result = await requestAccess(svcId, params.opts || {})
            _sendResponse(worker, requestId, result)
            return
          }
          case 'listFiles': {
            const result = await listFiles(svcId, params.token)
            _sendResponse(worker, requestId, result)
            return
          }
          case 'readText': {
            const result = await readTextFile(svcId, params.token, params.path)
            _sendResponse(worker, requestId, result)
            return
          }
          case 'readBinary': {
            const result = await readBinaryFile(svcId, params.token, params.path)
            _sendResponse(worker, requestId, result)
            return
          }
          default: _sendResponse(worker, requestId, undefined, 'Unknown fileAccess method: ' + method); return
        }
      } catch (e: any) { _sendResponse(worker, requestId, undefined, e?.message || String(e)); return }
    }
    case 'fetch': {
      try {
        switch (method) {
          case 'request': {
            const result = await import('@tauri-apps/api/core').then(m =>
              m.invoke('service_http_request', {
                url: params.url,
                method: params.method || 'GET',
                headers: params.headers || {},
                body: params.body || null,
              })
            )
            _sendResponse(worker, requestId, result)
            return
          }
          default: _sendResponse(worker, requestId, undefined, 'Unknown fetch method: ' + method); return
        }
      } catch (e: any) { _sendResponse(worker, requestId, undefined, e?.message || String(e)); return }
    }
    case 'ai': {
      // AI 涉及计费：后台路径无权限检查，这里按 serviceId 补验 manifest 权限
      const svc = getService(svcId)
      if (!svc || !svc.manifest.permissions.includes('ai')) {
        console.warn('[BgManager] 后台 AI 权限拒绝:', svcId)
        _sendResponse(worker, requestId, undefined, 'Permission denied: ai')
        return
      }
      console.log('[BgManager] 后台 AI 请求:', method, svcId)
      const aiSink: ServiceAiSink = (payload) => {
        try { worker.iframe.contentWindow?.postMessage({ type: 'event', name: 'ai-event', data: payload }, '*') } catch { /* ignore */ }
      }
      try {
        switch (method) {
          case 'createConversation': {
            const r = createServiceConversation(svcId, params.opts || {}, aiSink)
            _sendResponse(worker, requestId, r)
            return
          }
          case 'send': await sendServiceConversationMessage(svcId, params.conversationId, params.text); _sendResponse(worker, requestId); return
          case 'abort': abortServiceConversation(svcId, params.conversationId); _sendResponse(worker, requestId); return
          case 'close': closeServiceConversation(svcId, params.conversationId); _sendResponse(worker, requestId); return
          default: _sendResponse(worker, requestId, undefined, 'Unknown ai method: ' + method); return
        }
      } catch (e: any) { _sendResponse(worker, requestId, undefined, e?.message || String(e)); return }
    }
    case 'tools': {
      // 服务工具注册：后台路径无桥层权限检查，这里按 serviceId 补验 manifest 权限
      const svc = getService(svcId)
      if (!svc || !svc.manifest.permissions.includes('tools')) {
        console.warn('[BgManager] 后台工具权限拒绝:', svcId)
        _sendResponse(worker, requestId, undefined, 'Permission denied: tools')
        return
      }
      console.log('[BgManager] 后台工具请求:', method, svcId)
      try {
        switch (method) {
          case 'register': {
            const r = registerServiceTools(svcId, params.decls || [], worker.callServiceTool)
            _sendResponse(worker, requestId, r)
            return
          }
          case 'unregister':
            unregisterServiceTools(svcId, params.names, worker.callServiceTool)
            _sendResponse(worker, requestId)
            return
          default:
            _sendResponse(worker, requestId, undefined, 'Unknown tools method: ' + method)
            return
        }
      } catch (e: any) { _sendResponse(worker, requestId, undefined, e?.message || String(e)); return }
    }
    default:
      _sendResponse(worker, requestId, undefined, 'Unknown module: ' + module)
  }
}

// ---- 后台服务生命周期 ----

export async function startService(serviceId: string): Promise<void> {
  if (settings.background_services_enabled === false) {
    throw new Error('后台服务全局已禁用')
  }

  const existing = _workers.get(serviceId)
  if (existing?.state === 'running') {
    console.log('[BgManager] ' + serviceId + ' 已在运行')
    return
  }

  if (getRunningCount() >= MAX_CAPACITY()) {
    throw new Error('后台服务已达上限 (' + MAX_CAPACITY() + ')')
  }

  const svc = getService(serviceId)
  if (!svc) throw new Error('服务 "' + serviceId + '" 不存在')

  const config = svc.backgroundConfig
  if (!config) throw new Error('服务 "' + serviceId + '" 没有 background.json 配置')

  if (existing) { _destroyWorker(existing) }

  const entryContent = await readServiceFile(serviceId, config.entry)
  if (!entryContent) { throw new Error('后台入口文件不存在: ' + config.entry) }

  const html = buildBackgroundHTML(entryContent)
  const bgContainer = getHiddenContainer()
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'width:0;height:0;overflow:hidden;'
  const iframe = document.createElement('iframe')
  iframe.sandbox.add('allow-scripts')
  iframe.style.cssText = 'width:0;height:0;border:none;'
  wrapper.appendChild(iframe)
  bgContainer.appendChild(wrapper)

  const eventUnsubs: (() => void)[] = []

  const worker: BackgroundWorker = {
    serviceId, iframe, container: wrapper, backgroundConfig: config,
    startCount: (existing?.startCount ?? 0) + 1,
    lastRun: new Date().toISOString(), state: 'running',
    intervalId: null, eventUnsubs,
    pendingToolCalls: new Map(),
    callServiceTool: () => Promise.reject(new Error('后台桥未就绪')), // 下方立即替换
  }

  let toolReqSeq = 0
  worker.callServiceTool = (tool, args) => new Promise((resolve, reject) => {
    if (!iframe.contentWindow) { reject(new Error('服务窗口不可用')); return }
    const id = 'tc_' + (++toolReqSeq) + '_' + Math.random().toString(36).slice(2)
    const timer = setTimeout(() => {
      if (worker.pendingToolCalls.delete(id)) reject(new Error(`工具调用超时: ${tool}`))
    }, 30000)
    worker.pendingToolCalls.set(id, { resolve, reject, timer })
    const msg: ToolCallMessage = { type: 'tool-call', requestId: id, tool, args }
    iframe.contentWindow.postMessage(msg, '*')
  })

  const msgHandler = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    const data = event.data
    if (!data) return
    // 服务工具调用结果回执（tool-result）
    if (data.type === 'tool-result') {
      const p = worker.pendingToolCalls.get(data.requestId)
      if (!p) return
      worker.pendingToolCalls.delete(data.requestId)
      clearTimeout(p.timer)
      if (data.error) p.reject(new Error(data.error))
      else p.resolve(data.result)
      return
    }
    if (data.type !== 'api') return
    handleBgAPI(data, worker).catch((e) => {
      console.warn('[BgManager] ' + serviceId + ' API error:', e)
    })
  }

  window.addEventListener('message', msgHandler)
  // worker 销毁时一并摘除监听，避免重启累积
  eventUnsubs.push(() => window.removeEventListener('message', msgHandler))

  iframe.onerror = () => {
    console.log('[BgManager] ' + serviceId + ' 后台 iframe 异常，静默重启')
    _recoverWorker(worker)
  }

  iframe.srcdoc = html
  await new Promise<void>((resolve) => { iframe.onload = () => resolve(); setTimeout(() => resolve(), 500) })

  const schedule = config.schedule
  if (schedule && schedule.type === 'interval' && schedule.intervalMs && schedule.intervalMs > 0) {
    console.log('[BgManager] ' + serviceId + ' 启动间隔定时器: ' + schedule.intervalMs + 'ms')
    worker.intervalId = setInterval(() => {
      if (worker.state === 'running' && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'event', name: 'tick',
          data: { trigger: 'interval', at: new Date().toISOString() },
        }, '*')
        worker.lastRun = new Date().toISOString()
      }
    }, schedule.intervalMs)
  }

  if (config.onEvents && config.onEvents.length > 0) {
    const networkEvents = ['peer-discovered', 'peer-lost', 'session-created', 'session-message', 'session-closed', 'session-error']
    for (const eventName of config.onEvents) {
      console.log('[BgManager] ' + serviceId + ' 订阅主机事件: ' + eventName)
      if (networkEvents.includes(eventName)) {
        const unsub = onNetworkEvent(eventName, (...args: any[]) => {
          if (worker.state === 'running' && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              type: 'event', name: eventName,
              data: args.length === 1 ? args[0] : args,
            }, '*')
          }
        })
        eventUnsubs.push(unsub)
      }
    }
  }

  _workers.set(serviceId, worker)
  if (svc.backgroundState !== undefined) { svc.backgroundState = 'running'; svc.backgroundEnabled = true }

  console.log('[BgManager] ======== ' + serviceId + ' 后台启动 (第 ' + worker.startCount + ' 次) ========')
}

export async function stopService(serviceId: string): Promise<void> {
  const worker = _workers.get(serviceId)
  if (!worker) return
  _destroyWorker(worker)
  _workers.delete(serviceId)
  const svc = getService(serviceId)
  if (svc && svc.backgroundState !== undefined) { svc.backgroundState = 'stopped' }
  console.log('[BgManager] ======== ' + serviceId + ' 后台已停止 ========')
}

export async function stopAll(): Promise<void> {
  const ids = Array.from(_workers.keys())
  for (const id of ids) { await stopService(id) }
  console.log('[BgManager] ======== 所有后台服务已停止 ========')
}
