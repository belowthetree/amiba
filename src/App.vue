<!-- ============================================================
变形虫 (Amiba) — App.vue (根组件: 玻璃背景 + 边缘翻页 + router-view)
============================================================ -->
<template>
  <div class="app-shell">
    <!-- 玻璃辉光背景 -->
    <GlassBackground />

    <!-- 边缘翻页提示 -->
    <EdgeNavHint />

    <!-- 版本更新提示横幅 -->
    <div v-if="updateBanner.visible" class="update-banner" @click="goToUpdate">
      <span class="update-banner-icon">🆕</span>
      <span class="update-banner-text">{{ $t('app.updateAvailable', { version: updateBanner.version }) }}</span>
      <button class="update-banner-close" @click.stop="dismissUpdateBanner" :title="$t('app.dismiss')">✕</button>
    </div>

    <!-- Main content -->
    <main
      ref="mainRef"
      class="main-content"
      @touchstart.passive="onSwipeStart"
      @touchmove="onSwipeMove"
      @touchend="onSwipeEnd"
      @touchcancel="onSwipeEnd"
    >
      <!-- 当前页（手势拖动层） -->
      <div
        ref="pageWrapper"
        class="page-wrapper"
        :style="swipeStyle"
      >
        <router-view v-slot="{ Component, route: r }">
          <transition :name="transitionName" @after-enter="onPageEntered">
            <!-- 聊天页常驻缓存：滑回时复用 DOM 与滚动位置，避免重挂载闪烁 -->
            <keep-alive include="ChatPage">
              <component :is="Component" :key="r.fullPath" />
            </keep-alive>
          </transition>
        </router-view>
      </div>

      <!-- 预览页（手势拖出时从边缘露出） -->
      <div
        v-if="previewComponent"
        class="preview-peek"
        :class="[previewOnLeft ? 'peek-left' : 'peek-right']"
        :style="swipeStyle"
      >
        <component :is="previewComponent" />
      </div>

      <!-- 全局悬浮块容器 -->
      <FloatingWidgetContainer />

      <!-- WebView 预览悬浮控制栏 -->
      <WebviewOverlay />
    </main>

    <!-- API 设置引导：无可用 API 时占满全屏，验证通过前不可关闭 -->
    <ApiSetupOverlay
      v-if="apiSetupRequired"
      :reason="apiSetupReason"
      @ready="apiSetupRequired = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch, ref, shallowRef, defineAsyncComponent, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FloatingWidgetContainer from './host/floating-widget-container.vue'
import WebviewOverlay from './components/WebviewOverlay.vue'
import GlassBackground from './components/GlassBackground.vue'
import EdgeNavHint from './components/EdgeNavHint.vue'
import ApiSetupOverlay from './components/ApiSetupOverlay.vue'
import { testApiConnection } from './ai/api-check'
import { themeState } from './config/theme-store'
import { settings } from './config/config'
import { checkForUpdate } from './config/updater'
import { isHarmonyRuntime, nativeListen, type UnlistenFn } from './config/platform-bridge'
import { PAGE_ORDER } from './router'

const route = useRoute()
const router = useRouter()
const mainRef = ref<HTMLElement>()
const pageWrapper = ref<HTMLElement>()

// 当前主题名同步到 <html data-theme>，供 GlassBackground 等按主题微调
watch(() => themeState.activeTheme, (name) => {
  document.documentElement.dataset.theme = name
}, { immediate: true })

// ==== 页面组件注册表（用于手势预览时渲染目标页） ====
const PAGE_COMPONENTS: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  '/services': defineAsyncComponent(() => import('./pages/ServiceBrowsePage.vue')),
  '/': defineAsyncComponent(() => import('./pages/ChatPage.vue')),
  '/quick': defineAsyncComponent(() => import('./pages/QuickPage.vue')),
  '/registry': defineAsyncComponent(() => import('./pages/RemoteServicesPage.vue')),
  '/settings': defineAsyncComponent(() => import('./pages/SettingsPage.vue')),
  '/memory': defineAsyncComponent(() => import('./pages/MemoryPage.vue')),
}

const transitionName = ref('page-forward')

function routePath(name: string | symbol | null | undefined): string {
  if (name === 'services') return '/services'
  if (name === 'chat') return '/'
  if (name === 'quick') return '/quick'
  if (name === 'registry') return '/registry'
  if (name === 'settings') return '/settings'
  if (name === 'memory') return '/memory'
  return '/'
}

