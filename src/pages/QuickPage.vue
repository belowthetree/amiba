<!-- ============================================================
  变形虫 (Amiba) — QuickPage（自定义快捷页面）
  ============================================================ -->
<template>
  <div class="quick-page">
    <!-- 自定义内容运行在 iframe 沙箱中，隔离全局 CSS/JS，避免污染宿主应用 -->
    <iframe
      v-if="content"
      class="custom-view-frame"
      :srcdoc="srcdoc"
      sandbox="allow-scripts allow-same-origin allow-forms"
      title="quick-view"
    ></iframe>
    <div v-else class="empty-state">
      <div class="empty-icon">✦</div>
      <p>{{ $t('quick.emptyHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { quickViewContent, loadCustomView } from '../config/custom-view-store'

const router = useRouter()
const content = ref('')

// 注入最小 __amiba__ 垫片：让嵌入内容里的“打开完整服务”等按钮能跳转宿主路由。
// 只提供 navigateTo，不包含 storage 等桥接模块，服务代码会继续走 localStorage 回退。
const BRIDGE_SHIM = `<script>
window.__amiba__ = window.__amiba__ || {};
window.__amiba__.navigateTo = function (path) {
  window.parent.postMessage({ type: 'amiba-quick-navigate', path: path }, '*');
};
<\/script>`

const srcdoc = computed(() => BRIDGE_SHIM + content.value)

// 接收 iframe 内导航请求
function onMessage(e: MessageEvent) {
  const data = e.data as { type?: string; path?: unknown }
  if (data?.type === 'amiba-quick-navigate' && typeof data.path === 'string' && data.path.startsWith('/')) {
    router.push(data.path)
  }
}

onMounted(async () => {
  window.addEventListener('message', onMessage)
  content.value = await loadCustomView('quick')
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
})

watch(quickViewContent, (val) => {
  content.value = val
})
</script>

<style scoped>
.quick-page {
  max-width: 800px;
  margin: 0 auto;
  padding: var(--spacing-md);
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

/* 页内标题：与记忆/设置页统一 */
.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
  margin-bottom: var(--spacing-md);
  color: var(--color-text);
}

.custom-view-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px var(--spacing-md);
  text-align: center;
}

.empty-icon {
  font-size: 34px;
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light);
  border-radius: var(--radius-lg);
  margin-bottom: var(--spacing-md);
  box-shadow: var(--shadow-sm);
  color: var(--color-primary);
}

.empty-state p {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  max-width: 360px;
  line-height: 1.7;
}
</style>
