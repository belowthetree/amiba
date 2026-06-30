// ============================================================
// 变形虫 (Amiba) — Vue 入口
// ============================================================
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initConfig, settings } from './config/config'
import { initStorage } from './config/storage'
import { initRegistry } from './host/registry'
import { memoryStore } from './ai/memory-store'
import { loadUserSkills } from './ai/skills'
import { discoverTools } from './tools/discover'
import { soulManager } from './ai/soul'
import { maybeRunCurator } from './ai/skill-curator'
import { initProviderStore } from './ai/provider-store'
import { initCustomAgentStore } from './ai/custom-agent-store'

async function bootstrap() {
  await initStorage()
  await Promise.all([
    initConfig(),
    initRegistry(),
    memoryStore.init(),
    loadUserSkills(),
    initProviderStore(),
    initCustomAgentStore(),
  ])

  // 工具自发现
  discoverTools()

  // 人格系统初始化（不自动创建 default.md，留给首次引导）
  await soulManager.init()

  // Curator 后台检查（启动时自动判断是否需要运行）
  // 从 settings 读取 curator 配置
  const curatorConfig = {
    enabled: (settings as any).curator_enabled ?? true,
    intervalHours: (settings as any).curator_interval_hours ?? 168,
    staleAfterDays: (settings as any).curator_stale_after_days ?? 30,
    archiveAfterDays: (settings as any).curator_archive_after_days ?? 90,
    consolidateEnabled: (settings as any).curator_consolidate_enabled ?? false,
  }
  maybeRunCurator(curatorConfig).then((result) => {
    if (result.ran) {
      const parts: string[] = [`${result.report?.transitions.length} 个迁移`]
      if (result.report?.consolidation?.ran) {
        parts.push(`${result.report.consolidation.umbrellasCreated} 个 umbrella, ${result.report.consolidation.skillsArchived} 个合并归档`)
      }
      console.log('[Bootstrap] Curator 已运行:', parts.join(', '))
    }
  })

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)

  app.mount('#app')
}

bootstrap()
