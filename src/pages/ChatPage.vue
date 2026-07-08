<!-- ============================================================
变形虫 (Amiba) — ChatPage (AI 对话)
============================================================ -->
<template>
  <div class="chat-page">
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
        @keydown.enter.exact.prevent="send"
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
import { ref, nextTick, onMounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { streamChat, buildMessages } from '../ai/agent'
import { getApiKey, settings } from '../config/config'
import { detectSlashCommand, buildSkillInvocationMessage } from '../ai/skill-commands'
import { matchCommand } from '../ai/commands'
import {
  getSession,
  loadHistory,
  saveHistory,
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
  addSystemMessage,
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
import { soulManager } from '../ai/soul'
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
const streamingReasoning = ref('')
let abortController: AbortController | null = null
const showStepLimit = ref(false)
const stepLimitCount = ref(0)

function stopStreaming() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

function continueGeneration() {
  if (isReviewing.value) return
  showStepLimit.value = false
  addUserMessage(t('chat.stepLimitContinueMsg'))
  saveHistory()
  scrollToBottom()
  // 复用发送逻辑，但不 reset 用户输入
  sending.value = true
  streaming.value = true
  streamingContent.value = ''
  streamingReasoning.value = ''
  abortController = new AbortController()
  streamContinue()
}

async function streamContinue() {
  try {
    const history = messages.value
      .filter((m) => !m.hidden && m.role !== 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const chatMsgs = buildMessages(history)

    const gen = streamChat(chatMsgs, { turnCount: turnCount.value, abortSignal: abortController!.signal })

    for await (const chunk of gen) {
      if (chunk.startsWith('\x00REASONING\x00')) {
        streamingReasoning.value += chunk.slice(11)
      } else if (chunk.startsWith('\x00TOOL:') && chunk.endsWith('\x00')) {
        const toolName = chunk.slice(6, -1)
        console.log('[ChatPage] 🔧', toolName)
        if (streamingContent.value || streamingReasoning.value) {
          addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined)
          streamingContent.value = ''
          streamingReasoning.value = ''
        }
        addToolMessage(toolName)
        saveHistory()
      } else if (chunk.startsWith('\x00STEP_LIMIT:')) {
        const n = parseInt(chunk.split(':')[1])
        if (streamingContent.value) {
          addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined)
          streamingContent.value = ''
          streamingReasoning.value = ''
        }
        stepLimitCount.value = n
        showStepLimit.value = true
      } else {
        streamingContent.value += chunk
      }
      scrollToBottom()
    }

    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined)
      streamingReasoning.value = ''
      saveHistory()
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      errorMsg.value = `${t('chat.errorPrefix')}: ${e.message}`
    }
  } finally {
    abortController = null
    sending.value = false
    streaming.value = false
    streamingContent.value = ''
    streamingReasoning.value = ''
    scrollToBottom()
  }
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
    errorMsg.value = t('chat.errorNoApiKey')
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

  addUserMessage(text)
  saveHistory() // 实时保存用户消息

  // ---- Slash 命令检测 ----
  let injectedUserMsg: string = text
  if (text.startsWith('/')) {
    const detected = await detectSlashCommand(text)
    if (detected) {
      console.log(`[Skill] === 用户斜杠命令触发: /${detected.skill.slug} (${detected.skill.name}) ===`)
      const expanded = await buildSkillInvocationMessage(
        detected.skill.slug,
        detected.userInstruction
      )
      if (expanded) {
        injectedUserMsg = expanded
      }
    }
  }

  scrollToBottom()

  sending.value = true
  streaming.value = true
  streamingContent.value = ''
  streamingReasoning.value = ''

  // 创建中止控制器
  abortController = new AbortController()

  try {
    // 过滤掉隐藏的系统消息，只传 user/assistant 给 API
    const history = messages.value
      .filter((m) => !m.hidden && m.role !== 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const chatMsgs = buildMessages(history.slice(0, -1))
    chatMsgs.push({ role: 'user', content: injectedUserMsg })

    const gen = streamChat(chatMsgs, { turnCount: turnCount.value, abortSignal: abortController.signal })

    for await (const chunk of gen) {
      if (chunk.startsWith('\x00REASONING\x00')) {
        streamingReasoning.value += chunk.slice(11)
      } else if (chunk.startsWith('\x00TOOL:') && chunk.endsWith('\x00')) {
        const toolName = chunk.slice(6, -1)
        console.log('[ChatPage] 🔧', toolName)
        if (streamingContent.value || streamingReasoning.value) {
          addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined)
          streamingContent.value = ''
          streamingReasoning.value = ''
        }
        addToolMessage(toolName)
        saveHistory()
      } else if (chunk.startsWith('\x00STEP_LIMIT:')) {
        const n = parseInt(chunk.split(':')[1])
        if (streamingContent.value) {
          addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined)
          streamingContent.value = ''
          streamingReasoning.value = ''
        }
        stepLimitCount.value = n
        showStepLimit.value = true
      } else {
        streamingContent.value += chunk
      }
      scrollToBottom()
    }

    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined)
      streamingReasoning.value = ''
      saveHistory() // 实时保存 AI 回复
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      errorMsg.value = `${t('chat.errorPrefix')}: ${e.message}`
    }
  } finally {
    abortController = null
    sending.value = false
    streaming.value = false
    streamingContent.value = ''
    streamingReasoning.value = ''
    scrollToBottom()
  }
}

