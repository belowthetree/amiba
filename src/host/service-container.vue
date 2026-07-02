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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getService, getServicePackage, setServiceData, getServiceData, removeServiceData } from './registry'
import { createBridge, BRIDGE_SCRIPT } from './bridge'
import { inlinePackage } from '../ai/generator'
import {
  registerWidget,
  unregisterWidget,
  unregisterServiceWidgets,
  setWidgetVisible,
} from './floating-widget-manager'
import {
  setVisibility,
  getVisibility,
  startDiscovery,
  stopDiscovery,
  getVisibleDevices,
  connect,
  disconnect,
  send,
  clearServiceCallbacks,
} from './network-bridge'
import type { ApiHandler } from './bridge'
import type { ServicePackage, FloatingWidgetManifest } from '../types/service'

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
  router.push('/services')
}

function onIframeLoad() {
  loading.value = false
}

/** 从已加载的 ServicePackage 中读取 widget HTML 文件内容 */
function getWidgetHtmlFromPackage(page: string): string | null {
  if (!servicePkg.value) return null
  const file = servicePkg.value.files.find((f) => f.path === page)
  return file ? file.content : null
}

/** 从 ServicePackage 加载 widget.json 并注册所有 widget */
function loadWidgetsFromPackage(pkg: ServicePackage, permissions: string[]) {
  const widgetJsonFile = pkg.files.find((f) => f.path === 'widget.json')
  if (!widgetJsonFile) {
    console.log('[ServiceContainer] 无 widget.json，跳过 widget 加载')
    return
  }

  let manifest: FloatingWidgetManifest
  try {
    manifest = JSON.parse(widgetJsonFile.content)
  } catch {
    console.warn('[ServiceContainer] widget.json 解析失败')
    return
  }

  if (!manifest.widgets || !Array.isArray(manifest.widgets)) return

  for (const config of manifest.widgets) {
    // 查找 widget HTML 文件
    const widgetFile = pkg.files.find((f) => f.path === config.page)
    if (!widgetFile) {
      console.warn(`[ServiceContainer] Widget "${config.id}" 页面文件不存在: ${config.page}`)
      continue
    }

    // 注入 bridge 脚本
    const processed = widgetFile.content.replace(
      '<!-- AMIBA_BRIDGE -->',
      '<script>' + BRIDGE_SCRIPT + '<\/script>'
    )

    registerWidget(
      { ...config, serviceId: serviceId.value },
      processed
    )
    console.log(`[ServiceContainer] Widget 已注册: ${config.id}`)
  }
}

function makeApiHandler(): ApiHandler {
  return async (module, method, params) => {
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
            showToast(params.title, params.icon || 'none')
            return
          default:
            throw new Error(`Unknown notification method: ${method}`)
        }
      }
      case 'ui': {
        switch (method) {
          case 'navigateTo':
            if (params.url) router.push(params.url)
            return
          case 'navigateBack':
            router.back()
            return
          default:
            throw new Error(`Unknown ui method: ${method}`)
        }
      }
      case 'widgets': {
        switch (method) {
          case 'registerWidget': {
            const config = params.config
            if (!config || !config.id || !config.page) {
              throw new Error('Invalid widget config: id and page required')
            }
            // 从服务文件读取 widget HTML
            const widgetHtml = getWidgetHtmlFromPackage(config.page)
            if (!widgetHtml) {
              throw new Error(`Widget page not found: ${config.page}`)
            }
            // 注入 bridge 脚本
            const processed = widgetHtml.replace(
              '<!-- AMIBA_BRIDGE -->',
              '<script>' + BRIDGE_SCRIPT + '<\/script>'
            )
            registerWidget(
              { ...config, serviceId: serviceId.value },
              processed
            )
            return
          }
          case 'removeWidget':
            unregisterWidget(params.id)
            return
          case 'showWidget':
            setWidgetVisible(params.id, true)
            return
          case 'hideWidget':
            setWidgetVisible(params.id, false)
            return
          default:
            throw new Error(`Unknown widgets method: ${method}`)
        }
      }
      case 'network': {
        switch (method) {
          case 'setVisibility':
            await setVisibility(params.visibility || { lan: true, ble: false })
            return
          case 'getVisibility':
            return await getVisibility()
          case 'startDiscovery':
            await startDiscovery(params.transport || 'all')
            return
          case 'stopDiscovery':
            await stopDiscovery(params.transport || 'all')
            return
          case 'getVisibleDevices':
            return getVisibleDevices()
          case 'connect':
            await connect(params.peerId)
            return
          case 'disconnect':
            await disconnect(params.peerId)
            return
          case 'send':
            await send(params.peerId, params.message)
            return
          default:
            throw new Error(`Unknown network method: ${method}`)
        }
      }
      default:
        throw new Error(`Unknown module: ${module}`)
    }
  }
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
  let html = inlinePackage(pkg)

  // Inject the real bridge script BEFORE service scripts, replacing placeholder
  html = html.replace('<!-- AMIBA_BRIDGE -->', '<script>' + BRIDGE_SCRIPT + '<\/script>')

  serviceHtml.value = html
  loading.value = false

  // ---- 加载 widget.json（声明式 widget 配置） ----
  loadWidgetsFromPackage(pkg, svc.manifest.permissions || [])

  // Wait for iframe to render, then set up host-side listener BEFORE browser parses srcdoc
  await nextTick()
  const iframe = iframeRef.value
  if (iframe) {
    const permissions = svc.manifest.permissions || []
    const apiHandler = makeApiHandler()
    bridgeCleanup = createBridge(iframe, permissions, apiHandler).destroy
  }
})

onUnmounted(() => {
  if (bridgeCleanup) {
    bridgeCleanup()
    bridgeCleanup = null
  }
  // 注销该服务的所有 widget
  unregisterServiceWidgets(serviceId.value)
  // 清理该服务的网络回调
  clearServiceCallbacks(serviceId.value)
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