function getPageIndex(path: string): number {
  return PAGE_ORDER.indexOf(path)
}

// ==== 全局导航守卫：自动计算过渡方向 ====
router.beforeEach((to, from) => {
  // 手势驱动时用空过渡（手势自身已完成位移动画，避免二次动画/闪屏）
  if (swipeCommitted.value) {
    transitionName.value = 'none'
    return
  }

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
const swipeAnimMs = ref(280)       // 松手动画时长（按剩余距离/速度动态计算）
const swipeAnimEase = ref('cubic-bezier(0.25, 0.9, 0.3, 1)')

// 当前页与预览页共用同一 transform/transition，保证两侧严格同步
const swipeStyle = computed(() => ({
  transform: `translateX(${swipeOffsetX.value}px)`,
  transition: swipeAnimating.value
    ? `transform ${swipeAnimMs.value}ms ${swipeAnimEase.value}`
    : 'none',
}))

let swipeStartX = 0
let swipeStartY = 0
let swipeLastX = 0
let swipeSide = 0 // 当前拖动侧：1=右滑(上一页), -1=左滑(下一页)
let swipeTargetPath = ''
let swipeCommitSeq = 0 // 提交序号：新手势使旧的待执行提交失效
let moveSamples: { t: number; x: number }[] = [] // 近期位移采样，用于末端速度

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

const SWIPE_ACTIVATE_PX = 10       // 水平激活位移
const SWIPE_COMMIT_RATIO = 0.33    // 位移超过屏宽比例触发切换
const SWIPE_FLICK_VELOCITY = 0.4   // px/ms 末端快划速度阈值
const EDGE_DAMP = 0.28             // 边缘橡皮筋阻尼系数
const EDGE_MAX = 90                // 边缘橡皮筋最大位移 px

function screenW(): number {
  return window.innerWidth
}

// 指定拖动侧的目标路由（无目标表示已到边缘）
function sideTarget(dir: number): string {
  const idx = getPageIndex(routePath(route.name))
  if (idx < 0) return ''
  return PAGE_ORDER[idx - dir] ?? ''
}

function onSwipeStart(e: TouchEvent) {
  const t = e.touches[0]
  beginSwipe(t.clientX, t.clientY)
}

// 手势起始（宿主触摸与快捷页 iframe 转发共用）
function beginSwipe(x: number, y: number) {
  // 如果正在做 CSS 过渡动画，取消它
  if (swipeAnimating.value) {
    cancelSwipeAnimation()
  }
  swipeCommitSeq++ // 使上一次提交遗留的待执行回调失效

  swipeStartX = x
  swipeStartY = y
  swipeLastX = swipeStartX
  swipeOffsetX.value = 0
  swipeSide = 0
  swipeTargetPath = ''
  moveSamples = []
  isSwiping.value = false
  swipeCommitted.value = false
  hidePreview()
}

function onSwipeMove(e: TouchEvent) {
  const t = e.touches[0]
  trackSwipe(t.clientX, t.clientY, () => e.preventDefault())
}

// 手势移动：prevent 用于宿主触摸阻止默认滚动，iframe 转发场景无事件可阻止则不传
function trackSwipe(x: number, y: number, prevent?: () => void) {
  const dx = x - swipeStartX
  const dy = y - swipeStartY

  // 未激活时：超过最小位移且明显偏水平才进入滑动模式；偏垂直让位给页面滚动
  if (!isSwiping.value) {
    if (Math.abs(dx) < SWIPE_ACTIVATE_PX) return
    if (Math.abs(dy) * 1.5 > Math.abs(dx)) return
    // 当前页不在主导航中（如服务详情页）不做手势
    if (getPageIndex(routePath(route.name)) < 0) return
    isSwiping.value = true
    swipeSide = 0
    moveSamples = [{ t: Date.now(), x: swipeStartX }]
  }

  // 拖动侧跟随手指方向实时切换（不锁定方向，可中途反向）
  const dir = dx > 0.5 ? 1 : dx < -0.5 ? -1 : swipeSide
  if (dir !== 0 && dir !== swipeSide) {
    swipeSide = dir
    swipeTargetPath = sideTarget(dir)
    if (swipeTargetPath) showPreview(swipeTargetPath, dir > 0)
    else hidePreview()
  }

  // 采样最近 ~120ms 位移，估算松手瞬间速度
  const now = Date.now()
  moveSamples.push({ t: now, x })
  while (moveSamples.length > 2 && now - moveSamples[0].t > 120) moveSamples.shift()
  swipeLastX = x

  // 偏移：有目标时 1:1 跟手（限幅一屏）；到边缘时橡皮筋阻尼，松手回弹
  const w = screenW()
  if (swipeTargetPath) {
    swipeOffsetX.value = Math.max(-w, Math.min(w, dx))
  } else {
    swipeOffsetX.value = Math.max(-EDGE_MAX, Math.min(EDGE_MAX, dx * EDGE_DAMP))
  }
  prevent?.()
}

function onSwipeEnd(_e?: TouchEvent) {
  if (!isSwiping.value) return
  isSwiping.value = false

  // 末端速度：取最近 120ms 采样的平均速度，避免全程平均淹没问题
  const now = Date.now()
  const first = moveSamples[0]
  const vx = first && now > first.t ? (swipeLastX - first.x) / (now - first.t) : 0

  const w = screenW()
  const offset = swipeOffsetX.value
  const dist = Math.abs(offset)
  // 快划时以速度方向为准（支持轻拂切换），否则以位移方向为准
  const dir = Math.abs(vx) > SWIPE_FLICK_VELOCITY
    ? Math.sign(vx)
    : (Math.sign(offset) || swipeSide)
  const target = dir !== 0 ? sideTarget(dir) : ''
  // 反向快划（拖出去又甩回来）视为取消
  const sameDir = dist < 2 || dir === Math.sign(offset)
  const shouldCommit =
    !!target && sameDir && (dist > w * SWIPE_COMMIT_RATIO || Math.abs(vx) > SWIPE_FLICK_VELOCITY)

  if (shouldCommit) {
    // 提交切换：时长随剩余距离和末速度收缩，快划时迅速收尾
    const remaining = w - dist
    swipeAnimMs.value = Math.round(
      Math.min(300, Math.max(130, remaining / Math.max(Math.abs(vx), 0.9)))
    )
    swipeAnimEase.value = 'cubic-bezier(0.2, 0.8, 0.3, 1)'
    swipeAnimating.value = true
    swipeCommitted.value = true
    swipeOffsetX.value = dir * w
    const path = target
    const commitId = ++swipeCommitSeq
    // 等滑出动画真正结束（transitionend）再切路由，避免定时器与视觉帧竞态导致的回弹
    let pushed = false
    const doPush = () => {
      if (pushed || !swipeCommitted.value || commitId !== swipeCommitSeq) return
      pushed = true
      pageWrapper.value?.removeEventListener('transitionend', onTransitionEnd)
      // 位移复位推迟到组件切换完成（onPageEntered），过早复位会让旧页闪回一帧
      router.push(path).catch(() => {})
      // 兜底：过渡回调未触发（导航被拦截等）时强制复位
      setTimeout(() => {
        if (swipeCommitted.value && commitId === swipeCommitSeq) resetSwipeState()
      }, 500)
    }
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'transform') doPush()
    }
    pageWrapper.value?.addEventListener('transitionend', onTransitionEnd)
    setTimeout(doPush, swipeAnimMs.value + 80) // 兜底：transitionend 未触发
  } else {
    // 回弹：时长随弹回距离缩放
    swipeAnimMs.value = Math.round(
      Math.min(320, Math.max(160, dist / Math.max(Math.abs(vx), 0.5)))
    )
    swipeAnimEase.value = 'cubic-bezier(0.3, 1.0, 0.4, 1)'
    swipeAnimating.value = true
    swipeOffsetX.value = 0
    setTimeout(() => {
      swipeAnimating.value = false
      hidePreview()
    }, swipeAnimMs.value)
  }
}

