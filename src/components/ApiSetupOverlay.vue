<!-- ============================================================
变形虫 (Amiba) — ApiSetupOverlay (API 设置引导)
启动时无可用 API 时占满全屏，验证通过前不可关闭
============================================================ -->
<template>
  <div class="api-setup-overlay">
    <div class="setup-card">
      <h2 class="setup-title">🔑 {{ $t('apiSetup.title') }}</h2>
      <p class="setup-desc">
        {{ reason === 'missing' ? $t('apiSetup.descMissing') : $t('apiSetup.descUnavailable') }}
      </p>

      <div class="form-group">
        <label>{{ $t('settings.general.defaultProvider') }}</label>
        <select v-model="defaultProviderId" class="form-input" @change="onDefaultProviderChange">
          <option value="">{{ $t('settings.general.noProviderSelected') }}</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <div class="form-group" v-if="!defaultProviderId">
        <label>{{ $t('settings.general.baseUrl') }}</label>
        <input
          v-model="settings.ai_base_url"
          class="form-input"
          placeholder="https://api.deepseek.com/v1"
        />
      </div>

      <div class="form-group">
        <label>{{ $t('settings.general.apiKey') }}</label>
        <input
          :type="showKey ? 'text' : 'password'"
          v-model="settings.api_key"
          class="form-input"
          placeholder="sk-..."
        />
        <button class="toggle-key" @click="showKey = !showKey">
          {{ showKey ? '🙈' : '👁' }}
        </button>
      </div>

      <div class="form-group">
        <label>{{ $t('settings.general.model') }}</label>
        <select v-model="settings.ai_model" class="form-input" v-if="defaultProviderModels.length">
          <option v-for="m in defaultProviderModels" :key="m" :value="m">{{ m }}</option>
        </select>
        <input
          v-else
          v-model="settings.ai_model"
          class="form-input"
          :placeholder="$t('settings.general.customModelPlaceholder')"
          autocomplete="off"
        />
      </div>

      <p v-if="statusText" class="setup-status" :class="{ ok: statusOk }">{{ statusText }}</p>

      <button
        class="verify-btn"
        :disabled="testing || !settings.api_key"
        @click="verifyAndContinue"
      >
        {{ testing ? $t('apiSetup.testing') : $t('apiSetup.verify') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { settings } from '../config/config'
import { providers } from '../ai/provider-store'
import { testApiConnection } from '../ai/api-check'

const props = defineProps<{ reason: 'missing' | 'unavailable' }>()
const emit = defineEmits<{ ready: [] }>()

const { t } = useI18n()

const showKey = ref(false)
const testing = ref(false)
const statusText = ref('')
const statusOk = ref(false)

// 与设置页通用页签一致的供应商联动逻辑
const defaultProviderId = ref(settings.default_provider_id || '')
const defaultProviderModels = computed(() => {
  const p = providers.find(p => p.id === defaultProviderId.value)
  return p?.models || []
})

function onDefaultProviderChange() {
  settings.default_provider_id = defaultProviderId.value || undefined
  if (defaultProviderId.value) {
    const p = providers.find(p => p.id === defaultProviderId.value)
    if (p) {
      settings.ai_base_url = p.baseUrl
      if (p.apiKey) settings.api_key = p.apiKey
    }
  }
}

async function verifyAndContinue() {
  if (testing.value) return
  testing.value = true
  statusText.value = ''
  console.log('[ApiSetup] 开始验证 API 连接...')
  const result = await testApiConnection(settings.ai_base_url, settings.api_key, settings.ai_model)
  testing.value = false
  if (result.ok) {
    console.log('[ApiSetup] ✓ API 验证通过')
    statusOk.value = true
    statusText.value = t('apiSetup.testSuccess')
    // 稍作停顿让用户看到成功状态
    setTimeout(() => emit('ready'), 400)
  } else {
    console.log('[ApiSetup] ✗ API 验证失败:', result.error)
    statusOk.value = false
    statusText.value = t('apiSetup.testFailed', { error: result.error || 'unknown' })
  }
}
</script>

<style scoped>
.api-setup-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--spacing-lg);
  overflow-y: auto;
}

.setup-card {
  width: 100%;
  max-width: 420px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--spacing-lg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.setup-title {
  font-size: var(--font-size-xl);
  margin-bottom: var(--spacing-sm);
}

.setup-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin-bottom: var(--spacing-lg);
}

.form-group {
  position: relative;
  margin-bottom: var(--spacing-md);
}

.form-group label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-xs);
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-md);
  outline: none;
  transition: border-color 0.15s ease;
}

.form-input:focus {
  border-color: var(--color-primary);
}

.toggle-key {
  position: absolute;
  right: 8px;
  bottom: 8px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
}

.setup-status {
  font-size: var(--font-size-sm);
  color: var(--color-error);
  margin-bottom: var(--spacing-md);
  word-break: break-all;
}

.setup-status.ok {
  color: var(--color-success);
}

.verify-btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-size: var(--font-size-md);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.verify-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.verify-btn:disabled {
  background: var(--color-disabled);
  cursor: not-allowed;
}
</style>
