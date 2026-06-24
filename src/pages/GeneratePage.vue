<!-- ============================================================
变形虫 (Amiba) — GeneratePage (AI 生成服务)
============================================================ -->
<template>
  <div class="generate-page">
    <div class="header">
      <h2>✨ AI 生成即时应用</h2>
      <p class="subtitle">描述你想要的应用，AI 将为你生成完整的迷你小程序</p>
    </div>

    <div class="prompt-area">
      <textarea
        v-model="prompt"
        class="prompt-input"
        placeholder="例如: 帮我做一个番茄钟应用，25分钟倒计时，有开始暂停和重置按钮..."
        rows="4"
      ></textarea>
      <button
        class="generate-btn"
        :disabled="!prompt.trim() || generating"
        @click="startGeneration"
      >
        {{ generating ? '生成中...' : '🚀 开始生成' }}
      </button>
    </div>

    <!-- Progress -->
    <div v-if="generating" class="progress-card">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>
      <p class="progress-text">{{ progressMessage }}</p>
    </div>

    <!-- Error -->
    <div v-if="errorMsg" class="error-card">
      <p>❌ {{ errorMsg }}</p>
    </div>

    <!-- Validation errors -->
    <div v-if="validationErrors.length > 0" class="validation-card">
      <h3>⚠️ 校验警告</h3>
      <ul>
        <li v-for="(err, i) in validationErrors" :key="i">
          <strong>{{ err.node }}</strong>: {{ err.message }}
        </li>
      </ul>
    </div>

    <!-- Result -->
    <div v-if="generatedService" class="result-card">
      <div class="result-header">
        <span class="result-icon">✅</span>
        <div>
          <h3>{{ generatedService.manifest.name }}</h3>
          <p class="result-desc">{{ generatedService.manifest.description }}</p>
        </div>
      </div>

      <div class="result-meta">
        <span class="badge">{{ generatedService.manifest.id }}</span>
        <span class="badge">v{{ generatedService.manifest.version }}</span>
        <span
          class="badge permission"
          v-for="p in generatedService.manifest.permissions"
          :key="p"
        >{{ p }}</span>
      </div>

      <div class="result-actions">
        <button class="action-btn primary" @click="installAndRun">
          ▶ 安装并运行
        </button>
        <button class="action-btn" @click="installOnly">
          📦 仅安装
        </button>
        <button class="action-btn danger" @click="discardResult">
          🗑 丢弃
        </button>
      </div>

      <!-- Preview -->
      <details class="preview-details">
        <summary>预览生成内容</summary>
        <div class="preview-tabs">
          <button
            v-for="tab in ['ui', 'logic']"
            :key="tab"
            :class="['tab', { active: previewTab === tab }]"
            @click="previewTab = tab"
          >{{ tab }}</button>
        </div>
        <pre class="preview-code"><code>{{ previewContent }}</code></pre>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { generateService } from '../ai/generator'
import { registerService, storeServiceHtml } from '../host/registry'
import { useRouter } from 'vue-router'
import type { GeneratedService, ValidationError } from '../types/service'

const router = useRouter()

const prompt = ref('')
const generating = ref(false)
const progressMessage = ref('')
const progressPct = ref(0)
const errorMsg = ref('')
const validationErrors = ref<ValidationError[]>([])
const generatedService = ref<GeneratedService | null>(null)
const previewTab = ref<'ui' | 'logic'>('ui')

const previewContent = computed(() => {
  if (!generatedService.value) return ''
  if (previewTab.value === 'ui') {
    return JSON.stringify(generatedService.value.ui, null, 2)
  }
  return generatedService.value.logic || '(无逻辑代码)'
})

