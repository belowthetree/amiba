<!-- ============================================================
变形虫 (Amiba) — HomePage
============================================================ -->
<template>
  <div class="home-page">
    <!-- 插槽: home.above-welcome -->
    <SlotRenderer name="home.above-welcome" :html="slotHtml('home.above-welcome')" />

    <div class="welcome-card">
      <h1 class="app-title">{{ $t('home.heading') }}</h1>
      <p class="app-subtitle">{{ $t('home.subtitle') }}</p>
    </div>

    <div class="section">
      <h2 class="section-title">{{ $t('home.sysFeatures') }}</h2>
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

    <!-- 插槽: home.below-features -->
    <SlotRenderer name="home.below-features" :html="slotHtml('home.below-features')" />

    <div class="section" v-if="recentServices.length > 0">
      <h2 class="section-title">{{ $t('home.recentUse') }}</h2>

      <!-- 插槽: home.above-recent -->
      <SlotRenderer name="home.above-recent" :html="slotHtml('home.above-recent')" />
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
        <p>{{ $t('home.noUserServices') }}</p>
        <button class="cta-btn" @click="$router.push('/')">
          💬 {{ $t('home.ctaGenerate') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getUserServices } from '../host/registry'
import SlotRenderer from '../components/SlotRenderer.vue'
import { themeState } from '../config/theme-store'

const { t } = useI18n()

const slotHtml = (name: string) => themeState.slots[name] || ''

const builtinItems = [
  { id: 'chat', name: t('home.chat.name'), icon: '💬', desc: t('home.chat.desc'), route: '/' },
  { id: 'services', name: t('home.services.name'), icon: '📦', desc: t('home.services.desc'), route: '/services' },
  { id: 'settings', name: t('home.settings.name'), icon: '⚙️', desc: t('home.settings.desc'), route: '/settings' },
  { id: 'memory', name: t('home.memory.name'), icon: '🧠', desc: t('home.memory.desc'), route: '/memory' },
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
