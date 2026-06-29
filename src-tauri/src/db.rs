// ============================================================
// 变形虫 (Amiba) — SessionDB: SQLite + FTS5 会话存储
// ============================================================
// 借鉴 Hermes hermes_state.py 的 FTS5 设计，为 Tauri 桌面应用精简。
// 提供：FTS5 全文搜索、消息索引、会话元数据查询、JSON 迁移。
// ============================================================

use rusqlite::{params, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

// ---- Schema ----

const SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    message_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_session_active ON messages(session_id, active, id);
";

const FTS_SQL: &str = "
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (
        new.id,
        COALESCE(new.content, '') || ' ' || COALESCE(new.tool_name, '')
    );
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.id;
    INSERT INTO messages_fts(rowid, content) VALUES (
        new.id,
        COALESCE(new.content, '') || ' ' || COALESCE(new.tool_name, '')
    );
END;
";

// ---- Types ----

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub session_id: String,
    pub session_title: String,
    pub snippet: String,
    pub match_message_id: i64,
    pub messages_before: i64,
    pub messages_after: i64,
    pub window: Vec<MessageRow>,
    pub bookend_start: Vec<MessageRow>,
    pub bookend_end: Vec<MessageRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MessageRow {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub timestamp: f64,
    pub tool_name: Option<String>,
    pub anchor: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionRead {
    pub session_id: String,
    pub session_meta: SessionMeta,
    pub message_count: usize,
    pub truncated: bool,
    pub messages: Vec<MessageRow>,
}

// ---- SessionDB ----

pub struct SessionDB {
    conn: Mutex<rusqlite::Connection>,
}

impl SessionDB {
    pub fn open(db_path: &PathBuf) -> SqlResult<Self> {
        // 确保父目录存在
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = rusqlite::Connection::open(db_path)?;

        // WAL 模式 — 更好的并发读
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        // 建表
        conn.execute_batch(SCHEMA_SQL)?;

        // FTS5
        let fts_ok = conn.execute_batch(FTS_SQL);
        if let Err(ref e) = fts_ok {
            // FTS5 不可用时静默降级（某些精简 SQLite 构建）
            eprintln!("[SessionDB] FTS5 unavailable, search disabled: {e}");
        }

        // Schema 版本迁移
        Self::migrate_schema(&conn)?;

        Ok(SessionDB {
            conn: Mutex::new(conn),
        })
    }

    fn migrate_schema(conn: &rusqlite::Connection) -> SqlResult<()> {
        let version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if version < 1 {
            conn.execute(
                "INSERT OR REPLACE INTO schema_version (version) VALUES (1)",
                [],
            )?;
        }
        Ok(())
    }

    // ---- 消息索引 ----

    pub fn index_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&str>,
        tool_name: Option<&str>,
    ) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();

        conn.execute(
            "INSERT INTO messages (session_id, role, content, tool_calls, tool_name, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, role, content, tool_calls, tool_name, timestamp],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn index_messages_batch(&self, session_id: &str, messages: &[serde_json::Value]) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();

        // 先删除该 session 的现有消息（幂等重写）
        conn.execute(
            "DELETE FROM messages WHERE session_id = ?1",
            params![session_id],
        )?;

        for (i, msg) in messages.iter().enumerate() {
            let role = msg["role"].as_str().unwrap_or("unknown");
            let content = msg["content"].as_str().unwrap_or("");
            let tool_calls = msg.get("tool_calls").and_then(|v| v.as_str());
            let tool_name = msg.get("tool_name").and_then(|v| v.as_str());

            conn.execute(
                "INSERT INTO messages (session_id, role, content, tool_calls, tool_name, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![session_id, role, content, tool_calls, tool_name, timestamp + i as f64 * 0.001],
            )?;
        }
        Ok(())
    }

    // ---- Session CRUD ----

    pub fn upsert_session(&self, id: &str, title: &str, message_count: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono_now();
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at, message_count) VALUES (?1, ?2, ?3, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, message_count=excluded.message_count",
            params![id, title, now, message_count],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![id])?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_session(&self, id: &str) -> SqlResult<Option<SessionMeta>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(SessionMeta {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                message_count: row.get(4)?,
            })
        })?;
        match rows.next() {
            Some(Ok(meta)) => Ok(Some(meta)),
            _ => Ok(None),
        }
    }

    pub fn list_sessions(&self, limit: u32, exclude_id: Option<&str>) -> SqlResult<Vec<SessionMeta>> {
        let conn = self.conn.lock().unwrap();
        let sql = if exclude_id.is_some() {
            "SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE id != ?2 ORDER BY updated_at DESC LIMIT ?1"
        } else {
            "SELECT id, title, created_at, updated_at, message_count FROM sessions ORDER BY updated_at DESC LIMIT ?1"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = if let Some(eid) = exclude_id {
            stmt.query_map(params![limit, eid], |row| {
                Ok(SessionMeta {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    message_count: row.get(4)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?
        } else {
            stmt.query_map(params![limit], |row| {
                Ok(SessionMeta {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    message_count: row.get(4)?,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?
        };
        Ok(rows)
    }

    // ---- FTS5 搜索 ----

    pub fn search(&self, query: &str, limit: u32) -> SqlResult<Vec<SearchResult>> {
        let conn = self.conn.lock().unwrap();

        // 检查 FTS 表是否存在
        let fts_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='messages_fts'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !fts_exists {
            return Ok(vec![]);
        }

        let sanitized = sanitize_fts5_query(query);
        let limit_i64 = limit as i64;

        // FTS5 搜索 + JOIN messages 获取上下文
        let mut stmt = conn.prepare(
            "SELECT m.session_id, m.id, m.role, COALESCE(m.content, ''), m.timestamp, m.tool_name,
                    snippet(messages_fts, 0, '<mark>', '</mark>', '…', 40) as snippet
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             WHERE messages_fts MATCH ?1 AND m.active = 1
             ORDER BY rank
             LIMIT ?2",
        )?;

        let mut hits: Vec<(String, i64, String, String, f64, Option<String>, String)> = vec![];
        {
            let rows = stmt.query_map(params![sanitized, limit_i64 * 3], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, f64>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?;
            for row in rows {
                hits.push(row?);
            }
        }

        if hits.is_empty() {
            return Ok(vec![]);
        }

        // 按 session 去重，取每个 session 的最佳匹配
        let mut seen_sessions = std::collections::HashSet::new();
        let mut results: Vec<SearchResult> = vec![];

        for (sid, msg_id, _role, _content, _ts, _tn, snippet) in &hits {
            if seen_sessions.contains(sid) {
                continue;
            }
            seen_sessions.insert(sid.clone());

            // 获取 session meta（直接查询，避免嵌套锁）
            let meta = conn
                .query_row(
                    "SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE id = ?1",
                    params![sid],
                    |row| {
                        Ok(SessionMeta {
                            id: row.get(0)?,
                            title: row.get(1)?,
                            created_at: row.get(2)?,
                            updated_at: row.get(3)?,
                            message_count: row.get(4)?,
                        })
                    },
                )
                .ok();
            let title = meta
                .as_ref()
                .map(|m| m.title.clone())
                .unwrap_or_else(|| "Unknown".to_string());

            // 获取 ±5 消息窗口
            let window = Self::get_message_window(&conn, sid, *msg_id, 5).unwrap_or_default();

            // 获取 bookends（前3 + 后3）
            let bookend_start = Self::get_bookend_start(&conn, sid).unwrap_or_default();
            let bookend_end = Self::get_bookend_end(&conn, sid).unwrap_or_default();

            // 统计前后消息数
            let (before, after) = Self::count_messages_around(&conn, sid, *msg_id).unwrap_or((0, 0));

            results.push(SearchResult {
                session_id: sid.clone(),
                session_title: title,
                snippet: snippet.clone(),
                match_message_id: *msg_id,
                messages_before: before,
                messages_after: after,
                window,
                bookend_start,
                bookend_end,
            });

            if results.len() >= limit as usize {
                break;
            }
        }

        Ok(results)
    }

    fn get_message_window(
        conn: &rusqlite::Connection,
        session_id: &str,
        anchor_id: i64,
        window: i64,
    ) -> SqlResult<Vec<MessageRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, role, COALESCE(content, ''), timestamp, tool_name FROM messages
             WHERE session_id = ?1 AND active = 1 AND id BETWEEN ?2 AND ?3
             ORDER BY id",
        )?;
        let rows = stmt.query_map(
            params![session_id, anchor_id - window, anchor_id + window],
            |row| {
                let id: i64 = row.get(0)?;
                Ok(MessageRow {
                    id,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get(3)?,
                    tool_name: row.get(4)?,
                    anchor: id == anchor_id,
                })
            },
        )?;
        rows.collect()
    }

    fn get_bookend_start(conn: &rusqlite::Connection, session_id: &str) -> SqlResult<Vec<MessageRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, role, COALESCE(content, ''), timestamp, tool_name FROM messages
             WHERE session_id = ?1 AND active = 1 AND role IN ('user', 'assistant')
             ORDER BY id LIMIT 3",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                timestamp: row.get(3)?,
                tool_name: row.get(4)?,
                anchor: false,
            })
        })?;
        rows.collect()
    }

    fn get_bookend_end(conn: &rusqlite::Connection, session_id: &str) -> SqlResult<Vec<MessageRow>> {
        let mut stmt = conn.prepare(
            "SELECT id, role, COALESCE(content, ''), timestamp, tool_name FROM messages
             WHERE session_id = ?1 AND active = 1 AND role IN ('user', 'assistant')
             ORDER BY id DESC LIMIT 3",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                timestamp: row.get(3)?,
                tool_name: row.get(4)?,
                anchor: false,
            })
        })?;
        let mut v: Vec<MessageRow> = rows.collect::<SqlResult<Vec<_>>>()?;
        v.reverse();
        Ok(v)
    }

    fn count_messages_around(
        conn: &rusqlite::Connection,
        session_id: &str,
        anchor_id: i64,
    ) -> SqlResult<(i64, i64)> {
        let before: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE session_id = ?1 AND active = 1 AND id < ?2",
            params![session_id, anchor_id],
            |row| row.get(0),
        )?;
        let after: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE session_id = ?1 AND active = 1 AND id > ?2",
            params![session_id, anchor_id],
            |row| row.get(0),
        )?;
        Ok((before, after))
    }

    // ---- 全量读取 ----

    pub fn read_session(&self, session_id: &str, head: usize, tail: usize) -> SqlResult<SessionRead> {
        let conn = self.conn.lock().unwrap();
        // 直接在锁内查询，避免嵌套调用 get_session() 导致死锁
        let meta = conn
            .query_row(
                "SELECT id, title, created_at, updated_at, message_count FROM sessions WHERE id = ?1",
                params![session_id],
                |row| {
                    Ok(SessionMeta {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                        message_count: row.get(4)?,
                    })
                },
            )
            .unwrap_or(SessionMeta {
                id: session_id.to_string(),
                title: "Unknown".to_string(),
                created_at: String::new(),
                updated_at: String::new(),
                message_count: 0,
            });

        let mut stmt = conn.prepare(
            "SELECT id, role, COALESCE(content, ''), timestamp, tool_name FROM messages
             WHERE session_id = ?1 AND active = 1
             ORDER BY id",
        )?;
        let all: Vec<MessageRow> = stmt
            .query_map(params![session_id], |row| {
                Ok(MessageRow {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get(3)?,
                    tool_name: row.get(4)?,
                    anchor: false,
                })
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        let total = all.len();
        let truncated = total > head + tail;
        let window = if truncated {
            let mut v: Vec<MessageRow> = all[..head].to_vec();
            v.extend(all[total - tail..].to_vec());
            v
        } else {
            all
        };

        Ok(SessionRead {
            session_id: session_id.to_string(),
            session_meta: meta,
            message_count: total,
            truncated,
            messages: window,
        })
    }

    // ---- 滚动 ----

    pub fn scroll(
        &self,
        session_id: &str,
        around_message_id: i64,
        window: i64,
    ) -> SqlResult<Vec<MessageRow>> {
        let conn = self.conn.lock().unwrap();
        let w = window.max(1).min(20);
        Self::get_message_window(&conn, session_id, around_message_id, w)
    }
}

// ---- 辅助 ----

fn sanitize_fts5_query(query: &str) -> String {
    // 简单清洗：移除 FTS5 特殊字符，保留基本 token
    let cleaned: String = query
        .chars()
        .map(|c| match c {
            '"' | '(' | ')' | '^' | '~' | '@' | ':' | '&' | '|' | '!' => ' ',
            _ => c,
        })
        .collect();
    cleaned.trim().to_string()
}

fn chrono_now() -> String {
    // 简易 ISO 时间戳，避免引入 chrono crate
    use std::time::SystemTime;
    let dur = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    let secs = dur.as_secs();
    // 转换为 ISO 8601
    let days_since_epoch = secs / 86400;
    let time_in_day = secs % 86400;
    let hours = time_in_day / 3600;
    let minutes = (time_in_day % 3600) / 60;
    let seconds = time_in_day % 60;

    // 从 Unix epoch 推算年月日（简化，对 1970-2100 范围有效）
    let (y, m, d) = civil_from_days(days_since_epoch as i64);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hours, minutes, seconds
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    // Convert days since 1970-01-01 to year/month/day
    // Algorithm from Howard Hinnant
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ============================================================
// Tauri Commands
// ============================================================

pub mod commands {
    use super::*;
    use tauri::State;

    #[tauri::command]
    pub fn search_sessions(
        db: State<SessionDB>,
        query: String,
        limit: Option<u32>,
    ) -> Result<String, String> {
        let results = db
            .search(&query, limit.unwrap_or(5))
            .map_err(|e| format!("Search failed: {e}"))?;
        serde_json::to_string(&results).map_err(|e| format!("Serialize failed: {e}"))
    }

    #[tauri::command]
    pub fn index_message(
        db: State<SessionDB>,
        session_id: String,
        role: String,
        content: String,
        tool_calls: Option<String>,
        tool_name: Option<String>,
    ) -> Result<String, String> {
        let id = db
            .index_message(
                &session_id,
                &role,
                &content,
                tool_calls.as_deref(),
                tool_name.as_deref(),
            )
            .map_err(|e| format!("Index failed: {e}"))?;
        Ok(id.to_string())
    }

    #[tauri::command]
    pub fn index_message_batch(
        db: State<SessionDB>,
        session_id: String,
        messages: Vec<serde_json::Value>,
    ) -> Result<String, String> {
        db.index_messages_batch(&session_id, &messages)
            .map_err(|e| format!("Batch index failed: {e}"))?;
        Ok("ok".to_string())
    }

    #[tauri::command]
    pub fn get_session(
        db: State<SessionDB>,
        session_id: String,
    ) -> Result<String, String> {
        let meta = db
            .get_session(&session_id)
            .map_err(|e| format!("Get session failed: {e}"))?;
        serde_json::to_string(&meta).map_err(|e| format!("Serialize failed: {e}"))
    }

    #[tauri::command]
    pub fn list_sessions_cmd(
        db: State<SessionDB>,
        limit: Option<u32>,
        exclude_id: Option<String>,
    ) -> Result<String, String> {
        let sessions = db
            .list_sessions(limit.unwrap_or(50), exclude_id.as_deref())
            .map_err(|e| format!("List sessions failed: {e}"))?;
        serde_json::to_string(&sessions).map_err(|e| format!("Serialize failed: {e}"))
    }

    #[tauri::command]
    pub fn delete_session_cmd(
        db: State<SessionDB>,
        session_id: String,
    ) -> Result<String, String> {
        db.delete_session(&session_id)
            .map_err(|e| format!("Delete session failed: {e}"))?;
        Ok("ok".to_string())
    }

    #[tauri::command]
    pub fn scroll_session(
        db: State<SessionDB>,
        session_id: String,
        around_message_id: i64,
        window: Option<i64>,
    ) -> Result<String, String> {
        let messages = db
            .scroll(&session_id, around_message_id, window.unwrap_or(5))
            .map_err(|e| format!("Scroll failed: {e}"))?;
        serde_json::to_string(&messages).map_err(|e| format!("Serialize failed: {e}"))
    }

    #[tauri::command]
    pub fn read_session_cmd(
        db: State<SessionDB>,
        session_id: String,
        head: Option<usize>,
        tail: Option<usize>,
    ) -> Result<String, String> {
        let session = db
            .read_session(&session_id, head.unwrap_or(20), tail.unwrap_or(10))
            .map_err(|e| format!("Read session failed: {e}"))?;
        serde_json::to_string(&session).map_err(|e| format!("Serialize failed: {e}"))
    }
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

use std::sync::atomic::{AtomicU32, Ordering};

    static DB_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_db() -> (SessionDB, PathBuf) {
        let id = DB_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("amiba_test_{}_{}", std::process::id(), id));
        std::fs::create_dir_all(&dir).ok();
        let path = dir.join("test_state.db");
        let _ = std::fs::remove_file(&path);
        let db = SessionDB::open(&path).expect("open test db");
        (db, dir)
    }

    fn cleanup(dir: PathBuf) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_sanitize_fts5_query_basic() {
        assert_eq!(sanitize_fts5_query("hello world"), "hello world");
    }

    #[test]
    fn test_sanitize_fts5_query_special_chars() {
        let result = sanitize_fts5_query("test\"query(here)");
        assert!(!result.contains('"'));
        assert!(!result.contains('('));
        assert!(!result.contains(')'));
    }

    #[test]
    fn test_sanitize_fts5_query_colons() {
        let result = sanitize_fts5_query("col:value");
        assert!(!result.contains(':'), "colons should be stripped");
    }

    #[test]
    fn test_sanitize_fts5_query_preserve_words() {
        let result = sanitize_fts5_query("rust sqlite fts5 search");
        assert_eq!(result, "rust sqlite fts5 search");
    }

    #[test]
    fn test_sanitize_fts5_query_empty() {
        assert_eq!(sanitize_fts5_query(""), "");
    }

    #[test]
    fn test_open_and_schema() {
        let (db, dir) = temp_db();

        // Schema should exist
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sessions'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let msg_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='messages'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(msg_count, 1);

        cleanup(dir);
    }

    #[test]
    fn test_upsert_and_get_session() {
        let (db, dir) = temp_db();

        db.upsert_session("sess_1", "Test Chat", 5).unwrap();
        let meta = db.get_session("sess_1").unwrap().unwrap();
        assert_eq!(meta.title, "Test Chat");
        assert_eq!(meta.message_count, 5);

        // Upsert update
        db.upsert_session("sess_1", "Updated Chat", 10).unwrap();
        let meta = db.get_session("sess_1").unwrap().unwrap();
        assert_eq!(meta.title, "Updated Chat");
        assert_eq!(meta.message_count, 10);

        // Non-existent
        assert!(db.get_session("nonexistent").unwrap().is_none());

        cleanup(dir);
    }

    #[test]
    fn test_index_and_search() {
        let (db, dir) = temp_db();

        // Index messages
        db.upsert_session("sess_a", "Search Test", 2).unwrap();
        db.index_message("sess_a", "user", "hello world rust programming", None, None).unwrap();
        db.index_message("sess_a", "assistant", "rust is a systems language", None, Some("reply")).unwrap();

        // Search should find it
        let results = db.search("rust programming", 5).unwrap();
        assert!(!results.is_empty(), "should find rust programming");
        assert_eq!(results[0].session_id, "sess_a");

        // Non-matching query
        let empty = db.search("python django flask", 5).unwrap();
        assert!(empty.is_empty());

        cleanup(dir);
    }

    #[test]
    fn test_search_with_bookends() {
        let (db, dir) = temp_db();

        db.upsert_session("sess_b", "Bookend Test", 10).unwrap();
        for i in 0..10 {
            db.index_message("sess_b", "user", &format!("message number {}", i), None, None).unwrap();
        }

        let results = db.search("message number 5", 3).unwrap();
        assert!(!results.is_empty());
        let r = &results[0];
        // Should have bookends
        assert!(r.bookend_start.len() <= 3);
        assert!(r.bookend_end.len() <= 3);
        // Window should contain the match
        assert!(r.window.iter().any(|m| m.anchor));

        cleanup(dir);
    }

    #[test]
    fn test_list_sessions() {
        let (db, dir) = temp_db();

        db.upsert_session("a", "Alpha", 1).unwrap();
        db.upsert_session("b", "Beta", 2).unwrap();
        db.upsert_session("c", "Gamma", 3).unwrap();

        let sessions = db.list_sessions(10, None).unwrap();
        assert_eq!(sessions.len(), 3);

        let excl = db.list_sessions(10, Some("b")).unwrap();
        assert_eq!(excl.len(), 2);

        cleanup(dir);
    }

    #[test]
    fn test_read_session_truncation() {
        let (db, dir) = temp_db();

        db.upsert_session("sess_c", "Truncation Test", 50).unwrap();
        for i in 0..50 {
            db.index_message("sess_c", "user", &format!("msg {}", i), None, None).unwrap();
        }

        let session = db.read_session("sess_c", 5, 5).unwrap();
        assert!(session.truncated);
        assert_eq!(session.messages.len(), 10); // 5 head + 5 tail
        assert_eq!(session.message_count, 50);

        cleanup(dir);
    }

    #[test]
    fn test_delete_session_cascades() {
        let (db, dir) = temp_db();

        db.upsert_session("sess_d", "Delete Test", 3).unwrap();
        db.index_message("sess_d", "user", "msg1", None, None).unwrap();
        db.index_message("sess_d", "user", "msg2", None, None).unwrap();

        db.delete_session("sess_d").unwrap();
        assert!(db.get_session("sess_d").unwrap().is_none());

        // Messages should also be gone
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE session_id = 'sess_d'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        cleanup(dir);
    }

    #[test]
    fn test_scroll_window() {
        let (db, dir) = temp_db();

        db.upsert_session("sess_e", "Scroll Test", 20).unwrap();
        for i in 0..20 {
            db.index_message("sess_e", "user", &format!("line {}", i), None, None).unwrap();
        }

        // Scroll around message 10
        let messages = db.scroll("sess_e", 10, 3).unwrap();
        assert!(messages.len() <= 7); // anchor ±3, max 7
        assert!(messages.iter().any(|m| m.id == 10 && m.anchor));

        cleanup(dir);
    }
}
