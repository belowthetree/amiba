// ============================================================
// 变形虫 (Amiba) — Session Search 工具（SQLite FTS5 后端）
// ============================================================
// 借鉴 Hermes session_search_tool.py 的四模式设计：
//   DISCOVERY — query → FTS5 搜索，返回窗口 + 片段 + bookends
//   SCROLL    — session_id + around_message_id → 翻页
//   READ      — session_id only → 全量读取（head+tail 截断）
//   BROWSE    — 无参 → 最近会话列表
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  searchSessions,
  readSession,
  scrollSession,
  listSessions,
  type SearchResult,
} from '../config/session-db'

// ---- 搜索参数 ----

interface SessionSearchParams {
  query?: string
  limit?: number
  session_id?: string
  around_message_id?: number
  window?: number
  sort?: 'newest' | 'oldest'
}

// ---- 工具注册 ----

toolRegistry.register({
  name: 'session_search',
  toolset: 'core',
  emoji: '🔍',
  description:
    '搜索历史会话（SQLite FTS5 全文索引）。四种模式：传 query 搜索、传 session_id+around_message_id 翻页、仅传 session_id 全量读取、无参浏览最近会话。',
  maxResultSizeChars: 6000,
  schema: {
    type: 'function',
    function: {
      name: 'session_search',
      description:
        '搜索或浏览历史会话记录。FTS5 全文索引，无需 LLM 调用。四种模式：\n' +
        '1) DISCOVERY：传 query → 返回匹配片段 + 上下文窗口 + 会话首尾摘要\n' +
        '2) SCROLL：传 session_id + around_message_id → 翻页查看更多上下文\n' +
        '3) READ：仅传 session_id → 读取整个会话（大会话截断首尾）\n' +
        '4) BROWSE：无参 → 最近会话列表\n\n' +
        'SOURCE-FIRST 原则：此工具仅搜索 Hermes/Amiba 对话历史。如果用户提供了直接来源（URL、文件路径、应用等），优先检查原始来源。将 session_search 作为辅助上下文。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词（DISCOVERY 模式）。支持多个词（空格分隔）、AND/OR/NOT 布尔操作、引号短语。',
          },
          limit: {
            type: 'number',
            description: 'DISCOVERY 模式：返回最多会话数（默认 3，最大 10）。BROWSE 模式也生效。',
          },
          session_id: {
            type: 'string',
            description: 'SCROLL/READ 模式：目标会话 ID。在 DISCOVERY 结果中获取。',
          },
          around_message_id: {
            type: 'number',
            description: 'SCROLL 模式：锚定消息 ID。从 DISCOVERY 结果的 match_message_id 获取，或用窗口首/尾消息 id 翻页。',
          },
          window: {
            type: 'number',
            description: 'SCROLL 模式：锚点两侧各返回多少条消息（默认 5，范围 1-20）。',
          },
          sort: {
            type: 'string',
            enum: ['newest', 'oldest'],
            description: 'DISCOVERY 模式：时间偏向。newest=最近优先，oldest=最早优先。默认仅按 BM25 相关性排序。',
          },
        },
        required: [],
      },
    },
  },
  handler: async (args) => {
    const params = args as unknown as SessionSearchParams
    return handleSessionSearch(params)
  },
})

// ---- 处理逻辑 ----

async function handleSessionSearch(params: SessionSearchParams): Promise<string> {
  const { query, limit = 3, session_id, around_message_id, window = 5, sort } = params

  const effectiveLimit = Math.min(Math.max(1, limit), 10)

  // SCROLL 模式（session_id + around_message_id 同时存在）
  if (session_id && around_message_id !== undefined) {
    const messages = await scrollSession(session_id, around_message_id, window)
    if (!messages.length) {
      return `未找到消息。session_id: "${session_id}", around_message_id: ${around_message_id}`
    }
    return formatScroll(messages, session_id, around_message_id, window)
  }

  // READ 模式（仅 session_id）
  if (session_id && around_message_id === undefined) {
    const session = await readSession(session_id)
    if (!session) {
      return `未找到 session "${session_id}"。`
    }
    return formatRead(session)
  }

  // DISCOVERY 模式（有 query）
  if (query && query.trim()) {
    const results = await searchSessions(query.trim(), effectiveLimit)
    if (!results.length) {
      return `未找到包含 "${query}" 的对话记录。`
    }
    return formatDiscovery(results, query, effectiveLimit, sort)
  }

  // BROWSE 模式（无参）
  const sessions = await listSessions(effectiveLimit)
  if (!sessions.length) {
    return '没有历史会话记录。'
  }
  return formatBrowse(sessions, effectiveLimit)
}

