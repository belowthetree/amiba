// ============================================================
// @amiba/ui-routes — 页面注册表 → vue-router 同步插件
// ============================================================
import { watch } from 'vue'
import type { Router } from 'vue-router'
import type { AmibaContext } from '../../kernel'
import { pageRegistry } from '../page-registry/instance'

export const name = '@amiba/ui-routes'
export const inject = ['router', 'pageRegistry', 'ui-pages']
export const provides = ['uiRoutes']

export interface AmibaUiRoutesService {
  sync(): void
}

export function apply(ctx: AmibaContext): void {
  const router = ctx.get<Router>('router')
  if (!router) throw new Error('[ui-routes] 缺少 router 服务')

  const routeIds = new Set<string>()

  const sync = () => {
    const entries = pageRegistry.list()
    const currentIds = new Set(entries.map((entry) => entry.id))

    for (const id of [...routeIds]) {
      if (!currentIds.has(id)) {
        router.removeRoute(id)
        routeIds.delete(id)
      }
    }

    for (const entry of entries) {
      if (router.hasRoute(entry.id)) router.removeRoute(entry.id)
      router.addRoute({
        path: entry.path,
        name: entry.id,
        component: entry.component,
        meta: {
          pageId: entry.id,
          keepAlive: entry.keepAlive,
          mainNav: entry.mainNav,
        },
      })
      routeIds.add(entry.id)
    }
  }

  sync()
  const stop = watch(pageRegistry.version, sync)

  const service: AmibaUiRoutesService = { sync }
  ctx.provide('uiRoutes', service)
  ctx.effect(() => stop, 'ui-routes: page-registry-watch')
}
