// ============================================================
// @amiba/ui-shell — 宿主壳黑盒插件
// ============================================================
// 本阶段不做任何重构：把现有 App.vue 与 router 原样注册为服务。
// 未来 main.ts 通过 ctx.get('uiShell') / ctx.get('router') 挂载；
// 后续 P3 再拆手势、更新横幅、API 门控等壳内扩展点。
// ============================================================

import type { Component } from 'vue'
import type { Router } from 'vue-router'
import App from '../../App.vue'
import router, { PAGE_ORDER } from '../../router'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/ui-shell'
export const inject = ['platform']
export const provides = ['uiShell', 'router']

/** `ctx.get('uiShell')` 返回的服务面。 */
export interface AmibaUIShellService {
  /** 当前根组件（黑盒阶段就是 App.vue）。 */
  component: Component
  /** 主导航页面顺序，供诊断页/后续 pageRegistry 使用。 */
  pageOrder: readonly string[]
}

export function apply(ctx: AmibaContext): void {
  const shell: AmibaUIShellService = {
    component: App,
    pageOrder: PAGE_ORDER,
  }
  ctx.provide('uiShell', shell)
  ctx.provide('router', router)
}
