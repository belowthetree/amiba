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
import { soulManager } from './ai/soul'

async function bootstrap() {
  await initStorage()
  await Promise.all([
    initConfig(),
    initRegistry(),
    memoryStore.init(),
    loadUserSkills(),
  ])

  // 工具自发现
  discoverTools()

  // 人格系统初始化（不自动创建 default.md，留给首次引导）
  await soulManager.init()

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  app.mount('#app')
}

bootstrap()
