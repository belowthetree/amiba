// ============================================================
// 变形虫 (Amiba) — postMessage Bridge (宿主侧)
// ============================================================
import type { ServiceRequest, ServiceResponse, HostEvent } from '../types/service'

export type ApiHandler = (
  module: string,
  method: string,
  params: Record<string, any>
) => Promise<any>

/** Iframe-side bridge script — inject into srcdoc BEFORE service scripts run */
export const BRIDGE_SCRIPT = `
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
    widgets: {
      register: function(config) { return callHost('widgets', 'registerWidget', { config: config }); },
      remove: function(id) { return callHost('widgets', 'removeWidget', { id: id }); },
      show: function(id) { return callHost('widgets', 'showWidget', { id: id }); },
      hide: function(id) { return callHost('widgets', 'hideWidget', { id: id }); },
    },
    network: {
      setVisibility: function(opts) { return callHost('network', 'setVisibility', { visibility: opts }); },
      getVisibility: function() { return callHost('network', 'getVisibility', {}); },
      startDiscovery: function(transport) { return callHost('network', 'startDiscovery', { transport: transport }); },
      stopDiscovery: function(transport) { return callHost('network', 'stopDiscovery', { transport: transport }); },
      getVisibleDevices: function() { return callHost('network', 'getVisibleDevices', {}); },
      connect: function(peerId) { return callHost('network', 'connect', { peerId: peerId }); },
      disconnect: function(peerId) { return callHost('network', 'disconnect', { peerId: peerId }); },
      send: function(peerId, message) { return callHost('network', 'send', { peerId: peerId, message: message }); },
      onPeerDiscovered: function(callback) {
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === 'event' && e.data.name === 'peer-discovered') {
            callback(e.data.data);
          }
        });
      },
      onMessage: function(callback) {
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === 'event' && e.data.name === 'message-received') {
            callback(e.data.data);
          }
        });
      },
    },
  };
})();
`

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
    if (req.module === 'widgets' && !allowedPermissions.includes('widgets')) {
      sendResponse(req.requestId, undefined, 'Permission denied: widgets')
      return
    }
    if (req.module === 'network' && !allowedPermissions.includes('network')) {
      sendResponse(req.requestId, undefined, 'Permission denied: network')
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

  return {
    destroy() {
      window.removeEventListener('message', handleMessage)
    },
    sendEvent,
  }
}

