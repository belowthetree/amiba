// ============================================================
// @amiba/widgets — 悬浮块 / 后台服务 / 桌面卡片服务插件
// ============================================================
// 收口 floating-widget / widget-lifecycle / background-manager /
// file-access-grants；桌面卡片仍按原方式动态 import，避免提前加载。
// ============================================================

import * as floatingWidgetManager from '../../host/floating-widget-manager'
import * as widgetLifecycle from '../../host/widget-lifecycle'
import * as backgroundManager from '../../host/background-manager'
import * as fileAccessGrants from '../../host/file-access-grants'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/widgets'
export const inject = ['storage', 'settings', 'network', 'serviceRuntime']
export const provides = ['widgets']

/** `ctx.get('widgets')` 返回的服务面。 */
export interface AmibaWidgetsService {
  floating: typeof floatingWidgetManager
  lifecycle: typeof widgetLifecycle
  background: typeof backgroundManager
  fileGrants: typeof fileAccessGrants
  /** 按原启动位置动态加载桌面卡片模块。 */
  initDesktopWidgets(): Promise<void>
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaWidgetsService = {
    floating: floatingWidgetManager,
    lifecycle: widgetLifecycle,
    background: backgroundManager,
    fileGrants: fileAccessGrants,
    async initDesktopWidgets() {
      const { initDesktopWidgetStore } = await import('../../config/desktop-widget-store')
      const { startDesktopWidgetRunner } = await import('../../host/desktop-widget-runner')
      await initDesktopWidgetStore()
      await startDesktopWidgetRunner()
    },
  }
  ctx.provide('widgets', service)
}
