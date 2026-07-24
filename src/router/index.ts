// ============================================================
// 变形虫 (Amiba) — 路由定义
// ============================================================
import { createRouter, createWebHistory } from 'vue-router'

/** 主导航页面序列（从左到右），供滑动手势与边缘翻页提示共用 */
export const PAGE_ORDER = ['/services', '/', '/quick', '/registry', '/settings', '/memory']

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chat', component: () => import('../pages/ChatPage.vue') },
    { path: '/services', name: 'services', component: () => import('../pages/ServiceBrowsePage.vue') },
    { path: '/settings', name: 'settings', component: () => import('../pages/SettingsPage.vue') },
    { path: '/memory', name: 'memory', component: () => import('../pages/MemoryPage.vue') },
    { path: '/quick', name: 'quick', component: () => import('../pages/QuickPage.vue') },
    { path: '/registry', name: 'registry', component: () => import('../pages/RemoteServicesPage.vue') },
    { path: '/service/:serviceId/:pathMatch(.*)*', name: 'service', component: () => import('../host/service-container.vue') },
  ],
})

export default router
