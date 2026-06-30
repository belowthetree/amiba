// ============================================================
// 变形虫 (Amiba) — Session 会话管理 v2（多 session）
// ============================================================
// 支持多个独立会话，每个会话独立存储历史。
// ChatPage、commands、agent 均通过此模块读写会话。
// ============================================================
import { ref, type Ref } from 'vue'
import { storageGetJSON, storageSetJSON } from '../config/storage'
import { invalidateSystemPrompt, setMemoryCheckpointFromCache } from './system-prompt'

// ---- 存储路径 ----

const SESSIONS_DIR = 'sessions'
const INDEX_KEY = `${SESSIONS_DIR}/_index`
const HISTORY_KEY_PREFIX = `${SESSIONS_DIR}/`

// ---- 类型 ----

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  hidden?: boolean
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: string   // ISO 8601
  updatedAt: string   // ISO 8601
  messageCount: number
}

export interface SessionState {
  messages: Ref<Message[]>
  turnCount: Ref<number>
  sending: Ref<boolean>
  streaming: Ref<boolean>
  streamingContent: Ref<string>
  errorMessage: Ref<string>
}

// ---- 全局状态 ----

let _session: SessionState | null = null
let _currentId: string | null = null

/** 生成短 ID（时间戳 + 随机） */
function genId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${ts}${rand}`
}

/** 根据标题生成简短摘要 */
function guessTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && !m.hidden)
  if (firstUser) {
    const t = firstUser.content.replace(/\n/g, ' ').trim()
    return t.length > 30 ? t.slice(0, 30) + '…' : t
  }
  return '新对话'
}

// ---- Session 索引 ----

async function loadIndex(): Promise<SessionMeta[]> {
  const raw = await storageGetJSON<SessionMeta[]>(INDEX_KEY)
  return Array.isArray(raw) ? raw : []
}

async function saveIndex(metas: SessionMeta[]): Promise<void> {
  await storageSetJSON(INDEX_KEY, metas)
}

async function addToIndex(meta: SessionMeta): Promise<void> {
  const metas = await loadIndex()
  // 去重：替换同 ID
  const idx = metas.findIndex((m) => m.id === meta.id)
  if (idx >= 0) metas[idx] = meta
  else metas.unshift(meta)
  await saveIndex(metas)
}

async function removeFromIndex(id: string): Promise<void> {
  const metas = await loadIndex()
  await saveIndex(metas.filter((m) => m.id !== id))
}

// ---- Session 持久化 ----

function historyKey(id: string): string {
  return `${HISTORY_KEY_PREFIX}${id}`
}

async function loadMessages(id: string): Promise<Message[]> {
  const msgs = await storageGetJSON<Message[]>(historyKey(id))
  return Array.isArray(msgs) ? msgs : []
}

async function saveMessages(id: string, messages: Message[]): Promise<void> {
  // 只保留最近 100 条
  const trimmed = messages.slice(-100)
  const errors: string[] = []

  // 1. JSON 文件保存（主路径）
  try {
    await storageSetJSON(historyKey(id), trimmed)
  } catch (e) {
    errors.push(`json_save: ${e}`)
  }

  // 2. SQLite FTS5 索引（独立 try/catch，借鉴 Hermes turn_finalizer.py）
  try {
    const { indexMessageBatch } = await import('../config/session-db')
    await indexMessageBatch(id, trimmed)
  } catch (e) {
    errors.push(`fts5_index: ${e}`)
  }

  // 3. SQLite session meta 同步
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('get_session', { sessionId: id }).catch(() => {})
  } catch { /* best-effort */ }

  if (errors.length > 0) {
    console.warn('[Session] 持久化警告:', errors.join('; '))
  }
}

async function deleteSessionFile(id: string): Promise<void> {
  // 1. 删除 JSON 文件
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`amiba/${historyKey(id)}`, {
      baseDir: BaseDirectory.AppData,
    }).catch(() => {})
  } catch {
    /* 非 Tauri 环境静默 */
  }

  // 2. 删除 SQLite 记录
  try {
    const { deleteSession } = await import('../config/session-db')
    await deleteSession(id)
  } catch {
    /* best-effort */
  }
}

// ---- 公共 API ----

/** 获取当前 SessionState（懒初始化） */
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

/** 获取当前 session ID */
export function getCurrentSessionId(): string | null {
  return _currentId
}

// ---- Session 生命周期 ----

/** 列出所有 session 元数据 */
export async function listSessions(): Promise<SessionMeta[]> {
  return loadIndex()
}

/** 创建新 session 并切换 */
export async function createSession(title?: string): Promise<SessionMeta> {
  const id = genId()
  const now = new Date().toISOString()
  const meta: SessionMeta = {
    id,
    title: title || '新对话',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  }

  await addToIndex(meta)
  await saveMessages(id, [])
  await switchToSession(id)
  console.log('[Session] ✨ 创建:', id, `"${meta.title}"`)

  return meta
}

/** 切换到指定 session */
export async function switchToSession(id: string): Promise<void> {
  const session = getSession()
  _currentId = id

  const msgs = await loadMessages(id)
  session.messages.value = msgs
  session.turnCount.value = msgs.filter((m) => m.role === 'user').length
  session.streamingContent.value = ''
  session.errorMessage.value = ''

  invalidateSystemPrompt()
  const { buildSystemPrompt } = await import('./system-prompt')
  buildSystemPrompt({ force: true })

  console.log('[Session] 🔄 切换:', id, `(${msgs.length} 条消息)`)
}

/** 删除 session */
export async function deleteSession(id: string): Promise<void> {
  await removeFromIndex(id)
  await deleteSessionFile(id)
  console.log('[Session] 🗑️ 删除:', id)

  // 如果删除的是当前 session，切换到最新的或创建新的
  if (_currentId === id) {
    const metas = await loadIndex()
    if (metas.length > 0) {
      await switchToSession(metas[0].id)
    } else {
      await createSession()
    }
  }
}

/** 重命名 session */
export async function renameSession(id: string, title: string): Promise<void> {
  const metas = await loadIndex()
  const meta = metas.find((m) => m.id === id)
  if (meta) {
    meta.title = title
    await addToIndex(meta)
  }
}

/** 开始新会话（/new 命令） */
export async function newSession(): Promise<string> {
  const session = getSession()
  const oldId = _currentId

  // 捕获记忆检查点
  const visibleMessages = session.messages.value.filter((m) => !m.hidden)
  if (visibleMessages.length > 0) {
    const lastMessages = visibleMessages.slice(-12)
    const checkpoint = lastMessages
      .map((m) => `[${m.role === 'user' ? '用户' : 'AI'}]: ${m.content.slice(0, 200)}`)
      .join('\n')
    setMemoryCheckpointFromCache(checkpoint)
  }

  // 保存当前 session
  if (oldId) {
    await saveMessages(oldId, session.messages.value)
    // 更新标题（用第一条用户消息）
    const firstUser = session.messages.value.find((m) => m.role === 'user' && !m.hidden)
    if (firstUser) {
      const title = firstUser.content.replace(/\n/g, ' ').trim().slice(0, 30)
      await renameSession(oldId, title || '新对话')
    }
    // 更新消息数
    const metas = await loadIndex()
    const meta = metas.find((m) => m.id === oldId)
    if (meta) {
      meta.messageCount = visibleMessages.length
      meta.updatedAt = new Date().toISOString()
      await addToIndex(meta)
    }
  }

  // 创建新 session
  const meta = await createSession()
  _currentId = meta.id

  // 触发 skill 审查（后台异步，不阻塞）
  if (visibleMessages.length >= 5) {
    const settings = (await import('../config/config')).getSettings()
    if ((settings as any).skill_auto_review_enabled ?? true) {
      import('./skill-reviewer').then(({ forkReviewAgent }) => {
        forkReviewAgent(
          visibleMessages.map((m) => ({ role: m.role, content: m.content })),
          'session_end',
        ).then((result) => {
          if (result.ran) {
            console.log(
              `[Session] 🔍 Skill 审查: 创建 ${result.skillsCreated}, ` +
              `修补 ${result.skillsPatched}, 删除 ${result.skillsDeleted}`,
            )
          }
        })
      })
    }
  }

  invalidateSystemPrompt()
  const { buildSystemPrompt } = await import('./system-prompt')
  buildSystemPrompt({ force: true })

  return `已创建新会话「${meta.title}」。`
}

// ---- 历史加载（兼容旧版） ----

const LEGACY_HISTORY_KEY = 'amiba_chat_history'

export async function loadHistory(): Promise<void> {
  const session = getSession()

  // 尝试加载 session 索引
  const metas = await loadIndex()

  if (metas.length > 0) {
    // 有 session 记录：加载最近一个
    const latest = metas[0]
    _currentId = latest.id
    const msgs = await loadMessages(latest.id)
    session.messages.value = msgs
    session.turnCount.value = msgs.filter((m) => m.role === 'user').length
  } else {
    // 尝试迁移旧版单 session 数据
    const legacy = await storageGetJSON<Message[]>(LEGACY_HISTORY_KEY)
    if (legacy && Array.isArray(legacy) && legacy.length > 0) {
      // 迁移：创建第一个 session 并导入旧数据
      const id = genId()
      const now = new Date().toISOString()
      const meta: SessionMeta = {
        id,
        title: guessTitle(legacy),
        createdAt: now,
        updatedAt: now,
        messageCount: legacy.length,
      }
      await addToIndex(meta)
      await saveMessages(id, legacy)
      _currentId = id
      session.messages.value = legacy
      session.turnCount.value = legacy.filter((m) => m.role === 'user').length
      // 清除旧 key
      await storageSetJSON(LEGACY_HISTORY_KEY, null)
      console.log('[Session] 已迁移旧版历史到 session:', id)
    } else {
      // 全新用户：创建默认 session
      const meta = await createSession()
      _currentId = meta.id
    }
  }
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null

export async function saveHistory(): Promise<void> {
  const session = getSession()
  if (!_currentId) return

  // 防抖：300ms 内多次调用只执行最后一次
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(async () => {
    _saveTimer = null
    await saveMessages(_currentId!, session.messages.value)
    console.log('[Session] 💾 保存:', _currentId, `(${session.messages.value.length} 条)`)

    // 同步更新 session 元数据
    const visibleMessages = session.messages.value.filter((m) => !m.hidden)
    const firstUser = session.messages.value.find((m) => m.role === 'user' && !m.hidden)
    const title = firstUser
      ? firstUser.content.replace(/\n/g, ' ').trim().slice(0, 30) || '新对话'
      : '新对话'

    const metas = await loadIndex()
    const meta = metas.find((m) => m.id === _currentId)
    if (meta) {
      meta.messageCount = visibleMessages.length
      meta.updatedAt = new Date().toISOString()
      if (meta.title === '新对话' && title !== '新对话') {
        meta.title = title
      }
      await addToIndex(meta)
    }
  }, 300)
}

/** 立即刷新保存（不防抖，用于切换 session 前） */
export async function flushHistory(): Promise<void> {
  if (_saveTimer) {
    clearTimeout(_saveTimer)
    _saveTimer = null
  }
  const session = getSession()
  if (_currentId) {
    await saveMessages(_currentId, session.messages.value)
    console.log('[Session] 💾 flush:', _currentId, `(${session.messages.value.length} 条)`)
  }
}

// ---- 消息操作 ----

export function addUserMessage(content: string): void {
  const session = getSession()
  session.messages.value.push({ role: 'user', content })
  session.turnCount.value++
}

export function addAssistantMessage(content: string): void {
  getSession().messages.value.push({ role: 'assistant', content })
}

export function addSystemMessage(content: string): void {
  getSession().messages.value.push({ role: 'system', content, hidden: true })
}

export function flashError(msg: string): void {
  const session = getSession()
  session.errorMessage.value = msg
  setTimeout(() => {
    if (session.errorMessage.value === msg) {
      session.errorMessage.value = ''
    }
  }, 3000)
}

export function getVisibleMessages(): Message[] {
  return getSession().messages.value.filter((m) => !m.hidden)
}

/**
 * 中场审查钩子：当对话超过阈值时，后台异步审查前半段。
 * 由 ChatPage 在每轮对话后调用。
 */
let _midReviewTurnCount = 0
export async function maybeMidSessionReview(): Promise<void> {
  const session = getSession()
  const threshold = 20
  if (session.turnCount.value < threshold) return
  if (session.turnCount.value - _midReviewTurnCount < threshold) return

  _midReviewTurnCount = session.turnCount.value
  const settings = (await import('../config/config')).getSettings()
  if (!((settings as any).skill_auto_review_enabled ?? true)) return

  const visibleMessages = session.messages.value
    .filter((m) => !m.hidden)
    .slice(-Math.floor(session.messages.value.length * 0.6)) // 前半段

  import('./skill-reviewer').then(({ forkReviewAgent }) => {
    forkReviewAgent(
      visibleMessages.map((m) => ({ role: m.role, content: m.content })),
      'mid_session',
    ).then((result) => {
      if (result.ran) {
        console.log(`[Session] 🔍 中场审查: 修补 ${result.skillsPatched}`)
      }
    })
  })
}
