<!-- ============================================================
变形虫 (Amiba) — SettingsPage
============================================================ -->
<template>
  <div class="settings-page">
    <h2 class="page-title">⚙️ 设置</h2>

    <div class="settings-section">
      <h3 class="section-label">API 配置</h3>

      <div class="form-group">
        <label>API Key</label>
        <input
          :type="showKey ? 'text' : 'password'"
          v-model="apiKey"
          class="form-input"
          placeholder="sk-..."
        />
        <button class="toggle-key" @click="showKey = !showKey">
          {{ showKey ? '🙈' : '👁' }}
        </button>
      </div>

      <div class="form-group">
        <label>Base URL</label>
        <input
          v-model="settings.ai_base_url"
          class="form-input"
          placeholder="https://api.deepseek.com/v1"
        />
      </div>

      <div class="form-group">
        <label>对话模型</label>
        <input
          v-model="settings.ai_model"
          class="form-input"
          placeholder="deepseek-chat"
        />
      </div>

      <div class="form-group">
        <label>生成模型</label>
        <input
          v-model="settings.ai_generation_model"
          class="form-input"
          placeholder="deepseek-chat"
        />
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-label">外观</h3>

      <div class="form-group">
        <label>主题模式</label>
        <select v-model="settings.theme_mode" class="form-input">
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </div>

      <div class="form-group">
        <label>语言</label>
        <select v-model="settings.language" class="form-input">
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-label">数据管理</h3>
      <div class="action-row">
        <button class="danger-btn" @click="clearAllData">
          🗑 清除所有数据
        </button>
        <button class="secondary-btn" @click="exportData">
          📥 导出配置
        </button>
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-label">关于</h3>
      <div class="about-info">
        <p><strong>变形虫 Amiba</strong> v1.0.0</p>
        <p>AI 驱动的跨平台即时应用平台</p>
        <p>Vue 3 + TypeScript + Capacitor</p>
      </div>
    </div>

    <div class="saved-hint" v-if="showSaved">✅ 已保存</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { settings, getApiKey, setApiKey } from '../config/config'

const apiKey = ref('')
const showKey = ref(false)
const showSaved = ref(false)

let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(apiKey, (val) => {
  void setApiKey(val).then(() => flashSaved())
})

watch(
  () => ({ ...settings }),
  () => {
    flashSaved()
  },
  { deep: true }
)

function flashSaved() {
  showSaved.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    showSaved.value = false
  }, 1500)
}

function clearAllData() {
  if (confirm('确定要清除所有数据吗？这将删除配置、记忆和已安装的服务。此操作不可撤销！')) {
    localStorage.clear()
    location.reload()
  }
}

function exportData() {
  const data: Record<string, any> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      data[key] = localStorage.getItem(key)
    }
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `amiba-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  flashSaved()
}
</script>

<style scoped>
.settings-page {
  padding: 16px;
  max-width: 500px;
  margin: 0 auto;
}

.page-title {
  font-size: 22px;
  margin-bottom: 20px;
  color: #333;
}

.settings-section {
  background: white;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.section-label {
  font-size: 14px;
  font-weight: 600;
  color: #666;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-group {
  margin-bottom: 12px;
  position: relative;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  font-size: 13px;
  color: #999;
  margin-bottom: 4px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: #1976D2;
}

.toggle-key {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
}

.action-row {
  display: flex;
  gap: 8px;
}

.danger-btn {
  padding: 8px 16px;
  border: 1px solid #e53935;
  color: #e53935;
  background: white;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.danger-btn:hover {
  background: #FFF3E0;
}

.secondary-btn {
  padding: 8px 16px;
  border: 1px solid #1976D2;
  color: #1976D2;
  background: white;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.about-info {
  font-size: 13px;
  color: #999;
  line-height: 1.8;
}

.saved-hint {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 999;
  animation: fadeInOut 1.5s ease;
}

@keyframes fadeInOut {
  0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
  20% { opacity: 1; transform: translateX(-50%) translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
</style>
