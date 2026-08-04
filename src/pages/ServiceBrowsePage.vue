<!-- ============================================================
变形虫 (Amiba) — ServiceBrowsePage (服务浏览与管理)
============================================================ -->
<template>
  <div class="browse-page">
    <div class="header">
      <div class="header-btns">
        <button class="import-btn" @click="importFromFolder">📂 {{ $t('services.importFolder') }}</button>
        <button class="registry-btn" @click="$router.push('/registry')">🌐 {{ $t('services.registry') }}</button>
        <button class="share-btn" @click="showShareDialog = true">📡</button>
      </div>
    </div>

    <!-- 分享弹窗 -->
    <ShareDialog v-model="showShareDialog" />

    <!-- AI 对话设置弹窗 -->
    <ServiceAiSettingsDialog v-if="aiSettingsSvc" :service="aiSettingsSvc" @close="aiSettingsSvc = null" />

    <!-- 插槽: services.above-list -->
    <SlotRenderer name="services.above-list" :html="slotHtml('services.above-list')" />

    <!-- User services -->
    <div class="section">
      <div v-if="userServices.length === 0" class="empty">
        <p>{{ $t('services.noUserServices') }}</p>
        <button class="cta-btn" @click="$router.push('/')">
          💬 {{ $t('services.ctaGenerate') }}
        </button>
      </div>

      <div class="grid" v-else>
        <div
          class="svc-card"
          v-for="svc in userServices"
          :key="svc.manifest.id"
          :class="{ disabled: !svc.enabled }"
          @click="openService(svc)"
        >
          <div class="card-icon-wrap"><span class="card-icon">{{ svcIcon(svc) }}</span></div>
          <div class="card-name">{{ svc.manifest.name }}</div>
          <div class="card-desc">{{ svc.manifest.description || $t('services.noDescription') }}</div>
          <div class="card-meta">{{ svc.manifest.id }} · v{{ svc.manifest.version }}</div>
          <div class="card-actions" @click.stop>
            <label v-if="svc.manifest.permissions.includes('widgets') || svc.backgroundConfig" class="toggle" :title="$t('services.serviceToggle')">
              <input
                type="checkbox"
                :checked="isServiceActive(svc.manifest.id)"
                @change="handleServiceToggle(svc)"
              />
              <span class="toggle-slider"></span>
            </label>
            <button class="action-icon" @click="openAiSettings(svc)" :title="$t('services.ai.title')">🤖</button>
            <button class="action-icon" @click="deleteService(svc)" title="删除">🗑</button>
          </div>
        </div>
      </div>
    </div>


  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ShareDialog from './ShareDialog.vue'
import ServiceAiSettingsDialog from '../components/ServiceAiSettingsDialog.vue'
import {
  BUILTIN_SERVICES,
  getUserServices,
  toggleService,
  unregisterService,
  registerService,
  storeServicePackage,
  removeServiceStorage,
  getService,
  destroyServiceRuntime,
} from '../host/registry'
import type { ServiceEntry, ServicePackage } from '../types/service'
import { readDirRecursive } from '../config/storage'
import { widgetStates, setServiceWidgetsVisible, hasWidgetConfig } from '../host/floating-widget-manager'
import { isRunning, startService, stopService } from '../host/background-manager'
import { settings } from '../config/config'
import { pickFolder } from '../config/folder-picker'
import SlotRenderer from '../components/SlotRenderer.vue'
import { themeState } from '../config/theme-store'

const router = useRouter()
const { t } = useI18n()

const slotHtml = (name: string) => themeState.slots[name] || ''

const showShareDialog = ref(false)

/** 当前打开 AI 设置的服务（null = 关闭弹窗） */
const aiSettingsSvc = ref<ServiceEntry | null>(null)

function openAiSettings(svc: ServiceEntry) {
  aiSettingsSvc.value = svc
}

const userServices = computed(() => getUserServices())

const systemServices = computed(() =>
  BUILTIN_SERVICES.filter((s) =>
    ['system.chat', 'system.settings', 'system.memory'].includes(s.manifest.id)
  )
)

function sysIcon(id: string): string {
  const icons: Record<string, string> = {
    'system.chat': '💬',
    'system.settings': '⚙️', 'system.memory': '🧠',
  }
  return icons[id] || '📄'
}

function svcIcon(svc: ServiceEntry): string {
  const icons: Record<string, string> = { storage: '💾', notification: '🔔' }
  const perm = svc.manifest.permissions[0]
  return perm ? (icons[perm] || '📱') : '📱'
}

function navigateTo(svc: ServiceEntry) {
  const routes: Record<string, string> = {
    'system.chat': '/',
    'system.settings': '/settings',
    'system.memory': '/memory',
  }
  router.push(routes[svc.manifest.id] || '/')
}

function openService(svc: ServiceEntry) {
  if (!svc.enabled) return
  router.push(`/service/${svc.manifest.id}/`)
}

async function handleToggle(id: string, enabled: boolean) {
  await toggleService(id, enabled)
}

function hasServiceWidgetVisible(serviceId: string): boolean {
  const hasVisible = Object.values(widgetStates).some(
    (s) => s.config.serviceId === serviceId && s.visible
  )
  if (hasVisible) return true
  // 内存中无 widget 时（离开服务页面后），查 registry 持久化状态
  return getService(serviceId)?.widgetsVisible === true
}

