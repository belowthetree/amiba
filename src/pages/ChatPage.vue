<!-- ============================================================
变形虫 (Amiba) — ChatPage (AI 对话)
============================================================ -->
<template>
  <div class="chat-page" :style="{ paddingBottom: keyboardInset + 'px' }">
    <div class="chat-topbar">
      <div class="session-selector" @click="showSessions = !showSessions">
        <span class="session-title">{{ currentSessionTitle }}</span>
        <span class="dropdown-arrow">▾</span>
      </div>
      <div class="topbar-actions">
        <button class="action-btn" :title="$t('chat.newSession')" @click="doNewSession">＋</button>
        <button class="stats-btn" @click="showStats = true">📊</button>
      </div>
      <!-- Session 下拉列表 -->
      <div v-if="showSessions" class="session-dropdown" @click.stop>
        <div
          v-for="s in sessionList"
          :key="s.id"
          :class="['session-item', { active: s.id === currentId }]"
          @click="switchTo(s.id)"
        >
          <span class="session-item-title">{{ s.title }}</span>
          <span class="session-item-meta">{{ s.messageCount }} {{ $t('chat.messageCount') }} · {{ fmtDate(s.updatedAt) }}</span>
          <button class="session-del" :title="$t('chat.delete')" @click.stop="doDeleteSession(s.id)">✕</button>
        </div>
        <div v-if="sessionList.length === 0" class="session-empty">{{ $t('chat.noSessions') }}</div>
      </div>
    </div>

    <!-- 插槽: chat.above-messages -->
    <SlotRenderer name="chat.above-messages" :html="slotHtml('chat.above-messages')" />

    <div class="chat-messages" ref="messagesEl">
      <div v-if="visibleMessages.length === 0" class="chat-empty">
        <div class="empty-icon">💬</div>
        <p>{{ $t('chat.emptyHint') }}</p>
        <p class="hint">{{ $t('chat.emptySubHint') }}</p>
      </div>

      <div
        v-for="(msg, idx) in visibleMessages"
        :key="idx"
        :class="['message', msg.role]"
      >
        <div class="message-content" v-if="msg.role === 'tool'">🔧 {{ msg.content }}</div>
        <div class="message-content" v-else>
          <details v-if="msg.reasoning" class="reasoning-block">
            <summary>{{ $t('chat.thinking') }}</summary>
            <div class="reasoning-content">{{ msg.reasoning }}</div>
          </details>
          {{ msg.content }}
        </div>
      </div>

      <div v-if="streaming" class="message assistant">
        <div class="message-content streaming">
          <details v-if="streamingReasoning" class="reasoning-block" open>
            <summary>{{ $t('chat.thinkingProgress') }}</summary>
            <div class="reasoning-content">{{ streamingReasoning }}</div>
          </details>
          {{ streamingContent }}<span v-if="!streamingReasoning || streamingContent" class="cursor">|</span>
        </div>
      </div>

      <div v-if="errorMsg" class="message error">
        <div class="message-content">{{ errorMsg }}</div>
      </div>
    </div>

    <div class="chat-input-bar">
      <textarea
        v-model="input"
        class="chat-input"
        :placeholder="isReviewing ? $t('chat.reviewRunning') : $t('chat.placeholder')"
        rows="2"
        :disabled="isReviewing"
        @keydown="onInputKeydown"
        @beforeinput="onInputBeforeInput"
      ></textarea>
      <button
        v-if="streaming"
        class="stop-btn"
        @click="stopStreaming"
      >
        {{ $t('chat.stop') }}
      </button>
      <button
        v-else
        class="send-btn"
        :disabled="!input.trim() || sending || isReviewing"
        @click="send"
      >
        {{ $t('chat.send') }}
      </button>
    </div>

    <!-- 插槽: chat.below-input -->
    <SlotRenderer name="chat.below-input" :html="slotHtml('chat.below-input')" />

    <!-- 统计模态框 -->
    <div v-if="showStats" class="modal-overlay" @click.self="showStats = false">
      <div class="modal-box">
        <h3>📊 {{ $t('chat.stats.title') }}</h3>
        <div class="stat-row">
          <span class="stat-label">{{ $t('chat.stats.saveMemoryHint') }}</span>
          <span class="stat-value">{{ $t('chat.stats.roundsLeft', { n: nudgeCountdown }) }}</span>
        </div>

        <div class="stat-divider">🌐 {{ $t('chat.stats.nearbyDevices') }}</div>

        <div class="stat-row">
          <span class="stat-label">{{ $t('chat.stats.lanLabel') }}</span>
          <span class="stat-value">{{ lanPeerCount }} {{ $t('chat.stats.units') }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">{{ $t('chat.stats.bleLabel') }}</span>
          <span class="stat-value">{{ blePeerCount }} {{ $t('chat.stats.units') }}</span>
        </div>
        <div class="stat-row total">
          <span class="stat-label">{{ $t('chat.stats.total') }}</span>
          <span class="stat-value">{{ totalPeerCount }} {{ $t('chat.stats.units') }}</span>
        </div>

        <div v-if="totalPeerCount > 0" class="peer-list">
          <div v-for="p in peerList" :key="p.id" class="peer-item">
            <span class="peer-icon">{{ p.transport === 'lan' ? '🖥️' : '📶' }}</span>
            <span class="peer-name">{{ p.name }}</span>
            <span class="peer-transport">{{ p.transport.toUpperCase() }}</span>
          </div>
        </div>
        <div v-else class="no-peers">{{ $t('chat.stats.noPeers') }}</div>

        <button class="modal-close" @click="showStats = false">{{ $t('chat.stats.close') }}</button>
      </div>
    </div>

    <!-- 工具调用上限模态框 -->
    <div v-if="showStepLimit" class="modal-overlay" @click.self="showStepLimit = false">
      <div class="modal-box">
        <h3>🔧 {{ $t('chat.stepLimit', { n: stepLimitCount }) }}</h3>
        <div class="limit-actions">
          <button class="primary-btn" @click="continueGeneration">{{ $t('chat.stepLimitContinue') }}</button>
          <button class="secondary-btn" @click="showStepLimit = false">{{ $t('chat.stepLimitEnd') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApiKey, settings } from '../config/config'
import {
  sendMessage,
  stopGeneration as stopStreaming,
  continueGeneration as continueAgent,
  running as agentRunning,
  streamingReasoning,
  showStepLimit,
  stepLimitCount,
} from '../ai/agent-runner'
import { matchCommand } from '../ai/commands'
import {
  getSession,
  loadHistory,
  saveHistory,
  flashError,
  getVisibleMessages,
  listSessions,
  createSession,
  switchToSession,
  deleteSession,
  getCurrentSessionId,
  newSession,
  flushHistory,
} from '../ai/session'
import type { SessionMeta } from '../ai/session'
import { isReviewing, lastReviewResult } from '../ai/skill-reviewer'
import { peerList } from '../host/network-bridge'
import { 
  startDiscovery as netStartDiscovery,
  stopDiscovery as netStopDiscovery,
} from '../host/network-bridge'
import SlotRenderer from '../components/SlotRenderer.vue'
import { themeState } from '../config/theme-store'

const { t } = useI18n()

const slotHtml = (name: string) => themeState.slots[name] || ''

const session = getSession()
const { messages, turnCount, sending, streaming, streamingContent, errorMessage: errorMsg } = session

const input = ref('')
const messagesEl = ref<HTMLDivElement | null>(null)
const showStats = ref(false)
const showSessions = ref(false)
const sessionList = ref<SessionMeta[]>([])
const currentId = ref<string | null>(null)

// Agent 执行状态由 agent-runner 全局管理；ChatPage 只读绑定

// ==== 自动滚屏：Agent 流式输出时跟随 ====
watch(
  () => streamingContent.value,
  () => {
    if (agentRunning.value) scrollToBottom()
  }
)

// ==== 输入框键盘处理 ====

// 回车发送；IME 组合中（中文选词）不触发，Shift+Enter 换行
function onInputKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  send()
}

// 部分手机输入法回车不派发标准 Enter keydown，通过 beforeinput 拦截换行改为发送
const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
function onInputBeforeInput(e: Event) {
  if (!isCoarsePointer) return
  const ie = e as InputEvent
  if (ie.inputType === 'insertParagraph' || ie.inputType === 'insertLineBreak') {
    e.preventDefault()
    send()
  }
}

// ==== 软键盘遮挡适配 ====
// 通过 visualViewport 计算键盘高度，给页面加底部 padding 把输入框顶到键盘上方
const keyboardInset = ref(0)
function syncKeyboardInset() {
  const vv = window.visualViewport
  if (!vv) return
  keyboardInset.value = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
  if (keyboardInset.value > 0) scrollToBottom()
}

/** 步数限制后继续 — 委托给 agent-runner */
async function continueGeneration() {
  if (isReviewing.value) return
  scrollToBottom()
  await continueAgent()
}

const visibleMessages = computed(() => getVisibleMessages())

const currentSessionTitle = computed(() => {
  const s = sessionList.value.find((s) => s.id === currentId.value)
  return s?.title || t('chat.defaultSessionTitle')
})

const NUDGE_INTERVAL = 10
const nudgeCountdown = computed(() => {
  return NUDGE_INTERVAL - (turnCount.value % NUDGE_INTERVAL)
})

// 附近设备统计
const lanPeerCount = computed(() => peerList.filter(p => p.transport === 'lan').length)
const blePeerCount = computed(() => peerList.filter(p => p.transport === 'ble').length)
const totalPeerCount = computed(() => peerList.length)

function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return t('chat.today')
  if (diff < 172800000) return t('chat.yesterday')
  return d.toLocaleDateString(settings.language === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' })
}

async function refreshSessionList() {
  sessionList.value = await listSessions()
  currentId.value = getCurrentSessionId()
}

async function switchTo(id: string) {
  showSessions.value = false
  await switchToSession(id)
  currentId.value = id
  await refreshSessionList()
  scrollToBottom()
}

async function doNewSession() {
  showSessions.value = false
  stopStreaming()
  await newSession()
  await refreshSessionList()
  scrollToBottom()
}

async function doDeleteSession(id: string) {
  await deleteSession(id)
  await refreshSessionList()
  // 如果删除后无 session，自动创建
  if (sessionList.value.length === 0) {
    await createSession()
    await refreshSessionList()
  }
  scrollToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || isReviewing.value) return

  // 用户主动发送消息，关闭步数限制弹窗
  showStepLimit.value = false

  const apiKey = await getApiKey()
  if (!apiKey) {
    // 检测聊天记录：历史消息中已提示过未配置 API Key 则不再重复提示
    const warnText = t('chat.errorNoApiKey')
    const alreadyWarned = messages.value.some(
      (m) => m.content.includes(warnText) || m.content.includes('请先在设置中配置 API Key')
    )
    if (!alreadyWarned) {
      errorMsg.value = warnText
      session.messages.value.push({ role: 'system', content: warnText, hidden: true })
      saveHistory()
    }
    return
  }

  errorMsg.value = ''
  input.value = ''

  // ---- 内置命令检测 ----
  const cmd = matchCommand(text)
  if (cmd) {
    await flushHistory() // 切换前刷新保存
    const result = await cmd.handler()
    flashError(result)
    await refreshSessionList()
    scrollToBottom()
    return
  }

  // 委托给全局 Agent 执行器
  scrollToBottom()
  await sendMessage(text)
}

