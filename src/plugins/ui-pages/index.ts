// ============================================================
// @amiba/ui-pages — 官方页面插件
// ============================================================
// 把所有内置页面注册到 pageRegistry；路由与导航顺序由此生成。
// 页面组件保持懒加载，避免把全部页面打进首包。
// ============================================================

import { defineAsyncComponent } from 'vue'
import type { AmibaContext } from '../../kernel'
import type { PageRegistry, PageRegistration } from '../page-registry'
import type { AmibaI18nService } from '../i18n'

export const name = '@amiba/ui-pages'
export const inject = ['pageRegistry', 'i18n']
export const provides: string[] = []

export function apply(ctx: AmibaContext): void {
  const pages = ctx.get<PageRegistry>('pageRegistry')
  const i18n = ctx.get<AmibaI18nService>('i18n')
  if (!pages) throw new Error('[ui-pages] 缺少 pageRegistry 服务')
  if (!i18n) throw new Error('[ui-pages] 缺少 i18n 服务')

  const title = (key: string) => () => (i18n.instance.global.t as (key: string) => string)(key)

  const chat = defineAsyncComponent(() => import('../../pages/ChatPage.vue'))
  const services = defineAsyncComponent(() => import('../../pages/ServiceBrowsePage.vue'))
  const settings = defineAsyncComponent(() => import('../../pages/SettingsPage.vue'))
  const memory = defineAsyncComponent(() => import('../../pages/MemoryPage.vue'))
  const quick = defineAsyncComponent(() => import('../../pages/QuickPage.vue'))
  const registry = defineAsyncComponent(() => import('../../pages/RemoteServicesPage.vue'))
  const service = defineAsyncComponent(() => import('../../host/service-container.vue'))

  const definitions: PageRegistration[] = [
    { id: 'registry', path: '/registry', name: 'registry', component: registry, title: title('app.registry'), order: 10, mainNav: true },
    { id: 'services', path: '/services', name: 'services', component: services, title: title('app.services'), order: 20, mainNav: true },
    { id: 'chat', path: '/', name: 'chat', component: chat, title: title('app.title'), order: 30, mainNav: true, keepAlive: true, keepAliveName: 'ChatPage' },
    { id: 'settings', path: '/settings', name: 'settings', component: settings, title: title('app.settings'), order: 40, mainNav: true },
    { id: 'memory', path: '/memory', name: 'memory', component: memory, title: title('app.memory'), order: 50, mainNav: true },
    { id: 'quick', path: '/quick', name: 'quick', component: quick, title: title('app.quick'), order: 60, mainNav: false },
    { id: 'service', path: '/service/:serviceId/:pathMatch(.*)*', name: 'service', component: service, title: title('app.services'), order: 70, mainNav: false },
  ]

  for (const definition of definitions) {
    pages.register({ ...definition, preview: definition.mainNav ? definition.component : undefined })
  }
}
