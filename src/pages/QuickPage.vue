<!-- ============================================================
  变形虫 (Amiba) — QuickPage（自定义快捷页面）
  ============================================================ -->
<template>
  <div class="quick-page">
    <div v-if="content" ref="viewRef" class="custom-view-content" />
    <div v-else class="empty-state">
      <div class="empty-icon">✦</div>
      <h2>{{ $t('quick.title') }}</h2>
      <p>{{ $t('quick.emptyHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { quickViewContent, loadCustomView } from '../config/custom-view-store'

const content = ref('')
const viewRef = ref<HTMLElement>()

function render() {
  const el = viewRef.value
  if (!el) return
  const html = content.value
  if (!html.trim()) {
    el.innerHTML = ''
    return
  }
  el.innerHTML = html
  el.querySelectorAll('script').forEach((oldScript) => {
    const newScript = document.createElement('script')
    if (oldScript.src) {
      newScript.src = oldScript.src
    }
    newScript.textContent = oldScript.textContent
    oldScript.replaceWith(newScript)
  })
}

onMounted(async () => {
  const saved = await loadCustomView('quick')
  content.value = saved
  nextTick(render)
})

watch(quickViewContent, (val) => {
  content.value = val
  nextTick(render)
})
</script>

<style scoped>
.quick-page {
  max-width: 800px;
  margin: 0 auto;
  padding: var(--spacing-md);
  min-height: 100%;
}

.custom-view-content {
  display: contents;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px var(--spacing-md);
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: var(--spacing-md);
  opacity: 0.6;
}

.empty-state h2 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: var(--spacing-sm);
}

.empty-state p {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  max-width: 360px;
  line-height: 1.6;
}
</style>
