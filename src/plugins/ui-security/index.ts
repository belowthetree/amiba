// ============================================================
// @amiba/ui-security — 插件安全诊断 UI（设置页签）
// ============================================================
import type { AmibaContext } from '../../kernel'
import type { UISlotRegistry } from '../ui-slots'
import SecuritySection from './SecuritySection.vue'

export const name = '@amiba/ui-security'
export const inject = ['uiSlots', 'pluginManager']
export const provides: string[] = []

export function apply(ctx: AmibaContext): void {
  const slots = ctx.get<UISlotRegistry>('uiSlots')
  if (!slots) throw new Error('[ui-security] 缺少 uiSlots 服务')

  const handle = slots.register({
    name: 'ui.slot.settings.section',
    id: 'ui-security:settings',
    order: 90,
    component: SecuritySection,
    label: () => '插件安全',
  })
  ctx.effect(() => handle.dispose, 'ui-security: settings slot')
}
