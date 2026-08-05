import { relationalStore } from '@kit.ArkData'
import { common } from '@kit.AbilityKit'

const TAG = '[AmibaDb]'
const DB_NAME = 'amiba_state.db'

// 会话库 8 命令（对应 Tauri Rust 侧 src-tauri/src/db.rs；FTS5 缺口按 docs/harmonyos-migration.md §6.1 方案a 退化为 LIKE）
export const DB_COMMANDS: string[] = [
  'search_sessions',
  'index_message',
  'index_message_batch',
  'get_session',
  'list_sessions_cmd',
  'delete_session_cmd',
  'scroll_session',
  'read_session_cmd'
]

// ---- 线协议返回类型（与 src/config/session-db.ts / db.rs serde 结构对齐）----
interface MessageRow {
  id: number
  role: string
  content: string
  timestamp: number
  tool_name: string | null
  anchor: boolean
}

interface SessionMeta {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

interface SearchResult {
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

interface SessionRead {
  session_id: string
  session_meta: SessionMeta
  message_count: number
  truncated: boolean
  messages: MessageRow[]
}

// 搜索命中行（LIKE 退化：仅收集去重/snippet 所需字段）
interface SearchHit {
  sessionId: string
  messageId: number
  content: string
}

// ---- Schema（对齐 db.rs：去掉 messages_fts 虚拟表与三个触发器，鸿蒙内置 SQLite 无 FTS5）----
const CREATE_SCHEMA_VERSION_SQL: string =
  'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)'

const CREATE_SESSIONS_SQL: string =
  'CREATE TABLE IF NOT EXISTS sessions (' +
  'id TEXT PRIMARY KEY, ' +
  "title TEXT NOT NULL DEFAULT 'New Chat', " +
  'created_at TEXT NOT NULL, ' +
  'updated_at TEXT NOT NULL, ' +
  'message_count INTEGER DEFAULT 0)'

const CREATE_MESSAGES_SQL: string =
  'CREATE TABLE IF NOT EXISTS messages (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
  'session_id TEXT NOT NULL REFERENCES sessions(id), ' +
  'role TEXT NOT NULL, ' +
  'content TEXT, ' +
  'tool_calls TEXT, ' +
  'tool_name TEXT, ' +
  'timestamp REAL NOT NULL, ' +
  'active INTEGER NOT NULL DEFAULT 1)'

const CREATE_IDX_SESSION_SQL: string =
  'CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)'

const CREATE_IDX_SESSION_ACTIVE_SQL: string =
  'CREATE INDEX IF NOT EXISTS idx_messages_session_active ON messages(session_id, active, id)'

let store: relationalStore.RdbStore | null = null

// 由 EntryAbility.onCreate 调用（内部自行捕获异常并记日志，不会 reject）
export async function initDb(context: common.UIAbilityContext): Promise<void> {
  try {
    const config: relationalStore.StoreConfig = {
      name: DB_NAME,
      securityLevel: relationalStore.SecurityLevel.S1
    }
    const s = await relationalStore.getRdbStore(context, config)
    await s.executeSql(CREATE_SCHEMA_VERSION_SQL)
    await s.executeSql(CREATE_SESSIONS_SQL)
    await s.executeSql(CREATE_MESSAGES_SQL)
    await s.executeSql(CREATE_IDX_SESSION_SQL)
    await s.executeSql(CREATE_IDX_SESSION_ACTIVE_SQL)
    await s.executeSql('INSERT OR REPLACE INTO schema_version (version) VALUES (1)')
    store = s
    console.log(`${TAG} ✓ 会话库已打开: ${DB_NAME}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ 会话库初始化失败: ${msg}`)
  }
}

function reqStore(): relationalStore.RdbStore {
  if (!store) {
    throw new Error('会话库未初始化')
  }
  return store
}

// ---- 参数提取（风格同 FsCommands）----
function reqStr(v: Object | undefined, name: string): string {
  if (typeof v !== 'string' || (v as string).length === 0) {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

function optStr(v: Object | undefined): string | null {
  return typeof v === 'string' ? (v as string) : null
}

function reqNum(v: Object | undefined, name: string): number {
  if (typeof v !== 'number') {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as number
}

function optNum(v: Object | undefined, dft: number): number {
  return typeof v === 'number' ? (v as number) : dft
}

// 允许空串（消息 content 可为空，如纯工具调用消息）
function reqStrAllowEmpty(v: Object | undefined, name: string): string {
  if (typeof v !== 'string') {
    throw new Error(`缺少参数: ${name}`)
  }
  return v as string
}

// ---- 时间辅助 ----
// ISO 8601 UTC 秒级时间戳（与 db.rs chrono_now 输出格式一致）
function nowIso(): string {
  const d = new Date()
  const p = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}

// Unix 秒（REAL，含小数，与 db.rs as_secs_f64 一致）
function nowSecs(): number {
  return Date.now() / 1000
}

// ---- 搜索辅助（FTS5 缺口退化，§6.1 方案a）----
// 与 db.rs sanitize_fts5_query 一致：FTS5 特殊字符替换为空格
function sanitizeQuery(query: string): string {
  const specials = '"()^~@:&|!'
  let out = ''
  for (const ch of query) {
    out += specials.indexOf(ch) >= 0 ? ' ' : ch
  }
  return out.trim()
}

// LIKE 通配符转义（ESCAPE '!'）
function escapeLike(s: string): string {
  return s.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')
}

// 关键词上下文窗口截取，模拟 FTS5 snippet()：<mark> 包裹 + '…' 省略号，前后各约 40 字符
function makeSnippet(content: string, tokens: string[]): string {
  const lower = content.toLowerCase()
  for (const tok of tokens) {
    const idx = lower.indexOf(tok.toLowerCase())
    if (idx < 0) {
      continue
    }
    const start = Math.max(0, idx - 40)
    const end = Math.min(content.length, idx + tok.length + 40)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < content.length ? '…' : ''
    const before = content.substring(start, idx)
    const hit = content.substring(idx, idx + tok.length)
    const after = content.substring(idx + tok.length, end)
    return `${prefix}${before}<mark>${hit}</mark>${after}${suffix}`
  }
  // 仅 tool_name 命中（FTS 索引含 tool_name，snippet 列只取 content）：退化为开头截断
  return content.length > 80 ? `${content.substring(0, 80)}…` : content
}

// ---- ResultSet 读取 ----
function readMessageRows(rs: relationalStore.ResultSet, anchorId: number): MessageRow[] {
  const idxId = rs.getColumnIndex('id')
  const idxRole = rs.getColumnIndex('role')
  const idxContent = rs.getColumnIndex('content')
  const idxTs = rs.getColumnIndex('timestamp')
  const idxTool = rs.getColumnIndex('tool_name')
  const rows: MessageRow[] = []
  while (rs.goToNextRow()) {
    const id = rs.getLong(idxId)
    const row: MessageRow = {
      id: id,
      role: rs.getString(idxRole),
      content: rs.isColumnNull(idxContent) ? '' : rs.getString(idxContent),
      timestamp: rs.getDouble(idxTs),
      tool_name: rs.isColumnNull(idxTool) ? null : rs.getString(idxTool),
      anchor: id === anchorId
    }
    rows.push(row)
  }
  return rows
}

function readSessionMeta(rs: relationalStore.ResultSet): SessionMeta | null {
  if (!rs.goToNextRow()) {
    return null
  }
  const meta: SessionMeta = {
    id: rs.getString(rs.getColumnIndex('id')),
    title: rs.getString(rs.getColumnIndex('title')),
    created_at: rs.getString(rs.getColumnIndex('created_at')),
    updated_at: rs.getString(rs.getColumnIndex('updated_at')),
    message_count: rs.getLong(rs.getColumnIndex('message_count'))
  }
  return meta
}

async function queryMessages(s: relationalStore.RdbStore, sql: string,
  args: relationalStore.ValueType[], anchorId: number): Promise<MessageRow[]> {
  const rs = await s.querySql(sql, args)
  try {
    return readMessageRows(rs, anchorId)
  } finally {
    rs.close()
  }
}

async function querySessionMeta(s: relationalStore.RdbStore, sessionId: string): Promise<SessionMeta | null> {
  const rs = await s.querySql(
    'SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE id = ?',
    [sessionId])
  try {
    return readSessionMeta(rs)
  } finally {
    rs.close()
  }
}

async function countAround(s: relationalStore.RdbStore, sessionId: string,
  anchorId: number, before: boolean): Promise<number> {
  const cmp = before ? '<' : '>'
  const rs = await s.querySql(
    `SELECT COUNT(*) AS c FROM messages WHERE session_id = ? AND active = 1 AND id ${cmp} ?`,
    [sessionId, anchorId])
  try {
    return rs.goToNextRow() ? rs.getLong(rs.getColumnIndex('c')) : 0
  } finally {
    rs.close()
  }
}

// anchor ±window 消息窗口（anchorId <= 0 时无 anchor 标记）
async function getMessageWindow(s: relationalStore.RdbStore, sessionId: string,
  anchorId: number, window: number): Promise<MessageRow[]> {
  return queryMessages(s,
    'SELECT id, role, COALESCE(content, \'\') AS content, timestamp, tool_name FROM messages ' +
    'WHERE session_id = ? AND active = 1 AND id BETWEEN ? AND ? ORDER BY id',
    [sessionId, anchorId - window, anchorId + window], anchorId)
}

// ---- 命令实现 ----
async function cmdSearch(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const query = reqStr(args['query'], 'query')
  const limit = optNum(args['limit'], 5)
  const sanitized = sanitizeQuery(query)
  if (sanitized.length === 0) {
    return '[]'
  }
  // FTS5 对多词是隐式 AND：拆 token 后逐词 LIKE AND，语义最接近 unicode61 行为
  const tokens = sanitized.split(/\s+/).filter((t: string) => t.length > 0).slice(0, 8)
  const conditions: string[] = []
  const bindArgs: relationalStore.ValueType[] = []
  for (const tok of tokens) {
    const pat = `%${escapeLike(tok)}%`
    // FTS 索引内容为 content || ' ' || tool_name，故两列都参与匹配
    conditions.push("(m.content LIKE ? ESCAPE '!' OR m.tool_name LIKE ? ESCAPE '!')")
    bindArgs.push(pat)
    bindArgs.push(pat)
  }
  const sql = 'SELECT m.session_id, m.id, COALESCE(m.content, \'\') AS content FROM messages m ' +
    `WHERE m.active = 1 AND ${conditions.join(' AND ')} ` +
    'ORDER BY m.timestamp DESC, m.id DESC LIMIT ?'
  // rank 无对应物：时间倒序代替（§6.1）；取 limit*3 留出去重余量
  bindArgs.push(limit * 3)

  const hits: SearchHit[] = []
  const rs = await s.querySql(sql, bindArgs)
  try {
    const idxSid = rs.getColumnIndex('session_id')
    const idxId = rs.getColumnIndex('id')
    const idxContent = rs.getColumnIndex('content')
    while (rs.goToNextRow()) {
      const hit: SearchHit = {
        sessionId: rs.getString(idxSid),
        messageId: rs.getLong(idxId),
        content: rs.getString(idxContent)
      }
      hits.push(hit)
    }
  } finally {
    rs.close()
  }

  // 按 session 去重（时间倒序下首个命中即该会话最新匹配），与 Rust 侧「每 session 取最佳匹配」对应
  const results: SearchResult[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    if (seen.has(hit.sessionId)) {
      continue
    }
    seen.add(hit.sessionId)
    const meta = await querySessionMeta(s, hit.sessionId)
    const window = await getMessageWindow(s, hit.sessionId, hit.messageId, 5)
    const bookendStart = await queryMessages(s,
      'SELECT id, role, COALESCE(content, \'\') AS content, timestamp, tool_name FROM messages ' +
      "WHERE session_id = ? AND active = 1 AND role IN ('user', 'assistant') ORDER BY id LIMIT 3",
      [hit.sessionId], 0)
    const bookendEnd = await queryMessages(s,
      'SELECT id, role, COALESCE(content, \'\') AS content, timestamp, tool_name FROM messages ' +
      "WHERE session_id = ? AND active = 1 AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT 3",
      [hit.sessionId], 0)
    bookendEnd.reverse()
    const before = await countAround(s, hit.sessionId, hit.messageId, true)
    const after = await countAround(s, hit.sessionId, hit.messageId, false)
    const r: SearchResult = {
      session_id: hit.sessionId,
      session_title: meta ? meta.title : 'Unknown',
      snippet: makeSnippet(hit.content, tokens),
      match_message_id: hit.messageId,
      messages_before: before,
      messages_after: after,
      window: window,
      bookend_start: bookendStart,
      bookend_end: bookendEnd
    }
    results.push(r)
    if (results.length >= limit) {
      break
    }
  }
  return JSON.stringify(results)
}

async function cmdIndexMessage(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const sessionId = reqStr(args['sessionId'], 'sessionId')
  const role = reqStr(args['role'], 'role')
  const content = reqStrAllowEmpty(args['content'], 'content')
  const toolCalls = optStr(args['toolCalls'])
  const toolName = optStr(args['toolName'])

  // 确保 session 行存在（INSERT OR IGNORE，与 db.rs 一致）
  const now = nowIso()
  const sessionVb: relationalStore.ValuesBucket = {
    'id': sessionId,
    'title': 'Imported Chat',
    'created_at': now,
    'updated_at': now,
    'message_count': 0
  }
  await s.insert('sessions', sessionVb, relationalStore.ConflictResolution.ON_CONFLICT_IGNORE)

  const msgVb: relationalStore.ValuesBucket = {
    'session_id': sessionId,
    'role': role,
    'content': content,
    'tool_calls': toolCalls,
    'tool_name': toolName,
    'timestamp': nowSecs()
  }
  // db.rs 为普通 INSERT（自增 id），返回 last_insert_rowid
  const rowId = await s.insert('messages', msgVb)
  return rowId.toString()
}

async function cmdIndexMessageBatch(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const sessionId = reqStr(args['sessionId'], 'sessionId')
  const raw = args['messages']
  if (!(raw instanceof Array)) {
    throw new Error('缺少参数: messages')
  }

  const now = nowIso()
  const sessionVb: relationalStore.ValuesBucket = {
    'id': sessionId,
    'title': 'Imported Chat',
    'created_at': now,
    'updated_at': now,
    'message_count': 0
  }
  await s.insert('sessions', sessionVb, relationalStore.ConflictResolution.ON_CONFLICT_IGNORE)

  // 幂等重写：先删后插（与 db.rs index_messages_batch 一致）
  await s.executeSql('DELETE FROM messages WHERE session_id = ?', [sessionId])
  const baseTs = nowSecs()
  const msgs = raw as Object[]
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] as Record<string, Object>
    const msgVb: relationalStore.ValuesBucket = {
      'session_id': sessionId,
      'role': optStr(m['role']) ?? 'unknown',
      'content': optStr(m['content']) ?? '',
      'tool_calls': optStr(m['tool_calls']),
      'tool_name': optStr(m['tool_name']),
      'timestamp': baseTs + i * 0.001
    }
    await s.insert('messages', msgVb)
  }
  return 'ok'
}

async function cmdGetSession(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const sessionId = reqStr(args['sessionId'], 'sessionId')
  const meta = await querySessionMeta(s, sessionId)
  // Rust 序列化 Option<SessionMeta>：不存在时为 'null'
  return meta ? JSON.stringify(meta) : 'null'
}

async function cmdListSessions(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const limit = optNum(args['limit'], 50)
  const excludeId = optStr(args['excludeId'])
  const sessions: SessionMeta[] = []
  let rs: relationalStore.ResultSet
  if (excludeId !== null) {
    rs = await s.querySql(
      'SELECT id, title, created_at, updated_at, message_count FROM sessions ' +
      'WHERE id != ? ORDER BY updated_at DESC LIMIT ?',
      [excludeId, limit])
  } else {
    rs = await s.querySql(
      'SELECT id, title, created_at, updated_at, message_count FROM sessions ORDER BY updated_at DESC LIMIT ?',
      [limit])
  }
  try {
    while (true) {
      const meta = readSessionMeta(rs)
      if (!meta) {
        break
      }
      sessions.push(meta)
    }
  } finally {
    rs.close()
  }
  return JSON.stringify(sessions)
}

async function cmdDeleteSession(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const sessionId = reqStr(args['sessionId'], 'sessionId')
  await s.executeSql('DELETE FROM messages WHERE session_id = ?', [sessionId])
  await s.executeSql('DELETE FROM sessions WHERE id = ?', [sessionId])
  return 'ok'
}

async function cmdScrollSession(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const sessionId = reqStr(args['sessionId'], 'sessionId')
  const aroundMessageId = reqNum(args['aroundMessageId'], 'aroundMessageId')
  // 窗口钳制 [1, 20]（与 db.rs scroll 一致）
  const w = Math.max(1, Math.min(20, optNum(args['window'], 5)))
  const rows = await getMessageWindow(s, sessionId, aroundMessageId, w)
  return JSON.stringify(rows)
}

async function cmdReadSession(s: relationalStore.RdbStore, args: Record<string, Object>): Promise<string> {
  const sessionId = reqStr(args['sessionId'], 'sessionId')
  const head = optNum(args['head'], 20)
  const tail = optNum(args['tail'], 10)

  const found = await querySessionMeta(s, sessionId)
  const meta: SessionMeta = found ?? {
    id: sessionId,
    title: 'Unknown',
    created_at: '',
    updated_at: '',
    message_count: 0
  }
  const all = await queryMessages(s,
    'SELECT id, role, COALESCE(content, \'\') AS content, timestamp, tool_name FROM messages ' +
    'WHERE session_id = ? AND active = 1 ORDER BY id',
    [sessionId], 0)

  const total = all.length
  const truncated = total > head + tail
  let window: MessageRow[]
  if (truncated) {
    window = all.slice(0, head)
    window.push(...all.slice(total - tail))
  } else {
    window = all
  }
  const r: SessionRead = {
    session_id: sessionId,
    session_meta: meta,
    message_count: total,
    truncated: truncated,
    messages: window
  }
  return JSON.stringify(r)
}

// ---- 命令入口 ----
// 返回值与 db.rs 的 Result<String, String> 对齐：数据命令返回 JSON 字符串
// （前端 session-db.ts 对 nativeInvoke 结果再 JSON.parse 一次），写命令返回 'ok'/行 id 字符串。
export async function handleDbCommand(cmd: string, args: Record<string, Object>): Promise<Object | null> {
  try {
    const s = reqStore()
    switch (cmd) {
      case 'search_sessions':
        return await cmdSearch(s, args)
      case 'index_message':
        return await cmdIndexMessage(s, args)
      case 'index_message_batch':
        return await cmdIndexMessageBatch(s, args)
      case 'get_session':
        return await cmdGetSession(s, args)
      case 'list_sessions_cmd':
        return await cmdListSessions(s, args)
      case 'delete_session_cmd':
        return await cmdDeleteSession(s, args)
      case 'scroll_session':
        return await cmdScrollSession(s, args)
      case 'read_session_cmd':
        return await cmdReadSession(s, args)
      default:
        throw new Error(`未知 db 命令: ${cmd}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ ${cmd} 失败: ${msg}`)
    // ArkTS 限制 throw 只能抛 Error：统一重抛 Error 实例
    throw new Error(msg)
  }
}