function cancelSwipeAnimation() {
  swipeAnimating.value = false
  swipeOffsetX.value = 0
  swipeCommitted.value = false
  isSwiping.value = false
  hidePreview()
}

/** 手势提交后的统一复位（关闭动画、归零位移、隐藏预览） */
function resetSwipeState() {
  swipeAnimating.value = false
  swipeOffsetX.value = 0
  swipeCommitted.value = false
  hidePreview()
}

// ==== 快捷页 iframe 触摸转发 ====
// iframe 内的触摸事件不会冒泡到宿主文档，快捷页通过 postMessage 转发触摸坐标，
// 这里把转发坐标喂回同一套手势逻辑，使快捷页也能滑动切换页面
function onIframeTouchMessage(e: MessageEvent) {
  const d = e.data as { type?: string; phase?: string; x?: unknown; y?: unknown } | null
  if (!d || d.type !== 'amiba-quick-touch') return
  if (route.name !== 'quick') return
  if (typeof d.x !== 'number' || typeof d.y !== 'number') return
  if (d.phase === 'start') beginSwipe(d.x, d.y)
  else if (d.phase === 'move') trackSwipe(d.x, d.y)
  else if (d.phase === 'end') onSwipeEnd()
}

// 页面过渡完成回调：重置主容器滚动位置；手势提交后在此复位位移（新页挂载后再归零，避免旧页闪回）
function onPageEntered() {
  if (mainRef.value) mainRef.value.scrollTop = 0
  if (!swipeCommitted.value) return
  resetSwipeState()
}

