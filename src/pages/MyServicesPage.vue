<!-- ============================================================
变形虫 (Amiba) — MyServicesPage (我的服务)
============================================================ -->
<template>
  <div class="my-services-page">
    <div class="header">
      <h2>📦 我的服务</h2>
      <button class="new-btn" @click="$router.push('/generate')">
        + 新建
      </button>
    </div>

    <!-- Built-in services -->
    <div class="section">
      <h3 class="section-title">系统服务</h3>
      <div class="service-list">
        <div
          class="service-item builtin"
          v-for="svc in builtinServices"
          :key="svc.manifest.id"
          @click="navigateTo(svc)"
        >
          <span class="svc-icon">{{ getIcon(svc.manifest.id) }}</span>
          <div class="svc-info">
            <span class="svc-name">{{ svc.manifest.name }}</span>
            <span class="svc-desc">{{ svc.manifest.description }}</span>
          </div>
          <span class="svc-badge system">内置</span>
        </div>
      </div>
    </div>

    <!-- User services -->
    <div class="section">
      <h3 class="section-title">
        用户服务
        <span class="count">{{ userServices.length }}</span>
      </h3>

      <div v-if="userServices.length === 0" class="empty">
        <p>还没有安装用户服务</p>
        <button class="cta-btn" @click="$router.push('/generate')">
          ✨ AI 生成一个
        </button>
      </div>

      <div class="service-list" v-else>
        <div
          class="service-item user"
          v-for="svc in userServices"
          :key="svc.manifest.id"
          :class="{ disabled: !svc.enabled }"
        >
          <span class="svc-icon">📱</span>
          <div class="svc-info" @click="openService(svc)">
            <span class="svc-name">{{ svc.manifest.name }}</span>
            <span class="svc-desc">{{ svc.manifest.description }}</span>
            <span class="svc-meta">
              {{ svc.manifest.id }} · v{{ svc.manifest.version }}
              · {{ formatDate(svc.installedAt) }}
            </span>
          </div>
          <div class="svc-actions">
            <label class="toggle">
              <input
                type="checkbox"
                :checked="svc.enabled"
                @change="handleToggle(svc.manifest.id, !svc.enabled)"
              />
              <span class="toggle-slider"></span>
            </label>
            <button class="action-icon" @click="deleteService(svc)" title="删除">
              🗑
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Demo service quick install -->
    <div class="section" v-if="!hasDemoService">
      <div class="demo-card">
        <div class="demo-info">
          <span class="demo-icon">🎁</span>
          <div>
            <strong>Hello World 示例</strong>
            <p>快速安装一个演示服务体验功能</p>
          </div>
        </div>
        <button class="install-btn" @click="installDemo">安装</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
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

const router = useRouter()

const builtinServices = computed(() => {
  // Show only navigable built-in services
  return BUILTIN_SERVICES.filter((s) =>
    ['system.home', 'system.chat', 'system.generate', 'system.settings', 'system.memory'].includes(
      s.manifest.id
    )
  )
})

const userServices = computed(() => getUserServices())
const hasDemoService = computed(() =>
  userServices.value.some((s) => s.manifest.id === 'user.hello_world')
)

function getIcon(id: string): string {
  const icons: Record<string, string> = {
    'system.home': '🏠',
    'system.chat': '💬',
    'system.generate': '✨',
    'system.settings': '⚙️',
    'system.memory': '🧠',
  }
  return icons[id] || '📄'
}

function navigateTo(svc: ServiceEntry) {
  const routes: Record<string, string> = {
    'system.home': '/home',
    'system.chat': '/',
    'system.generate': '/generate',
    'system.settings': '/settings',
    'system.my_services': '/my-services',
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
  if (confirm(`确定要删除 "${svc.manifest.name}" 吗？此操作不可撤销。`)) {
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
</script>

<style scoped>
.my-services-page {
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

.new-btn {
  padding: 8px 16px;
  background: #1976D2;
  color: white;
  border: none;
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

.service-item.disabled {
  opacity: 0.5;
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

.svc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Toggle switch */
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