onMounted(async () => {
  // 软键盘监听：visualViewport 在键盘弹出/收起时触发 resize/scroll
  window.visualViewport?.addEventListener('resize', syncKeyboardInset)
  window.visualViewport?.addEventListener('scroll', syncKeyboardInset)
  syncKeyboardInset()

  await loadHistory()
  await refreshSessionList()

  // 清理历史记录中残留的"未配置 API Key"提示消息（旧版本可能保存为可见消息）
  const warnTexts = [t('chat.errorNoApiKey'), '请先在设置中配置 API Key']
  let dirty = false
  for (const m of session.messages.value) {
    if (!m.hidden && warnTexts.some((w) => m.content.includes(w))) {
      m.hidden = true
      dirty = true
    }
  }
  if (dirty) saveHistory()

  scrollToBottom()
})

// 离开聊天页时清除残留错误提示（errorMsg 为会话级状态，不清理会跨页面驻留）
onUnmounted(() => {
  errorMsg.value = ''
  window.visualViewport?.removeEventListener('resize', syncKeyboardInset)
  window.visualViewport?.removeEventListener('scroll', syncKeyboardInset)
})

watch(
  () => messages.value.length,
  () => {
    saveHistory()
  }
)

// 打开统计框时自动启动设备发现，关闭时停止
watch(showStats, async (open) => {
  if (open) {
    try {
      await netStartDiscovery('lan')
    } catch { /* 非 Tauri 环境或无权限静默跳过 */ }
  } else {
    netStopDiscovery('lan').catch(() => {})
  }
})

