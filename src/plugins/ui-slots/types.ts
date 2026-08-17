// ============================================================
// @amiba/ui-slots — 类型化 Vue Slot 契约
// ============================================================
import type { Component } from 'vue'

export interface UISlotMap {
  /** App 壳层全局浮层（后续迁更新横幅等）。 */
  'ui.slot.app.global': { args: []; injected: Record<string, never> }
  /** 聊天页消息列表上方。 */
  'ui.slot.chat.above-messages': { args: [sessionId: string]; injected: Record<string, never> }
  /** 聊天页输入框下方。 */
  'ui.slot.chat.below-input': { args: [sessionId: string]; injected: Record<string, never> }
  /** 设置页顶级页签。 */
  'ui.slot.settings.section': { args: []; injected: Record<string, never> }
  /** 服务列表页网格上方。 */
  'ui.slot.services.above-list': { args: []; injected: Record<string, never> }
  /** 记忆页 Tab。 */
  'ui.slot.memory.tab': { args: []; injected: Record<string, never> }
}

export type UISlotName = keyof UISlotMap

export const UI_SLOT_NAMES: readonly UISlotName[] = [
  'ui.slot.app.global',
  'ui.slot.chat.above-messages',
  'ui.slot.chat.below-input',
  'ui.slot.settings.section',
  'ui.slot.services.above-list',
  'ui.slot.memory.tab',
] as const

export interface UISlotRegistration<Name extends UISlotName = UISlotName> {
  name: Name
  /** `${pluginId}:${localId}`，同一 Slot 内唯一。 */
  id: string
  order?: number
  component: Component
  label?: () => string
  icon?: string
  locale?: string
  replaceDefault?: boolean
  /** 宿主按 SlotMap 声明的参数调用，返回注入组件的业务 props。 */
  inject?: (...args: UISlotMap[Name]['args']) => Record<string, unknown>
}

export interface UISlotEntry<Name extends UISlotName = UISlotName> {
  name: Name
  id: string
  order: number
  component: Component
  label?: () => string
  icon?: string
  locale?: string
  replaceDefault: boolean
  inject?: (...args: UISlotMap[Name]['args']) => Record<string, unknown>
}

export interface UISlotHandle {
  id: string
  dispose(): void
  update(patch: Partial<Omit<UISlotRegistration, 'name'>>): void
}
