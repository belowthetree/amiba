// ============================================================
// 变形虫 (Amiba) — WebSocket 会话管理 (network_session.rs)
// ============================================================
// TCP 监听器 + WebSocket 会话（Inbound/Outbound）+ 服务匹配。
// 与 network_visibility.rs 解耦：本模块只管 session 生命周期。
//
// 服务匹配协议（传输层，对应用透明）：
//   连接方首条消息: {"type":"hello","from":"<peerId>","name":"<hostname>","service":"<serviceKey>"}
//   被动方回复（自动）:
//     服务匹配 → 自动 ack → 创建 Inbound Session
//     服务不匹配 → 自动 reject{"reason":"没有服务在监听"}
//
// 服务视角：startListening('p2p-chat') → 自动收到 onSession(session) → 直接收发数据
// ============================================================

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpListener;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, watch, Mutex};
use tokio_tungstenite::{accept_async, connect_async};
use tokio_tungstenite::tungstenite::Message;
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
    /// 按服务请求启动监听：引用计数（归零时停 listener）
    pub listener_refcount: u32,
    /// 当前正在监听的服务标识集合
    pub listening_services: HashSet<String>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            ws_port: 0,
            listener_cancel: None,
            listener_refcount: 0,
            listening_services: HashSet::new(),
        }
    }
}

pub fn init_session_store() -> SessionStore {
    SessionStore::new()
}

// ---- 常量 ----

const HELLO_READ_TIMEOUT_SECS: u64 = 10;
const CONNECT_ACK_TIMEOUT_SECS: u64 = 30;

// ============================================================
// Listener 管理（内部，由 start_listener / stop_listener 命令调用）
// ============================================================

async fn ensure_listener(
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

async fn stop_listener(state: &State<'_, Arc<Mutex<SessionStore>>>) -> Result<(), String> {
    let mut ns = state.lock().await;
    if let Some(tx) = ns.listener_cancel.take() {
        let _ = tx.send(true);
    }
    ns.ws_port = 0;
    eprintln!("[net-session] TCP 监听已停止");
    Ok(())
}

// ============================================================
// 入站连接处理 — 自动服务匹配
// ============================================================

/// 接受入站 TCP → 升级 WS → 读 hello → 服务匹配 → 自动 ack/reject。
/// 对服务完全透明：匹配则直接建 session，不匹配则自动拒绝。
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

    let (mut write, mut read) = ws.split();

    // 读取首条 hello（10s 超时）
    let hello_result = tokio::time::timeout(
        Duration::from_secs(HELLO_READ_TIMEOUT_SECS),
        read_first_text(&mut read),
    ).await;

    let hello_text = match hello_result {
        Ok(Ok(text)) => text,
        _ => {
            eprintln!("[net-session] 未收到 hello ({}), 关闭", addr);
            let _ = write.close().await;
            return;
        }
    };

    // 解析 hello
    let hello: serde_json::Value = match serde_json::from_str(&hello_text) {
        Ok(v) => v,
        Err(_) => {
            eprintln!("[net-session] hello 解析失败 ({}): {}", addr, hello_text);
            let _ = write.close().await;
            return;
        }
    };

    if hello["type"].as_str() != Some("hello") {
        eprintln!("[net-session] 首条消息非 hello ({}): {}", addr, hello_text);
        let _ = write.close().await;
        return;
    }

    let peer_id = hello["from"].as_str().unwrap_or("unknown").to_string();
    let peer_name = hello["name"].as_str().unwrap_or("unknown").to_string();
    let service_key = hello["service"].as_str().unwrap_or("").to_string();

    eprintln!("[net-session] === 收到 hello: service={}, from={}, name={}, addr={} ===", service_key, peer_id, peer_name, addr);
    eprintln!("[net-session]    当前监听服务: {:?}", { let ss = state.lock().await; ss.listening_services.clone() });

    // ---- 服务匹配：自动 accept / reject ----
    let matched = {
        let ss = state.lock().await;
        !service_key.is_empty() && ss.listening_services.contains(&service_key)
    };

    eprintln!("[net-session]    匹配结果: matched={}  service_key='{}'", matched, service_key);

    if matched {
        // 匹配：发 ack → 建 Inbound Session
        eprintln!("[net-session]    ✓ 服务匹配，发送 ack ...");
        if let Err(e) = write.send(Message::Text(
            serde_json::json!({"type":"ack"}).to_string().into()
        )).await {
            eprintln!("[net-session] 发送 ack 失败: {}", e);
            let _ = write.close().await;
            return;
        }

        let ws = match write.reunite(read) {
            Ok(w) => w,
            Err(_) => return,
        };

        let session_id = Uuid::new_v4().to_string();
        let (msg_tx, msg_rx) = mpsc::unbounded_channel::<String>();
        let (cancel_tx, cancel_rx) = watch::channel(false);

        {
            let mut ss = state.lock().await;
            ss.sessions.insert(session_id.clone(), SessionState {
                id: session_id.clone(),
                peer_id: peer_id.clone(),
                peer_name: peer_name.clone(),
                direction: SessionDirection::Inbound,
                status: SessionStatus::Connected,
                msg_tx,
                cancel_tx: cancel_tx.clone(),
            });
        }

        eprintln!("[net-session]    ✓ Inbound session 创建: {} <- {} ({})", session_id, peer_id, peer_name);

        let _ = app.emit("network:session-created", serde_json::json!({
            "sessionId": &session_id,
            "peerId": &peer_id,
            "peerName": &peer_name,
            "direction": "inbound",
            "service": &service_key,
        }));

        spawn_session_io(ws, msg_rx, cancel_rx, session_id, peer_id, app, state);
    } else {
        // 不匹配：发 reject → 关闭
        let reason = if service_key.is_empty() {
            "hello 未指定 service".to_string()
        } else {
            format!("没有服务在监听 '{}'", service_key)
        };
        eprintln!("[net-session]    ✗ 服务不匹配，拒绝: {}", reason);
        let _ = write.send(Message::Text(
            serde_json::json!({"type":"reject","reason":&reason}).to_string().into()
        )).await;
        let _ = write.close().await;
    }
}

