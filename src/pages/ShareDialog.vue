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
          <select v-model="selectedServiceId" class="form-input" :disabled="sending">
            <option value="">{{ $t('share.selectService') }}...</option>
            <option v-for="s in userServices" :key="s.manifest.id" :value="s.manifest.id">
              {{ s.manifest.name }}
            </option>
          </select>
        </div>

        <p v-if="!userServices.length" class="hint-text">{{ $t('share.noUserServices') }}</p>

        <div class="form-group" v-if="selectedServiceId">
          <label>{{ $t('share.selectPeer') }}</label>
          <select v-model="selectedPeerId" class="form-input" :disabled="sending">
            <option value="">{{ $t('share.selectPeer') }}...</option>
            <option v-for="p in lanPeers" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.address }})
            </option>
          </select>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
  return getUserServices().filter((s) => s.enabled && s.source !== 'builtin')
})

const lanPeers = computed(() => {
  return peerList.filter((p) => p.transport === 'lan')
})

let unsubShare: (() => void) | null = null
let discoveryInterval: ReturnType<typeof setInterval> | null = null

function close() {
  if (sending.value) return
  if (listening.value) {
    stopReceiving()
    listening.value = false
    pendingReq.value = null
  }
  stopDiscovery('lan').catch(() => {})
  clearDiscoveryInterval()
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

  // 打开弹窗时自动开始设备发现
  startDiscovery('lan').catch(() => {})
  discoveryInterval = setInterval(() => {
    startDiscovery('lan').catch(() => {})
  }, 15000)
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
  background: rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.share-dialog {
  background: white;
  border-radius: 16px;
  padding: 24px;
  width: 90%;
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.dialog-header h3 {
  font-size: 18px;
  color: #333;
  margin: 0;
}

.dialog-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #999;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.dialog-close:hover {
  background: #f0f0f0;
}

.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: #f0f0f0;
  border-radius: 10px;
  padding: 3px;
}

.tab-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn.active {
  background: white;
  color: #1976D2;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.tab-content {
  min-height: 120px;
}

.form-group {
  margin-bottom: 12px;
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
  background: white;
  font-family: inherit;
}

.form-input:focus {
  border-color: #1976D2;
}

.hint-text {
  font-size: 13px;
  color: #bbb;
  text-align: center;
  padding: 12px 0;
}

.primary-btn {
  padding: 10px 16px;
  background: #1976D2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.primary-btn:hover {
  background: #1565C0;
}

.primary-btn.full {
  width: 100%;
}

.secondary-btn {
  padding: 10px 16px;
  background: #f5f5f5;
  color: #666;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.secondary-btn:hover {
  background: #e0e0e0;
}

.status-area {
  margin: 12px 0;
}

.status-text {
  font-size: 13px;
  margin-bottom: 6px;
  color: #666;
}

.status-text.ok { color: #4CAF50; }
.status-text.error { color: #e53935; }
.status-text.warn { color: #f57c00; }

.progress-bar {
  width: 100%;
  height: 6px;
  background: #e0e0e0;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #1976D2;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.request-card {
  background: #f9f9f9;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  text-align: center;
}

.req-icon {
  font-size: 36px;
}

.req-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.req-info strong {
  font-size: 14px;
  color: #333;
}

.req-info span {
  font-size: 13px;
  color: #666;
}

.req-desc {
  font-size: 12px;
  color: #999;
}

.req-actions {
  display: flex;
  gap: 8px;
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
  background-color: #ccc;
  border-radius: 26px;
  transition: 0.3s;
}

.switch .slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s;
}

.switch input:checked + .slider { background-color: #1976D2; }
.switch input:checked + .slider:before { transform: translateX(22px); }
</style>
