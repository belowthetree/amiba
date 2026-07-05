// ============================================================
// 变形虫 (Amiba) — FloatingWidgetManager（悬浮块状态管理器）
// ============================================================
import { reactive } from 'vue'
import type { FloatingWidgetConfig, FloatingWidgetState } from '../types/service'

// ---- 状态 ----

export const widgetStates = reactive<Record<string, FloatingWidgetState>>({})

// ---- 当前路由名称（外部设置） ----
let currentRouteName: string | null = null

/** 由容器在挂载/路由变化时调用 */
export function setCurrentRoute(name: string | null) {
  const prev = currentRouteName
  currentRouteName = name

  // 路由变化时，重新计算所有 widget 的 visible
  for (const id of Object.keys(widgetStates)) {
    const state = widgetStates[id]

    // persistent + manual 模式：路由变化不重置 visible
    if (state.config.lifecycle === 'persistent' && state.config.trigger === 'manual') {
      // 保持当前 visible 状态不变
      continue
    }

    const wasVisible = state.visible
    state.visible = computeVisible(state.config)

    // 离开生命周期页面 → 自动折叠面板
    if (wasVisible && !state.visible) {
      state.expanded = false
    }
  }
}

function computeVisible(config: FloatingWidgetConfig): boolean {
  switch (config.trigger) {
    case 'manual':
      // manual 模式：初始隐藏，完全由 show()/hide() API 控制
      // 如果之前被 show() 调用过且路由仍然匹配（或全局），保持状态
      // 这里返回当前状态不变，由外部 setWidgetVisible 控制
      // 首次注册时 visible=false
      return false

    case 'page':
      // page 模式：当前路由在 showOn 中时自动显示
      if (!config.showOn || config.showOn.length === 0) {
        // 空数组 = 全局生命周期，始终可见
        return true
      }
      if (currentRouteName && config.showOn.includes(currentRouteName)) {
        return true
      }
      return false

    default:
      return false
  }
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
  console.log(`[FloatingWidget] 注册: ${config.id} (trigger=${config.trigger}, visible=${state.visible})`)
}

/** 移除单个 widget */
export function unregisterWidget(id: string): void {
  if (widgetStates[id]) {
    delete widgetStates[id]
    console.log(`[FloatingWidget] 注销: ${id}`)
  }
}

/** 按服务 ID 批量注销（persistent widget 不随服务卸载销毁） */
export function unregisterServiceWidgets(serviceId: string): void {
  const ids = Object.keys(widgetStates).filter(
    (id) => widgetStates[id].config.serviceId === serviceId
      && widgetStates[id].config.lifecycle !== 'persistent'
  )
  for (const id of ids) {
    delete widgetStates[id]
  }
  if (ids.length > 0) {
    console.log(`[FloatingWidget] 注销服务 "${serviceId}" 的 ${ids.length} 个 widget`)
  }
}

/**
 * 手动设置 visible。
 * - manual 模式：完全由 show()/hide() 控制
 * - page 模式：路由匹配时自动为 true，但手动 hide() 可临时隐藏
 */
export function setWidgetVisible(id: string, visible: boolean): void {
  const state = widgetStates[id]
  if (!state) return

  if (state.config.trigger === 'manual') {
    // manual 模式：直接设置
    state.visible = visible
    if (!visible) state.expanded = false
  } else {
    // page 模式：hide() 可以临时隐藏，但路由变化会重新计算
    state.visible = visible
    if (!visible) state.expanded = false
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

/** 关闭 persistent widget（彻底移除，不可恢复） */
export function closePersistentWidget(id: string): void {
  const state = widgetStates[id]
  if (!state) return
  if (state.config.lifecycle !== 'persistent') {
    console.warn(`[FloatingWidget] "${id}" 不是 persistent widget，请使用 unregisterWidget`)
    return
  }
  unregisterWidget(id)
}