/// 从 WS read 分片读取首条非 ping/pong 文本消息。
async fn read_first_text(read: &mut InboundRead) -> Result<String, String> {
    loop {
        match read.next().await {
            Some(Ok(msg)) => {
                let text = msg.into_text().unwrap_or_default();
                if text.contains("\"type\":\"ping\"") || text.contains("\"type\":\"pong\"") {
                    continue;
                }
                return Ok(text);
            }
            Some(Err(e)) => return Err(format!("WS 读取错误: {}", e)),
            None => return Err("连接已断开".into()),
        }
    }
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
    service_key: Option<String>,
) -> Result<serde_json::Value, String> {
    // 从 VisibilityState 获取 peer 地址 + 本机设备身份
    let (peer_name, address, device_id, device_name) = {
        let vs = vis_state.lock().await;
        let peer = vs.discovered_peers.get(&peer_id)
            .ok_or_else(|| format!("设备 {} 未发现", peer_id))?;
        (peer.name.clone(), peer.address.clone(), vs.device_id.clone(), vs.device_name.clone())
    };

    if address.is_empty() {
        return Err("设备地址未知".into());
    }
    if address.ends_with(":0") {
        return Err("该设备暂未开放连接。请在对方设备上打开相同服务（服务需调用 startListening）".into());
    }

    let url = format!("ws://{}", address);
    eprintln!("[net-session] === 主动连接: {} -> {} (service={}) ===", peer_id, url, service_key.as_deref().unwrap_or(""));

    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    // ---- 发送 hello（仅服务匹配信息，无 greeting）----
    let (mut write, mut read) = ws.split();

    let hello = serde_json::json!({
        "type": "hello",
        "from": device_id,
        "name": device_name,
        "service": service_key.as_deref().unwrap_or(""),
    });
    write.send(Message::Text(hello.to_string().into()))
        .await
        .map_err(|e| format!("发送 hello 失败: {}", e))?;

    eprintln!("[net-session] 已发送 hello -> {} (service={})", peer_id, service_key.as_deref().unwrap_or(""));

    // 等待 ack/reject（30s 超时）
    let sleep = tokio::time::sleep(Duration::from_secs(CONNECT_ACK_TIMEOUT_SECS));
    tokio::pin!(sleep);

    let response_text;
    loop {
        tokio::select! {
            msg = read.next() => {
                match msg {
                    Some(Ok(m)) => {
                        let text = m.into_text().unwrap_or_default();
                        if text.contains("\"type\":\"ping\"") || text.contains("\"type\":\"pong\"") {
                            continue;
                        }
                        response_text = text;
                        break;
                    }
                    Some(Err(e)) => {
                        return Err(format!("握手读取错误: {}", e));
                    }
                    None => {
                        return Err("连接已断开".into());
                    }
                }
            }
            _ = &mut sleep => {
                let _ = write.close().await;
                return Err("对方未响应（超时）".into());
            }
        }
    }

    // 解析握手响应
    let resp: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| format!("握手响应解析失败: {}", e))?;

    match resp["type"].as_str() {
        Some("ack") => {
            eprintln!("[net-session] 收到 ack <- {}", peer_id);
        }
        Some("reject") => {
            let reason = resp["reason"].as_str().unwrap_or("已拒绝").to_string();
            let _ = write.close().await;
            return Err(reason);
        }
        _ => {
            let _ = write.close().await;
            return Err("无效的握手响应".into());
        }
    }

    // ---- 创建 Outbound Session ----
    let session_id = Uuid::new_v4().to_string();
    let (msg_tx, msg_rx) = mpsc::unbounded_channel::<String>();
    let (cancel_tx, cancel_rx) = watch::channel(false);

    {
        let mut ns = sess_state.lock().await;
        ns.sessions.insert(session_id.clone(), SessionState {
            id: session_id.clone(),
            peer_id: peer_id.clone(),
            peer_name: peer_name.clone(),
            direction: SessionDirection::Outbound,
            status: SessionStatus::Connected,
            msg_tx,
            cancel_tx: cancel_tx.clone(),
        });
    }

    eprintln!("[net-session]    ✓ Outbound session 创建: {} -> {} ({})", session_id, peer_id, peer_name);

    let _ = app.emit("network:session-created", serde_json::json!({
        "sessionId": &session_id,
        "peerId": &peer_id,
        "peerName": &peer_name,
        "direction": "outbound",
        "service": service_key.as_deref().unwrap_or(""),
    }));

    // Reunite 分片，启动双工 I/O
    let ws = write.reunite(read)
        .map_err(|e| format!("reunite 失败: {:?}", e))?;
    spawn_session_io(ws, msg_rx, cancel_rx, session_id.clone(), peer_id.clone(), app, sess_state.inner().clone());

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

