// ============================================================
// 变形虫 (Amiba) — Vue 入口
// ============================================================
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initConfig } from './config/config'
import { initStorage } from './config/storage'
import { initRegistry } from './host/registry'
import { memoryStore } from './ai/memory-store'
import { loadUserSkills } from './ai/skills'
import { discoverTools } from './tools/discover'

async function bootstrap() {
  await initStorage()
  await Promise.all([
    initConfig(),
    initRegistry(),
    memoryStore.init(),
    loadUserSkills(),
  ])

  // 工具自发现（触发 *.tool.ts 顶层 register → flush）
  discoverTools()

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  app.mount('#app')
}

bootstrap()
