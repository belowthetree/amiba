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

      <div class="topbar-right-group">
        <SlotRenderer name="topbar.right" :html="slotHtml('topbar.right')" />

        <button class="nav-btn quick-btn" @click="$router.push('/quick')" :title="$t('app.quick')">
          ✦
        </button>

        <button class="nav-btn settings-btn" @click="$router.push('/settings')" :title="$t('app.settings')">
          ⚙️
        </button>
      </div>
    </header>

    <!-- Main content -->
    <main
      ref="mainRef"
      class="main-content"
      @touchstart.passive="onSwipeStart"
      @touchmove="onSwipeMove"
      @touchend="onSwipeEnd"
    >
      <!-- 当前页（手势拖动层） -->
      <div
        ref="pageWrapper"
        class="page-wrapper"
        :class="{ 'swipe-animating': swipeAnimating }"
        :style="{ transform: `translateX(${swipeOffsetX}px)` }"
      >
        <router-view v-slot="{ Component, route: r }">
          <transition :name="transitionName" :key="r.fullPath">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>

      <!-- 预览页（手势拖出时从边缘露出） -->
      <div
        v-if="previewComponent"
        class="preview-peek"
        :class="[previewOnLeft ? 'peek-left' : 'peek-right', { 'swipe-animating': swipeAnimating }]"
        :style="{ transform: `translateX(${swipeOffsetX}px)` }"
      >
        <component :is="previewComponent" />
      </div>

      <!-- 全局悬浮块容器 -->
      <FloatingWidgetContainer />

      <!-- WebView 预览悬浮控制栏 -->
      <WebviewOverlay />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch, ref, shallowRef, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import FloatingWidgetContainer from './host/floating-widget-container.vue'
import WebviewOverlay from './components/WebviewOverlay.vue'
import SlotRenderer from './components/SlotRenderer.vue'
import { themeState } from './config/theme-store'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const mainRef = ref<HTMLElement>()
const pageWrapper = ref<HTMLElement>()

// ==== 页面序列（从左到右） ====
const PAGE_ORDER = ['/services', '/', '/quick', '/settings', '/memory']

// ==== 页面组件注册表（用于手势预览时渲染目标页） ====
const PAGE_COMPONENTS: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  '/services': defineAsyncComponent(() => import('./pages/ServiceBrowsePage.vue')),
  '/': defineAsyncComponent(() => import('./pages/ChatPage.vue')),
  '/quick': defineAsyncComponent(() => import('./pages/QuickPage.vue')),
  '/settings': defineAsyncComponent(() => import('./pages/SettingsPage.vue')),
  '/memory': defineAsyncComponent(() => import('./pages/MemoryPage.vue')),
}

const transitionName = ref('page-forward')

function routePath(name: string | symbol | null | undefined): string {
  if (name === 'services') return '/services'
  if (name === 'chat') return '/'
  if (name === 'quick') return '/quick'
  if (name === 'settings') return '/settings'
  if (name === 'memory') return '/memory'
  return '/'
}

function getPageIndex(path: string): number {
  return PAGE_ORDER.indexOf(path)
}

// ==== 全局导航守卫：自动计算过渡方向 ====
router.beforeEach((to, from) => {
  // 手势驱动时跳过 CSS transition（手势自身控制动画）
  if (swipeCommitted.value) return

  const toPath = routePath(to.name)
  const fromPath = routePath(from.name)

  if (to.name === 'service') {
    transitionName.value = 'page-forward'
    return
  }
  if (from.name === 'service') {
    transitionName.value = 'page-back'
    return
  }

  const toIdx = getPageIndex(toPath)
  const fromIdx = getPageIndex(fromPath)
  if (toIdx >= 0 && fromIdx >= 0) {
    transitionName.value = toIdx > fromIdx ? 'page-forward' : 'page-back'
  } else {
    transitionName.value = 'page-forward'
  }
})

// ==== iPhone 风格跟手滑动手势 ====
const swipeOffsetX = ref(0)        // 实时 translateX 像素
const swipeAnimating = ref(false)  // 松手后 CSS 动画中
const swipeCommitted = ref(false)  // 动画完成待切路由
const isSwiping = ref(false)       // 手势进行中

