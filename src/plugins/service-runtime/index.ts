// ============================================================
// @amiba/service-runtime — 用户服务运行时服务插件
// ============================================================
// 收口现有 host/registry.ts、host/bridge.ts、host/service-tools.ts。
// 本阶段不改变内部实现；service-container.vue 仍由路由按需加载。
// ============================================================

import * as registry from '../../host/registry'
import * as bridge from '../../host/bridge'
import * as serviceTools from '../../host/service-tools'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/service-runtime'
export const inject = ['storage', 'settings', 'toolRegistry']
export const provides = ['serviceRuntime']

/** `ctx.get('serviceRuntime')` 返回的服务面。 */
export interface AmibaServiceRuntimeService {
  registry: typeof registry
  bridge: typeof bridge
  tools: typeof serviceTools
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaServiceRuntimeService = {
    registry,
    bridge,
    tools: serviceTools,
  }
  ctx.provide('serviceRuntime', service)
}
