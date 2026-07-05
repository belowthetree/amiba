<!-- ============================================================
变形虫 (Amiba) — WebviewOverlay（WebView 悬浮预览面板）
============================================================ -->
<template>
  <div
    v-if="webviewOverlay.isBrowsing"
    class="webview-overlay"
    :style="{ top: webviewOverlay.yPosition + 'px' }"
  >
    <!-- 拖动把手 + 标题栏 -->
    <div
      class="overlay-header"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDrag"
    >
      <span class="overlay-icon">🌐</span>
      <span class="overlay-title">{{ webviewOverlay.pageTitle || webviewOverlay.currentUrl }}</span>
      <button
        class="overlay-close"
        @click.stop="showConfirm = true"
        :title="$t('webview.closeTitle')"
      >
        ✕
      </button>
    </div>

    <!-- 预览窗 body 区域（显示截图或加载中） -->
    <div class="overlay-body">
      <img
        v-if="webviewOverlay.screenshot"
        :src="webviewOverlay.screenshot"
        class="screenshot-img"
        alt="WebView screenshot"
      />
      <div v-else class="body-loading">{{ $t('webview.capturing') }}...</div>
    </div>

    <!-- 确认关闭弹窗 -->
    <div v-if="showConfirm" class="confirm-overlay" @click.self="showConfirm = false">
      <div class="confirm-dialog">
        <div class="confirm-text">{{ $t('webview.closeConfirm') }}</div>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel" @click="showConfirm = false">
            {{ $t('webview.cancel') }}
          </button>
          <button class="confirm-btn confirm-ok" @click="handleClose">
            {{ $t('webview.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  webviewOverlay,
  stopBrowsing,
  updateOverlayPosition,
  initScreenshotListener,
  destroyScreenshotListener,
} from '../host/webview-overlay-state'
import { closeBrowser } from '../config/web-bridge'

const { t } = useI18n()
const showConfirm = ref(false)

onMounted(() => {
  initScreenshotListener()
})

async function handleClose() {
  showConfirm.value = false
  try {
    await closeBrowser()
    console.log('[WebviewOverlay] Browser closed via close button')
  } catch (e: any) {
    console.error('[WebviewOverlay] closeBrowser failed:', e)
  }
  stopBrowsing()
}

// ---- 拖动 ----

let dragStartY = 0
let dragStartWidgetY = 0
let hasDragged = false

function startDrag(event: MouseEvent | TouchEvent) {
  hasDragged = false
  dragStartWidgetY = webviewOverlay.yPosition

  const clientY =
    event instanceof MouseEvent ? event.clientY : event.touches[0].clientY
  dragStartY = clientY

  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
  document.addEventListener('touchmove', onDrag, { passive: false })
  document.addEventListener('touchend', stopDrag)
}

function onDrag(event: MouseEvent | TouchEvent) {
  const clientY =
    event instanceof MouseEvent ? event.clientY : event.touches[0].clientY
  const deltaY = clientY - dragStartY
  if (Math.abs(deltaY) > 5) hasDragged = true
  updateOverlayPosition(dragStartWidgetY + deltaY)
}

function stopDrag() {
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
  destroyScreenshotListener()
})
</script>

<style scoped>
.webview-overlay {
  position: fixed;
  right: 8px;
  width: 500px;
  background: #2c2c2c;
  border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 标题栏 */
.overlay-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #1e1e1e;
  cursor: move;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
  z-index: 2;
}

.overlay-icon {
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}

.overlay-title {
  flex: 1;
  font-size: 12px;
  font-weight: 500;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #888;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.overlay-close:hover {
  background: #e53935;
  color: #fff;
}

/* 预览窗 body 区域 */
.overlay-body {
  height: 270px;
  flex-shrink: 0;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #333;
  border-top: none;
  border-radius: 0 0 8px 8px;
  overflow: hidden;
}

.screenshot-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.body-loading {
  color: #999;
  font-size: 13px;
}

/* 确认弹窗 */
.confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  z-index: 10;
}

.confirm-dialog {
  background: #fff;
  border-radius: 8px;
  padding: 18px 22px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.2);
  text-align: center;
  max-width: 250px;
}

.confirm-text {
  font-size: 14px;
  color: #333;
  margin-bottom: 14px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.confirm-btn {
  padding: 6px 20px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.confirm-cancel {
  background: #f5f5f5;
  color: #666;
}

.confirm-cancel:hover {
  background: #e8e8e8;
}

.confirm-ok {
  background: #e53935;
  color: #fff;
  border-color: #e53935;
}

.confirm-ok:hover {
  background: #c62828;
}

/* 响应式 */
@media (max-width: 768px) {
  .webview-overlay {
    width: 360px;
    right: 4px;
  }

  .overlay-body {
    height: 200px;
  }
}
</style>
