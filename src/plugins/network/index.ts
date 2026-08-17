// ============================================================
// @amiba/network — 局域网 / 蓝牙互联服务插件
// ============================================================
// 收口 network-bridge / network-session / room-manager /
// service-share / skill-share，内部实现不变。
// ============================================================

import * as networkBridge from '../../host/network-bridge'
import * as networkSession from '../../host/network-session'
import * as roomManager from '../../host/room-manager'
import * as serviceShare from '../../host/service-share'
import * as skillShare from '../../host/skill-share'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/network'
export const inject = ['storage', 'settings']
export const provides = ['network']

/** `ctx.get('network')` 返回的服务面。 */
export interface AmibaNetworkService {
  bridge: typeof networkBridge
  session: typeof networkSession
  rooms: typeof roomManager
  serviceShare: typeof serviceShare
  skillShare: typeof skillShare
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaNetworkService = {
    bridge: networkBridge,
    session: networkSession,
    rooms: roomManager,
    serviceShare,
    skillShare,
  }
  ctx.provide('network', service)
}