let swipeStartX = 0
let swipeStartY = 0
let swipeStartTime = 0
let swipeLastX = 0
let swipeLastTime = 0
let swipeDir = 0 // 1=右滑(back), -1=左滑(forward)
let swipeTargetPath = ''

// ==== 预览页面（手势时从边缘露出目标页） ====
const previewComponent = shallowRef<any>(null)
const previewOnLeft = ref(false) // true=预览在左边(back), false=预览在右边(forward)

function showPreview(path: string, onLeft: boolean) {
  previewOnLeft.value = onLeft
  const comp = PAGE_COMPONENTS[path]
  if (comp && previewComponent.value !== comp) {
    previewComponent.value = comp
  }
}
function hidePreview() {
  previewComponent.value = null
}

const SWIPE_THRESHOLD_RATIO = 0.28   // 超过屏幕 28% 触发切换
const SWIPE_VELOCITY_THRESHOLD = 0.3 // px/ms 快速滑动阈值
const SWIPE_DAMP = 0.55              // 超出阈值后的阻尼系数
const SWIPE_ANIM_DURATION = 280      // 松手后动画时长 ms

function screenW(): number {
  return window.innerWidth
}

function onSwipeStart(e: TouchEvent) {
  // 如果正在做 CSS 过渡动画，取消它
  if (swipeAnimating.value) {
    cancelSwipeAnimation()
  }

  const t = e.touches[0]
  swipeStartX = t.clientX
  swipeStartY = t.clientY
  swipeStartTime = Date.now()
  swipeLastX = swipeStartX
  swipeLastTime = swipeStartTime
  swipeOffsetX.value = 0
  swipeDir = 0
  swipeTargetPath = ''
  isSwiping.value = false
  swipeCommitted.value = false
  hidePreview()
}

function onSwipeMove(e: TouchEvent) {
  const t = e.touches[0]
  const dx = t.clientX - swipeStartX
  const dy = t.clientY - swipeStartY

  // 未进入水平滑动模式时：需要超过垂直方向 1.5 倍 + 最小 8px 才激活
  if (!isSwiping.value) {
    if (Math.abs(dx) < 8) return
    if (Math.abs(dy) * 1.5 > Math.abs(dx)) return
    isSwiping.value = true
    swipeDir = dx > 0 ? 1 : -1

    // 确定目标路由
    const currentPath = routePath(route.name)
    const idx = getPageIndex(currentPath)
    if (idx >= 0) {
      if (swipeDir < 0 && idx < PAGE_ORDER.length - 1) {
        swipeTargetPath = PAGE_ORDER[idx + 1]
      } else if (swipeDir > 0 && idx > 0) {
        swipeTargetPath = PAGE_ORDER[idx - 1]
      }
    }
    if (!swipeTargetPath) {
      isSwiping.value = false
      return
    }
    // 激活预览页渲染
    showPreview(swipeTargetPath, swipeDir > 0)
  }

  // 如果目标路由不可达，忽略
  if (!swipeTargetPath) return

  // 计算偏移量（带阻尼：超过 60% 屏宽后阻力增大）
  const absDx = Math.abs(dx)
  const limit = screenW() * 0.6
  const offset = swipeDir > 0
    ? (absDx > limit ? limit + (absDx - limit) * SWIPE_DAMP : absDx)
    : -(absDx > limit ? limit + (absDx - limit) * SWIPE_DAMP : absDx)

  swipeOffsetX.value = offset
  swipeLastX = t.clientX
  swipeLastTime = Date.now()
  e.preventDefault()
}

function onSwipeEnd(_e: TouchEvent) {
  if (!isSwiping.value) return
  isSwiping.value = false

  const offset = Math.abs(swipeOffsetX.value)
  const elapsed = Date.now() - swipeLastTime
  const velocity = elapsed > 0 ? offset / elapsed : 0
  const threshold = screenW() * SWIPE_THRESHOLD_RATIO

  // 判断是否触发切换：位移超过阈值 或 快速滑动
  const shouldCommit = offset > threshold || velocity > SWIPE_VELOCITY_THRESHOLD

  if (shouldCommit && swipeTargetPath) {
    // 提交切换：CSS 动画到屏幕边缘
    const targetOffset = swipeDir * screenW()
    swipeAnimating.value = true
    swipeCommitted.value = true
    swipeOffsetX.value = targetOffset

    // 动画结束后切路由
    setTimeout(() => {
      router.push(swipeTargetPath).then(() => {
        // 瞬间重置位置（关闭动画过渡）
        swipeAnimating.value = false
        swipeOffsetX.value = 0
        swipeCommitted.value = false
        hidePreview()
      })
    }, SWIPE_ANIM_DURATION)
  } else {
    // 回弹：CSS 动画回 0
    swipeAnimating.value = true
    swipeOffsetX.value = 0
    setTimeout(() => {
      swipeAnimating.value = false
      hidePreview()
    }, SWIPE_ANIM_DURATION)
  }
}

