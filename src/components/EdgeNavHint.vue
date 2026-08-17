<!-- ============================================================
变形虫 (Amiba) — EdgeNavHint (边缘翻页提示)
左右两侧的细长玻璃竖条，提示可滑动/点击切换页面
============================================================ -->
<template>
  <button
    v-if="prevTarget"
    class="edge-hint edge-left"
    :title="prevTarget.title"
    :aria-label="prevTarget.title"
    @click="go(prevTarget.path)"
  >
    <span class="chevron">‹</span>
  </button>
  <button
    v-if="nextTarget"
    class="edge-hint edge-right"
    :title="nextTarget.title"
    :aria-label="nextTarget.title"
    @click="go(nextTarget.path)"
  >
    <span class="chevron">›</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { pageRegistry } from '../plugins/page-registry/instance'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// 路径 → 页面名 i18n key
const PATH_TITLE_KEY: Record<string, string> = {
  '/services': 'app.services',
  '/': 'app.title',
  '/registry': 'app.registry',
  '/settings': 'app.settings',
  '/memory': 'app.memory',
}

// 主导航页面序列来自 pageRegistry；service / quick 等非导航页不显示边缘提示。
const mainNavPages = computed(() => {
  void pageRegistry.version.value
  return pageRegistry.list().filter((entry) => entry.mainNav)
})
const currentIndex = computed(() => mainNavPages.value.findIndex((entry) => entry.path === route.path))

function target(offset: number) {
  if (currentIndex.value < 0) return null
  const entry = mainNavPages.value[currentIndex.value + offset]
  if (!entry) return null
  return { path: entry.path, title: entry.title?.() ?? t(PATH_TITLE_KEY[entry.path] || 'app.title') }
}

const prevTarget = computed(() => target(-1))
const nextTarget = computed(() => target(1))

function go(path: string) {
  router.push(path)
}
</script>

<style scoped>
.edge-hint {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 60;
  width: 26px;
  height: 62px;
  padding: 0;
  border: 1px solid var(--color-border);
  border: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  border-radius: 999px;
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 55%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.35;
  box-shadow: var(--shadow-sm);
  transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;
}

.edge-left { left: 6px; }
.edge-right { right: 6px; }

.edge-hint:hover,
.edge-hint:focus-visible {
  opacity: 0.95;
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 80%, transparent);
}

.edge-hint:active {
  transform: translateY(-50%) scale(0.92);
}

.chevron {
  font-size: 20px;
  line-height: 1;
  font-weight: 500;
  user-select: none;
}

.edge-left .chevron { margin-left: -2px; }
.edge-right .chevron { margin-right: -2px; }
</style>
