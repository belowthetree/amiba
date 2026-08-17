// ============================================================
// @amiba/custom-agents — 自定义 Agent 服务插件
// ============================================================
// ============================================================

import * as customAgents from '../../ai/custom-agent-store'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/custom-agents'
export const inject = ['storage', 'settings']
export const provides = ['customAgents']

/** `ctx.get('customAgents')` 返回的服务面。 */
export type AmibaCustomAgentsService = typeof customAgents

export function apply(ctx: AmibaContext): void {
  ctx.provide('customAgents', customAgents)
}
