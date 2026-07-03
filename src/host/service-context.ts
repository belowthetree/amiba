// ============================================================
// 变形虫 (Amiba) — ServiceContext
// ============================================================
// 统一管理一个服务的所有运行时资源。
// 服务挂载时创建，卸载时调用 destroy() 即可清理全部资源。
// ============================================================

import { sessions } from './network-bridge'
import { unregisterServiceWidgets } from './floating-widget-manager'

export class ServiceContext {
  readonly serviceId: string

  /** 本服务持有的 session ID 集合，卸载时全部关闭 */
  private _sessionIds = new Set<string>()

  /** bridge 事件转发函数 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _sendEvent: ((...args: any[]) => void) | null = null

  /** bridge 清理函数 */
  private _bridgeDestroy: (() => void) | null = null

  /** 网络事件取消订阅 */
  private _networkUnsubs: (() => void)[] = []

  constructor(serviceId: string) {
    this.serviceId = serviceId
  }

  /** 注册 bridge */
  registerBridge(
    destroy: () => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendEvent: (...args: any[]) => void,
  ) {
    this._bridgeDestroy = destroy
    this._sendEvent = sendEvent
  }

  /** 向 iframe 推送事件 */
  sendEvent(name: string, data?: any) {
    this._sendEvent?.(name, data)
  }

  /** 添加 session ID */
  addSession(sessionId: string) {
    this._sessionIds.add(sessionId)
  }

  /** 移除 session ID */
  removeSession(sessionId: string) {
    this._sessionIds.delete(sessionId)
  }

  /** 注册网络事件取消订阅 */
  addNetworkUnsub(fn: () => void) {
    this._networkUnsubs.push(fn)
  }

  /** 销毁所有资源 */
  destroy() {
    // 1. 取消网络事件订阅
    for (const unsub of this._networkUnsubs) {
      try { unsub() } catch { /* ignore */ }
    }
    this._networkUnsubs = []

    // 2. 关闭所有 session
    for (const sid of this._sessionIds) {
      const s = sessions.get(sid)
      if (s) s.close().catch(() => {})
    }
    this._sessionIds.clear()

    // 3. 注销所有 widget
    unregisterServiceWidgets(this.serviceId)

    // 4. 销毁 bridge
    if (this._bridgeDestroy) {
      try { this._bridgeDestroy() } catch { /* ignore */ }
      this._bridgeDestroy = null
    }

    // 5. 清空引用
    this._sendEvent = null
  }
}
