// ============================================================
// 变形虫 (Amiba) — 路由定义
// ============================================================
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../pages/HomePage.vue'),
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('../pages/ChatPage.vue'),
    },
    {
      path: '/generate',
      name: 'generate',
      component: () => import('../pages/GeneratePage.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../pages/SettingsPage.vue'),
    },
    {
      path: '/my-services',
      name: 'my-services',
      component: () => import('../pages/MyServicesPage.vue'),
    },
    {
      path: '/memory',
      name: 'memory',
      component: () => import('../pages/MemoryPage.vue'),
    },
    {
      path: '/service/:serviceId/:pathMatch(.*)*',
      name: 'service',
      component: () => import('../host/service-container.vue'),
    },
  ],
})

export default router