// 审查状态监听：显示/隐藏进度指示器
watch(isReviewing, (reviewing) => {
  if (reviewing) {
    stopStreaming()
    session.messages.value.push({ role: 'system', content: `🔍 ${t('chat.reviewRunning')}` })
    saveHistory()
    scrollToBottom()
  }
})

// 审查结果监听：完成后显示汇总（仅用户感知的触发）
watch(lastReviewResult, (result) => {
  if (!result) return
  // 仅 manual（用户手动）和 session_end（/new 切换会话）展示结果
  // mid_session / curator 是后台维护，不打扰用户
  if (result.trigger !== 'manual' && result.trigger !== 'session_end') return

  if (result.ran && !result.error) {
    const msg = t('chat.reviewComplete', { created: result.skillsCreated, patched: result.skillsPatched, deleted: result.skillsDeleted } as any)
    session.messages.value.push({ role: 'system', content: `✅ ${msg}` })
  } else if (result.error) {
    session.messages.value.push({ role: 'system', content: `⚠️ ${t('chat.reviewError', { error: result.error })}` })
  } else {
    session.messages.value.push({ role: 'system', content: `ℹ️ ${t('chat.reviewSkipped')}` })
  }
  saveHistory()
  scrollToBottom()
})
</script>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.chat-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  position: relative;
}

