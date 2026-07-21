<!-- ============================================================
变形虫 (Amiba) — ShareDialog (局域网服务分享弹窗)
============================================================ -->
<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="share-dialog">
      <div class="dialog-header">
        <h3>📡 {{ $t('share.title') }}</h3>
        <button class="dialog-close" @click="close">✕</button>
      </div>

      <!-- Tab bar -->
      <div class="tab-bar">
        <button
          :class="['tab-btn', { active: mode === 'send' }]"
          @click="mode = 'send'"
        >{{ $t('share.sendTab') }}</button>
        <button
          :class="['tab-btn', { active: mode === 'receive' }]"
          @click="mode = 'receive'"
        >{{ $t('share.receiveTab') }}</button>
      </div>

      <!-- ====== 发送模式 ====== -->
      <div v-if="mode === 'send'" class="tab-content">
        <div class="form-group">
          <label>{{ $t('share.selectService') }}</label>
          <SelectDropdown
            v-model="selectedServiceId"
            :options="serviceOptions"
            :placeholder="$t('share.selectService') + '...'"
            :disabled="sending"
          />
        </div>

        <p v-if="!userServices.length" class="hint-text">{{ $t('share.noUserServices') }}</p>

        <div class="form-group" v-if="selectedServiceId">
          <label>{{ $t('share.selectPeer') }}</label>
          <SelectDropdown
            v-model="selectedPeerId"
            :options="peerOptions"
            :placeholder="$t('share.selectPeer') + '...'"
            :disabled="sending"
          />
        </div>

        <p v-if="selectedServiceId && !lanPeers.length" class="hint-text">{{ $t('share.noPeers') }}</p>

        <div v-if="statusText" class="status-area">
          <div class="status-text" :class="statusType">{{ statusText }}</div>
          <div v-if="statusPercent >= 0" class="progress-bar">
            <div class="progress-fill" :style="{ width: statusPercent + '%' }"></div>
          </div>
        </div>

        <button
          v-if="selectedServiceId && selectedPeerId && !sending"
          class="primary-btn full"
          @click="doSend"
        >{{ $t('share.send') }}</button>
      </div>

      <!-- ====== 接收模式 ====== -->
      <div v-if="mode === 'receive'" class="tab-content">
        <div class="form-group">
          <div class="toggle-row">
            <label style="margin-bottom:0">{{ $t('share.waitForShare') }}</label>
            <label class="switch">
              <input type="checkbox" :checked="listening" @change="toggleListening" />
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <!-- 等待中状态 -->
        <div v-if="listening && !pendingReq" class="hint-text" style="text-align:center;padding:24px 0">
          ⏳ {{ $t('share.waiting') }}
        </div>

        <!-- 收到分享请求 -->
        <div v-if="pendingReq" class="request-card">
          <div class="req-icon">📦</div>
          <div class="req-info">
            <strong>{{ $t('share.requestFrom', { name: pendingReq.peerName }) }}</strong>
            <span>{{ pendingReq.manifest.name }}</span>
            <span class="req-desc">{{ pendingReq.manifest.description }}</span>
          </div>
          <div class="req-actions">
            <button class="primary-btn" @click="doAccept">{{ $t('share.confirm') }}</button>
            <button class="secondary-btn" @click="doDecline">{{ $t('share.decline') }}</button>
          </div>
        </div>

        <!-- 传输进度 -->
        <div v-if="statusText && listening" class="status-area">
          <div class="status-text" :class="statusType">{{ statusText }}</div>
          <div v-if="statusPercent >= 0" class="progress-bar">
            <div class="progress-fill" :style="{ width: statusPercent + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { peerList, startDiscovery, stopDiscovery } from '../host/network-bridge'
import { getUserServices } from '../host/registry'
import {
  sendService,
  startReceiving,
  stopReceiving,
  acceptShare,
  declineShare,
  onShareEvent,
  getPendingRequest,
  type ShareEvent,
} from '../host/service-share'
import SelectDropdown from '../components/SelectDropdown.vue'

const { t } = useI18n()
const visible = defineModel<boolean>({ default: false })
const mode = ref<'send' | 'receive'>('send')
const selectedServiceId = ref('')
const selectedPeerId = ref('')
const sending = ref(false)
const listening = ref(false)
const statusText = ref('')
const statusPercent = ref(-1)
const statusType = ref('')
const pendingReq = ref<any>(null)

const userServices = computed(() => {
  return getUserServices().filter((s) => s.enabled && !s.manifest.id.startsWith('system.'))
})

const lanPeers = computed(() => {
  return peerList.filter((p) => p.transport === 'lan')
})

const serviceOptions = computed(() =>
  userServices.value.map((s) => ({ value: s.manifest.id, label: s.manifest.name }))
)

const peerOptions = computed(() =>
  lanPeers.value.map((p) => ({ value: p.id, label: `${p.name} (${p.address})` }))
)

let unsubShare: (() => void) | null = null
let discoveryInterval: ReturnType<typeof setInterval> | null = null

function close() {
  if (sending.value) return
  if (listening.value) {
    stopReceiving()
    listening.value = false
    pendingReq.value = null
  }
  visible.value = false
  statusText.value = ''
  statusPercent.value = -1
}

