// ============================================================
// @amiba/legacy-bootstrap — 兼容期启动编排插件
// ============================================================
// P2 第 8 步：不再 import 任何业务模块，只按原顺序调用各服务，
// 然后挂载 uiShell 并注册 App 生命周期。
// ============================================================

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import type { Router } from 'vue-router'
import type { AmibaContext } from '../../kernel'
import type { AmibaUIShellService } from '../ui-shell'
import type { AmibaLifecycleService } from '../platform'
import type { AmibaStorageService } from '../storage'
import type { AmibaSettingsService } from '../settings'
import type { AmibaFileLoggerService } from '../file-logger'
import type { AmibaToolRegistryService } from '../tool-registry'
import type { AmibaToolsetsService } from '../toolsets'
import type { AmibaModelProvidersService } from '../model-providers'
import type { AmibaCredentialsService } from '../credentials'
import type { AmibaSessionService } from '../session'
import type { AmibaMemoryService } from '../memory'
import type { AmibaSkillsService } from '../skills'
import type { AmibaCustomAgentsService } from '../custom-agents'
import type { AmibaServiceRuntimeService } from '../service-runtime'
import type { AmibaNetworkService } from '../network'
import type { AmibaWidgetsService } from '../widgets'
import type { AmibaThemeService } from '../theme'
import type { AmibaCustomViewService } from '../custom-view'
import type { AmibaSoulService } from '../soul'
import type { AmibaI18nService } from '../i18n'
import type { AmibaTaskRecoveryService } from '../task-recovery'

export const name = '@amiba/legacy-bootstrap'
export const inject = ['storage', 'settings', 'fileLogger', 'toolRegistry', 'toolsets', 'modelProviders', 'credentials', 'uiShell', 'router', 'session', 'memory', 'skills', 'customAgents', 'serviceRuntime', 'network', 'widgets', 'theme', 'customView', 'soul', 'i18n', 'taskRecovery', 'uiRoutes', 'ui-marketplace', 'ui-security', 'lifecycle']
export const provides: string[] = []

