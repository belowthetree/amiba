// ============================================================
// 变形虫 (Amiba) — WebSocket 会话管理 (network_session.rs)
// ============================================================
// TCP 监听器 + WebSocket 会话（Inbound/Outbound）。
// 与 network_visibility.rs 解耦：本模块只管 session 生命周期。
// 跨模块依赖：network_connect 需从 VisibilityState 读取 peer 地址。
// ============================================================

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpListener;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, watch, Mutex};
use tokio_tungstenite::{accept_async, connect_async};
use futures_util::{SinkExt, StreamExt};
use uuid::Uuid;

use crate::network_visibility::VisibilityState;

// ---- Session Types ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SessionDirection {
    Outbound,  // 本机主动发起
    Inbound,   // 对端连入
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SessionStatus {
    Connecting,
    Connected,
    Disconnected,
}

#[allow(dead_code)]
pub struct SessionState {
    pub id: String,
    #[allow(dead_code)]
    pub peer_id: String,
    #[allow(dead_code)]
    pub peer_name: String,
    #[allow(dead_code)]
    pub direction: SessionDirection,
    #[allow(dead_code)]
    pub status: SessionStatus,
    /// 向该 session 发送消息的通道
    pub msg_tx: mpsc::UnboundedSender<String>,
    /// 取消信号
    pub cancel_tx: watch::Sender<bool>,
}

// ---- Session Store ----

pub struct SessionStore {
    pub sessions: HashMap<String, SessionState>,
    pub ws_port: u16,
    /// 取消 TCP listener 任务
    pub listener_cancel: Option<watch::Sender<bool>>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            ws_port: 0,
            listener_cancel: None,
        }
    }
}

pub fn init_session_store() -> SessionStore {
    SessionStore::new()
}

// ============================================================
// Listener 管理（pub，供 visibility 模块编排）
// ============================================================

/// 启动 TCP 监听（若未启动）。绑定随机端口，写入 ws_port。
/// accept 循环将每条连入升级为 WebSocket → 创建 Inbound Session。
pub async fn ensure_listener(
    state: &State<'_, Arc<Mutex<SessionStore>>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    if ns.ws_port != 0 { return Ok(()); }

    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("TCP 绑定失败: {}", e))?;
    ns.ws_port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (listener_cancel, cancel_rx) = watch::channel(false);
    ns.listener_cancel = Some(listener_cancel);

    eprintln!("[net-session] TCP 监听已启动，端口: {}", ns.ws_port);
    drop(ns);

    let state_clone = state.inner().clone();
    tokio::spawn(async move {
        let mut cancel_rx = cancel_rx;
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            let state = state_clone.clone();
                            let app = app.clone();
                            tokio::spawn(async move {
                                accept_inbound(state, app, stream, addr).await;
                            });
                        }
                        Err(e) => {
                            eprintln!("[net-session] accept 错误: {}", e);
                            break;
                        }
                    }
                }
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        eprintln!("[net-session] TCP 监听已取消");
                        break;
                    }
                }
            }
        }
    });
    Ok(())
}

/// 停止 TCP 监听，释放端口。已建立的 session 不受影响。
pub async fn stop_listener(state: &State<'_, Arc<Mutex<SessionStore>>>) -> Result<(), String> {
    let mut ns = state.lock().await;
    if let Some(tx) = ns.listener_cancel.take() {
        let _ = tx.send(true);
    }
    ns.ws_port = 0;
    eprintln!("[net-session] TCP 监听已停止");
    Ok(())
}

/// 接受一条入站 TCP → 升级 WS → 创建 Inbound Session。
async fn accept_inbound(
    state: Arc<Mutex<SessionStore>>,
    app: AppHandle,
    stream: tokio::net::TcpStream,
    addr: std::net::SocketAddr,
) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            let msg = e.to_string();
            if !msg.contains("No \"Connection: upgrade\" header") {
                eprintln!("[net-session] WS 升级失败 ({}): {}", addr, msg);
            }
            return;
        }
    };

    // Inbound session：暂用地址作为 peer 标识（握手 PR 将替换为 hello 真实身份）
    let peer_id = format!("inbound-{}", Uuid::new_v4());
    let peer_name = format!("{}", addr.ip());
    let session_id = Uuid::new_v4().to_string();
    let (msg_tx, msg_rx) = mpsc::unbounded_channel::<String>();
    let (cancel_tx, cancel_rx) = watch::channel(false);

    {
        let mut ns = state.lock().await;
        ns.sessions.insert(session_id.clone(), SessionState {
            id: session_id.clone(),
            peer_id: peer_id.clone(),
            peer_name: peer_name.clone(),
            direction: SessionDirection::Inbound,
            status: SessionStatus::Connected,
            msg_tx: msg_tx.clone(),
            cancel_tx: cancel_tx.clone(),
        });
    }

    eprintln!("[net-session] Inbound session 创建: {} <- {} (来自 {})", session_id, peer_id, addr);

    let _ = app.emit("network:session-created", serde_json::json!({
        "sessionId": session_id,
        "peerId": peer_id,
        "peerName": peer_name,
        "direction": "inbound",
    }));

    spawn_session_io(ws, msg_rx, cancel_rx, session_id, peer_id, app, state);
}

// ============================================================
// Tauri Commands — Session
// ============================================================

