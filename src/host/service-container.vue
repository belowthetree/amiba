<!-- ============================================================
变形虫 (Amiba) — Service Container (iframe 外壳)
============================================================ -->
<template>
  <div class="service-container">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>正在加载服务...</p>
    </div>
    <div v-else-if="error" class="error-state">
      <p>❌ {{ error }}</p>
      <button class="back-btn" @click="goBack">返回</button>
    </div>
    <iframe
      v-else
      ref="iframeRef"
      :srcdoc="serviceHtml"
      :sandbox="sandboxFlags"
      class="service-iframe"
      @load="onIframeLoad"
      allow="clipboard-write"
    ></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getService, getServicePackage, setServiceData, getServiceData, removeServiceData } from './registry'
import { createBridge } from './bridge'
import { inlinePackage } from '../ai/generator'
import type { ApiHandler } from './bridge'
import type { ServicePackage } from '../types/service'

const route = useRoute()
const router = useRouter()

const iframeRef = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const error = ref('')
const serviceHtml = ref('')
const servicePkg = ref<ServicePackage | null>(null)

let bridgeCleanup: (() => void) | null = null

const serviceId = computed(() => {
  const id = route.params.serviceId as string
  // The pathMatch captures the rest
  const pathMatch = route.params.pathMatch
  if (Array.isArray(pathMatch)) return pathMatch[0] || id
  return id
})

const sandboxFlags = 'allow-scripts allow-same-origin'

function goBack() {
  router.push('/my-services')
}

function onIframeLoad() {
  loading.value = false

  const iframe = iframeRef.value
  if (!iframe) return

  const service = getService(serviceId.value)
  const permissions = service?.manifest.permissions || []

  const apiHandler: ApiHandler = async (module, method, params) => {
    switch (module) {
      case 'storage': {
        const svcId = serviceId.value
        switch (method) {
          case 'setStorage':
            await setServiceData(svcId, params.key, params.data)
            return
          case 'getStorage':
            return await getServiceData(svcId, params.key)
          case 'removeStorage':
            await removeServiceData(svcId, params.key)
            return
          default:
            throw new Error(`Unknown storage method: ${method}`)
        }
      }
      case 'notification': {
        switch (method) {
          case 'showToast':
            // Simple toast implementation
            showToast(params.title, params.icon || 'none')
            return
          default:
            throw new Error(`Unknown notification method: ${method}`)
        }
      }
      case 'ui': {
        switch (method) {
          case 'navigateTo':
            // Navigate within the app
            if (params.url) {
              router.push(params.url)
            }
            return
          case 'navigateBack':
            router.back()
            return
          default:
            throw new Error(`Unknown ui method: ${method}`)
        }
      }
      default:
        throw new Error(`Unknown module: ${module}`)
    }
  }

  bridgeCleanup = createBridge(iframe, permissions, apiHandler).destroy
}

function showToast(title: string, icon: string) {
  // Create a toast element
  const toast = document.createElement('div')
  const iconMap: Record<string, string> = {
    success: '✅',
    error: '❌',
    loading: '⏳',
    none: '',
  }
  toast.className = 'amiba-toast'
  toast.innerHTML = `${iconMap[icon] || ''} ${title}`
  document.body.appendChild(toast)

  // Animate
  requestAnimationFrame(() => {
    toast.style.opacity = '1'
    toast.style.transform = 'translateY(0)'
  })

  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(20px)'
    setTimeout(() => toast.remove(), 300)
  }, 2000)
}

onMounted(async () => {
  console.log("[Container] loading service:", serviceId.value);
  const svc = getService(serviceId.value)
  if (!svc) {
    error.value = `服务 "${serviceId.value}" 未找到`
    loading.value = false
    return
  }

  if (!svc.enabled) {
    error.value = `服务 "${svc.manifest.name}" 已禁用`
    loading.value = false
    return
  }

  // Load service package
  const pkg = await getServicePackage(serviceId.value)
  if (!pkg) {
    error.value = `服务 "${svc.manifest.name}" 内容为空`
    loading.value = false
    return
  }

  servicePkg.value = pkg
  const html = inlinePackage(pkg)
  serviceHtml.value = html
  loading.value = false
})

onUnmounted(() => {
  if (bridgeCleanup) {
    bridgeCleanup()
    bridgeCleanup = null
  }
})
</script>

<style scoped>
.service-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.service-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #666;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e0e0e0;
  border-top-color: #1976D2;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.back-btn {
  padding: 8px 24px;
  border: 1px solid #1976D2;
  border-radius: 8px;
  background: white;
  color: #1976D2;
  cursor: pointer;
  font-size: 14px;
}
</style>

<style>
/* Global toast styles */
.amiba-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: #333;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 10000;
  opacity: 0;
  transition: all 0.3s ease;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
</style>
