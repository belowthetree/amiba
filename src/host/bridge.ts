// ============================================================
// 变形虫 (Amiba) — postMessage Bridge (宿主侧)
// ============================================================
import type { ServiceRequest, ServiceResponse, HostEvent } from '../types/service'

export type ApiHandler = (
  module: string,
  method: string,
  params: Record<string, any>
) => Promise<any>

export function createBridge(
  iframe: HTMLIFrameElement,
  allowedPermissions: string[],
  handler: ApiHandler
) {
  function handleMessage(event: MessageEvent) {
    // Verify origin — in production, check against known origins
    const data = event.data

    if (!data || data.type !== 'api') return

    const req = data as ServiceRequest

    if (!req.module || !req.method || !req.requestId) return

    // Check permissions
    if (req.module === 'storage' && !allowedPermissions.includes('storage')) {
      sendResponse(req.requestId, undefined, 'Permission denied: storage')
      return
    }
    if (req.module === 'notification' && !allowedPermissions.includes('notification')) {
      sendResponse(req.requestId, undefined, 'Permission denied: notification')
      return
    }

    // Execute handler
    handler(req.module, req.method, req.params || {})
      .then((result) => sendResponse(req.requestId, result))
      .catch((err) => sendResponse(req.requestId, undefined, err.message))
  }

  function sendResponse(requestId: string, result?: any, error?: string) {
    const msg: ServiceResponse = {
      type: 'api-response',
      requestId,
      result,
      error,
    }
    iframe.contentWindow?.postMessage(msg, '*')
  }

  function sendEvent(name: HostEvent['name'], data?: any) {
    const msg: HostEvent = { type: 'event', name, data }
    iframe.contentWindow?.postMessage(msg, '*')
  }

  window.addEventListener('message', handleMessage)

  // Inject __amiba__ into iframe after load
  injectBridge(iframe)

  return {
    destroy() {
      window.removeEventListener('message', handleMessage)
    },
    sendEvent,
  }
}

function injectBridge(iframe: HTMLIFrameElement) {
  const win = iframe.contentWindow
  if (!win) return

  const script = `
(function() {
  const pending = new Map();
  let reqId = 0;

  function callHost(module, method, params) {
    return new Promise((resolve, reject) => {
      const id = 'r_' + (++reqId) + '_' + Math.random().toString(36).slice(2);
      pending.set(id, { resolve, reject });

      window.parent.postMessage({
        type: 'api',
        module: module,
        method: method,
        params: params || {},
        requestId: id
      }, '*');

      // Timeout after 30s
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  }

  window.addEventListener('message', function(event) {
    const data = event.data;
    if (!data || data.type !== 'api-response') return;
    const p = pending.get(data.requestId);
    if (!p) return;
    pending.delete(data.requestId);

    if (data.error) {
      p.reject(new Error(data.error));
    } else {
      p.resolve(data.result);
    }
  });

  window.__amiba__ = {
    storage: {
      set: function(key, data) { return callHost('storage', 'setStorage', { key: key, data: data }); },
      get: function(key) { return callHost('storage', 'getStorage', { key: key }); },
      remove: function(key) { return callHost('storage', 'removeStorage', { key: key }); },
    },
    showToast: function(title, icon) { return callHost('notification', 'showToast', { title: title, icon: icon || 'none' }); },
    navigateTo: function(url) { return callHost('ui', 'navigateTo', { url: url }); },
    navigateBack: function(delta) { return callHost('ui', 'navigateBack', { delta: delta || 1 }); },
  };
})();
`

  // Use a blob URL to inject the script
  try {
    const blob = new Blob([script], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    const scriptEl = win.document.createElement('script')
    scriptEl.src = url
    win.document.head?.appendChild(scriptEl)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    // Fallback: use eval
    try {
      ;(win as any).eval(script)
    } catch {
      // ignore
    }
  }
}