// ==== 版本更新横幅 ====
const updateBanner = reactive({
  visible: false,
  version: '',
})

async function checkUpdateBanner() {
  try {
    const info = await checkForUpdate()
    if (info.hasUpdate && info.latestVersion !== settings.dismissed_update_version) {
      updateBanner.visible = true
      updateBanner.version = info.latestVersion
      console.log('[App] 发现新版本:', info.latestVersion, '当前:', info.currentVersion)
    }
  } catch {
    // 检查失败静默忽略（网络问题等）
  }
}

function dismissUpdateBanner() {
  updateBanner.visible = false
  settings.dismissed_update_version = updateBanner.version
  console.log('[App] 已忽略版本:', updateBanner.version)
}

function goToUpdate() {
  router.push('/settings')
  // 延迟滚动到关于区域
  setTimeout(() => {
    const el = document.querySelector('.settings-section .about-info')
    el?.scrollIntoView({ behavior: 'smooth' })
  }, 300)
}

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

// ==== 安卓桌面卡片点击跳转 ====
// 热启动：MainActivity 向 WebView 注入 amiba-widget-navigate 事件
function onWidgetNavigate(e: Event) {
  const path = (e as CustomEvent).detail
  if (typeof path === 'string' && path.startsWith('/')) {
    console.log('[App] 桌面卡片跳转:', path)
    router.push(path).catch(() => {})
  }
}

// 鸿蒙热通道：ArkTS 壳经 emitToWeb 推送同名事件（FormCommands.handleHotTap），
// 走 nativeListen 而非 DOM 事件
let unlistenWidgetNavigate: UnlistenFn | null = null
async function setupHarmonyWidgetNavigate() {
  if (!isHarmonyRuntime()) return
  unlistenWidgetNavigate = await nativeListen<string>('amiba-widget-navigate', (e) => {
    if (typeof e.payload === 'string' && e.payload.startsWith('/')) {
      console.log('[App] 桌面卡片跳转(鸿蒙):', e.payload)
      router.push(e.payload).catch(() => {})
    }
  })
}

// 冷启动兜底：bootstrap 后消费一次原生侧暂存的跳转路径
async function consumePendingWidgetTap() {
  try {
    const { consumeWidgetTapPath } = await import('./config/desktop-widget-store')
    const path = await consumeWidgetTapPath()
    if (path && path.startsWith('/')) {
      console.log('[App] 桌面卡片冷启动跳转:', path)
      router.push(path).catch(() => {})
    }
  } catch { /* 非 Android 或调用失败，静默 */ }
}

onMounted(() => {
  injectThemeStyles()
  watch(() => ({ ...themeState.variables, css: themeState.customCSS }), injectThemeStyles, { deep: true })
  window.addEventListener('message', onIframeTouchMessage)
  window.addEventListener('amiba-widget-navigate', onWidgetNavigate)
  setupHarmonyWidgetNavigate()
  consumePendingWidgetTap()
  // 启动后延时检查更新（避免阻塞首屏）
  setTimeout(() => checkUpdateBanner(), 2000)
  // API 可用性检查：未配置或不可用时弹出全屏设置引导
  checkApiAvailability()
})