// ---- 格式化 ----

function formatDiscovery(
  results: SearchResult[],
  query: string,
  limit: number,
  sort?: string,
): string {
  let out = `搜索 "${query}" — 找到 ${results.length} 个相关会话：\n\n`

  for (let i = 0; i < Math.min(results.length, limit); i++) {
    const r = results[i]

    out += `## ${i + 1}. ${r.session_title}\n`
    out += `   会话 ID: \`${r.session_id}\` | 匹配消息 #${r.match_message_id}\n`
    out += `   片段: "${r.snippet}"\n`
    out += `   上下文: 匹配前 ${r.messages_before} 条, 后 ${r.messages_after} 条\n\n`

    // Bookend: 会话开头
    if (r.bookend_start.length > 0) {
      out += '**会话开始（目标 / 启动）:**\n'
      for (const m of r.bookend_start) {
        out += `  [${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '…' : ''}\n`
      }
      out += '\n'
    }

    // 匹配窗口
    out += `**匹配附近（±5 消息）:**\n`
    for (const m of r.window) {
      const anchor = m.anchor ? ' ⬅️ 匹配' : ''
      out += `  [${m.role}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '…' : ''}${anchor}\n`
    }
    out += '\n'

    // Bookend: 会话结尾
    if (r.bookend_end.length > 0) {
      out += '**会话结尾（决议 / 决定）:**\n'
      for (const m of r.bookend_end) {
        out += `  [${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '…' : ''}\n`
      }
      out += '\n'
    }

    out += `提示: 使用 session_search(session_id="${r.session_id}", around_message_id=${r.match_message_id}) 查看更多上下文。\n\n`
  }

  if (sort === 'newest') out += '（按最近优先排序）\n'
  else if (sort === 'oldest') out += '（按最早优先排序）\n'

  return out
}

function formatScroll(
  messages: { id: number; role: string; content: string; anchor?: boolean }[],
  sessionId: string,
  anchorId: number,
  window: number,
): string {
  let out = `会话 \`${sessionId}\` — 锚点 #${anchorId}，窗口 ±${window}：\n\n`

  for (const m of messages) {
    const marker = m.anchor ? ' ⬅️' : ''
    out += `[#${m.id}] ${m.role}${marker}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}\n\n`
  }

  if (messages.length > 0) {
    const firstId = messages[0].id
    const lastId = messages[messages.length - 1].id
    out += '翻页：'
    if (firstId !== anchorId - window) {
      out += `向前 → around_message_id=${firstId} | `
    }
    if (lastId !== anchorId + window) {
      out += `向后 → around_message_id=${lastId}`
    }
    out += '\n'
  }

  return out
}

function formatRead(session: {
  session_id: string
  session_meta: { title: string; message_count: number }
  truncated: boolean
  messages: { id: number; role: string; content: string }[]
}): string {
  const meta = session.session_meta
  let out = `会话: ${meta.title}\n`
  out += `ID: \`${session.session_id}\` | 消息数: ${meta.message_count}\n`
  if (session.truncated) {
    out += '（已截断：显示开头 20 + 结尾 10 条）\n'
  }
  out += '\n'

  for (const m of session.messages) {
    out += `[#${m.id}] ${m.role}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}\n\n`
  }

  if (session.truncated) {
    out += '提示: 使用 around_message_id 翻页查看中间部分。\n'
  }

  return out
}

function formatBrowse(
  sessions: { id: string; title: string; updated_at: string; message_count: number }[],
  limit: number,
): string {
  let out = `最近 ${Math.min(sessions.length, limit)} 个会话：\n\n`

  for (const s of sessions) {
    const date = s.updated_at ? s.updated_at.slice(0, 10) : 'unknown'
    out += `- **${s.title}** (${s.message_count} 条消息, ${date})\n`
    out += `  ID: \`${s.id}\`\n`
  }

  out += '\n提示: 传 query= 搜索，或 session_id= 读取特定会话。'
  return out
}
