<!-- ============================================================
变形虫 (Amiba) — QuickFab (快捷页悬浮入口)
快捷页不参与滑动切换，由本悬浮按钮作为全局入口；仅在主导航页显示
============================================================ -->
<template>
  <button
    v-if="visible"
    class="quick-fab"
    :title="$t('app.quick')"
    :aria-label="$t('app.quick')"
    @click="open"
  >
    ✦
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PAGE_ORDER } from '../router'

const route = useRoute()
const router = useRouter()

// 仅在主导航页显示；快捷页自身与服务详情等非导航页隐藏
const visible = computed(() => PAGE_ORDER.includes(route.path))

function open() {
  router.push('/quick')
}
</script>

<style scoped>
.quick-fab {
  position: fixed;
  right: 16px;
  /* 抬高避开聊天页底部输入条 */
  bottom: calc(max(var(--safe-bottom), 0px) + 88px);
  z-index: 60;
  width: 52px;
  height: 52px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary) 88%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--color-on-primary);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
  box-shadow: var(--shadow-md);
  transition: opacity 0.2s ease, transform 0.15s ease, background 0.2s ease;
}

.quick-fab:hover,
.quick-fab:focus-visible {
  opacity: 1;
  background: var(--color-primary);
}

.quick-fab:active {
  transform: scale(0.92);
}
</style>