/** 首次启动：以系统消息注入引导指令并触发 AI 回复 */
async function sendOnboardingMessage(directive: string) {
  sending.value = true
  streaming.value = true
  streamingContent.value = ''
  streamingReasoning.value = ''

  abortController = new AbortController()

  try {
    const chatMsgs: { role: string; content: string }[] = []
    chatMsgs.push({ role: 'system', content: directive })
    const gen = streamChat(chatMsgs as any, { turnCount: 0, abortSignal: abortController.signal })

    for await (const chunk of gen) {
      if (chunk.startsWith('\x00REASONING\x00')) {
        streamingReasoning.value += chunk.slice(11)
      } else {
        streamingContent.value += chunk
      }
      scrollToBottom()
    }

    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value, streamingReasoning.value || undefined)
      streamingReasoning.value = ''
    }
  } catch {
    /* 静默处理 */
  } finally {
    abortController = null
    sending.value = false
    streaming.value = false
    streamingContent.value = ''
    streamingReasoning.value = ''
    scrollToBottom()
  }
}

onMounted(async () => {
  await loadHistory()
  await refreshSessionList()

  // 首次启动引导：注入人格创建指令
  if (await soulManager.isFirstLaunch()) {
    const directive = soulManager.getOnboardingDirective()
    addSystemMessage(directive)  // 记录但不显示
    await sendOnboardingMessage(directive)
    return
  }

  scrollToBottom()
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
  padding: 8px 16px;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  position: relative;
}

.session-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: background 0.15s;
  max-width: 220px;
}

.session-selector:hover {
  background: var(--color-hover-bg);
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
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}

.action-btn:hover {
  background: var(--color-hover-bg);
}

.stats-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 16px;
  cursor: pointer;
}

/* Session 下拉 */
.session-dropdown {
  position: absolute;
  top: 100%;
  left: 16px;
  right: 16px;
  max-width: 1080px;
  margin: 4px auto 0;
  background: var(--color-surface);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
  z-index: 50;
  max-height: 320px;
  overflow-y: auto;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-divider, #f5f5f5);
  transition: background 0.15s;
}

.session-item:hover {
  background: var(--color-primary-light);
}

.session-item.active {
  background: var(--color-primary-light);
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
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.session-del:hover {
  color: var(--color-error);
  background: var(--color-error-light);
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
  gap: 12px;
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
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  align-self: flex-end;
}

.message.user .message-content {
  background: var(--color-primary);
  color: white;
  border-radius: 16px 16px 4px 16px;
}

.message.assistant {
  align-self: flex-start;
}

.message.assistant .message-content {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 16px 16px 16px 4px;
  box-shadow: 0 2px 8px var(--shadow-sm);
}

.message.tool {
  align-self: center;
}

.message.tool .message-content {
  background: var(--color-tool-msg-bg);
  color: var(--color-tool-msg-text);
  border-radius: 12px;
  font-size: 12px;
  padding: 6px 14px;
}

.message.error .message-content {
  background: var(--color-warning-light);
  color: var(--color-warning);
  align-self: center;
  font-size: 13px;
}

.message-content {
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.streaming .cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.chat-input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px 8px 16px;
  max-width: 1080px;
  width: calc(100% - 24px);
  margin: 0 auto 12px auto;
  background: var(--color-surface);
  border-radius: 16px;
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
  padding: 10px 18px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  align-self: flex-end;
}

.send-btn:disabled {
  background: var(--color-text-muted);
  cursor: not-allowed;
}

.stop-btn {
  flex-shrink: 0;
  padding: 10px 18px;
  background: var(--color-error);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  align-self: flex-end;
}

.stop-btn:hover {
  background: var(--color-error-dark);
}

/* ---- 统计模态框 ---- */

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-box {
  background: var(--color-surface);
  border-radius: 16px;
  padding: 24px;
  min-width: 280px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}

.modal-box h3 {
  margin: 0 0 16px;
  font-size: 16px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--color-border-light, #f0f0f0);
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
  border-top: 1px solid var(--color-border-light, #f0f0f0);
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
  border-top: 1px solid var(--color-border-light, #f0f0f0);
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
  padding: 1px 6px;
  border-radius: 4px;
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
  padding: 8px;
  background: var(--color-bg);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.limit-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.limit-actions .primary-btn {
  flex: 1;
  padding: 10px 16px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.limit-actions .primary-btn:hover {
  background: var(--color-primary-hover);
}

.limit-actions .secondary-btn {
  flex: 1;
  padding: 10px 16px;
  background: var(--color-bg);
  color: var(--color-text-secondary);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.limit-actions .secondary-btn:hover {
  background: var(--color-hover-bg);
}

/* === 响应式：移动端适配 === */
@media (max-width: 768px) {
  .chat-page {
    height: 100%;
  }

  .chat-topbar {
    padding: 6px 8px;
  }

  .session-selector {
    max-width: 140px;
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
    padding: 8px;
    gap: 8px;
  }

  .message {
    max-width: 92%;
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
  background: rgba(0,0,0,0.03);
  border-left: 3px solid var(--color-border, #d0d0d0);
  border-radius: 0 6px 6px 0;
}

.message-content {
    padding: 10px 14px;
    font-size: 13px;
  }

  .chat-input-bar {
    padding: 6px 8px 6px 12px;
    border-radius: 16px;
    gap: 4px;
    width: calc(100% - 16px);
    margin: 0 auto 8px auto;
  }

  .chat-input {
    font-size: 13px;
    min-height: 44px;
  }

  .send-btn {
    padding: 8px 14px;
    font-size: 13px;
    border-radius: 10px;
  }

  .stop-btn {
    padding: 8px 14px;
    font-size: 13px;
    border-radius: 10px;
  }

  .stats-btn {
    padding: 2px 8px;
    font-size: 14px;
  }

  .action-btn {
    padding: 2px 8px;
    font-size: 14px;
  }
}

/* 安全区域（刘海屏/底部指示条） */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .chat-input-bar {
    padding-bottom: calc(6px + env(safe-area-inset-bottom));
  }
}
</style>
