// ============================================================
// @amiba/ui-slots — Vue Slot 注册表
// ============================================================
import { ref, type Ref } from 'vue'
import type { Component } from 'vue'
import {
  UI_SLOT_NAMES,
  type UISlotEntry,
  type UISlotHandle,
  type UISlotMap,
  type UISlotName,
  type UISlotRegistration,
} from './types'

interface StoredSlot {
  name: UISlotName
  id: string
  order: number
  component: Component
  label?: () => string
  icon?: string
  locale?: string
  replaceDefault: boolean
  inject?: (...args: unknown[]) => Record<string, unknown>
}

export class UISlotRegistry {
  /** 每次注册/注销/更新自增，宿主组件据此刷新。 */
  readonly version: Ref<number> = ref(0)

  private readonly slots = new Map<UISlotName, Map<string, StoredSlot>>()

  register<Name extends UISlotName>(registration: UISlotRegistration<Name>): UISlotHandle {
    const { name, id } = registration
    this.assertKnownSlot(name)
    let slotMap = this.slots.get(name)
    if (!slotMap) {
      slotMap = new Map()
      this.slots.set(name, slotMap)
    }
    if (slotMap.has(id)) {
      throw new Error(`[ui-slots] Slot "${name}" 中已存在注册项 "${id}"`)
    }

    const stored: StoredSlot = {
      name,
      id,
      order: registration.order ?? 0,
      component: registration.component,
      label: registration.label,
      icon: registration.icon,
      locale: registration.locale,
      replaceDefault: registration.replaceDefault ?? false,
      inject: registration.inject as unknown as StoredSlot['inject'],
    }
    slotMap.set(id, stored)
    this.bump()

    return {
      id,
      dispose: () => {
        this.slots.get(name)?.delete(id)
        this.bump()
      },
      update: (patch) => {
        const current = this.slots.get(name)?.get(id)
        if (!current) return
        if (patch.order !== undefined) current.order = patch.order
        if (patch.component !== undefined) current.component = patch.component
        if (patch.label !== undefined) current.label = patch.label
        if (patch.icon !== undefined) current.icon = patch.icon
        if (patch.locale !== undefined) current.locale = patch.locale
        if (patch.replaceDefault !== undefined) current.replaceDefault = patch.replaceDefault
        if (patch.inject !== undefined) current.inject = patch.inject as unknown as StoredSlot['inject']
        this.bump()
      },
    }
  }

  list<Name extends UISlotName>(name: Name): UISlotEntry<Name>[] {
    this.assertKnownSlot(name)
    const slotMap = this.slots.get(name)
    if (!slotMap) return []
    return [...slotMap.values()]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((entry) => entry as unknown as UISlotEntry<Name>)
  }

  get<Name extends UISlotName>(name: Name, id: string): UISlotEntry<Name> | undefined {
    this.assertKnownSlot(name)
    const entry = this.slots.get(name)?.get(id)
    return entry as unknown as UISlotEntry<Name> | undefined
  }

  has(name: string, id?: string): boolean {
    if (!this.isKnownSlot(name)) return false
    const slotMap = this.slots.get(name as UISlotName)
    if (!slotMap) return false
    return id === undefined ? slotMap.size > 0 : slotMap.has(id)
  }

  disposeSlot(name: UISlotName): void {
    this.assertKnownSlot(name)
    this.slots.delete(name)
    this.bump()
  }

  disposeAll(): void {
    this.slots.clear()
    this.bump()
  }

  isKnownSlot(name: string): name is UISlotName {
    return (UI_SLOT_NAMES as readonly string[]).includes(name)
  }

  private assertKnownSlot(name: string): asserts name is UISlotName {
    if (!this.isKnownSlot(name)) {
      throw new Error(`[ui-slots] 未声明的 Slot: "${name}"。可用: ${UI_SLOT_NAMES.join(', ')}`)
    }
  }

  private bump(): void {
    this.version.value += 1
  }
}
