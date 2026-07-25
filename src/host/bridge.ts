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

      // 自动附加 serviceId（如果上下文中已设置且未显式传递）
      var payloadParams = params || {};
      if (window.__amiba_service_id__ && !payloadParams.serviceId) {
        payloadParams = Object.assign({}, payloadParams, { serviceId: window.__amiba_service_id__ });
      }

      window.parent.postMessage({
        type: 'api',
        module: module,
        method: method,
        params: payloadParams,
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

  // ---- 事件监听 ----
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data) return;

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
  });

  // ---- 会话事件分发 ----
  var sessionCallbacks = {}; // sessionId → { eventName: [handler] }
  var sessionProxies = {};   // sessionId → proxy object

  function getSessionCallbacks(sid, event) {
    if (!sessionCallbacks[sid]) sessionCallbacks[sid] = {};
    if (!sessionCallbacks[sid][event]) sessionCallbacks[sid][event] = [];
    return sessionCallbacks[sid][event];
  }

  // 监听 host 推送的 session-event
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || data.type !== 'event' || data.name !== 'session-event') return;
    var payload = data.data; // { sessionId, event, data }
    if (!payload || !payload.sessionId) return;
    var cbs = sessionCallbacks[payload.sessionId];
    if (!cbs) return;
    var handlers = cbs[payload.event];
    if (handlers) {
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](payload.data); } catch(e) { console.warn('[session-event]', e); }
      }
    }
  });

  function createSessionProxy(sid, peerId, peerName) {
    if (sessionProxies[sid]) return sessionProxies[sid];
    var proxy = {
      id: sid,
      peerId: peerId,
      peerName: peerName,
      send: function(message) {
        return callHost('network', 'sessionSend', { sessionId: sid, message: message });
      },
      close: function() {
        return callHost('network', 'sessionClose', { sessionId: sid });
      },
      on: function(event, handler) {
        getSessionCallbacks(sid, event).push(handler);
        return function() {
          var arr = getSessionCallbacks(sid, event);
          var idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        };
      }
    };
    sessionProxies[sid] = proxy;
    return proxy;
  }

  // ---- 房间事件分发 ----
  var roomCallbacks = {}; // roomId → { eventName: [handler] }
  var roomProxies = {};   // roomId → proxy object

  function getRoomCallbacks(rid, event) {
    if (!roomCallbacks[rid]) roomCallbacks[rid] = {};
    if (!roomCallbacks[rid][event]) roomCallbacks[rid][event] = [];
    return roomCallbacks[rid][event];
  }

  // 监听 host 推送的 room-event
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || data.type !== 'event' || data.name !== 'room-event') return;
    var payload = data.data; // { roomId, event, data }
    if (!payload || !payload.roomId) return;
    var proxy = roomProxies[payload.roomId];
    // 自动同步成员列表快照（member-join / member-leave 事件携带 members）
    if (proxy && payload.data && payload.data.members) {
      proxy.members = payload.data.members;
    }
    var cbs = roomCallbacks[payload.roomId];
    if (!cbs) return;
    var handlers = cbs[payload.event];
    if (handlers) {
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](payload.data); } catch(e) { console.warn('[room-event]', e); }
      }
    }
  });

  function createRoomProxy(info) {
    if (roomProxies[info.roomId]) return roomProxies[info.roomId];
    var proxy = {
      id: info.roomId,
      name: info.name,
      isHost: info.isHost,
      selfId: info.selfId,
      hostId: info.hostId,
      members: info.members || [],
      // 成员 → 房主
      send: function(data) {
        return callHost('network', 'roomSend', { roomId: info.roomId, data: data });
      },
      // 房主 → 全体广播
      broadcast: function(data) {
        return callHost('network', 'roomBroadcast', { roomId: info.roomId, data: data });
      },
      // 房主 → 指定成员
      sendTo: function(memberId, data) {
        return callHost('network', 'roomSendTo', { roomId: info.roomId, memberId: memberId, data: data });
      },
      // 房主：踢出成员
      kick: function(memberId) {
        return callHost('network', 'roomKick', { roomId: info.roomId, memberId: memberId });
      },
      // 房主解散房间 / 成员离开房间
      close: function() {
        return callHost('network', 'roomClose', { roomId: info.roomId });
      },
      on: function(event, handler) {
        getRoomCallbacks(info.roomId, event).push(handler);
        return function() {
          var arr = getRoomCallbacks(info.roomId, event);
          var idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        };
      }
    };
    roomProxies[info.roomId] = proxy;
    return proxy;
  }

  window.__amiba__ = {
    storage: {
      set: function(key, data) { return callHost('storage', 'setStorage', { key: key, data: data, serviceId: window.__amiba_service_id__ || undefined }); },
      get: function(key) { return callHost('storage', 'getStorage', { key: key, serviceId: window.__amiba_service_id__ || undefined }); },
      remove: function(key) { return callHost('storage', 'removeStorage', { key: key, serviceId: window.__amiba_service_id__ || undefined }); },
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
      // 可见性 & 发现
      setVisibility: function(opts) { return callHost('network', 'setVisibility', { visibility: opts }); },
      getVisibility: function() { return callHost('network', 'getVisibility', {}); },
      startDiscovery: function(transport) { return callHost('network', 'startDiscovery', { transport: transport }); },
      stopDiscovery: function(transport) { return callHost('network', 'stopDiscovery', { transport: transport }); },
      getVisibleDevices: function() { return callHost('network', 'getVisibleDevices', {}); },
      onPeerDiscovered: function(callback) {
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === 'event' && e.data.name === 'peer-discovered') {
            callback(e.data.data);
          }
        });
      },

      // ---- Session API (v4) ----
      connect: function(peerId, serviceKey) {
        console.log('[JSBridge] connect ->', peerId, 'serviceKey=', serviceKey);
        return callHost('network', 'connect', { peerId: peerId, serviceKey: serviceKey }).then(function(info) {
          if (!info || !info.sessionId) {
            throw new Error('连接失败：' + (info && info.error ? info.error : '未知错误'));
          }
          console.log('[JSBridge] connect <- sid=', info.sessionId);
          return createSessionProxy(info.sessionId, info.peerId, info.peerName);
        });
      },
      onSession: function(callback) {
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === 'event' && e.data.name === 'session-created') {
            var info = e.data.data; // { sessionId, peerId, peerName, direction }
            console.log('[JSBridge] onSession <- dir=', info.direction, 'sid=', info.sessionId, 'peer=', info.peerName);
            callback(createSessionProxy(info.sessionId, info.peerId, info.peerName));
          }
        });
      },

      // ---- 按需监听（服务主动请求 TCP listener） ----
      startListening: function(serviceKey) {
        console.log('[JSBridge] startListening:', serviceKey);
        return callHost('network', 'startListening', { serviceKey: serviceKey });
      },
      stopListening: function(serviceKey) {
        console.log('[JSBridge] stopListening:', serviceKey);
        return callHost('network', 'stopListening', { serviceKey: serviceKey });
      },

      // ---- 局域网房间 API ----
      // 房主创建房间，等待其他设备 joinRoom；星型通信，成员管理由宿主负责
      createRoom: function(opts) {
        console.log('[JSBridge] createRoom:', opts);
        return callHost('network', 'roomCreate', { opts: opts || {} }).then(function(info) {
          if (!info || !info.roomId) {
            throw new Error('创建房间失败');
          }
          return createRoomProxy(info);
        });
      },
      joinRoom: function(peerId, opts) {
        console.log('[JSBridge] joinRoom ->', peerId);
        return callHost('network', 'roomJoin', { peerId: peerId, opts: opts || {} }).then(function(info) {
          if (!info || !info.roomId) {
            throw new Error('加入房间失败');
          }
          return createRoomProxy(info);
        });
      }
    },
    background: {
      start: function(opts) { return callHost('background', 'start', { opts: opts || {}, serviceId: window.__amiba_service_id__ || undefined }); },
      stop: function() { return callHost('background', 'stop', { serviceId: window.__amiba_service_id__ || undefined }); },
      getState: function() { return callHost('background', 'getState', { serviceId: window.__amiba_service_id__ || undefined }); },
      postMessage: function(message) { return callHost('background', 'postMessage', { message: message, serviceId: window.__amiba_service_id__ || undefined }); },
      onMessage: function(callback) {
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === 'event' && e.data.name === 'bg-message') {
            callback(e.data.data);
          }
        });
      },
      on: function(eventName, callback) {
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === 'event' && e.data.name === eventName) {
            callback(e.data.data);
          }
        });
      }
    },
    fileAccess: {
      requestAccess: function(opts) { return callHost('fileAccess', 'requestAccess', { opts: opts || {} }); },
      listFiles: function(token) { return callHost('fileAccess', 'listFiles', { token: token }); },
      readText: function(token, path) { return callHost('fileAccess', 'readText', { token: token, path: path }); },
      readBinary: function(token, path) { return callHost('fileAccess', 'readBinary', { token: token, path: path }); },
    },
    fetch: {
      request: function(opts) {
        return callHost('fetch', 'request', {
          url: opts.url,
          method: opts.method || 'GET',
          headers: opts.headers || {},
          body: opts.body || null,
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
    if (event.source !== iframe.contentWindow) return // 只处理来自自身 iframe 的消息
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
    if (req.module === 'background' && !allowedPermissions.includes('background')) {
      sendResponse(req.requestId, undefined, 'Permission denied: background')
      return
    }
    if (req.module === 'fileAccess' && !allowedPermissions.includes('fileAccess')) {
      sendResponse(req.requestId, undefined, 'Permission denied: fileAccess')
      return
    }
    if (req.module === 'fetch' && !allowedPermissions.includes('fetch')) {
      sendResponse(req.requestId, undefined, 'Permission denied: fetch')
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

