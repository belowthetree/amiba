// ============================================================
// 变形虫 (Amiba) — Vue 入口
// ============================================================
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initConfig } from './config/config'
import { initRegistry } from './host/registry'
import { refreshMemoryCache } from './ai/memory'

async function bootstrap() {
  // Initialize storage-dependent modules
  await Promise.all([
    initConfig(),
    initRegistry(),
    refreshMemoryCache(),
  ])

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  app.mount('#app')
}

bootstrap()
