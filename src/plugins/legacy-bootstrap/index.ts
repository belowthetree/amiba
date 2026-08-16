// ============================================================
// @amiba/legacy-bootstrap — 兼容期启动编排插件
// ============================================================
// P1 第 5 步的“临时官方大插件包”：
// 把原 main.ts 的全部初始化逻辑原样搬入 apply()，
// 通过内核服务取得 uiShell / router / lifecycle 后挂载 Vue。
// 默认装配结果与改造前一致；后续 P2/P3 再逐项拆出。
// ============================================================

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import type { Router } from 'vue-router'
import type { AmibaContext } from '../../kernel'
import { i18n, syncI18nWithSettings } from '../../i18n'
import { initLogger } from '../../config/logger'
import { soulManager } from '../../ai/soul'
import { initCustomAgentStore } from '../../ai/custom-agent-store'
import { initNetworkBridge } from '../../host/network-bridge'
import { initPersistentWidgets } from '../../host/widget-lifecycle'
import { initThemeStore, installPrebuiltThemes } from '../../config/theme-store'
import { initCustomViewStore } from '../../config/custom-view-store'
import { onAppBackground, checkRecoveryNeeded } from '../../ai/task-recovery'
import type { AmibaUIShellService } from '../ui-shell'
import type { AmibaLifecycleService } from '../platform'
import type { AmibaStorageService } from '../storage'
import type { AmibaSettingsService } from '../settings'
import type { AmibaToolRegistryService } from '../tool-registry'
import type { AmibaToolsetsService } from '../toolsets'
import type { AmibaModelProvidersService } from '../model-providers'
import type { AmibaCredentialsService } from '../credentials'
import type { AmibaSessionService } from '../session'
import type { AmibaMemoryService } from '../memory'
import type { AmibaSkillsService } from '../skills'
import type { AmibaServiceRuntimeService } from '../service-runtime'

export const name = '@amiba/legacy-bootstrap'
export const inject = ['storage', 'settings', 'toolRegistry', 'toolsets', 'modelProviders', 'credentials', 'uiShell', 'router', 'session', 'memory', 'skills', 'serviceRuntime', 'lifecycle']
export const provides: string[] = []

export async function apply(ctx: AmibaContext): Promise<void> {
  const storage = ctx.get<AmibaStorageService>('storage')
  const settings = ctx.get<AmibaSettingsService>('settings')
  const tools = ctx.get<AmibaToolRegistryService>('toolRegistry')
  const toolsetService = ctx.get<AmibaToolsetsService>('toolsets')
  const providers = ctx.get<AmibaModelProvidersService>('modelProviders')
  const credentials = ctx.get<AmibaCredentialsService>('credentials')
  const session = ctx.get<AmibaSessionService>('session')
  const memory = ctx.get<AmibaMemoryService>('memory')
  const skills = ctx.get<AmibaSkillsService>('skills')
  const runtime = ctx.get<AmibaServiceRuntimeService>('serviceRuntime')
  if (!storage || !settings || !tools || !toolsetService || !providers || !credentials || !session || !memory || !skills || !runtime) {
    throw new Error('[legacy-bootstrap] 缺少 storage / settings / toolRegistry / toolsets / modelProviders / credentials / session / memory / skills / serviceRuntime 服务，无法初始化')
  }
  // storage / settings / modelProviders 已由各自插件在 apply() 中完成初始化；
  // toolsets / credentials / session 服务本阶段仅注册，供后续模块经 ctx 消费。
  void storage
  void toolsetService
  void providers
  void credentials
  void session

  // 尽早拦截 console 写入日志文件
  initLogger(settings.state)

  await Promise.all([
    runtime.registry.initRegistry(),
    memory.init(),
    skills.user.loadUserSkills(),
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
  const prebuiltCount = await runtime.registry.installPrebuiltServices()
  if (prebuiltCount > 0) console.log(`[Bootstrap] 安装了 ${prebuiltCount} 个预置服务`)

  // 预加载 persistent widget
  await initPersistentWidgets()

  // 安卓桌面卡片：扫描服务卡片定义 → 推送原生缓存 → 启动逻辑 runner
  // 非 Android 平台 runner 照常运行（写 cache），仅推送原生一步跳过
  try {
    const { initDesktopWidgetStore } = await import('../../config/desktop-widget-store')
    const { startDesktopWidgetRunner } = await import('../../host/desktop-widget-runner')
    await initDesktopWidgetStore()
    await startDesktopWidgetRunner()
  } catch (e) {
    console.warn('[Bootstrap] 桌面卡片初始化失败:', e)
  }

  // 工具自发现（经 toolRegistry 服务，调用位置保持不变）
  tools.discover()

  // 人格系统初始化（不自动创建 default.md，留给首次引导）
  await soulManager.init()

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
  syncI18nWithSettings()

  const shell = ctx.get<AmibaUIShellService>('uiShell')
  const router = ctx.get<Router>('router')
  const lifecycle = ctx.get<AmibaLifecycleService>('lifecycle')
  if (!shell || !router || !lifecycle) {
    throw new Error('[legacy-bootstrap] 缺少 uiShell / router / lifecycle 服务，无法挂载应用')
  }

  ctx.effect(() => {
    const app = createApp(shell.component)
    const pinia = createPinia()

    app.use(i18n)
    app.use(pinia)
    app.use(router)

    app.mount('#app')
    return () => app.unmount()
  }, 'legacy-bootstrap: vue-app')

  // 注册 App 生命周期监听（后台保存中断快照）
  console.log('[Bootstrap] 注册 App 生命周期监听')
  ctx.effect(() => lifecycle.init({
    onBackground: () => onAppBackground(),
    onForeground: async () => {
      try {
        await checkRecoveryNeeded()
      } catch (e) {
        console.error('[Bootstrap] onForeground 恢复检查失败:', e)
      }
    },
  }), 'legacy-bootstrap: app-lifecycle')

  ctx.provide('app', { mounted: true })
}