function clearDiscoveryInterval() {
  if (discoveryInterval) {
    clearInterval(discoveryInterval)
    discoveryInterval = null
  }
}

async function doSend() {
  if (!selectedServiceId.value || !selectedPeerId.value) return
  sending.value = true
  statusType.value = ''
  statusText.value = t('share.progress') + '...'
  statusPercent.value = 0
  await sendService(selectedServiceId.value, selectedPeerId.value)
}

async function toggleListening() {
  if (listening.value) {
    await stopReceiving()
    listening.value = false
    pendingReq.value = null
    statusText.value = ''
  } else {
    listening.value = true
    statusText.value = t('share.waiting')
    await startReceiving()
  }
}

async function doAccept() {
  pendingReq.value = null
  statusText.value = t('share.accepted')
  statusType.value = ''
  statusPercent.value = 0
  acceptShare()
}

async function doDecline() {
  pendingReq.value = null
  statusText.value = t('share.declined')
  setTimeout(() => { statusText.value = '' }, 2000)
  await declineShare()
}

// 分享事件订阅
onMounted(() => {
  unsubShare = onShareEvent((evt: ShareEvent) => {
    switch (evt.event) {
      case 'progress':
        statusType.value = ''
        statusText.value = evt.message || ''
        break
      case 'chunk-progress':
        statusPercent.value = evt.percent ?? 0
        statusText.value = t('share.progress') + ` (${evt.message})`
        break
      case 'complete':
        statusType.value = 'ok'
        statusText.value = evt.message || t('share.complete')
        sending.value = false
        setTimeout(() => { visible.value = false; statusText.value = ''; statusPercent.value = -1 }, 1500)
        break
      case 'error':
        statusType.value = 'error'
        statusText.value = t('share.error') + ': ' + (evt.message || '')
        sending.value = false
        break
      case 'declined':
        statusType.value = 'warn'
        statusText.value = t('share.declined')
        sending.value = false
        setTimeout(() => { statusText.value = '' }, 3000)
        break
      case 'request':
        // 收到分享请求
        pendingReq.value = {
          peerName: evt.peerName,
          manifest: evt.manifest,
        }
        break
    }
  })

  // 弹窗可见时才启动设备发现
  watch(visible, (v) => {
    if (v) {
      startDiscovery('lan').catch(() => {})
      discoveryInterval = setInterval(() => {
        startDiscovery('lan').catch(() => {})
      }, 15000)
    } else {
      stopDiscovery('lan').catch(() => {})
      clearDiscoveryInterval()
    }
  })
})

onUnmounted(() => {
  unsubShare?.()
  clearDiscoveryInterval()
  stopDiscovery('lan').catch(() => {})
  if (listening.value) stopReceiving()
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: overlayFadeIn 0.2s ease;
}

.share-dialog {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  width: 90%;
  max-width: 420px;
  box-shadow: var(--shadow-md);
  animation: dialogPopIn 0.25s cubic-bezier(0.34, 1.4, 0.64, 1);
}

@keyframes overlayFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes dialogPopIn {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: scale(1); }
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.dialog-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--color-text);
  margin: 0;
}

.dialog-close {
  background: none;
  border: none;
  font-size: 16px;
  color: var(--color-text-muted);
  cursor: pointer;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: all 0.2s ease;
}

.dialog-close:hover {
  background: var(--color-hover-bg);
  color: var(--color-text);
}

.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-md);
  padding: 4px;
}

.tab-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.tab-content {
  min-height: 120px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  background: var(--color-surface);
  font-family: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.form-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.hint-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-align: center;
  padding: 12px 0;
}

.primary-btn {
  padding: 10px 16px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.primary-btn:hover {
  background: var(--color-primary-hover);
}

.primary-btn:active {
  transform: scale(0.97);
}

.primary-btn.full {
  width: 100%;
}

.secondary-btn {
  padding: 10px 16px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.secondary-btn:hover {
  background: var(--color-hover-bg);
}

.secondary-btn:active {
  transform: scale(0.97);
}

.status-area {
  margin: 12px 0;
}

.status-text {
  font-size: var(--font-size-sm);
  margin-bottom: 6px;
  color: var(--color-text-secondary);
}

.status-text.ok { color: var(--color-success); }
.status-text.error { color: var(--color-error); }
.status-text.warn { color: var(--color-warning); }

.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--color-border-light);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.request-card {
  background: var(--color-bg);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  text-align: center;
  box-shadow: var(--shadow-sm);
}

.req-icon {
  font-size: 28px;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
}

.req-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.req-info strong {
  font-size: 14px;
  color: var(--color-text);
}

.req-info span {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.req-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.req-actions {
  display: flex;
  gap: var(--spacing-sm);
  width: 100%;
}

.req-actions .primary-btn,
.req-actions .secondary-btn {
  flex: 1;
}

/* 开关 */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  flex-shrink: 0;
}

.switch input { opacity: 0; width: 0; height: 0; }

.switch .slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--color-disabled);
  border-radius: 26px;
  transition: 0.25s ease;
}

.switch .slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: var(--color-surface);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.15);
  transition: 0.25s ease;
}

.switch input:checked + .slider { background-color: var(--color-primary); }
.switch input:checked + .slider:before { transform: translateX(22px); }
</style>
