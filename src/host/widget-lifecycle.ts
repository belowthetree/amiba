// ============================================================
// 变形虫 (Amiba) — WidgetLifecycle 事件驱动生命周期引擎
// ============================================================
// 将 widget 可见性判定集中在此模块，外部通过事件触发重新评估。
// 事件源：路由变化、服务加载/卸载、widget 开关切换。
// ============================================================
import { reactive } from 'vue'
import { getService, getUserServices, setServiceWidgetConfig } from './registry'
import { widgetStates, registerWidget } from './floating-widget-manager'
import { readServiceFile } from '../config/storage'
import { BRIDGE_SCRIPT } from './bridge'
import type { FloatingWidgetConfig, FloatingWidgetManifest } from '../types/service'

// ---- 上下文 ----

export const lifecycleContext = reactive({
  currentRoute: null as string | null,
  loadedServices: new Set<string>(),
})

// ---- 评估 ----

/** 解析 lifecycle 字符串，判断 widget 在当前上下文中是否可见 */
export function evaluateWidget(config: FloatingWidgetConfig): boolean {
  const raw = config.lifecycle

  // 兼容旧字段：lifecycle: 'service' → 服务加载时可见
  if (raw === 'service') {
    return lifecycleContext.loadedServices.has(config.serviceId)
  }
  // 兼容旧字段：lifecycle: 'persistent' → 始终可见
  if (raw === 'persistent') {
    return getService(config.serviceId)?.widgetsVisible !== false
  }
  // 无配置 → 默认服务加载时可见
  if (!raw) {
    return lifecycleContext.loadedServices.has(config.serviceId)
  }

  // 新格式：管道分隔的界面/服务列表
  const tokens = raw.split('|').map(t => t.trim()).filter(Boolean)
  for (const token of tokens) {
    // "*" 或空 → 全局可见
    if (token === '*') return true

    // 服务 ID（如 "user.floating-demo"）→ 服务已加载
    if (token.startsWith('user.')) {
      if (lifecycleContext.loadedServices.has(token)) return true
      continue
    }

    // 路由名（如 "chat", "home", "services"）→ 当前路由匹配
    if (lifecycleContext.currentRoute === token) return true
  }

  return false
}

// ---- 事件入口 ----

/** 重新评估所有 widget 的可见性 */
function reevaluateAll() {
  for (const id of Object.keys(widgetStates)) {
    const state = widgetStates[id]
    if (!state) continue
    const wasVisible = state.visible
    state.visible = evaluateWidget(state.config)
    if (wasVisible && !state.visible) {
      state.expanded = false
    }
  }
}

/** 重新评估指定服务的所有 widget */
function reevaluateService(serviceId: string) {
  for (const id of Object.keys(widgetStates)) {
    const state = widgetStates[id]
    if (!state || state.config.serviceId !== serviceId) continue
    const wasVisible = state.visible
    state.visible = evaluateWidget(state.config)
    if (wasVisible && !state.visible) {
      state.expanded = false
    }
  }
}

export function onRouteChange(name: string | null) {
  console.log(`[WidgetLifecycle] === 路由变更: ${name || '(无)'} ===`)
  lifecycleContext.currentRoute = name
  reevaluateAll()
}

export function onServiceLoaded(serviceId: string) {
  console.log(`[WidgetLifecycle] === 服务加载: ${serviceId} ===`)
  lifecycleContext.loadedServices.add(serviceId)
  reevaluateService(serviceId)
}

export function onServiceUnloaded(serviceId: string) {
  console.log(`[WidgetLifecycle] === 服务卸载: ${serviceId} ===`)
  lifecycleContext.loadedServices.delete(serviceId)
  reevaluateService(serviceId)
}

export function onWidgetToggled(serviceId: string) {
  console.log(`[WidgetLifecycle] === widget 开关变更: ${serviceId} ===`)
  reevaluateService(serviceId)
}

// ---- 启动预加载 ----

/** 启动时预加载所有有 lifecycle 配置的 widget */
export async function initPersistentWidgets(): Promise<void> {
  const services = getUserServices()

  for (const svc of services) {
    if (!svc.manifest.permissions.includes('widgets')) continue

    const widgetJsonRaw = await readServiceFile(svc.manifest.id, 'widget.json')
    if (!widgetJsonRaw) continue

    let manifest: FloatingWidgetManifest
    try {
      manifest = JSON.parse(widgetJsonRaw)
    } catch {
      console.warn(`[WidgetLifecycle] ${svc.manifest.id} widget.json 解析失败`)
      continue
    }

    if (!manifest.widgets?.length) continue

    for (const config of manifest.widgets) {
      // 无 lifecycle 配置 → 跳过（仅服务加载时动态注册）
      if (!config.lifecycle && config.trigger !== 'page') continue

      const htmlContent = await readServiceFile(svc.manifest.id, config.page)
      if (!htmlContent) {
        console.warn(`[WidgetLifecycle] ${svc.manifest.id}: widget ${config.id} 文件不存在: ${config.page}`)
        continue
      }

      const withServiceId: FloatingWidgetConfig = { ...config, serviceId: svc.manifest.id }
      const injected = injectBridge(htmlContent, svc.manifest.id, config.id)

      registerWidget(withServiceId, injected)
      console.log(`[WidgetLifecycle] ✓ 预加载: ${config.id} (lifecycle="${config.lifecycle || '(默认)'}")`)
    }
  }
}

// ---- 桥脚本注入 ----

function injectBridge(html: string, serviceId: string, widgetId?: string): string {
  var extra = 'window.__amiba_service_id__ = "' + serviceId + '"'
  if (widgetId) extra += ';window.__widget_id__ = "' + widgetId + '"'
  return html.replace(
    '<!-- AMIBA_BRIDGE -->',
    '<script>' + extra + '</' + 'script>' +
    '<script>' + BRIDGE_SCRIPT + '<\/script>'
  )
}
