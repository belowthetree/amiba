<!-- ============================================================
变形虫 (Amiba) — ChatPage (AI 对话)
无顶栏布局：功能按钮收纳进输入区左侧滑出面板
============================================================ -->
<template>
  <div class="chat-page" :class="{ empty: isEmpty, sink: sinkAnim }" :style="{ paddingBottom: keyboardInset + 'px' }">
    <!-- 插槽: chat.above-messages -->
    <SlotRenderer name="chat.above-messages" :html="slotHtml('chat.above-messages')" />

    <TransitionGroup name="msg" tag="div" class="chat-messages" :class="{ 'pre-scroll': !initialScrolled }" ref="messagesEl">
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
          <button
            v-if="msg.role === 'assistant' && idx === retryMsgIndex"
            class="retry-btn"
            :title="$t('chat.retry')"
            @click="doRetry"
          >🔄 {{ $t('chat.retry') }}</button>
        </div>
      </div>

      <div v-if="streaming" key="streaming" class="message assistant">
        <div class="message-content streaming">
          <details v-if="streamingReasoning" class="reasoning-block" open>
            <summary>{{ $t('chat.thinkingProgress') }}</summary>
            <div class="reasoning-content">{{ streamingReasoning }}</div>
          </details>
          {{ streamingContent }}<span v-if="!streamingReasoning || streamingContent" class="cursor">|</span>
        </div>
      </div>

      <div v-if="errorMsg" key="error" class="message error">
        <div class="message-content">{{ errorMsg }}</div>
      </div>
    </TransitionGroup>

    <!-- 输入区：空态时垂直居中，有消息后沉底 -->
    <div class="chat-input-zone">
      <!-- 空态提示（居中态显示在输入框上方） -->
      <div v-if="isEmpty" class="chat-empty-hero">
        <div class="empty-icon">💬</div>
        <p>{{ $t('chat.emptyHint') }}</p>
        <p class="hint">{{ $t('chat.emptySubHint') }}</p>
      </div>

      <div class="chat-input-row">
        <!-- 功能面板开关：› 点击后输入框右移，左侧露出功能按钮 -->
        <button
          class="panel-toggle"
          :class="{ open: panelOpen }"
          :aria-expanded="panelOpen"
          @click="panelOpen = !panelOpen"
        >
          <span class="chevron">›</span>
        </button>

        <!-- 功能面板（宽度动画滑出） -->
        <div class="input-panel" :class="{ open: panelOpen }">
          <div class="input-panel-inner">
            <button class="panel-btn" :title="$t('chat.newSession')" @click="doNewSession(); panelOpen = false">＋</button>
            <button class="panel-btn" :title="$t('chat.stats.title')" @click="showStats = true; panelOpen = false">📊</button>
            <button class="panel-btn" :title="$t('chat.sessions')" @click.stop="showSessions = !showSessions; panelOpen = false">🗂️</button>
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

        <!-- 会话列表弹出层（锚定在输入条上方） -->
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
// keep-alive 按组件名缓存：聊天页常驻，滑回时保留 DOM 与滚动位置，零重载
defineOptions({ name: 'ChatPage' })

import { ref, nextTick, onMounted, onUnmounted, onActivated, onDeactivated, watch, computed } from 'vue'
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
import { checkRecoveryNeeded, clearSnapshot } from '../ai/task-recovery'

const { t } = useI18n()

const slotHtml = (name: string) => themeState.slots[name] || ''

const session = getSession()
const { messages, turnCount, sending, streaming, streamingContent, errorMessage: errorMsg } = session

const input = ref('')
const messagesEl = ref<any>(null) // TransitionGroup 组件实例，取 DOM 用 .$el
// 首帧置底完成前隐藏消息列表（仅冷启动首次挂载：store 为空需等异步加载）。
// 滑页预览等重挂载场景 store 已有消息，首帧同步渲染+置底，不隐藏避免闪烁
const initialScrolled = ref(messages.value.length > 0)
const showStats = ref(false)
const showSessions = ref(false)
const panelOpen = ref(false)
const sessionList = ref<SessionMeta[]>([])
const currentId = ref<string | null>(null)

// 中断恢复：被中断的 assistant 消息在 visibleMessages 中的索引，-1 表示无
const retryMsgIndex = ref(-1)