export async function apply(ctx: AmibaContext): Promise<void> {
  const storage = ctx.get<AmibaStorageService>('storage')
  const settings = ctx.get<AmibaSettingsService>('settings')
  const fileLogger = ctx.get<AmibaFileLoggerService>('fileLogger')
  const tools = ctx.get<AmibaToolRegistryService>('toolRegistry')
  const toolsetService = ctx.get<AmibaToolsetsService>('toolsets')
  const providers = ctx.get<AmibaModelProvidersService>('modelProviders')
  const credentials = ctx.get<AmibaCredentialsService>('credentials')
  const session = ctx.get<AmibaSessionService>('session')
  const memory = ctx.get<AmibaMemoryService>('memory')
  const skills = ctx.get<AmibaSkillsService>('skills')
  const customAgents = ctx.get<AmibaCustomAgentsService>('customAgents')
  const runtime = ctx.get<AmibaServiceRuntimeService>('serviceRuntime')
  const network = ctx.get<AmibaNetworkService>('network')
  const widgets = ctx.get<AmibaWidgetsService>('widgets')
  const theme = ctx.get<AmibaThemeService>('theme')
  const customView = ctx.get<AmibaCustomViewService>('customView')
  const soul = ctx.get<AmibaSoulService>('soul')
  const i18n = ctx.get<AmibaI18nService>('i18n')
  const taskRecovery = ctx.get<AmibaTaskRecoveryService>('taskRecovery')
  if (!storage || !settings || !fileLogger || !tools || !toolsetService || !providers || !credentials || !session || !memory || !skills || !customAgents || !runtime || !network || !widgets || !theme || !customView || !soul || !i18n || !taskRecovery) {
    throw new Error('[legacy-bootstrap] 缺少基础服务，无法初始化')
  }
  // storage / settings / modelProviders 已由各自插件在 apply() 中完成初始化；
  // 其余服务仅注册，初始化仍按下方顺序显式调用。
  void storage
  void toolsetService
  void providers
  void credentials
  void session

  // 尽早拦截 console 写入日志文件
  fileLogger.init(settings.state)

  await Promise.all([
    runtime.registry.initRegistry(),
    memory.init(),
    skills.user.loadUserSkills(),
    customAgents.initCustomAgentStore(),
  ])
  // 主题系统初始化（加载后立即生效，不影响其他模块）
  // 非 Tauri 环境静默跳过（初始化为空）
  await theme.initThemeStore()
  // 安装预置主题（从 public/themes/ 复制到 AppData，首次运行或缺失时执行）
  const prebuiltThemeCount = await theme.installPrebuiltThemes()
  if (prebuiltThemeCount > 0) console.log(`[Bootstrap] 安装了 ${prebuiltThemeCount} 个预置主题`)
  // 自定义视图存储初始化
  await customView.initCustomViewStore()
  // 网络互联桥初始化（非 Tauri 环境静默跳过）
  network.bridge.initNetworkBridge()

  // 安装预置服务（public/services/，仅首次运行）
  const prebuiltCount = await runtime.registry.installPrebuiltServices()
  if (prebuiltCount > 0) console.log(`[Bootstrap] 安装了 ${prebuiltCount} 个预置服务`)

  // 预加载 persistent widget
  await widgets.lifecycle.initPersistentWidgets()

  // 安卓桌面卡片：扫描服务卡片定义 → 推送原生缓存 → 启动逻辑 runner
  // 非 Android 平台 runner 照常运行（写 cache），仅推送原生一步跳过
  try {
    await widgets.initDesktopWidgets()
  } catch (e) {
    console.warn('[Bootstrap] 桌面卡片初始化失败:', e)
  }

  // 工具自发现（经 toolRegistry 服务，调用位置保持不变）
  tools.discover()

  // 人格系统初始化（不自动创建 default.md，留给首次引导）
  await soul.init()

  // Curator 后台检查（启动时自动判断是否需要运行）
  // 从 settings 读取 curator 配置
  const curatorConfig = {
    enabled: (settings.state as any).curator_enabled ?? true,
    intervalHours: (settings.state as any).curator_interval_hours ?? 168,
    staleAfterDays: (settings.state as any).curator_stale_after_days ?? 30,
    archiveAfterDays: (settings.state as any).curator_archive_after_days ?? 90,
    consolidateEnabled: (settings.state as any).curator_consolidate_enabled ?? false,
  }
  skills.curator.maybeRunCurator(curatorConfig).then((result) => {
    if (result.ran) {
      const parts: string[] = [`${result.report?.transitions.length} 个迁移`]
      if (result.report?.consolidation?.ran) {
        parts.push(`${result.report.consolidation.umbrellasCreated} 个 umbrella, ${result.report.consolidation.skillsArchived} 个合并归档`)
      }
      console.log('[Bootstrap] Curator 已运行:', parts.join(', '))
    }
  })

  // 同步 settings.language → i18n locale
  i18n.sync()

  const shell = ctx.get<AmibaUIShellService>('uiShell')
  const router = ctx.get<Router>('router')
  const lifecycle = ctx.get<AmibaLifecycleService>('lifecycle')
  if (!shell || !router || !lifecycle) {
    throw new Error('[legacy-bootstrap] 缺少 uiShell / router / lifecycle 服务，无法挂载应用')
  }

  ctx.effect(() => {
    const app = createApp(shell.component)
    const pinia = createPinia()

    app.use(i18n.instance)
    app.use(pinia)
    app.use(router)

    app.mount('#app')
    return () => app.unmount()
  }, 'legacy-bootstrap: vue-app')

  // 注册 App 生命周期监听（后台保存中断快照）
  console.log('[Bootstrap] 注册 App 生命周期监听')
  ctx.effect(() => lifecycle.init({
    onBackground: () => taskRecovery.onBackground(),
    onForeground: async () => {
      try {
        await taskRecovery.checkRecoveryNeeded()
      } catch (e) {
        console.error('[Bootstrap] onForeground 恢复检查失败:', e)
      }
    },
  }), 'legacy-bootstrap: app-lifecycle')

  ctx.provide('app', { mounted: true })
}