function cancelSwipeAnimation() {
  swipeAnimating.value = false
  swipeOffsetX.value = 0
  swipeCommitted.value = false
  isSwiping.value = false
  hidePreview()
}

const routeTitles: Record<string, string> = {
  chat: t('app.title'),
  settings: t('app.settings'),
  memory: t('app.memory'),
  quick: t('app.quick'),
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
/* === Global Reset & Design Tokens === */
/* 精致柔和风设计系统：现代靛蓝主色、大圆角、柔和分层阴影 */
:root {
  --color-primary: #6366F1;
  --color-primary-hover: #4F46E5;
  --color-primary-light: #EEF2FF;
  --color-bg: #F5F6F8;
  --color-surface: #FFFFFF;
  --color-text: #1F2329;
  --color-text-secondary: #6B7280;
  --color-text-muted: #9CA3AF;
  --color-success: #22C55E;
  --color-success-light: #ECFDF3;
  --color-warning: #F59E0B;
  --color-warning-light: #FFFBEB;
  --color-error: #EF4444;
  --color-error-dark: #DC2626;
  --color-error-light: #FEF2F2;
  --color-border: #E5E7EB;
  --color-border-light: #F1F3F5;
  --color-divider: #F1F3F5;
  --color-hover-bg: #F3F4F6;
  --color-disabled: #D1D5DB;
  --color-on-primary: #FFFFFF;
  --color-tool-msg-bg: #F3F4F6;
  --color-tool-msg-text: #6B7280;
  --color-scrollbar-thumb: #C7CBD1;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.04);
  --shadow-md: 0 4px 8px -2px rgba(16, 24, 40, 0.06), 0 8px 20px -4px rgba(16, 24, 40, 0.08);
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-md: 15px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
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
  background: var(--color-scrollbar-thumb, #c0c0c0);
  border-radius: 4px;
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
  border-bottom: 1px solid var(--color-border-light, #eee);
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
  border-radius: 50%;
  color: var(--color-text);
  flex-shrink: 0;
  transition: background 0.18s ease, transform 0.12s ease;
}

.nav-btn:hover {
  background: var(--color-hover-bg, #f0f0f0);
}

.nav-btn:active {
  background: var(--color-hover-bg, #f0f0f0);
  transform: scale(0.92);
}

.topbar-right-group {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
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
  position: relative;
}

/* ==== 页面容器（手势拖动层） ==== */
.page-wrapper {
  width: 100%;
  height: 100%;
  will-change: transform;
  touch-action: pan-y; /* 允许垂直滚动，拦截水平滑动 */
}

/* 松手后的惯性 / 回弹动画 */
.page-wrapper.swipe-animating {
  transition: transform 0.28s cubic-bezier(0.25, 0.1, 0.25, 1);
}

/* 预览页与当前页同步过渡（跟手滑动 + 松手动画） */
.preview-peek.swipe-animating {
  transition: transform 0.28s cubic-bezier(0.25, 0.1, 0.25, 1);
}

/* ==== 预览页面（手势拖动时从边缘露出） ==== */
.preview-peek {
  position: absolute;
  top: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  background: var(--color-bg);
  overflow: hidden;
}
.peek-right { left: 100%; }
.peek-left  { right: 100%; }

/* ==== TopBar / 非手势导航的 CSS 过渡 ==== */
/* 仅在非手势触发的路由切换时生效（手势有自己的 JS 动画） */

.page-forward-enter-active,
.page-forward-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.page-forward-enter-from { opacity: 0; transform: translateX(30px); }
.page-forward-leave-to   { opacity: 0; transform: translateX(-20px); }

.page-back-enter-active,
.page-back-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.page-back-enter-from { opacity: 0; transform: translateX(-30px); }
.page-back-leave-to   { opacity: 0; transform: translateX(20px); }

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