/** 回前台时检查中断快照（组件已挂载场景） */
async function onVisibilityChange() {
  if (document.hidden) return
  const s = await checkRecoveryNeeded()
  if (s) {
    console.log('[ChatPage] visibilitychange: 检测到中断快照，显示刷新按钮')
    const visible = getVisibleMessages()
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].role === 'assistant') {
        retryMsgIndex.value = i
        break
      }
    }
  }
}

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

// 空态：无可见消息且未在流式输出/无错误提示 → 输入框垂直居中
const isEmpty = computed(() =>
  visibleMessages.value.length === 0 && !streaming.value && !errorMsg.value
)

// 输入区沉降动画：仅在空态→非空态跳变时播放（切页重挂载不重放）
const sinkAnim = ref(false)
watch(isEmpty, (empty, prev) => {
  if (prev === true && !empty) {
    sinkAnim.value = true
    setTimeout(() => { sinkAnim.value = false }, 450)
  }
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

/** 点击空白处关闭会话列表（下拉层与打开按钮均有 @click.stop，不会冒泡误触发） */
function closeSessionDropdown() {
  showSessions.value = false
}

// ==== 中断恢复：内联刷新 ====

async function doRetry() {
  console.log('[ChatPage] 用户点击重新生成')
  retryMsgIndex.value = -1
  await clearSnapshot()

  // 找到最后一条 user 消息，移除它之后的所有不完整消息
  const msgs = session.messages.value
  let lastUserIdx = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user' && !msgs[i].hidden) {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) return

  const userContent = msgs[lastUserIdx].content
  // 移除该 user 消息之后的所有消息（不完整的 assistant + tool）
  msgs.splice(lastUserIdx + 1)
  await saveHistory()

  // 重新发送 user 消息获取新输出
  scrollToBottom()
  await sendMessage(userContent)
}

function scrollToBottom() {
  nextTick(() => {
    const el = messagesEl.value?.$el ?? messagesEl.value
    if (el) el.scrollTop = el.scrollHeight
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

  // store 已有缓存消息（重挂载）：DOM 已同步渲染，首帧绘制前直接置底
  if (initialScrolled.value) {
    const el = messagesEl.value?.$el ?? messagesEl.value
    if (el) el.scrollTop = el.scrollHeight
  }

  // 冷启动首挂载：历史加载期间列表保持隐藏（pre-scroll），加载完同步置底后再显示
  try {
    await loadHistory()
    await nextTick()
    const el = messagesEl.value?.$el ?? messagesEl.value
    if (el) el.scrollTop = el.scrollHeight
  } finally {
    initialScrolled.value = true
  }
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

  // 检查是否有中断的 AI 任务需要恢复：在最后一条 assistant 消息旁显示刷新按钮
  const snap = await checkRecoveryNeeded()
  if (snap) {
    console.log('[ChatPage] onMounted: 检测到中断快照，显示刷新按钮')
    const visible = getVisibleMessages()
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].role === 'assistant') {
        retryMsgIndex.value = i
        break
      }
    }
  }

  // 回前台时重新检查（组件已挂载，onMounted 不会再次触发）
  document.addEventListener('visibilitychange', onVisibilityChange)

  // 点击空白处关闭会话列表下拉层
  document.addEventListener('click', closeSessionDropdown)
})

// 离开聊天页时清除残留错误提示（errorMsg 为会话级状态，不清理会跨页面驻留）
onUnmounted(() => {
  errorMsg.value = ''
  window.visualViewport?.removeEventListener('resize', syncKeyboardInset)
  window.visualViewport?.removeEventListener('scroll', syncKeyboardInset)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  document.removeEventListener('click', closeSessionDropdown)
})

// keep-alive 激活：首次激活紧随 onMounted（已刷新过），之后每次滑回聊天页刷新会话列表统计
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  refreshSessionList()
  // 休眠期间 DOM 脱离文档，滚动容器的 scrollTop 会丢失归零：激活后恢复置底
  scrollToBottom()
})