#[tauri::command]
pub async fn network_connect(
    sess_state: State<'_, Arc<Mutex<SessionStore>>>,
    vis_state: State<'_, Arc<Mutex<VisibilityState>>>,
    app: AppHandle,
    peer_id: String,
) -> Result<serde_json::Value, String> {
    // 从 VisibilityState 获取 peer 地址
    let (peer_name, address) = {
        let vs = vis_state.lock().await;
        let peer = vs.discovered_peers.get(&peer_id)
            .ok_or_else(|| format!("设备 {} 未发现", peer_id))?;
        (peer.name.clone(), peer.address.clone())
    };

    if address.is_empty() {
        return Err("设备地址未知".into());
    }

    let url = format!("ws://{}", address);
    eprintln!("[net-session] 主动连接: {} -> {}", peer_id, url);

    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    let session_id = Uuid::new_v4().to_string();
    let (msg_tx, msg_rx) = mpsc::unbounded_channel::<String>();
    let (cancel_tx, cancel_rx) = watch::channel(false);

    // 注册 session
    {
        let mut ns = sess_state.lock().await;
        ns.sessions.insert(session_id.clone(), SessionState {
            id: session_id.clone(),
            peer_id: peer_id.clone(),
            peer_name: peer_name.clone(),
            direction: SessionDirection::Outbound,
            status: SessionStatus::Connected,
            msg_tx: msg_tx.clone(),
            cancel_tx: cancel_tx.clone(),
        });
    }

    eprintln!("[net-session] Outbound session 创建: {} -> {} ({})", session_id, peer_id, peer_name);

    // emit session-created
    let _ = app.emit("network:session-created", serde_json::json!({
        "sessionId": &session_id,
        "peerId": &peer_id,
        "peerName": &peer_name,
        "direction": "outbound",
    }));

    // spawn 双向读写任务
    spawn_session_io(
        ws, msg_rx, cancel_rx,
        session_id.clone(), peer_id.clone(),
        app, sess_state.inner().clone(),
    );

    Ok(serde_json::json!({
        "sessionId": session_id,
        "peerId": peer_id,
        "peerName": peer_name,
    }))
}

#[tauri::command]
pub async fn network_send(
    state: State<'_, Arc<Mutex<SessionStore>>>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let tx = {
        let ns = state.lock().await;
        ns.sessions.get(&session_id)
            .map(|s| s.msg_tx.clone())
            .ok_or_else(|| format!("会话 {} 不存在", session_id))?
    };
    tx.send(message).map_err(|e| format!("发送失败: {}", e))
}

#[tauri::command]
pub async fn network_disconnect(
    state: State<'_, Arc<Mutex<SessionStore>>>,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    close_session(&state, &app, &session_id).await
}

#[tauri::command]
pub async fn network_get_ws_port(
    state: State<'_, Arc<Mutex<SessionStore>>>,
) -> Result<u16, String> {
    let ns = state.lock().await;
    Ok(ns.ws_port)
}

// ============================================================
// 内部辅助
// ============================================================

async fn close_session(
    state: &State<'_, Arc<Mutex<SessionStore>>>,
    app: &AppHandle,
    session_id: &str,
) -> Result<(), String> {
    let session = {
        let mut ns = state.lock().await;
        ns.sessions.remove(session_id)
    };
    if let Some(s) = session {
        let _ = s.cancel_tx.send(true);
        let _ = app.emit("network:session-closed", serde_json::json!({
            "sessionId": s.id,
            "reason": "disconnected",
        }));
    }
    Ok(())
}

fn spawn_session_io<S>(
    ws: tokio_tungstenite::WebSocketStream<S>,
    mut msg_rx: mpsc::UnboundedReceiver<String>,
    mut cancel_rx: watch::Receiver<bool>,
    session_id: String,
    _peer_id: String,
    app: AppHandle,
    state: Arc<Mutex<SessionStore>>,
) where S: AsyncRead + AsyncWrite + Unpin + Send + 'static {
    let (mut write, mut read) = ws.split();

    // 任务 1: WS → 前端
    let sid1 = session_id.clone();
    let app1 = app.clone();
    let mut cancel1 = cancel_rx.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = read.next() => {
                    match msg {
                        Some(Ok(tungstenite_msg)) => {
                            let text = tungstenite_msg.into_text().unwrap_or_default();
                            if text.contains("\"type\":\"ping\"") || text.contains("\"type\":\"pong\"") {
                                continue;
                            }
                            let _ = app1.emit("network:session-message", serde_json::json!({
                                "sessionId": sid1,
                                "message": text,
                            }));
                        }
                        Some(Err(e)) => {
                            eprintln!("[net-session] session {} 读取错误: {}", sid1, e);
                            break;
                        }
                        None => break,
                    }
                }
                _ = cancel1.changed() => {
                    if *cancel1.borrow() { break; }
                }
            }
        }
    });

    // 任务 2: 前端 → WS
    let sid2 = session_id.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = msg_rx.recv() => {
                    match msg {
                        Some(text) => {
                            if let Err(e) = write.send(
                                tokio_tungstenite::tungstenite::Message::Text(text.into())
                            ).await {
                                eprintln!("[net-session] session {} 写入错误: {}", sid2, e);
                                break;
                            }
                        }
                        None => break,
                    }
                }
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() { break; }
                }
            }
        }
        // 清理
        let mut ns = state.lock().await;
        if let Some(s) = ns.sessions.get(&session_id) {
            let _ = app.emit("network:session-closed", serde_json::json!({
                "sessionId": session_id,
                "reason": "connection-lost",
            }));
            let _ = s.cancel_tx.send(true);
        }
        ns.sessions.remove(&session_id);
        eprintln!("[net-session] session {} 已关闭", session_id);
    });
}
