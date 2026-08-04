// ============================================================
// 变形虫 (Amiba) — SessionDB 前端封装（Tauri invoke → Rust SQLite）
// ============================================================
// 借鉴 Hermes session_search_tool.py 的四模式设计：
//   DISCOVERY — query → FTS5 搜索
//   SCROLL    — session_id + around_message_id → 翻页窗口
//   READ      — session_id only → 全量读取
//   BROWSE    — 无参 → 最近会话列表
// ============================================================

import type { Message } from '../ai/session'
import { isTauriRuntime } from './platform-bridge'

// ---- Rust 端返回类型 ----

export interface MessageRow {
  id: number
  role: string
  content: string
  timestamp: number
  tool_name?: string
  anchor?: boolean
}

export interface SearchResult {
  session_id: string
  session_title: string
  snippet: string
  match_message_id: number
  messages_before: number
  messages_after: number
  window: MessageRow[]
  bookend_start: MessageRow[]
  bookend_end: MessageRow[]
}

export interface SessionMeta {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface SessionRead {
  session_id: string
  session_meta: SessionMeta
  message_count: number
  truncated: boolean
  messages: MessageRow[]
}

// ---- 检测 Tauri 环境 ----

let _tauriAvailable: boolean | null = null

async function isTauri(): Promise<boolean> {
  if (_tauriAvailable !== null) return _tauriAvailable
  _tauriAvailable = isTauriRuntime()
  return _tauriAvailable
}

// ---- API ----

export async function searchSessions(
  query: string,
  limit: number = 5,
): Promise<SearchResult[]> {
  if (!(await isTauri())) return []
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    const raw = await nativeInvoke<string>('search_sessions', { query, limit })
    return JSON.parse(raw)
  } catch (e) {
    console.error('[SessionDB] search failed:', e)
    return []
  }
}

export async function indexMessage(
  sessionId: string,
  role: string,
  content: string,
  toolCalls?: string,
  toolName?: string,
): Promise<void> {
  if (!(await isTauri())) return
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    await nativeInvoke('index_message', {
      sessionId,
      role,
      content,
      toolCalls: toolCalls || null,
      toolName: toolName || null,
    })
  } catch (e) {
    console.error('[SessionDB] indexMessage failed:', e)
  }
}

export async function indexMessageBatch(
  sessionId: string,
  messages: Message[],
): Promise<void> {
  if (!(await isTauri())) return
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    const msgs = messages.map((m) => ({
      role: m.role,
      content: m.content || '',
      tool_calls: (m as any).tool_calls ? JSON.stringify((m as any).tool_calls) : null,
      tool_name: m.toolName || ((m as any).tool_call_id ? `tool:${(m as any).tool_call_id}` : null),
    }))
    await nativeInvoke('index_message_batch', { sessionId, messages: msgs })
  } catch (e) {
    console.error('[SessionDB] indexMessageBatch failed:', e)
  }
}

export async function getSession(sessionId: string): Promise<SessionMeta | null> {
  if (!(await isTauri())) return null
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    const raw = await nativeInvoke<string>('get_session', { sessionId })
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function listSessions(
  limit: number = 50,
  excludeId?: string,
): Promise<SessionMeta[]> {
  if (!(await isTauri())) return []
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    const raw = await nativeInvoke<string>('list_sessions_cmd', {
      limit,
      excludeId: excludeId || null,
    })
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (!(await isTauri())) return
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    await nativeInvoke('delete_session_cmd', { sessionId })
  } catch (e) {
    console.error('[SessionDB] deleteSession failed:', e)
  }
}

export async function scrollSession(
  sessionId: string,
  aroundMessageId: number,
  window: number = 5,
): Promise<MessageRow[]> {
  if (!(await isTauri())) return []
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    const raw = await nativeInvoke<string>('scroll_session', {
      sessionId,
      aroundMessageId,
      window,
    })
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export async function readSession(
  sessionId: string,
  head: number = 20,
  tail: number = 10,
): Promise<SessionRead | null> {
  if (!(await isTauri())) return null
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    const raw = await nativeInvoke<string>('read_session_cmd', { sessionId, head, tail })
    return JSON.parse(raw)
  } catch {
    return null
  }
}