async function startGeneration() {
  if (!prompt.value.trim() || generating.value) return

  errorMsg.value = ''
  validationErrors.value = []
  generatedService.value = null
  generating.value = true
  progressPct.value = 10
  progressMessage.value = '正在准备...'

  try {
    const gen = generateService(prompt.value, (progress) => {
      progressMessage.value = progress.message
      switch (progress.stage) {
        case 'preparing':
          progressPct.value = 15
          break
        case 'generating':
          progressPct.value = 40
          break
        case 'validating':
          progressPct.value = 70
          break
        case 'packaging':
          progressPct.value = 85
          break
        case 'done':
          progressPct.value = 100
          break
        case 'error':
          progressPct.value = 0
          errorMsg.value = progress.message
          break
      }
    })

    for await (const result of gen) {
      if (Array.isArray(result)) {
        // Validation errors
        validationErrors.value = result
      } else {
        // Generated service
        generatedService.value = result
        progressPct.value = 100
        progressMessage.value = '生成完成！'
      }
    }
  } catch (e: any) {
    errorMsg.value = `生成失败: ${e.message}`
  } finally {
    generating.value = false
  }
}

function installAndRun() {
  if (!generatedService.value) return

  const svc = generatedService.value
  const html = (svc as any)._html

  registerService(svc.manifest, 'ai-generated')
  if (html) {
    storeServiceHtml(svc.manifest.id, html)
  }

  // Navigate to the service
  router.push(`/service/${svc.manifest.id}/`)
}

function installOnly() {
  if (!generatedService.value) return

  const svc = generatedService.value
  const html = (svc as any)._html

  registerService(svc.manifest, 'ai-generated')
  if (html) {
    storeServiceHtml(svc.manifest.id, html)
  }

  generatedService.value = null
  validationErrors.value = []
  prompt.value = ''
  progressPct.value = 0
  progressMessage.value = ''

  alert(`服务 "${svc.manifest.name}" 已安装！可在"我的服务"中查看。`)
}

function discardResult() {
  generatedService.value = null
  validationErrors.value = []
}
</script>

<style scoped>
.generate-page {
  padding: 16px;
  max-width: 600px;
  margin: 0 auto;
}

.header {
  text-align: center;
  margin-bottom: 20px;
}

.header h2 {
  font-size: 22px;
  color: #333;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 13px;
  color: #999;
}

.prompt-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.prompt-input {
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  padding: 14px;
  font-size: 14px;
  resize: vertical;
  font-family: inherit;
  outline: none;
}

.prompt-input:focus {
  border-color: #1976D2;
}

.generate-btn {
  padding: 12px;
  background: linear-gradient(135deg, #1976D2, #42A5F5);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  cursor: pointer;
  font-weight: 600;
}

.generate-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.progress-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.progress-bar {
  height: 6px;
  background: #e0e0e0;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1976D2, #42A5F5);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.progress-text {
  font-size: 13px;
  color: #666;
  text-align: center;
}

.error-card {
  background: #FFF3E0;
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  color: #E65100;
  font-size: 14px;
}

.validation-card {
  background: #FFF8E1;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  font-size: 13px;
}

.validation-card h3 {
  margin-bottom: 8px;
  color: #F57F17;
}

.validation-card ul {
  list-style: none;
  padding: 0;
}

.validation-card li {
  padding: 4px 0;
  color: #666;
}

.result-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.result-icon {
  font-size: 32px;
}

.result-header h3 {
  font-size: 18px;
  color: #333;
}

.result-desc {
  font-size: 13px;
  color: #999;
}

.result-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.badge {
  padding: 4px 10px;
  background: #E3F2FD;
  color: #1976D2;
  border-radius: 6px;
  font-size: 12px;
}

.badge.permission {
  background: #E8F5E9;
  color: #388E3C;
}

.result-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  padding: 10px 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  color: #333;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: #f5f5f5;
}

.action-btn.primary {
  background: #1976D2;
  color: white;
  border-color: #1976D2;
}

.action-btn.primary:hover {
  background: #1565C0;
}

.action-btn.danger {
  color: #e53935;
  border-color: #e53935;
}

.action-btn.danger:hover {
  background: #FFF3E0;
}

.preview-details {
  margin-top: 16px;
  border-top: 1px solid #eee;
  padding-top: 12px;
}

.preview-details summary {
  cursor: pointer;
  font-size: 13px;
  color: #1976D2;
  margin-bottom: 8px;
}

.preview-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.tab {
  padding: 4px 12px;
  border: 1px solid #e0e0e0;
  background: white;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.tab.active {
  background: #1976D2;
  color: white;
  border-color: #1976D2;
}

.preview-code {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.preview-code code {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