// ==== API 可用性检查（启动门） ====
const apiSetupRequired = ref(false)
const apiSetupReason = ref<'missing' | 'unavailable'>('missing')

async function checkApiAvailability() {
  if (!settings.api_key) {
    console.log('[App] 未配置 API Key，显示 API 设置引导')
    apiSetupReason.value = 'missing'
    apiSetupRequired.value = true
    return
  }
  // 已配置 Key：后台验证连通性，不可用则弹出引导
  const result = await testApiConnection(settings.ai_base_url, settings.api_key, settings.ai_model)
  if (!result.ok) {
    console.log('[App] API 不可用，显示 API 设置引导:', result.error)
    apiSetupReason.value = 'unavailable'
    apiSetupRequired.value = true
  } else {
    console.log('[App] ✓ API 可用性检查通过')
  }
}

onUnmounted(() => {
  window.removeEventListener('message', onIframeTouchMessage)
  window.removeEventListener('amiba-widget-navigate', onWidgetNavigate)
  unlistenWidgetNavigate?.()
})
</script>

<style>
/* === Global Reset & Design Tokens === */
/* 玉石玻璃风设计系统：玉青主色、半透明表面、大圆角、柔和分层阴影 */
:root {
  --color-primary: #2FA98C;
  --color-primary-hover: #238D75;
  --color-primary-light: #E1F3ED;
  --color-bg: #EDF3F0;
  --color-surface: rgba(255, 255, 255, 0.78);
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
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  /* 关闭 Android WebView 点击时的绿色高亮方块 */
  -webkit-tap-highlight-color: transparent;
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

/* 版本更新横幅（浮动玻璃胶囊） */
.update-banner {
  position: fixed;
  top: calc(max(var(--safe-top), 8px) + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  max-width: calc(100vw - 32px);
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 82%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--color-primary-light);
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  border-radius: 999px;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  font-size: 13px;
  color: var(--color-primary-hover, #238D75);
  transition: background 0.2s ease;
}
.update-banner:hover {
  background: var(--color-primary-light, #E1F3ED);
}
.update-banner-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.update-banner-text {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.update-banner-close {
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  font-size: 14px;
  cursor: pointer;
  color: var(--color-text-muted, #9CA3AF);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}
.update-banner-close:hover {
  color: var(--color-text, #1F2329);
  background: rgba(0,0,0,0.06);
}

/* Main content */
.main-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  position: relative;
  z-index: 1;
  /* 隐藏主容器滚动条：桌面端经典滚动条会挤压内容宽度，导致居中页面偏左 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.main-content::-webkit-scrollbar {
  display: none;
}

/* ==== 页面容器（手势拖动层） ==== */
.page-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  padding-top: max(var(--safe-top), 8px);
  will-change: transform;
  touch-action: pan-y; /* 允许垂直滚动，拦截水平滑动 */
}

/* ==== 预览页面（手势拖动时从边缘露出） ==== */
.preview-peek {
  position: fixed; /* fixed：长页面滚动后预览仍与视口对齐 */
  top: 0;
  width: 100%;
  height: 100%;
  padding-top: max(var(--safe-top), 8px);
  z-index: 0;
  overflow: hidden;
}
.peek-right { left: 100%; }
.peek-left  { right: 100%; }

/* ==== 非手势导航的 CSS 过渡（与滑动手势一致的同步横滑） ==== */
/* 过渡期间两页都脱离文档流绝对定位叠放，互不影响布局，结束后恢复正常流 */
/* left/right 同时为 0：让 max-width 页面根元素靠自身 margin auto 居中，避免偏左 */
.page-forward-enter-active,
.page-forward-leave-active,
.page-back-enter-active,
.page-back-leave-active {
  position: absolute;
  top: max(var(--safe-top), 8px);
  left: 0;
  right: 0;
  height: calc(100% - max(var(--safe-top), 8px));
  overflow: hidden;
  pointer-events: none;
  transition: transform 0.28s cubic-bezier(0.25, 0.9, 0.3, 1);
}

.page-forward-enter-from { transform: translateX(100%); }
.page-forward-leave-to   { transform: translateX(-100%); }
.page-back-enter-from    { transform: translateX(-100%); }
.page-back-leave-to      { transform: translateX(100%); }
</style>
