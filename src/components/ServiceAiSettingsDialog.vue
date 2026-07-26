<!-- ============================================================
变形虫 (Amiba) — ServiceAiSettingsDialog (服务 AI 对话设置)
============================================================ -->
<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-box">
      <h3>🤖 {{ $t('services.ai.title') }}</h3>
      <p class="svc-name">{{ service.manifest.name }} <span class="svc-id">{{ service.manifest.id }}</span></p>

      <!-- 启用开关（未声明 ai 权限时，开启即授权补声明） -->
      <label class="enable-row">
        <span class="toggle">
          <input type="checkbox" :checked="enabled" @change="onToggleEnabled" />
          <span class="toggle-slider"></span>
        </span>
        <span class="enable-label">{{ $t('services.ai.enable') }}</span>
      </label>
      <p class="hint">{{ $t('services.ai.enableHint') }}</p>

      <template v-if="enabled">
        <!-- 只读工具（默认开启） -->
        <div class="tool-group">
          <div class="group-title">{{ $t('services.ai.readonlyTools') }}</div>
          <label v-for="name in readonlyTools" :key="name" class="tool-row">
            <input type="checkbox" :checked="selected.has(name)" @change="toggleTool(name)" />
            <span class="tool-name">{{ name }}</span>
            <span class="tool-desc">{{ $t('services.ai.tools.' + name) }}</span>
          </label>
        </div>

        <!-- 敏感工具（默认关闭，逐项开启） -->
        <div class="tool-group">
          <div class="group-title sensitive">{{ $t('services.ai.sensitiveTools') }}</div>
          <label v-for="name in sensitiveTools" :key="name" class="tool-row">
            <input type="checkbox" :checked="selected.has(name)" @change="toggleTool(name)" />
            <span class="tool-name">{{ name }}</span>
            <span class="tool-desc">{{ $t('services.ai.tools.' + name) }}</span>
          </label>
        </div>

        <button class="reset-btn" @click="resetDefault">↺ {{ $t('services.ai.resetDefault') }}</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ServiceEntry } from '../types/service'
import { SERVICE_AI_TOOLS, getDefaultServiceAiTools } from '../ai/service-ai'
import { updateServiceAiConfig, grantServicePermission } from '../host/registry'

const props = defineProps<{ service: ServiceEntry }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const readonlyTools = Object.keys(SERVICE_AI_TOOLS).filter((n) => SERVICE_AI_TOOLS[n].level === 'readonly')
const sensitiveTools = Object.keys(SERVICE_AI_TOOLS).filter((n) => SERVICE_AI_TOOLS[n].level === 'sensitive')

// 声明即启用：有 ai 权限且 aiConfig.enabled 未显式关闭 → 视为启用
const enabled = ref(
  props.service.manifest.permissions.includes('ai') && props.service.aiConfig?.enabled !== false
)
const selected = ref<Set<string>>(new Set(props.service.aiConfig?.tools ?? getDefaultServiceAiTools()))

async function save() {
  await updateServiceAiConfig(props.service.manifest.id, {
    enabled: enabled.value,
    tools: [...selected.value],
  })
}

async function onToggleEnabled(e: Event) {
  const checkbox = e.target as HTMLInputElement
  const want = checkbox.checked
  // 未声明 ai 权限：开启 = 用户授权，补充权限声明
  if (want && !props.service.manifest.permissions.includes('ai')) {
    if (!confirm(t('services.ai.grantConfirm', { name: props.service.manifest.name }))) {
      checkbox.checked = false
      return
    }
    await grantServicePermission(props.service.manifest.id, 'ai')
  }
  enabled.value = want
  await save()
}

function toggleTool(name: string) {
  if (selected.value.has(name)) selected.value.delete(name)
  else selected.value.add(name)
  save()
}

function resetDefault() {
  selected.value = new Set(getDefaultServiceAiTools())
  save()
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 20px 24px;
  width: min(440px, calc(100vw - 48px));
  max-height: 80vh;
  overflow-y: auto;
}

.modal-box h3 {
  margin: 0 0 4px;
  font-size: var(--font-size-lg);
  color: var(--color-text);
}

.svc-name {
  margin: 0 0 14px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.svc-id {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.enable-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.enable-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.hint {
  margin: 8px 0 14px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  line-height: 1.5;
}

.tool-group {
  margin-bottom: 12px;
}

.group-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}

.group-title.sensitive {
  color: var(--color-error, #d92d20);
}

.tool-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
  font-size: 13px;
}

.tool-row input {
  accent-color: var(--color-primary);
  flex-shrink: 0;
}

.tool-name {
  font-family: monospace;
  color: var(--color-text);
  flex-shrink: 0;
}

.tool-desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reset-btn {
  margin-top: 4px;
  padding: 6px 14px;
  background: var(--color-surface);
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.reset-btn:hover {
  background: var(--color-primary-light);
}

/* 开关样式（与服务卡片 toggle 一致） */
.toggle {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
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
</style>
