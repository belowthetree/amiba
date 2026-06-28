// ============================================================
// 变形虫 (Amiba) — Session 会话管理
// ============================================================
// 统一管理聊天会话状态：消息列表、轮次计数、历史持久化。
// ChatPage、commands、agent 均通过此模块读写会话。
// ============================================================
import { ref, type Ref } from 'vue'
import { storageGetJSON, storageSetJSON } from '../config/storage'
import { invalidateSystemPrompt, setMemoryCheckpointFromCache } from './system-prompt'

const HISTORY_KEY = 'amiba_chat_history'

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 是否在界面中隐藏（系统消息/命令结果等杂项） */
  hidden?: boolean
}

export interface SessionState {
  messages: Ref<Message[]>
  turnCount: Ref<number>
  sending: Ref<boolean>
  streaming: Ref<boolean>
  streamingContent: Ref<string>
  errorMessage: Ref<string>
}

/** 全局单例 */
let _session: SessionState | null = null

export function getSession(): SessionState {
  if (!_session) {
    _session = {
      messages: ref<Message[]>([]),
      turnCount: ref(0),
      sending: ref(false),
      streaming: ref(false),
      streamingContent: ref(''),
      errorMessage: ref(''),
    }
  }
  return _session
}

// ---- 持久化 ----

export async function loadHistory(): Promise<void> {
  const session = getSession()
  const saved = await storageGetJSON<Message[]>(HISTORY_KEY)
  if (saved && Array.isArray(saved)) {
    session.messages.value = saved.slice(-50)
    session.turnCount.value = session.messages.value.filter(
      (m) => m.role === 'user'
    ).length
  }
}

export async function saveHistory(): Promise<void> {
  const session = getSession()
  await storageSetJSON(HISTORY_KEY, session.messages.value.slice(-50))
}

// ---- Session 生命周期 ----

/** 开始新会话 */
export async function newSession(): Promise<string> {
  const session = getSession()

  // 捕获最后一段对话作为记忆检查点
  const visibleMessages = session.messages.value.filter((m) => !m.hidden)
  if (visibleMessages.length > 0) {
    const lastMessages = visibleMessages.slice(-12) // 最近 6 轮对话
    const checkpoint = lastMessages
      .map((m) => `[${m.role === 'user' ? '用户' : 'AI'}]: ${m.content.slice(0, 200)}`)
      .join('\n')
    // 通过缓存传递（避免跨模块异步依赖）
    setMemoryCheckpointFromCache(checkpoint)
  }

  session.messages.value = []
  session.turnCount.value = 0
  session.streamingContent.value = ''
  session.errorMessage.value = ''

  await storageSetJSON(HISTORY_KEY, [])

  invalidateSystemPrompt()
  const { buildSystemPrompt } = await import('./system-prompt')
  buildSystemPrompt({ force: true })

  return '已开始新会话。系统提示已重建。如有重要信息，AI 会自动保存到记忆。'
}

/** 添加一条用户消息并增加轮次 */
export function addUserMessage(content: string): void {
  const session = getSession()
  session.messages.value.push({ role: 'user', content })
  session.turnCount.value++
}

/** 添加一条 AI 回复 */
export function addAssistantMessage(content: string): void {
  getSession().messages.value.push({ role: 'assistant', content })
}

/** 添加一条系统消息（隐藏，记录但不显示） */
export function addSystemMessage(content: string): void {
  getSession().messages.value.push({ role: 'system', content, hidden: true })
}

/** 设置错误（3 秒后自动清除） */
export function flashError(msg: string): void {
  const session = getSession()
  session.errorMessage.value = msg
  setTimeout(() => {
    if (session.errorMessage.value === msg) {
      session.errorMessage.value = ''
    }
  }, 3000)
}

/** 获取可见消息（过滤隐藏的系统消息等杂项） */
export function getVisibleMessages(): Message[] {
  return getSession().messages.value.filter((m) => !m.hidden)
}
