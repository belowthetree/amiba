// ============================================================
// @amiba/ui-slots — 单元测试
// ============================================================
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import { UISlotRegistry } from './registry'
import type { UISlotRegistration } from './types'

const ComponentA = defineComponent({ name: 'SlotA', render: () => null })
const ComponentB = defineComponent({ name: 'SlotB', render: () => null })

describe('UISlotRegistry', () => {
  it('按 order 排序并支持注销', () => {
    const registry = new UISlotRegistry()
    const a: UISlotRegistration<'ui.slot.settings.section'> = {
      name: 'ui.slot.settings.section',
      id: 'demo:b',
      order: 20,
      component: ComponentB,
    }
    const b: UISlotRegistration<'ui.slot.settings.section'> = {
      name: 'ui.slot.settings.section',
      id: 'demo:a',
      order: 10,
      component: ComponentA,
    }
    const handleB = registry.register(a)
    registry.register(b)

    expect(registry.list('ui.slot.settings.section').map((entry) => entry.id)).toEqual(['demo:a', 'demo:b'])
    handleB.dispose()
    expect(registry.has('ui.slot.settings.section', 'demo:b')).toBe(false)
    expect(registry.list('ui.slot.settings.section').map((entry) => entry.id)).toEqual(['demo:a'])
  })

  it('拒绝同 Slot 重复 id 与未声明 Slot', () => {
    const registry = new UISlotRegistry()
    const registration: UISlotRegistration<'ui.slot.app.global'> = {
      name: 'ui.slot.app.global',
      id: 'demo:only',
      component: ComponentA,
    }
    registry.register(registration)
    expect(() => registry.register(registration)).toThrow(/已存在注册项/)
    expect(() => registry.register({ name: 'not.a.slot' as never, id: 'x', component: ComponentA })).toThrow(/未声明的 Slot/)
  })

  it('update 可修改 order 与 component', () => {
    const registry = new UISlotRegistry()
    const handle = registry.register({
      name: 'ui.slot.chat.below-input',
      id: 'demo:widget',
      order: 5,
      component: ComponentA,
    })
    handle.update({ order: 50, component: ComponentB })
    const entry = registry.get('ui.slot.chat.below-input', 'demo:widget')
    expect(entry?.order).toBe(50)
    expect(entry?.component).toBe(ComponentB)
  })
})
