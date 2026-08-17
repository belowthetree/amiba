// ============================================================
// @amiba/ui-slots — UI Slot 注册表服务插件
// ============================================================
// P3 第 1 步：只注册服务，不渲染任何宿主。
// 后续 ui-shell / 各页面通过 ctx.get('uiSlots') 接入。
// ============================================================

import type { AmibaContext } from '../../kernel'
import { uiSlotRegistry } from './instance'
import { UISlotRegistry } from './registry'

export const name = '@amiba/ui-slots'
export const inject: string[] = []
export const provides = ['uiSlots']

export type { UISlotEntry, UISlotHandle, UISlotMap, UISlotName, UISlotRegistration } from './types'
export { UI_SLOT_NAMES } from './types'
export { UISlotRegistry } from './registry'
export { uiSlotRegistry } from './instance'

export function apply(ctx: AmibaContext): void {
  ctx.provide('uiSlots', uiSlotRegistry)
}
