<!-- ============================================================
变形虫 (Amiba) — ChatPage (AI 对话)
============================================================ -->
<template>
  <div class="chat-page">
    <div class="chat-topbar">
      <span class="topbar-title">AI 对话</span>
      <button class="stats-btn" @click="showStats = true">📊</button>
    </div>

    <div class="chat-messages" ref="messagesEl">
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="empty-icon">💬</div>
        <p>开始与 AI 对话吧</p>
        <p class="hint">记忆会在对话中自动保存</p>
      </div>

      <div
        v-for="(msg, idx) in messages"
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
  flashError,
} from '../ai/session'
import { soulManager } from '../ai/soul'

const session = getSession()
const { messages, turnCount, sending, streaming, streamingContent, errorMessage: errorMsg } = session

const input = ref('')
const messagesEl = ref<HTMLDivElement | null>(null)
const showStats = ref(false)

const NUDGE_INTERVAL = 10
const nudgeCountdown = computed(() => {
  return NUDGE_INTERVAL - (turnCount.value % NUDGE_INTERVAL)
})

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
    const result = await cmd.handler()
    flashError(result)
    scrollToBottom()
    return
  }

  addUserMessage(text)

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
    const history = messages.value.map((m) => ({ role: m.role, content: m.content }))
    const chatMsgs = buildMessages(history.slice(0, -1))
    chatMsgs.push({ role: 'user', content: injectedUserMsg })

    const gen = streamChat(chatMsgs, { turnCount: turnCount.value })

    for await (const chunk of gen) {
      streamingContent.value += chunk
      scrollToBottom()
    }

    if (streamingContent.value) {
      addAssistantMessage(streamingContent.value)
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

  // 首次启动引导：注入人格创建指令到 system prompt（不显示在用户界面）
  if (await soulManager.isFirstLaunch()) {
    const directive = soulManager.getOnboardingDirective()
    // 作为附加的 system 消息注入（而非用户消息），AI 会看到但用户不会
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
  justify-content: center;
  padding: 8px 16px;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  position: relative;
}

.topbar-title {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.stats-btn {
  position: absolute;
  right: 0;
  background: none;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 16px;
  cursor: pointer;
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
</style>
