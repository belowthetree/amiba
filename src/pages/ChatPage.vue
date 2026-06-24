<!-- ============================================================
变形虫 (Amiba) — ChatPage (AI 对话)
============================================================ -->
<template>
  <div class="chat-page">
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
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { streamChat, buildMessages } from '../ai/agent'
import { executeMemoryOperation } from '../ai/memory'
import { getApiKey } from '../config/config'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<Msg[]>([])
const input = ref('')
const sending = ref(false)
const streaming = ref(false)
const streamingContent = ref('')
const errorMsg = ref('')
const messagesEl = ref<HTMLDivElement | null>(null)

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

  const apiKey = getApiKey()
  if (!apiKey) {
    errorMsg.value = '请先在设置中配置 API Key'
    return
  }

  errorMsg.value = ''
  input.value = ''

  messages.value.push({ role: 'user', content: text })
  scrollToBottom()

  sending.value = true
  streaming.value = true
  streamingContent.value = ''

  try {
    const history = messages.value.map((m) => ({ role: m.role, content: m.content }))
    const chatMsgs = buildMessages(history.slice(0, -1)) // exclude last user msg

    // Add last user msg separately
    chatMsgs.push({ role: 'user', content: text })

    const gen = streamChat(chatMsgs, async (params) => {
      return executeMemoryOperation(params)
    })

    for await (const chunk of gen) {
      streamingContent.value += chunk
      scrollToBottom()
    }

    if (streamingContent.value) {
      messages.value.push({ role: 'assistant', content: streamingContent.value })
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

onMounted(() => {
  // Load saved chat history
  try {
    const saved = localStorage.getItem('amiba_chat_history')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        messages.value = parsed.slice(-50) // Keep last 50 messages
      }
    }
  } catch {
    // ignore
  }
})

// Save history on change
import { watch } from 'vue'
watch(
  () => messages.value.length,
  () => {
    try {
      localStorage.setItem('amiba_chat_history', JSON.stringify(messages.value.slice(-50)))
    } catch {
      // ignore
    }
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

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  gap: 8px;
  padding: 12px 16px;
  background: white;
  border-top: 1px solid #eee;
}

.chat-input {
  flex: 1;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
}

.chat-input:focus {
  border-color: #1976D2;
}

.send-btn {
  padding: 10px 20px;
  background: #1976D2;
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.send-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
