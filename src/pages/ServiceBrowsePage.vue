<!-- ============================================================
变形虫 (Amiba) — ServiceBrowsePage (服务浏览)
============================================================ -->
<template>
  <div class="browse-page">
    <div class="section" v-if="userServices.length > 0">
      <h2 class="section-title">我的服务</h2>
      <div class="grid">
        <div
          class="svc-card"
          v-for="svc in userServices"
          :key="svc.manifest.id"
          :class="{ disabled: !svc.enabled }"
          @click="openService(svc)"
        >
          <div class="card-icon">{{ svcIcon(svc) }}</div>
          <div class="card-name">{{ svc.manifest.name }}</div>
          <div class="card-desc">{{ svc.manifest.description || '暂无描述' }}</div>
          <div class="card-meta">{{ svc.manifest.id }}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">系统服务</h2>
      <div class="grid">
        <div
          class="svc-card sys"
          v-for="svc in systemServices"
          :key="svc.manifest.id"
          @click="navigateTo(svc)"
        >
          <div class="card-icon">{{ sysIcon(svc.manifest.id) }}</div>
          <div class="card-name">{{ svc.manifest.name }}</div>
          <div class="card-desc">{{ svc.manifest.description }}</div>
        </div>
      </div>
    </div>

    <div class="section" v-if="userServices.length === 0">
      <div class="empty-hint">
        <p>还没有安装用户服务</p>
        <button class="cta-btn" @click="$router.push('/generate')">✨ AI 生成一个</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { getAllServices, getUserServices, BUILTIN_SERVICES } from '../host/registry'
import type { ServiceEntry } from '../types/service'

const router = useRouter()

const userServices = computed(() => getUserServices().filter(s => s.enabled))
const systemServices = computed(() =>
  BUILTIN_SERVICES.filter(s =>
    ['system.chat', 'system.generate', 'system.my_services', 'system.memory'].includes(s.manifest.id)
  )
)

function svcIcon(svc: ServiceEntry): string {
  const icons: Record<string, string> = { storage: '💾', notification: '🔔' }
  const perm = svc.manifest.permissions[0]
  return perm ? (icons[perm] || '📱') : '📱'
}

function sysIcon(id: string): string {
  const icons: Record<string, string> = {
    'system.chat': '💬', 'system.generate': '✨',
    'system.my_services': '📦', 'system.memory': '🧠',
    'system.home': '🏠', 'system.settings': '⚙️',
  }
  return icons[id] || '📄'
}

function openService(svc: ServiceEntry) {
  if (!svc.enabled) return
  router.push('/service/' + svc.manifest.id + '/')
}

function navigateTo(svc: ServiceEntry) {
  const routes: Record<string, string> = {
    'system.chat': '/', 'system.generate': '/generate',
    'system.my_services': '/my-services', 'system.memory': '/memory',
  }
  router.push(routes[svc.manifest.id] || '/')
}
</script>

<style scoped>
.browse-page { padding: 16px; max-width: 640px; margin: 0 auto; }
.section { margin-bottom: 24px; }
.section-title { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.svc-card {
  background: white; border-radius: 12px; padding: 20px 14px; text-align: center;
  cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.2s;
}
.svc-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
.svc-card:active { transform: scale(0.97); }
.svc-card.disabled { opacity: 0.4; }
.svc-card.sys { border: 1px dashed #e0e0e0; }
.card-icon { font-size: 36px; margin-bottom: 8px; }
.card-name { font-size: 14px; font-weight: 600; color: #333; margin-bottom: 4px; }
.card-desc { font-size: 12px; color: #999; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-meta { font-size: 10px; color: #ccc; margin-top: 6px; }
.empty-hint { text-align: center; padding: 32px; color: #999; }
.cta-btn { margin-top: 12px; padding: 10px 24px; background: #1976D2; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
</style>
