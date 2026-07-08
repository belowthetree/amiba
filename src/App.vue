<!-- ============================================================
变形虫 (Amiba) — App.vue (根组件: TopBar + router-view)
============================================================ -->
<template>
  <div class="app-shell">
    <!-- TopBar -->
    <header class="topbar">
      <button class="nav-btn home-btn" @click="$router.push('/services')" :title="$t('app.services')">📱</button>
      <button class="nav-btn home-btn" @click="$router.push('/')" :title="$t('app.title')">
        🏠
      </button>

      <SlotRenderer name="topbar.left" :html="slotHtml('topbar.left')" />

      <h1 v-if="!slotHtml('topbar.center')" class="topbar-title" @click="$router.push('/')">
        {{ currentTitle }}
      </h1>
      <SlotRenderer v-else name="topbar.center" :html="slotHtml('topbar.center')" />

      <SlotRenderer name="topbar.right" :html="slotHtml('topbar.right')" />

      <button class="nav-btn settings-btn" @click="$router.push('/settings')" :title="$t('app.settings')">
        ⚙️
      </button>
    </header>

    <!-- Main content -->
    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>

      <!-- 全局悬浮块容器 -->
      <FloatingWidgetContainer />

      <!-- WebView 预览悬浮控制栏 -->
      <WebviewOverlay />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import FloatingWidgetContainer from './host/floating-widget-container.vue'
import WebviewOverlay from './components/WebviewOverlay.vue'
import SlotRenderer from './components/SlotRenderer.vue'
import { themeState } from './config/theme-store'

const { t } = useI18n()
const route = useRoute()

const routeTitles: Record<string, string> = {
  chat: t('app.title'),
  home: t('app.home'),
  settings: t('app.settings'),
  memory: t('app.memory'),
  service: t('app.service'),
}

const currentTitle = computed(() => {
  const name = route.name as string
  return routeTitles[name] || t('app.title')
})

const slotHtml = (name: string) => themeState.slots[name] || ''

// 注入主题 CSS 变量和自定义 CSS 到 document.head
function injectThemeStyles() {
  let varsEl = document.getElementById('amiba-theme-vars') as HTMLStyleElement | null
  if (!varsEl) {
    varsEl = document.createElement('style')
    varsEl.id = 'amiba-theme-vars'
    document.head.appendChild(varsEl)
  }
  const entries = Object.entries(themeState.variables)
  varsEl.textContent = entries.length
    ? ':root {\n' + entries.map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}'
    : ''

  let customEl = document.getElementById('amiba-theme-custom') as HTMLStyleElement | null
  if (!customEl) {
    customEl = document.createElement('style')
    customEl.id = 'amiba-theme-custom'
    document.head.appendChild(customEl)
  }
  customEl.textContent = themeState.customCSS || ''
}

onMounted(() => {
  injectThemeStyles()
  watch(() => ({ ...themeState.variables, css: themeState.customCSS }), injectThemeStyles, { deep: true })
})
</script>

<style>
/* === Global Reset & Variables === */
:root {
  --color-primary: #1976D2;
  --color-bg: #f5f5f5;
  --color-surface: #ffffff;
  --color-text: #333333;
  --color-text-secondary: #999999;
  --topbar-height: 56px;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  height: 100%;
}

a {
  color: var(--color-primary);
  text-decoration: none;
}

button {
  font-family: inherit;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-button {
  width: 0;
  height: 0;
  display: none;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #c0c0c0;
  border-radius: 3px;
  border-right: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-button:start:decrement,
::-webkit-scrollbar-button:end:increment {
  display: none;
}
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 100vw;
  overflow: hidden;
}

/* TopBar */
.topbar {
  position: relative;
  display: flex;
  align-items: center;
  height: calc(var(--topbar-height) + var(--safe-top));
  padding: var(--safe-top) 12px 0 12px;
  background: var(--color-surface);
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
  z-index: 100;
  gap: 4px;
}

.nav-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: none;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #333;
  flex-shrink: 0;
}

.nav-btn:active {
  background: #f0f0f0;
}

.topbar-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 17px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 140px);
}

/* Main content */
.main-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

/* Page transitions */
.page-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.page-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.page-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* === 响应式：平板 === */
@media (min-width: 769px) and (max-width: 1024px) {
  .topbar {
    padding: calc(max(var(--safe-top), 8px) + 11px) 12px 0 12px;
  }
}

/* === 响应式：移动端全局 === */
@media (max-width: 768px) {
  .topbar {
    padding: max(var(--safe-top), 5px) 8px 0 8px;
  }

  .topbar-title {
    font-size: 15px;
  }

  .nav-btn {
    width: 36px;
    height: 36px;
    font-size: 18px;
  }
}
</style>
