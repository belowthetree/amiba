// ============================================================
// @amiba/ui-marketplace — 本地插件市场 UI（设置页签）
// ============================================================
import type { AmibaContext } from '../../kernel'
import type { UISlotRegistry } from '../ui-slots'
import MarketplaceSection from './MarketplaceSection.vue'

export const name = '@amiba/ui-marketplace'
export const inject = ['uiSlots', 'pluginManager']
export const provides: string[] = []

export function apply(ctx: AmibaContext): void {
  const slots = ctx.get<UISlotRegistry>('uiSlots')
  if (!slots) throw new Error('[ui-marketplace] 缺少 uiSlots 服务')

  const handle = slots.register({
    name: 'ui.slot.settings.section',
    id: 'ui-marketplace:settings',
    order: 80,
    component: MarketplaceSection,
    label: () => '本地插件',
  })
  ctx.effect(() => handle.dispose, 'ui-marketplace: settings slot')
}
