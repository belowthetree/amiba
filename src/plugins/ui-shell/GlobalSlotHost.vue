<!-- ============================================================
  @amiba/ui-shell — 全局 Slot 宿主
  渲染所有注册到 ui.slot.app.global 的 Vue 组件。
  无注册项时输出空节点，不影响现有布局。
============================================================ -->
<template>
  <div v-if="entries.length > 0" class="amiba-global-slots">
    <component
      :is="entry.component"
      v-for="entry in entries"
      :key="entry.id"
      v-bind="slotProps(entry)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { uiSlotRegistry } from '../ui-slots/instance'
import type { UISlotEntry } from '../ui-slots'

const entries = computed(() => {
  // 读取 version 建立响应式依赖，注册/注销/更新后宿主自动刷新。
  void uiSlotRegistry.version.value
  return uiSlotRegistry.list('ui.slot.app.global')
})

function slotProps(entry: UISlotEntry<'ui.slot.app.global'>): Record<string, unknown> {
  return entry.inject?.() ?? {}
}
</script>

<style scoped>
.amiba-global-slots {
  display: contents;
}
</style>
