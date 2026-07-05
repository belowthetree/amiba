<!-- ============================================================
变形虫 (Amiba) — ServiceBrowsePage (服务浏览与管理)
============================================================ -->
<template>
  <div class="browse-page">
    <div class="header">
      <h2>📦 {{ $t('services.title') }}</h2>
      <div class="header-btns">
        <button class="import-btn" @click="importFromFolder">📂 {{ $t('services.importFolder') }}</button>
        <button class="new-btn" @click="$router.push('/')">💬 {{ $t('services.createNew') }}</button>
      </div>
    </div>

    <!-- User services -->
    <div class="section">
      <h3 class="section-title">
        {{ $t('services.userServices') }}
        <span class="count">{{ userServices.length }}</span>
      </h3>

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
          <div class="card-icon">{{ svcIcon(svc) }}</div>
          <div class="card-name">{{ svc.manifest.name }}</div>
          <div class="card-desc">{{ svc.manifest.description || $t('services.noDescription') }}</div>
          <div class="card-meta">{{ svc.manifest.id }} · v{{ svc.manifest.version }}</div>
          <div class="card-actions" @click.stop>
            <label class="toggle">
              <input
                type="checkbox"
                :checked="svc.enabled"
                @change="handleToggle(svc.manifest.id, !svc.enabled)"
              />
              <span class="toggle-slider"></span>
            </label>
            <button class="action-icon" @click="deleteService(svc)" title="删除">🗑</button>
          </div>
        </div>
      </div>
    </div>

    <!-- System services -->
    <div class="section">
      <h3 class="section-title">{{ $t('services.systemServices') }}</h3>
      <div class="service-list">
        <div
          class="service-item builtin"
          v-for="svc in systemServices"
          :key="svc.manifest.id"
          @click="navigateTo(svc)"
        >
          <span class="svc-icon">{{ sysIcon(svc.manifest.id) }}</span>
          <div class="svc-info">
            <span class="svc-name">{{ svc.manifest.name }}</span>
            <span class="svc-desc">{{ svc.manifest.description }}</span>
          </div>
          <span class="svc-badge system">{{ $t('services.builtin') }}</span>
        </div>
      </div>
    </div>

    <!-- Demo service quick install -->
    <div class="section" v-if="!hasDemoService">
      <div class="demo-card">
        <div class="demo-info">
          <span class="demo-icon">🎁</span>
          <div>
            <strong>{{ $t('services.demoTitle') }}</strong>
            <p>{{ $t('services.demoDesc') }}</p>
          </div>
        </div>
        <button class="install-btn" @click="installDemo">{{ $t('services.install') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  BUILTIN_SERVICES,
  getUserServices,
  toggleService,
  unregisterService,
  registerService,
  storeServicePackage,
  removeServiceStorage,
} from '../host/registry'
import type { ServiceEntry, ServicePackage } from '../types/service'
import { DEMO_PACKAGE } from './demo-package'
import { readDirRecursive } from '../config/storage'

const router = useRouter()
const { t } = useI18n()

const userServices = computed(() => getUserServices())

const systemServices = computed(() =>
  BUILTIN_SERVICES.filter((s) =>
    ['system.chat', 'system.settings', 'system.memory'].includes(s.manifest.id)
  )
)

const hasDemoService = computed(() =>
  userServices.value.some((s) => s.manifest.id === 'user.hello_world')
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

function deleteService(svc: ServiceEntry) {
  if (confirm(t('services.confirmDelete', { name: svc.manifest.name }))) {
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

async function installDemo() {
  const manifest = {
    id: 'user.hello_world',
    name: 'Hello World',
    version: '1.0.0',
    description: '基础示例',
    permissions: ['notification'] as ('storage' | 'notification')[],
  }
  await registerService(manifest, 'ai-generated')
  await storeServicePackage(manifest.id, DEMO_PACKAGE)
}

async function importFromFolder() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, multiple: false, title: t('services.dialogTitle') })
    if (!dir || typeof dir !== 'string') return

    const { readTextFile } = await import('@tauri-apps/plugin-fs')

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
  padding: 16px;
  max-width: 600px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header h2 {
  font-size: 22px;
  color: #333;
}

.header-btns {
  display: flex;
  gap: 8px;
}

.new-btn {
  padding: 8px 16px;
  background: #1976D2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.import-btn {
  padding: 8px 16px;
  background: white;
  color: #1976D2;
  border: 1px solid #1976D2;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.section {
  margin-bottom: 20px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #999;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.count {
  background: #E3F2FD;
  color: #1976D2;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}

.service-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.service-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: white;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  transition: background 0.2s;
}

.service-item:hover {
  background: #fafafa;
}

.svc-icon {
  font-size: 24px;
}

.svc-info {
  flex: 1;
  min-width: 0;
}

.svc-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.svc-desc {
  display: block;
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.svc-meta {
  display: block;
  font-size: 11px;
  color: #ccc;
  margin-top: 2px;
}

.svc-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}

.svc-badge.system {
  background: #E3F2FD;
  color: #1976D2;
}

/* User services grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.svc-card {
  background: white;
  border-radius: 12px;
  padding: 16px 12px;
  text-align: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.svc-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.svc-card:active {
  transform: scale(0.97);
}

.svc-card.disabled {
  opacity: 0.5;
}

.svc-card .card-icon {
  font-size: 36px;
  margin-bottom: 2px;
}

.svc-card .card-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.svc-card .card-desc {
  font-size: 12px;
  color: #999;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.svc-card .card-meta {
  font-size: 10px;
  color: #ccc;
}

.svc-card .card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
  background: #ccc;
  border-radius: 22px;
  transition: 0.3s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: white;
  border-radius: 50%;
  transition: 0.3s;
}

.toggle input:checked + .toggle-slider {
  background: #1976D2;
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
}

.empty {
  text-align: center;
  padding: 32px;
  background: white;
  border-radius: 12px;
  color: #999;
}

.cta-btn {
  margin-top: 12px;
  padding: 10px 24px;
  background: #1976D2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.demo-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  border: 1px dashed #1976D2;
}

.demo-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.demo-icon {
  font-size: 28px;
}

.demo-info strong {
  font-size: 14px;
  color: #333;
}

.demo-info p {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.install-btn {
  padding: 8px 16px;
  background: #1976D2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
</style>
