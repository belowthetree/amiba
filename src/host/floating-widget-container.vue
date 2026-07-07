<!-- ============================================================
变形虫 (Amiba) — FloatingWidgetContainer（悬浮块全局容器）
============================================================ -->
<template>
  <div class="floating-widget-layer" v-if="hasVisibleWidgets">
    <div
      v-for="(state, id) in widgetStates"
      :key="id"
      v-show="state.visible"
      class="floating-widget-anchor"
      :class="[state.config.edge === 'left' ? 'edge-left' : 'edge-right']"
      :style="{ top: state.yPosition + 'px' }"
    >
      <!-- 展开面板 -->
      <transition name="panel-slide">
        <div
          v-if="state.expanded"
          class="widget-panel"
          :class="state.config.edge === 'left' ? 'panel-right' : 'panel-left'"
        >
          <div class="panel-header">
            <span class="panel-label">{{ state.config.label || state.config.id }}</span>
            <button class="panel-close" @click.stop="collapse(id)" :title="state.config.lifecycle === 'persistent' ? $t('host.close') : ''">✕</button>
          </div>
          <div class="panel-body">
            <iframe
              class="widget-iframe"
              :srcdoc="state.htmlContent"
              :data-widget-id="id"
              sandbox="allow-scripts"
              allow="clipboard-write"
            ></iframe>
          </div>
        </div>
      </transition>

      <!-- 图标按钮 -->
      <div class="widget-icon-wrap">
        <button
          class="widget-icon-btn"
          :title="state.config.label || state.config.id"
          @click="toggle(id)"
          @mousedown.prevent="startDrag($event, id)"
          @touchstart.prevent="startDrag($event, id)"
        >
          <span class="widget-icon">{{ state.config.icon }}</span>
        </button>
        <button
          v-if="state.config.lifecycle === 'persistent'"
          class="widget-icon-close"
          @click.stop="closePersistentWidget(id)"
          title="移除"
        >✕</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  widgetStates,
  setWidgetExpanded,
  updateWidgetPosition,
  closePersistentWidget,
} from './floating-widget-manager'
import { onRouteChange } from './widget-lifecycle'

const route = useRoute()

// ---- 路由监听 ----

onMounted(() => {
  onRouteChange((route.name as string) || null)
})

watch(
  () => route.name,
  (name) => {
    onRouteChange((name as string) || null)
  }
)

// ---- 悬浮块自动适应高度 ----

function handleWidgetResize(event: MessageEvent) {
  const data = event.data
  if (!data || data.type !== 'widget-resize') return
  const { widgetId, height } = data
  if (!widgetId || !height) return
  const iframe = document.querySelector('iframe[data-widget-id="' + widgetId + '"]') as HTMLIFrameElement | null
  if (iframe) {
    iframe.style.height = Math.min(Math.max(height, 80), 480) + 'px'
  }
}

onMounted(() => {
  window.addEventListener('message', handleWidgetResize)
})

onUnmounted(() => {
  window.removeEventListener('message', handleWidgetResize)
})

// ---- 计算 ----

const hasVisibleWidgets = computed(() => {
  return Object.values(widgetStates).some((s) => s.visible)
})

// ---- 交互 ----

function toggle(id: string) {
  if (hasDragged) return
  const state = widgetStates[id]
  if (!state) return
  setWidgetExpanded(id, !state.expanded)
}

function collapse(id: string) {
  setWidgetExpanded(id, false)
}

// ---- 拖动 ----

let dragTarget: string | null = null
let dragStartY = 0
let dragStartWidgetY = 0
let hasDragged = false

function startDrag(event: MouseEvent | TouchEvent, id: string) {
  dragTarget = id
  hasDragged = false
  const state = widgetStates[id]
  if (!state) return
  dragStartWidgetY = state.yPosition

  const clientY =
    event instanceof MouseEvent ? event.clientY : event.touches[0].clientY
  dragStartY = clientY

  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
  document.addEventListener('touchmove', onDrag, { passive: false })
  document.addEventListener('touchend', stopDrag)
}

function onDrag(event: MouseEvent | TouchEvent) {
  if (!dragTarget) return
  const clientY =
    event instanceof MouseEvent ? event.clientY : event.touches[0].clientY
  const deltaY = clientY - dragStartY
  if (Math.abs(deltaY) > 5) hasDragged = true
  const newY = Math.max(60, Math.min(window.innerHeight - 160, dragStartWidgetY + deltaY))
  updateWidgetPosition(dragTarget, newY)
}

function stopDrag() {
  dragTarget = null
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  document.removeEventListener('touchmove', onDrag)
  document.removeEventListener('touchend', stopDrag)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  document.removeEventListener('touchmove', onDrag)
  document.removeEventListener('touchend', stopDrag)
})
</script>

<style scoped>
/* ---- 层级容器 ---- */
.floating-widget-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9000;
}

/* ---- 锚点 ---- */
.floating-widget-anchor {
  position: absolute;
  pointer-events: auto;
}

.edge-left {
  left: 4px;
}
.edge-right {
  right: 4px;
}

/* ---- 图标按钮 ---- */
.widget-icon-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid #e0e0e0;
  background: var(--color-surface, #fff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  touch-action: none;
  user-select: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.widget-icon-btn:active {
  transform: scale(0.92);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

.widget-icon {
  line-height: 1;
}

.widget-icon-wrap {
  position: relative;
}

.widget-icon-close {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #ddd;
  background: #fff;
  color: #999;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  padding: 0;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  z-index: 1;
}

.widget-icon-close:hover {
  background: #e53935;
  color: #fff;
  border-color: #e53935;
}

/* ---- 展开面板 ---- */
.widget-panel {
  position: absolute;
  top: 0;
  width: 280px;
  max-height: 480px;
  background: var(--color-surface, #fff);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 9500;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.panel-right {
  left: 52px;
}

.panel-left {
  right: 52px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  background: var(--color-surface, #fff);
}

.panel-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 50%;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  flex-shrink: 0;
  transition: background 0.15s;
}

.panel-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #666;
}

.panel-body {
  flex: 1;
  overflow: hidden;
}

.widget-iframe {
  width: 100%;
  height: 200px;
  border: none;
  background: transparent;
  transition: height 0.15s ease;
}

/* ---- 面板动画 ---- */
.panel-slide-enter-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.panel-slide-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.edge-right .panel-slide-enter-from,
.edge-right .panel-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.edge-left .panel-slide-enter-from,
.edge-left .panel-slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* ---- 响应式 ---- */
@media (max-width: 768px) {
  .widget-panel {
    width: 260px;
    max-height: 350px;
  }

  .widget-icon-btn {
    width: 40px;
    height: 40px;
    font-size: 20px;
  }
}
</style>