.session-selector {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
  max-width: 220px;
}

.session-selector:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  box-shadow: var(--shadow-md);
}

.session-selector:active {
  transform: scale(0.97);
}

.session-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-arrow {
  font-size: 10px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn,
.stats-btn {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}

.action-btn:hover,
.stats-btn:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
  box-shadow: var(--shadow-md);
}

.action-btn:active,
.stats-btn:active {
  transform: scale(0.96);
}

/* Session 下拉 */
.session-dropdown {
  position: absolute;
  top: 100%;
  left: 16px;
  right: 16px;
  max-width: 1080px;
  margin: 6px auto 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  z-index: 50;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 0.15s ease;
}

.session-item:hover {
  background: var(--color-hover-bg);
}

.session-item.active {
  background: var(--color-primary-light);
}

.session-item.active .session-item-title {
  color: var(--color-primary);
  font-weight: 600;
}

.session-item-title {
  font-size: 14px;
  color: var(--color-text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item-meta {
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.session-del {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.session-del:hover {
  color: var(--color-error);
  background: var(--color-error-light);
}

.session-del:active {
  transform: scale(0.96);
}

.session-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  gap: 8px;
}

.empty-icon {
  font-size: 48px;
}

.hint {
  font-size: 12px;
  color: var(--color-text-muted);
}

.message {
  max-width: 85%;
  animation: fadeIn 0.25s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  align-self: flex-end;
}

.message.user .message-content {
  background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, var(--color-primary-hover)));
  color: var(--color-on-primary);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.message.assistant {
  align-self: flex-start;
}

.message.assistant .message-content {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm);
  box-shadow: var(--shadow-sm);
}

.message.tool {
  align-self: center;
}

.message.tool .message-content {
  background: var(--color-tool-msg-bg);
  color: var(--color-tool-msg-text);
  border-radius: 999px;
  font-size: 12px;
  padding: 5px 14px;
}

.message.error {
  align-self: center;
}

.message.error .message-content {
  background: var(--color-warning-light);
  color: var(--color-warning);
  border-radius: var(--radius-md);
  font-size: 13px;
}

.message-content {
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.streaming .cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.reasoning-block {
  margin-bottom: 8px;
}

.reasoning-block summary {
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}

.reasoning-block summary::marker {
  color: var(--color-text-muted);
}

.reasoning-content {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-style: italic;
  line-height: 1.6;
  white-space: pre-wrap;
  padding: 8px 10px;
  background: var(--color-hover-bg);
  border-left: 3px solid var(--color-border);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.chat-input-bar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 10px 10px 10px 18px;
  max-width: 1080px;
  width: calc(100% - 24px);
  margin: 0 auto 12px auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.chat-input-bar:focus-within {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-md);
}

.chat-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 6px 0;
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
  color: var(--color-text);
}

.chat-input::placeholder {
  color: var(--color-text-muted);
}

.chat-input:focus {
  outline: none;
}

@media (min-width: 768px) {
  .chat-input {
    min-height: 80px;
  }
}

.send-btn {
  flex-shrink: 0;
  padding: 10px 20px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  align-self: flex-end;
  box-shadow: var(--shadow-sm);
  transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
}

.send-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
  box-shadow: var(--shadow-md);
}

