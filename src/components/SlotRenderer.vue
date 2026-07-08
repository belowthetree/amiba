<!-- ============================================================
变形虫 (Amiba) — SlotRenderer（插槽渲染组件）
============================================================ -->
<template>
  <div ref="elRef" class="ui-slot" :data-slot="name" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'

const props = defineProps<{
  name: string
  html?: string
}>()

const elRef = ref<HTMLElement>()

function render() {
  const el = elRef.value
  if (!el) return
  const content = props.html || ''

  if (!content.trim()) {
    el.innerHTML = ''
    return
  }

  el.innerHTML = content
  // 手动执行 <script> 标签（v-html / innerHTML 不执行脚本）
  el.querySelectorAll('script').forEach((oldScript) => {
    const newScript = document.createElement('script')
    if (oldScript.src) {
      newScript.src = oldScript.src
    }
    newScript.textContent = oldScript.textContent
    oldScript.replaceWith(newScript)
  })
}

onMounted(() => {
  nextTick(render)
})

watch(
  () => props.html,
  () => {
    nextTick(render)
  },
)
</script>

<style scoped>
.ui-slot {
  display: contents;
}

/* 为空时完全隐藏 */
.ui-slot:empty {
  display: none;
}
</style>
