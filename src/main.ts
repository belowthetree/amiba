// ============================================================
// 变形虫 (Amiba) — Vue 入口
// ============================================================
import './config/polyfill'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { i18n, syncI18nWithSettings } from './i18n'
import { initConfig, settings } from './config/config'
import { initStorage } from './config/storage'
import { initLogger } from './config/logger'
import { initRegistry, installPrebuiltServices } from './host/registry'
import { memoryStore } from './ai/memory-store'
import { loadUserSkills } from './ai/skills'
import { discoverTools } from './tools/discover'
import { soulManager } from './ai/soul'
import { maybeRunCurator } from './ai/skill-curator'
import { initProviderStore } from './ai/provider-store'
import { initCustomAgentStore } from './ai/custom-agent-store'
import { initNetworkBridge } from './host/network-bridge'
import { initPersistentWidgets } from './host/widget-lifecycle'
import { initThemeStore, installPrebuiltThemes } from './config/theme-store'
import { initCustomViewStore } from './config/custom-view-store'
import { initAppLifecycle } from './app-lifecycle'
import { onAppBackground, checkRecoveryNeeded } from './ai/task-recovery'

async function bootstrap() {
  await initStorage()
  await initConfig()

  // 尽早拦截 console 写入日志文件
  initLogger(settings)

  await Promise.all([
    initRegistry(),
    memoryStore.init(),
    loadUserSkills(),
    initProviderStore(),
    initCustomAgentStore(),
  ])
  // 主题系统初始化（加载后立即生效，不影响其他模块）
  // 非 Tauri 环境静默跳过（初始化为空）
  await initThemeStore()
  // 安装预置主题（从 public/themes/ 复制到 AppData，首次运行或缺失时执行）
  const prebuiltThemeCount = await installPrebuiltThemes()
  if (prebuiltThemeCount > 0) console.log(`[Bootstrap] 安装了 ${prebuiltThemeCount} 个预置主题`)
  // 自定义视图存储初始化
  await initCustomViewStore()
  // 网络互联桥初始化（非 Tauri 环境静默跳过）
  initNetworkBridge()

  // 安装预置服务（public/services/，仅首次运行）
  const prebuiltCount = await installPrebuiltServices()
  if (prebuiltCount > 0) console.log(`[Bootstrap] 安装了 ${prebuiltCount} 个预置服务`)

  // 预加载 persistent widget
  await initPersistentWidgets()

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

  // 同步 settings.language → i18n locale
  syncI18nWithSettings()

  const app = createApp(App)
  const pinia = createPinia()

  app.use(i18n)
  app.use(pinia)
  app.use(router)

  app.mount('#app')

  // 注册 App 生命周期监听（后台保存中断快照）
  console.log('[Bootstrap] 注册 App 生命周期监听')
  initAppLifecycle({
    onBackground: () => onAppBackground(),
    onForeground: async () => {
      try {
        await checkRecoveryNeeded()
      } catch (e) {
        console.error('[Bootstrap] onForeground 恢复检查失败:', e)
      }
    },
  })
}

bootstrap()