function isServiceActive(serviceId: string): boolean {
  return hasServiceWidgetVisible(serviceId) || isRunning(serviceId)
}

async function handleServiceToggle(svc: ServiceEntry) {
  const active = isServiceActive(svc.manifest.id)
  if (active) {
    setServiceWidgetsVisible(svc.manifest.id, false)
    if (isRunning(svc.manifest.id)) {
      await stopService(svc.manifest.id)
    }
  } else {
    setServiceWidgetsVisible(svc.manifest.id, true)
    if (svc.backgroundConfig) {
      try {
        await startService(svc.manifest.id)
      } catch (e: any) {
        alert(e?.message || String(e))
        // 回滚 widget 可见性
        setServiceWidgetsVisible(svc.manifest.id, false)
      }
    }
  }
}

async function deleteService(svc: ServiceEntry) {
  if (confirm(t('services.confirmDelete', { name: svc.manifest.name }))) {
    // 1. 释放所有运行时资源（后台、悬浮块、文件授权、前台 handler）
    await destroyServiceRuntime(svc.manifest.id)
    // 2. 如果正在浏览该服务页面，导航回服务列表
    const currentPath = router.currentRoute.value.path
    if (currentPath === `/service/${svc.manifest.id}/` || currentPath.startsWith(`/service/${svc.manifest.id}`)) {
      router.push('/service')
    }
    // 3. 注销注册表 + 删除文件
    unregisterService(svc.manifest.id)
    removeServiceStorage(svc.manifest.id)
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN')
  } catch {
    return iso
  }
}

async function importFromFolder() {
  try {
    const dir = await pickFolder(t('services.dialogTitle'))
    if (!dir) return

    const { readTextFile } = await import('../config/native-fs')

    // Read manifest.json
    const manifestRaw = await readTextFile(dir + '/manifest.json').catch(() => null)
    if (!manifestRaw) {
      alert(t('services.noManifestJson'))
      return
    }

    const manifest = JSON.parse(manifestRaw)
    if (!manifest.id || !manifest.name) {
      alert(t('services.invalidManifest'))
      return
    }

    // 递归读取所有文件（含子目录，如 widgets/）
    const files = await readDirRecursive(dir)

    if (!files.some(f => f.path === 'index.html')) {
      alert(t('services.missingIndexHtml'))
      return
    }

    const pkg: ServicePackage = { manifest, files }
    await registerService(manifest, 'downloaded')
    await storeServicePackage(manifest.id, pkg)
    alert(t('services.imported', { name: manifest.name }))
  } catch (e: any) {
    console.error('[Import] 导入失败:', e)
    alert(t('services.importFailed') + ': ' + (e.message || e))
  }
}
</script>

<style scoped>
.browse-page {
  padding: var(--spacing-md);
  max-width: 640px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-lg);
}

.header h2 {
  font-size: var(--font-size-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--color-text);
}

.header-btns {
  display: flex;
  gap: var(--spacing-sm);
}

.import-btn {
  padding: 8px 16px;
  background: var(--color-surface);
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.import-btn:hover {
  background: var(--color-primary-light);
  transform: translateY(-1px);
}

.import-btn:active {
  transform: scale(0.97);
}

.registry-btn {
  padding: 8px 16px;
  background: var(--color-surface);
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}
.registry-btn:hover {
  background: var(--color-primary-light);
  transform: translateY(-1px);
}
.registry-btn:active {
  transform: scale(0.97);
}

.share-btn {
  padding: 8px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 16px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.share-btn:hover {
  background: var(--color-hover-bg);
  transform: translateY(-1px);
}

.share-btn:active {
  transform: scale(0.97);
}

.section {
  margin-bottom: var(--spacing-lg);
}

.section-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 10px;
  letter-spacing: 0.4px;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.count {
  background: var(--color-primary-light);
  color: var(--color-primary);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.service-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.service-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.service-item:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.svc-icon {
  font-size: 22px;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.svc-info {
  flex: 1;
  min-width: 0;
}

.svc-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.svc-desc {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.svc-meta {
  display: block;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-top: 2px;
}

.svc-badge {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 500;
  flex-shrink: 0;
}

.svc-badge.system {
  background: var(--color-primary-light);
  color: var(--color-primary);
}

/* User services grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.svc-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: 18px 14px;
  text-align: center;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.svc-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.svc-card:active {
  transform: scale(0.97);
}

.svc-card.disabled {
  opacity: 0.55;
}

.svc-card .card-icon-wrap {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
  margin-bottom: 4px;
}

.svc-card .card-icon {
  font-size: 28px;
  line-height: 1;
}

.svc-card .card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.svc-card .card-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.svc-card .card-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.svc-card .card-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: 4px;
}

.toggle {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-disabled);
  border-radius: 22px;
  transition: 0.25s ease;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: var(--color-surface);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.15);
  transition: 0.25s ease;
}

.toggle input:checked + .toggle-slider {
  background: var(--color-primary);
}

.toggle input:checked + .toggle-slider::before {
  transform: translateX(18px);
}

.action-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: background 0.2s ease;
}

.action-icon:hover {
  background: var(--color-error-light);
}

.empty {
  text-align: center;
  padding: 40px 24px;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  color: var(--color-text-secondary);
  font-size: 14px;
}

.cta-btn {
  margin-top: 14px;
  padding: 10px 24px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.cta-btn:hover {
  background: var(--color-primary-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.cta-btn:active {
  transform: scale(0.97);
}
</style>
