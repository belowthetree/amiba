<!-- ============================================================
  @amiba/ui-shell — 通用类型化 Slot 宿主
  props:
    name: UISlotName
    args: 宿主传给注册项 inject() 的参数
============================================================ -->
<template>
  <template v-for="entry in entries" :key="entry.id">
    <component :is="entry.component" v-bind="slotProps(entry)" />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { uiSlotRegistry } from '../ui-slots/instance'
import type { UISlotEntry, UISlotName } from '../ui-slots'

const props = defineProps<{
  name: UISlotName
  args?: unknown[]
}>()

const entries = computed(() => {
  void uiSlotRegistry.version.value
  return uiSlotRegistry.list(props.name)
})

function slotProps(entry: UISlotEntry): Record<string, unknown> {
  const inject = entry.inject as unknown as ((...args: unknown[]) => Record<string, unknown>) | undefined
  return inject?.(...(props.args ?? [])) ?? {}
}
</script>

<style scoped>
/* 宿主本身不产生布局，交给注册组件决定。 */
</style>