// keep-alive 休眠：页面切走但组件不销毁，等效原 onUnmounted 的页面级清理
onDeactivated(() => {
  errorMsg.value = ''
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

/* 空态：隐藏消息区，输入区垂直居中 */
.chat-page.empty .chat-messages {
  display: none;
}

/* 首帧置底完成前隐藏消息列表（visibility 保持布局占位，背景照常显示） */
.chat-messages.pre-scroll {
  visibility: hidden;
}

.chat-page.empty .chat-input-zone {
  flex: 1;
  justify-content: center;
  margin-bottom: 0;
}

/* 空态→非空态跳变时输入区沉降动画（切页重挂载不重放） */
.chat-page.sink .chat-input-zone {
  animation: inputSink 0.4s cubic-bezier(0.25, 0.9, 0.3, 1);
}

@keyframes inputSink {
  from { opacity: 0.3; transform: translateY(-14px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Session 弹出层（锚定在输入条上方） */
.session-dropdown {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  right: 0;
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--color-border-light);
  border: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
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

/* 空态提示（居中态位于输入框上方） */
.chat-empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 28px;
  color: var(--color-text-secondary);
  animation: fadeIn 0.3s ease;
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
}

/* 新消息进入动画（TransitionGroup 仅对新增触发，历史/切页重挂载不重放） */
.msg-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.msg-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  align-self: flex-end;
}

.message.user .message-content {
  background: var(--color-primary);
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

/* ==== 输入区（悬浮玻璃） ==== */
.chat-input-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  width: calc(100% - 24px);
  max-width: 1080px;
  margin: 0 auto 12px auto;
  flex-shrink: 0;
}

.chat-input-row {
  position: relative;
  display: flex;
  align-items: center;
}

/* 面板开关箭头 */
.panel-toggle {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-right: 8px;
  border: 1px solid var(--color-border);
  border: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  border-radius: 50%;
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 60%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--color-text-secondary);
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  box-shadow: var(--shadow-sm);
  transition: opacity 0.2s ease, background 0.2s ease, transform 0.15s ease;
}

.panel-toggle:hover {
  opacity: 1;
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 85%, transparent);
}

.panel-toggle:active {
  transform: scale(0.92);
}

.panel-toggle .chevron {
  line-height: 1;
  transition: transform 0.25s ease;
}

.panel-toggle.open .chevron {
  transform: rotate(180deg);
}

/* 功能面板：宽度 0 → auto 滑出，输入条随之右移压缩 */
.input-panel {
  width: 0;
  margin-right: 0;
  overflow: hidden;
  opacity: 0;
  flex-shrink: 0;
  transition: width 0.3s cubic-bezier(0.25, 0.9, 0.3, 1), margin-right 0.3s cubic-bezier(0.25, 0.9, 0.3, 1), opacity 0.2s ease;
}

.input-panel.open {
  width: 128px;
  margin-right: 8px;
  opacity: 1;
}

.input-panel-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 128px;
}

.panel-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-border-light);
  border: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
  border-radius: 50%;
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 80%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
}

.panel-btn:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.panel-btn:active {
  transform: scale(0.94);
}

/* 输入条：浮在背景上方的玻璃质感 */
.chat-input-bar {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 10px 10px 10px 18px;
  background: var(--color-surface);
  background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--color-border-light);
  border: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
  border-radius: var(--radius-lg);
  box-shadow:
    0 10px 28px -8px rgba(16, 24, 40, 0.12),
    0 2px 8px rgba(16, 24, 40, 0.05);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.chat-input-bar:focus-within {
  border-color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
  box-shadow:
    0 12px 32px -8px rgba(16, 24, 40, 0.12),
    0 2px 8px rgba(16, 24, 40, 0.06);
  box-shadow:
    0 12px 32px -8px color-mix(in srgb, var(--color-primary) 30%, transparent),
    0 2px 8px rgba(16, 24, 40, 0.06);
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
  background: color-mix(in srgb, var(--color-surface) 92%, transparent);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--color-border-light);
  border: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
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

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 4px 12px;
  background: var(--color-warning-light);
  color: var(--color-warning);
  border: 1px solid var(--color-warning);
  border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.15s ease;
}

.retry-btn:hover {
  background: var(--color-warning-light);
  background: color-mix(in srgb, var(--color-warning) 20%, var(--color-warning-light));
}

.retry-btn:active {
  transform: scale(0.96);
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

  .session-dropdown {
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

  .chat-input-zone {
    width: calc(100% - 16px);
    margin-bottom: 8px;
  }

  .chat-input-bar {
    padding: 8px 8px 8px 14px;
    gap: 6px;
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

  .input-panel.open {
    width: 108px;
  }

  .input-panel-inner {
    width: 108px;
    gap: 6px;
  }

  .panel-btn {
    width: 32px;
    height: 32px;
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
