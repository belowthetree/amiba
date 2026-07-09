// ============================================================
// 变形虫 (Amiba) — 路由定义
// ============================================================
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chat', component: () => import('../pages/ChatPage.vue') },
    { path: '/home', name: 'home', component: () => import('../pages/HomePage.vue') },
    { path: '/services', name: 'services', component: () => import('../pages/ServiceBrowsePage.vue') },
    { path: '/settings', name: 'settings', component: () => import('../pages/SettingsPage.vue') },
    { path: '/memory', name: 'memory', component: () => import('../pages/MemoryPage.vue') },
    { path: '/quick', name: 'quick', component: () => import('../pages/QuickPage.vue') },
    { path: '/service/:serviceId/:pathMatch(.*)*', name: 'service', component: () => import('../host/service-container.vue') },
  ],
})

export default router