#[tauri::command]
pub async fn network_start_listener(
    state: State<'_, Arc<Mutex<SessionStore>>>,
    app: AppHandle,
    service_key: String,
) -> Result<(), String> {
    eprintln!("[net-session] === startListening: service='{}' ===", service_key);
    let mut ss = state.lock().await;
    ss.listening_services.insert(service_key);
    ss.listener_refcount += 1;
    let need_start = ss.listener_refcount == 1;
    drop(ss);
    if need_start {
        ensure_listener(&state, app).await
    } else {
        eprintln!("[net-session]    TCP 监听已在运行，refcount={}", 1);
        Ok(())
    }
}

#[tauri::command]
pub async fn network_stop_listener(
    state: State<'_, Arc<Mutex<SessionStore>>>,
    service_key: String,
) -> Result<(), String> {
    eprintln!("[net-session] === stopListening: service='{}' ===", service_key);
    let mut ss = state.lock().await;
    ss.listening_services.remove(&service_key);
    if ss.listener_refcount > 0 {
        ss.listener_refcount -= 1;
    }
    let need_stop = ss.listener_refcount == 0;
    drop(ss);
    if need_stop {
        stop_listener(&state).await
    } else {
        eprintln!("[net-session]    其他服务仍在监听，保持 TCP 运行");
        Ok(())
    }
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
    let state1 = state.clone();
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
        // WS 读取端断开：通知前端关闭 session
        let mut ns = state1.lock().await;
        if let Some(s) = ns.sessions.remove(&sid1) {
            let _ = s.cancel_tx.send(true);
            let _ = app1.emit("network:session-closed", serde_json::json!({
                "sessionId": sid1,
                "reason": "connection-lost",
            }));
        }
        eprintln!("[net-session] session {} 读取端已关闭", sid1);
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

// ---- 分片类型别名（内部使用）----
type InboundWs = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;
type InboundRead = futures_util::stream::SplitStream<InboundWs>;
