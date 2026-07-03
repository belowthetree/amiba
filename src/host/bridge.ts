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

      setTimeout(function() {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  }

  // ---- 协议系统 ----
  var protocolHandlers = {};
  var protocolPending = new Map();
  var protocolReqId = 0;

  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data) return;

    // API 响应
    if (data.type === 'api-response') {
      var p = pending.get(data.requestId);
      if (!p) return;
      pending.delete(data.requestId);
      if (data.error) {
        p.reject(new Error(data.error));
      } else {
        p.resolve(data.result);
      }
      return;
    }

    // 收到协议消息 → 分发给注册的 handler
    if (data.type === 'event' && data.name === 'protocol-message') {
      var env = data.data; // { peerId, protocol, data, requestId? }
      if (!env || !env.protocol) return;
      var handler = protocolHandlers[env.protocol];
      if (!handler) return;

      // 构建上下文对象
      var ctx = {
        peerId: env.peerId,
        protocol: env.protocol,
        requestId: env.requestId || null,
        reply: function(responseData) {
          if (env.requestId) {
            callHost('network', 'sendProtocolResponse', {
              peerId: env.peerId,
              requestId: env.requestId,
              data: responseData
            });
          }
        }
      };

      try {
        var result = handler(env.data, ctx);
        // 同步返回值 + 有 requestId → 自动回复
        if (result !== undefined && env.requestId) {
          callHost('network', 'sendProtocolResponse', {
            peerId: env.peerId,
            requestId: env.requestId,
            data: result
          });
        }
      } catch (err) {
        if (env.requestId) {
          callHost('network', 'sendProtocolResponse', {
            peerId: env.peerId,
            requestId: env.requestId,
            error: err.message
          });
        }
      }
      return;
    }

    // 收到协议响应 → 解决 pending Promise
    if (data.type === 'event' && data.name === 'protocol-response') {
      var resp = data.data; // { requestId, data?, error? }
      if (!resp || !resp.requestId) return;
      var pp = protocolPending.get(resp.requestId);
      if (!pp) return;
      protocolPending.delete(resp.requestId);
      clearTimeout(pp.timer);
      if (resp.error) {
        pp.reject(new Error(resp.error));
      } else {
        pp.resolve(resp.data);
      }
      return;
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

      // ---- 协议 API ----
      protocol: {
        /** 注册协议处理器 */
        register: function(name, handler) {
          if (typeof name !== 'string' || !name) throw new Error('协议名称不能为空');
          if (typeof handler !== 'function') throw new Error('handler 必须是函数');
          protocolHandlers[name] = handler;
          return function() { delete protocolHandlers[name]; };
        },

        /** 注销协议处理器 */
        unregister: function(name) {
          delete protocolHandlers[name];
        },

        /** 发送协议消息（fire-and-forget） */
        send: function(peerId, protocol, data) {
          return callHost('network', 'sendProtocol', {
            peerId: peerId,
            protocol: protocol,
            data: data
          });
        },

        /** 发送协议请求并等待响应（RPC） */
        request: function(peerId, protocol, data, timeout) {
          return new Promise(function(resolve, reject) {
            var rid = 'pr_' + (++protocolReqId) + '_' + Math.random().toString(36).slice(2);
            var timer = setTimeout(function() {
              protocolPending.delete(rid);
              reject(new Error('协议请求超时'));
            }, timeout || 15000);

            protocolPending.set(rid, { resolve: resolve, reject: reject, timer: timer });

            callHost('network', 'sendProtocol', {
              peerId: peerId,
              protocol: protocol,
              data: data,
              requestId: rid
            }).catch(function(err) {
              protocolPending.delete(rid);
              clearTimeout(timer);
              reject(err);
            });
          });
        },

        /** 监听指定协议的消息（便捷方法，自动注册 handler） */
        on: function(name, callback) {
          return window.__amiba__.network.protocol.register(name, function(data, ctx) {
            callback(data, ctx);
          });
        }
      }
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

