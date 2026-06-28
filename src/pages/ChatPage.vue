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
        <button class="action-btn" title="新会话" @click="doNewSession">＋</button>
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
          <span class="session-item-meta">{{ s.messageCount }} 条 · {{ fmtDate(s.updatedAt) }}</span>
          <button class="session-del" title="删除" @click.stop="doDeleteSession(s.id)">✕</button>
        </div>
        <div v-if="sessionList.length === 0" class="session-empty">暂无历史会话</div>
      </div>
    </div>

    <div class="chat-messages" ref="messagesEl">
      <div v-if="visibleMessages.length === 0" class="chat-empty">
        <div class="empty-icon">💬</div>
        <p>开始与 AI 对话吧</p>
        <p class="hint">记忆会在对话中自动保存</p>
      </div>

      <div
        v-for="(msg, idx) in visibleMessages"
        :key="idx"
        :class="['message', msg.role]"
      >
        <div class="message-content" v-text="msg.content"></div>
      </div>

      <div v-if="streaming" class="message assistant">
        <div class="message-content streaming">
          {{ streamingContent }}<span class="cursor">|</span>
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
        placeholder="输入消息..."
        rows="2"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button
        class="send-btn"
        :disabled="!input.trim() || sending"
        @click="send"
      >
        {{ sending ? '...' : '发送' }}
      </button>
    </div>

    <!-- 统计模态框 -->
    <div v-if="showStats" class="modal-overlay" @click.self="showStats = false">
      <div class="modal-box">
        <h3>📊 统计</h3>
        <div class="stat-row">
          <span class="stat-label">距离建议保存记忆</span>
          <span class="stat-value">还有 {{ nudgeCountdown }} 轮</span>
        </div>
        <button class="modal-close" @click="showStats = false">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, watch, computed } from 'vue'
import { streamChat, buildMessages } from '../ai/agent'
import { getApiKey } from '../config/config'
import { detectSlashCommand, buildSkillInvocationMessage } from '../ai/skill-commands'
import { matchCommand } from '../ai/commands'
import {
  getSession,
  loadHistory,
  saveHistory,
  addUserMessage,
  addAssistantMessage,
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

const session = getSession()
const { messages, turnCount, sending, streaming, streamingContent, errorMessage: errorMsg } = session

const input = ref('')
const messagesEl = ref<HTMLDivElement | null>(null)
const showStats = ref(false)
const showSessions = ref(false)
const sessionList = ref<SessionMeta[]>([])
const currentId = ref<string | null>(null)

const visibleMessages = computed(() => getVisibleMessages())

const currentSessionTitle = computed(() => {
  const s = sessionList.value.find((s) => s.id === currentId.value)
  return s?.title || 'AI 对话'
})

const NUDGE_INTERVAL = 10
const nudgeCountdown = computed(() => {
  return NUDGE_INTERVAL - (turnCount.value % NUDGE_INTERVAL)
})

function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return '今天'
  if (diff < 172800000) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
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
  if (!text || sending.value) return

  const apiKey = await getApiKey()
  if (!apiKey) {
    errorMsg.value = '请先在设置中配置 API Key'
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

  try {
    // 过滤掉隐藏的系统消息，只传 user/assistant 给 API
    const history = messages.value
      .filter((m) => !m.hidden)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const chatMsgs = buildMessages(history.slice(0, -1))
    chatMsgs.push({ role: 'user', content: injectedUserMsg })

    const gen = streamChat(chatMsgs, { turnCount: turnCount.value })

    for await (const chunk of gen) {
      streamingContent.value += chunk
      scrollToBottom()
    }

    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value)
      saveHistory() // 实时保存 AI 回复
    }
  } catch (e: any) {
    errorMsg.value = `错误: ${e.message}`
  } finally {
    sending.value = false
    streaming.value = false
    streamingContent.value = ''
    scrollToBottom()
  }
}

/** 首次启动：以系统消息注入引导指令并触发 AI 回复 */
async function sendOnboardingMessage(directive: string) {
  sending.value = true
  streaming.value = true
  streamingContent.value = ''

  try {
    const chatMsgs: { role: string; content: string }[] = []
    chatMsgs.push({ role: 'system', content: directive })
    const gen = streamChat(chatMsgs as any, { turnCount: 0 })

    for await (const chunk of gen) {
      streamingContent.value += chunk
      scrollToBottom()
    }

    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value)
    }
  } catch {
    /* 静默处理 */
  } finally {
    sending.value = false
    streaming.value = false
    streamingContent.value = ''
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
  background: #f0f0f0;
}

.session-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-arrow {
  font-size: 10px;
  color: #999;
  flex-shrink: 0;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-btn {
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}

.action-btn:hover {
  background: #f0f0f0;
}

.stats-btn {
  background: none;
  border: 1px solid #e0e0e0;
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
  background: white;
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
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.15s;
}

.session-item:hover {
  background: #f8f9ff;
}

.session-item.active {
  background: #e3f2fd;
}

.session-item-title {
  font-size: 14px;
  color: #333;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item-meta {
  font-size: 11px;
  color: #aaa;
  flex-shrink: 0;
}

.session-del {
  background: none;
  border: none;
  color: #ccc;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.session-del:hover {
  color: #e53935;
  background: #ffebee;
}

.session-empty {
  padding: 24px;
  text-align: center;
  color: #ccc;
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
  color: #999;
  gap: 8px;
}

.empty-icon {
  font-size: 48px;
}

.hint {
  font-size: 12px;
  color: #ccc;
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
  background: #1976D2;
  color: white;
  border-radius: 16px 16px 4px 16px;
}

.message.assistant {
  align-self: flex-start;
}

.message.assistant .message-content {
  background: white;
  color: #333;
  border-radius: 16px 16px 16px 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.message.error .message-content {
  background: #FFF3E0;
  color: #E65100;
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
  padding: 8px 8px 8px 16px;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  background: white;
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
  background: #1976D2;
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  align-self: flex-end;
}

.send-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
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
  background: white;
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
  border-top: 1px solid #f0f0f0;
}

.stat-label {
  font-size: 14px;
  color: #666;
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: #1976D2;
}

.modal-close {
  margin-top: 16px;
  width: 100%;
  padding: 8px;
  background: #f5f5f5;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
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

  .message-content {
    padding: 10px 14px;
    font-size: 13px;
  }

  .chat-input-bar {
    padding: 6px 6px 6px 12px;
    border-radius: 0;
    gap: 4px;
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
