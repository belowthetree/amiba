// ============================================================
// 变形虫 (Amiba) — FloatingWidgetManager（悬浮块状态管理器）
// ============================================================
import { reactive } from 'vue'
import type { FloatingWidgetConfig, FloatingWidgetState } from '../types/service'

// ---- 状态 ----

export const widgetStates = reactive<Record<string, FloatingWidgetState>>({})

// ---- 已注册的路由名称集合（外部设置） ----
let currentRouteName: string | null = null

/** 由 FloatingWidgetContainer 在挂载后调用，传入当前路由名称 */
export function setCurrentRoute(name: string | null) {
  currentRouteName = name
  // 重新计算所有 widget 的 visible
  for (const id of Object.keys(widgetStates)) {
    widgetStates[id].visible = computeVisible(widgetStates[id].config)
  }
}

function computeVisible(config: FloatingWidgetConfig): boolean {
  if (config.trigger === 'manual') return false // manual 由代码控制
  // showOn 为空 → 全局可见
  if (!config.showOn || config.showOn.length === 0) return true
  // 匹配当前路由名称
  if (currentRouteName && config.showOn.includes(currentRouteName)) return true
  return false
}

// ---- 公开 API ----

export function registerWidget(config: FloatingWidgetConfig, htmlContent: string): void {
  if (widgetStates[config.id]) {
    console.warn(`[FloatingWidget] Widget "${config.id}" 已存在，覆盖注册`)
  }

  const state: FloatingWidgetState = {
    config,
    visible: computeVisible(config),
    expanded: false,
    yPosition: config.position,
    htmlContent,
  }

  widgetStates[config.id] = state
  console.log(`[FloatingWidget] 注册: ${config.id} (visible=${state.visible})`)
}

/** 移除单个 widget */
export function unregisterWidget(id: string): void {
  if (widgetStates[id]) {
    delete widgetStates[id]
    console.log(`[FloatingWidget] 注销: ${id}`)
  }
}

/** 按服务 ID 批量注销 */
export function unregisterServiceWidgets(serviceId: string): void {
  const ids = Object.keys(widgetStates).filter(
    (id) => widgetStates[id].config.serviceId === serviceId
  )
  for (const id of ids) {
    delete widgetStates[id]
  }
  if (ids.length > 0) {
    console.log(`[FloatingWidget] 注销服务 "${serviceId}" 的 ${ids.length} 个 widget`)
  }
}

export function setWidgetVisible(id: string, visible: boolean): void {
  const state = widgetStates[id]
  if (state) {
    state.visible = visible
  }
}

export function setWidgetExpanded(id: string, expanded: boolean): void {
  const state = widgetStates[id]
  if (state) {
    // 展开时折叠其他所有 widget
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