.send-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.send-btn:disabled {
  background: var(--color-disabled);
  box-shadow: none;
  opacity: 0.7;
  cursor: not-allowed;
}

.stop-btn {
  flex-shrink: 0;
  padding: 10px 20px;
  background: var(--color-error);
  color: var(--color-on-primary);
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  align-self: flex-end;
  box-shadow: var(--shadow-sm);
  transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}

.stop-btn:hover {
  background: var(--color-error-dark);
  box-shadow: var(--shadow-md);
}

.stop-btn:active {
  transform: scale(0.96);
}

/* ---- 统计模态框 ---- */

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: fadeIn 0.2s ease;
}

.modal-box {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 280px;
  max-width: calc(100vw - 32px);
  box-shadow: var(--shadow-md);
  animation: modalIn 0.25s ease;
}

@keyframes modalIn {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.modal-box h3 {
  margin: 0 0 16px;
  font-size: 16px;
  color: var(--color-text);
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--color-border-light);
}

.stat-label {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
}

.stat-divider {
  padding: 10px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-top: 1px solid var(--color-border-light);
  margin-top: 4px;
}

.stat-row.total {
  border-top: 1px solid var(--color-border);
  padding-top: 10px;
}

.stat-row.total .stat-value {
  color: var(--color-text);
}

.peer-list {
  max-height: 160px;
  overflow-y: auto;
  margin-top: 6px;
  border-top: 1px solid var(--color-border-light);
  padding-top: 6px;
}

.peer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 13px;
}

.peer-icon {
  font-size: 14px;
}

.peer-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.peer-transport {
  font-size: 10px;
  color: var(--color-text-secondary);
  background: var(--color-hover-bg);
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.no-peers {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 10px 0;
}

.modal-close {
  margin-top: 16px;
  width: 100%;
  padding: 10px;
  background: var(--color-bg);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease;
}

.modal-close:hover {
  background: var(--color-hover-bg);
  color: var(--color-text);
}

.modal-close:active {
  transform: scale(0.98);
}

.limit-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.limit-actions .primary-btn {
  flex: 1;
  padding: 10px 16px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}

.limit-actions .primary-btn:hover {
  background: var(--color-primary-hover);
  box-shadow: var(--shadow-md);
}

.limit-actions .primary-btn:active {
  transform: scale(0.97);
}

.limit-actions .secondary-btn {
  flex: 1;
  padding: 10px 16px;
  background: var(--color-bg);
  color: var(--color-text-secondary);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.15s ease;
}

.limit-actions .secondary-btn:hover {
  background: var(--color-hover-bg);
}

.limit-actions .secondary-btn:active {
  transform: scale(0.97);
}

/* === 响应式：移动端适配 === */
@media (max-width: 768px) {
  .chat-page {
    height: 100%;
  }

  .chat-topbar {
    padding: 8px 10px 6px;
  }

  .session-selector {
    max-width: 150px;
    padding: 6px 12px;
  }

  .session-title {
    font-size: 13px;
  }

  .session-dropdown {
    left: 8px;
    right: 8px;
    max-height: 260px;
  }

  .chat-messages {
    padding: 10px;
    gap: 10px;
  }

  .message {
    max-width: 92%;
  }

  .message-content {
    padding: 10px 14px;
    font-size: 13px;
  }

  .chat-input-bar {
    padding: 8px 8px 8px 14px;
    border-radius: var(--radius-lg);
    gap: 6px;
    width: calc(100% - 16px);
    margin: 0 auto 8px auto;
  }

  .chat-input {
    font-size: 13px;
    min-height: 44px;
  }

  .send-btn {
    padding: 8px 16px;
    font-size: 13px;
  }

  .stop-btn {
    padding: 8px 16px;
    font-size: 13px;
  }

  .stats-btn,
  .action-btn {
    width: 30px;
    height: 30px;
    font-size: 14px;
  }

  .modal-box {
    padding: 20px;
  }
}

/* 安全区域（刘海屏/底部指示条） */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .chat-input-bar {
    padding-bottom: calc(6px + env(safe-area-inset-bottom));
  }
}
</style>
