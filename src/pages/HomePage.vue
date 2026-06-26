<!-- ============================================================
变形虫 (Amiba) — HomePage
============================================================ -->
<template>
  <div class="home-page">
    <div class="welcome-card">
      <h1 class="app-title">变形虫 Amiba</h1>
      <p class="app-subtitle">AI 驱动的即时应用平台</p>
    </div>

    <div class="section">
      <h2 class="section-title">系统功能</h2>
      <div class="grid">
        <div
          class="feature-card"
          v-for="item in builtinItems"
          :key="item.id"
          @click="$router.push(item.route)"
        >
          <div class="feature-icon">{{ item.icon }}</div>
          <div class="feature-name">{{ item.name }}</div>
          <div class="feature-desc">{{ item.desc }}</div>
        </div>
      </div>
    </div>

    <div class="section" v-if="recentServices.length > 0">
      <h2 class="section-title">最近使用</h2>
      <div class="recent-list">
        <div
          class="recent-item"
          v-for="svc in recentServices"
          :key="svc.manifest.id"
          @click="openService(svc.manifest.id)"
        >
          <span class="recent-icon">📦</span>
          <span class="recent-name">{{ svc.manifest.name }}</span>
          <span class="recent-arrow">→</span>
        </div>
      </div>
    </div>

    <div class="section" v-else>
      <div class="empty-hint">
        <p>还没有用户服务</p>
        <button class="cta-btn" @click="$router.push('/generate')">
          🚀 让 AI 生成一个
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getUserServices } from '../host/registry'

const builtinItems = [
  { id: 'chat', name: 'AI 对话', icon: '💬', desc: '与 AI 助手对话', route: '/' },
  { id: 'generate', name: 'AI 生成', icon: '✨', desc: '生成即时小程序', route: '/generate' },
  { id: 'services', name: '服务管理', icon: '📦', desc: '管理已安装服务', route: '/services' },
  { id: 'settings', name: '设置', icon: '⚙️', desc: 'API Key 与配置', route: '/settings' },
  { id: 'memory', name: '记忆管理', icon: '🧠', desc: 'AI 记忆与画像', route: '/memory' },
]

const recentServices = computed(() => {
  return getUserServices().filter((s) => s.enabled).slice(0, 5)
})

function openService(id: string) {
  if (id.startsWith('system.')) return
  window.location.href = `/service/${id}/`
}
</script>

<style scoped>
.home-page {
  padding: 16px;
  max-width: 600px;
  margin: 0 auto;
}

.welcome-card {
  text-align: center;
  padding: 32px 16px;
  margin-bottom: 24px;
  background: linear-gradient(135deg, #1976D2, #42A5F5);
  border-radius: 16px;
  color: white;
}

.app-title {
  font-size: 28px;
  font-weight: bold;
  margin-bottom: 8px;
}

.app-subtitle {
  font-size: 14px;
  opacity: 0.9;
}

.section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #333;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.feature-card {
  background: white;
  border-radius: 12px;
  padding: 20px 12px;
  text-align: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.2s;
}

.feature-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.feature-card:active {
  transform: scale(0.97);
}

.feature-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.feature-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.feature-desc {
  font-size: 12px;
  color: #999;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: white;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.recent-item:active {
  background: #f5f5f5;
}

.recent-icon {
  font-size: 20px;
}

.recent-name {
  flex: 1;
  font-size: 14px;
  color: #333;
}

.recent-arrow {
  color: #ccc;
}

.empty-hint {
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

.cta-btn:hover {
  background: #1565C0;
}
</style>
