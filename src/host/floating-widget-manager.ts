// ============================================================
// 变形虫 (Amiba) — FloatingWidgetManager（悬浮块状态管理器）
// ============================================================
// 状态持久化在 amiba_service_registry 的 ServiceEntry.hasWidgets / widgetsVisible。
// 可见性生命周期判定委托给 widget-lifecycle.ts。
// ============================================================
import { reactive } from 'vue'
import { getService, setServiceWidgetConfig, setServiceWidgetsVisible as setRegistryWidgetsVisible } from './registry'
import { evaluateWidget, onWidgetToggled } from './widget-lifecycle'
import type { FloatingWidgetConfig, FloatingWidgetState } from '../types/service'

// ---- 状态 ----

export const widgetStates = reactive<Record<string, FloatingWidgetState>>({})

// ---- 公开 API ----

export function registerWidget(config: FloatingWidgetConfig, htmlContent: string): void {
  const existing = widgetStates[config.id]
  if (existing) {
    // 已注册：只更新 HTML 内容，保留 UI 状态（位置、展开状态、可见性）
    existing.htmlContent = htmlContent
    if (!existing.config.serviceId) {
      existing.config = { ...existing.config, serviceId: config.serviceId }
    }
    console.log(`[FloatingWidget] 更新 HTML: ${config.id}`)
    return
  }

  // 新注册：从 lifecycle 获取初始可见性
  const state: FloatingWidgetState = {
    config: { ...config, serviceId: config.serviceId },
    visible: evaluateWidget(config),
    expanded: false,
    yPosition: config.position,
    htmlContent,
  }

  widgetStates[config.id] = state

  // 标记该服务有 widget
  const svc = getService(config.serviceId)
  if (!svc?.hasWidgets) {
    setServiceWidgetConfig(config.serviceId, true, state.visible)
  }

  console.log(`[FloatingWidget] 注册: ${config.id} (visible=${state.visible})`)
}

export function unregisterWidget(id: string): void {
  if (widgetStates[id]) {
    delete widgetStates[id]
    console.log(`[FloatingWidget] 注销: ${id}`)
  }
}

export function unregisterServiceWidgets(serviceId: string): void {
  const ids = Object.keys(widgetStates).filter((id) => {
    const config = widgetStates[id].config
    if (config.serviceId !== serviceId) return false
    // 如果 lifecycle 包含路由名或其他服务 ID，widget 不应随服务卸载
    const tokens = (config.lifecycle || '').split('|').map(t => t.trim()).filter(Boolean)
    // 旧字段兼容
    if (config.lifecycle === 'persistent') return false
    if (config.lifecycle === 'service') return true
    if (!tokens.length) return true // 无配置 → 默认随服务卸载
    // 只要不是纯服务 ID 列表（包含路由名或 "*"），就不随服务卸载
    return tokens.every(t => t !== '*' && !isRouteToken(t))
  })
  for (const id of ids) {
    delete widgetStates[id]
  }
  if (ids.length > 0) {
    console.log(`[FloatingWidget] 注销服务 "${serviceId}" 的 ${ids.length} 个 widget`)
  }
}

const knownRoutes = new Set(['chat', 'home', 'services', 'settings', 'memory', 'service'])
function isRouteToken(t: string) { return knownRoutes.has(t) }

export function setWidgetVisible(id: string, visible: boolean): void {
  const state = widgetStates[id]
  if (!state) return
  state.visible = visible
  if (!visible) state.expanded = false
}

export function setWidgetExpanded(id: string, expanded: boolean): void {
  const state = widgetStates[id]
  if (state) {
    if (expanded) {
      for (const otherId of Object.keys(widgetStates)) {
        if (otherId !== id) {
          widgetStates[otherId].expanded = false
        }
      }
    }
    state.expanded = expanded
  }
}

export function updateWidgetPosition(id: string, y: number): void {
  const state = widgetStates[id]
  if (state) {
    state.yPosition = y
  }
}

export function getWidgetState(id: string): FloatingWidgetState | undefined {
  return widgetStates[id]
}

/** 按服务批量设置 widget 可见性（持久化到 registry） */
export function setServiceWidgetsVisible(serviceId: string, visible: boolean): void {
  for (const id of Object.keys(widgetStates)) {
    const state = widgetStates[id]
    if (state.config.serviceId === serviceId) {
      state.visible = visible
      if (!visible) state.expanded = false
    }
  }
  setRegistryWidgetsVisible(serviceId, visible)
  onWidgetToggled(serviceId)
  console.log(`[FloatingWidget] 服务 "${serviceId}" widget 可见性: ${visible}`)
}

export function closePersistentWidget(id: string): void {
  const state = widgetStates[id]
  if (!state) return
  // 没有跨路由生命周期配置的 widget 不能手动关闭
  const tokens = (state.config.lifecycle || '').split('|').map(t => t.trim()).filter(Boolean)
  const isGlobalLike = state.config.lifecycle === 'persistent'
    || state.config.lifecycle === '*'
    || tokens.some(t => t === '*' || isRouteToken(t) || t.startsWith('user.'))
  if (!isGlobalLike) {
    console.warn(`[FloatingWidget] "${id}" 没有跨路由生命周期，不可手动关闭`)
    return
  }
  unregisterWidget(id)
}

/** 判断某服务是否有 widget 配置（从 registry 读取） */
export function hasWidgetConfig(serviceId: string): boolean {
  const svc = getService(serviceId)
  if (!svc) return false
  if (svc.hasWidgets !== undefined) return svc.hasWidgets
  // 已安装的旧服务还没有 hasWidgets 字段，用权限兜底
  return svc.manifest.permissions.includes('widgets')
}
