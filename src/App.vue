<!-- ============================================================
变形虫 (Amiba) — App.vue (根组件: TopBar + router-view)
============================================================ -->
<template>
  <div class="app-shell">
    <!-- TopBar -->
    <header class="topbar">
      <button
        v-if="showBack"
        class="nav-btn back-btn"
        @click="goBack"
      >
        ←
      </button>
      <span v-else class="nav-btn placeholder"></span>

      <h1 class="topbar-title" @click="$router.push('/')">
        {{ currentTitle }}
      </h1>

      <button class="nav-btn menu-btn" @click="showMenu = !showMenu">
        ☰
      </button>
    </header>

    <!-- Main content -->
    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- Quick nav overlay -->
    <transition name="fade">
      <div v-if="showMenu" class="menu-overlay" @click.self="showMenu = false">
        <div class="menu-panel">
          <div class="menu-header">
            <span>导航</span>
            <button class="close-btn" @click="showMenu = false">✕</button>
          </div>
          <nav class="menu-nav">
            <button
              v-for="item in navItems"
              :key="item.route"
              class="menu-item"
              @click="navigate(item.route)"
            >
              <span class="menu-icon">{{ item.icon }}</span>
              <span>{{ item.name }}</span>
            </button>
          </nav>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const showMenu = ref(false)

const navItems = [
  { name: '首页', icon: '🏠', route: '/' },
  { name: 'AI 对话', icon: '💬', route: '/chat' },
  { name: 'AI 生成', icon: '✨', route: '/generate' },
  { name: '我的服务', icon: '📦', route: '/my-services' },
  { name: '设置', icon: '⚙️', route: '/settings' },
  { name: '记忆管理', icon: '🧠', route: '/memory' },
]

const routeTitles: Record<string, string> = {
  home: '变形虫',
  chat: 'AI 对话',
  generate: 'AI 生成',
  settings: '设置',
  'my-services': '我的服务',
  memory: '记忆管理',
  service: '服务',
}

const currentTitle = computed(() => {
  const name = route.name as string
  return routeTitles[name] || '变形虫'
})

const showBack = computed(() => {
  return route.name !== 'home'
})

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

function navigate(path: string) {
  showMenu.value = false
  router.push(path)
}
</script>

<style>
/* === Global Reset & Variables === */
:root {
  --color-primary: #1976D2;
  --color-bg: #f5f5f5;
  --color-surface: #ffffff;
  --color-text: #333333;
  --color-text-secondary: #999999;
  --topbar-height: 56px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  height: 100%;
}

a {
  color: var(--color-primary);
  text-decoration: none;
}

button {
  font-family: inherit;
}
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 100vw;
  overflow: hidden;
}

/* TopBar */
.topbar {
  display: flex;
  align-items: center;
  height: var(--topbar-height);
  padding: 0 12px;
  background: var(--color-surface);
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
  z-index: 100;
}

.nav-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: none;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #333;
}

.nav-btn:active {
  background: #f0f0f0;
}

.nav-btn.placeholder {
  visibility: hidden;
}

.topbar-title {
  flex: 1;
  font-size: 17px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Main content */
.main-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

/* Page transitions */
.page-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.page-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.page-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* Menu overlay */
.menu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 200;
  display: flex;
  justify-content: flex-end;
}

.menu-panel {
  width: 260px;
  height: 100%;
  background: white;
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.25s ease;
}

@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #eee;
  font-size: 16px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
}

.menu-nav {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: none;
  background: none;
  font-size: 15px;
  cursor: pointer;
  border-radius: 10px;
  text-align: left;
  color: #333;
}

.menu-item:active {
  background: #f5f5f5;
}

.menu-icon {
  font-size: 20px;
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
