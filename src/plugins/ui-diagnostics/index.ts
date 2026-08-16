// ============================================================
// @amiba/ui-diagnostics — 内核装配诊断页插件
// ============================================================
// 当前只提供服务与组件，不注册路由。
// 后续接入 main.ts 后，可通过 diagnostics 服务挂载诊断页。
// ============================================================

import type { Component } from 'vue'
import type { AmibaContext } from '../../kernel'
import type { KernelDiagnosticsSource } from './types'
import DiagnosticsPage from './DiagnosticsPage.vue'

export const name = '@amiba/ui-diagnostics'
export const inject: string[] = []
export const provides = ['diagnostics']

/** 诊断页路径约定（不注册路由，仅作为元数据供 shell 使用）。 */
export const DIAGNOSTICS_PATH = '/__amiba/diagnostics'

/** `ctx.get('diagnostics')` 返回的服务面。 */
export interface AmibaDiagnosticsService {
  component: Component
  path: string
  title: string
  source?: KernelDiagnosticsSource
  setSource(source: KernelDiagnosticsSource): void
}

export function apply(ctx: AmibaContext): void {
  let source: KernelDiagnosticsSource | undefined

  const service: AmibaDiagnosticsService = {
    component: DiagnosticsPage,
    path: DIAGNOSTICS_PATH,
    title: 'Amiba 插件诊断',
    get source() {
      return source
    },
    setSource(next) {
      source = next
    },
  }
  ctx.provide('diagnostics', service)
}
