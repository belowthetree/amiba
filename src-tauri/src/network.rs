// ============================================================
// 变形虫 (Amiba) — 局域网互联通信 (Rust 原生层 v4)
// ============================================================
// UDP 广播发现（保留）+ WebSocket 会话管理（新）。
// Rust 统一管理 WebSocket 客户端和服务端，前端通过 Tauri invoke/event 交互。
// ============================================================

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::{TcpListener, UdpSocket};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, watch, Mutex};
use tokio_tungstenite::{accept_async, connect_async};
use futures_util::{SinkExt, StreamExt};
use uuid::Uuid;

// ---- Types ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportVisibility {
    pub lan: bool,
    pub ble: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPeer {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rssi: Option<i32>,
    pub last_seen: String,
}

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

pub struct SessionState {
    pub id: String,
    pub peer_id: String,
    pub peer_name: String,
    pub direction: SessionDirection,
    pub status: SessionStatus,
    /// 向该 session 发送消息的通道
    pub msg_tx: mpsc::UnboundedSender<String>,
    /// 取消信号
    pub cancel_tx: watch::Sender<bool>,
}

// ---- Network State ----

pub struct NetworkState {
    pub device_id: String,
    pub device_name: String,
    pub session_id: String,
    pub visibility: TransportVisibility,
    pub discovered_peers: HashMap<String, DiscoveredPeer>,
    pub ws_port: u16,
    /// session_id → SessionState
    pub sessions: HashMap<String, SessionState>,
    /// 取消发现任务
    pub cancel_tx: Option<watch::Sender<bool>>,
}

impl NetworkState {
    pub fn new() -> Self {
        Self {
            device_id: String::new(),
            device_name: String::new(),
            session_id: Uuid::new_v4().to_string(),
            visibility: TransportVisibility { lan: true, ble: false },
            discovered_peers: HashMap::new(),
            ws_port: 0,
            sessions: HashMap::new(),
            cancel_tx: None,
        }
    }
}

// ---- Helpers ----

fn now_iso() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn get_hostname_str() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "amiba-device".into())
}

fn get_device_id(app: &AppHandle) -> String {
    let path = app
        .path()
        .app_data_dir()
        .unwrap_or_default()
        .join("amiba")
        .join("device_id");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let id = id.trim().to_string();
        if !id.is_empty() { return id; }
    }
    let id = Uuid::new_v4().to_string();
    let _ = std::fs::create_dir_all(path.parent().unwrap());
    let _ = std::fs::write(&path, &id);
    id
}

const UDP_BROADCAST_PORT: u16 = 28880;
const UDP_BROADCAST_ADDR: &str = "255.255.255.255:28880";

// ============================================================
// Tauri Commands — 可见性 & 发现
// ============================================================

#[tauri::command]
pub async fn network_get_device_id(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Result<String, String> {
    let ns = state.lock().await;
    Ok(ns.device_id.clone())
}

#[tauri::command]
pub async fn network_set_visibility(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
    visibility: TransportVisibility,
) -> Result<TransportVisibility, String> {
    let mut ns = state.lock().await;
    ns.visibility = visibility.clone();

    // 无论开关，先取消旧任务
    if let Some(tx) = ns.cancel_tx.take() { let _ = tx.send(true); }

    if visibility.lan {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        ns.cancel_tx = Some(cancel_tx);
        drop(ns);
        ensure_tcp_listener(&state, app.clone()).await?;
        start_udp_broadcast(state.inner().clone(), cancel_rx.clone()).await;
        start_udp_listener(state.inner().clone(), app.clone(), cancel_rx);
    }
    Ok(visibility)
}

#[tauri::command]
pub async fn network_get_visibility(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Result<TransportVisibility, String> {
    let ns = state.lock().await;
    Ok(ns.visibility.clone())
}

#[tauri::command]
pub async fn network_start_discovery(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
    transport: String,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    if let Some(tx) = ns.cancel_tx.take() { let _ = tx.send(true); }
    let (cancel_tx, cancel_rx) = watch::channel(false);
    ns.cancel_tx = Some(cancel_tx);
    drop(ns);

    if transport == "lan" || transport == "all" {
        start_udp_listener(state.inner().clone(), app.clone(), cancel_rx.clone());
        start_udp_broadcast(state.inner().clone(), cancel_rx).await;
    }
    if transport == "ble" || transport == "all" {
        return Err("BLE 当前平台暂不支持".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn network_stop_discovery(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    #[allow(unused)] transport: Option<String>,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    if let Some(tx) = ns.cancel_tx.take() { let _ = tx.send(true); }
    Ok(())
}

#[tauri::command]
pub async fn network_get_visible_devices(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Result<Vec<DiscoveredPeer>, String> {
    let ns = state.lock().await;
    Ok(ns.discovered_peers.values().cloned().collect())
}

#[tauri::command]
pub async fn network_get_ws_port(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Result<u16, String> {
    let ns = state.lock().await;
    Ok(ns.ws_port)
}

// ============================================================
// Tauri Commands — Session
// ============================================================

#[tauri::command]
pub async fn network_connect(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
    peer_id: String,
) -> Result<serde_json::Value, String> {
    // 从 discovered_peers 获取 peer 地址
    let (peer_name, address) = {
        let ns = state.lock().await;
        let peer = ns.discovered_peers.get(&peer_id)
            .ok_or_else(|| format!("设备 {} 未发现", peer_id))?;
        (peer.name.clone(), peer.address.clone())
    };

    if address.is_empty() {
        return Err("设备地址未知".into());
    }

    let url = format!("ws://{}", address);
    eprintln!("[network] 主动连接: {} -> {}", peer_id, url);

    let (ws, _) = connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    let session_id = Uuid::new_v4().to_string();
    let (msg_tx, msg_rx) = mpsc::unbounded_channel::<String>();
    let (cancel_tx, cancel_rx) = watch::channel(false);

    // 注册 session
    {
        let mut ns = state.lock().await;
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

    eprintln!("[network] Outbound session 创建: {} -> {} ({})", session_id, peer_id, peer_name);

    // emit session-created
    let _ = app.emit("network:session-created", serde_json::json!({
        "sessionId": session_id,
        "peerId": peer_id,
        "peerName": peer_name,
        "direction": "outbound",
    }));

    // spawn 双向读写任务
    let app1 = app.clone();
    let state1 = state.inner().clone();
    let sid = session_id.clone();
    let pid = peer_id.clone();
    spawn_session_io(ws, msg_rx, cancel_rx, sid, pid, app1, state1);

    Ok(serde_json::json!({
        "sessionId": session_id,
        "peerId": peer_id,
        "peerName": peer_name,
    }))
}

#[tauri::command]
pub async fn network_send(
    state: State<'_, Arc<Mutex<NetworkState>>>,
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
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    close_session(&state, &app, &session_id).await
}

async fn close_session(
    state: &State<'_, Arc<Mutex<NetworkState>>>,
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

// ============================================================
// TCP 监听器（接受外来 WebSocket 连接 → 创建 Inbound Session）
// ============================================================

async fn ensure_tcp_listener(
    state: &State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    if ns.ws_port != 0 { return Ok(()); }

    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("TCP 绑定失败: {}", e))?;
    ns.ws_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    eprintln!("[network] TCP 监听已启动，端口: {}", ns.ws_port);
    drop(ns);

    let state_clone = state.inner().clone();
    tokio::spawn(async move {
        while let Ok((stream, addr)) = listener.accept().await {
            let state = state_clone.clone();
            let app = app.clone();
            tokio::spawn(async move {
                let ws = match accept_async(stream).await {
                    Ok(ws) => ws,
                    Err(e) => {
                        let msg = e.to_string();
                        if !msg.contains("No \"Connection: upgrade\" header") {
                            eprintln!("[network] WS 升级失败 ({}): {}", addr, msg);
                        }
                        return;
                    }
                };

                // Inbound session：暂用地址作为 peer 标识
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

                eprintln!("[network] Inbound session 创建: {} <- {} (来自 {})", session_id, peer_id, addr);

                let _ = app.emit("network:session-created", serde_json::json!({
                    "sessionId": session_id,
                    "peerId": peer_id,
                    "peerName": peer_name,
                    "direction": "inbound",
                }));

                let app1 = app.clone();
                let state1 = state.clone();
                spawn_session_io(ws, msg_rx, cancel_rx, session_id, peer_id, app1, state1);
            });
        }
    });
    Ok(())
}

// ============================================================
// Session I/O 任务（双工读写）
// ============================================================

fn spawn_session_io<S>(
    ws: tokio_tungstenite::WebSocketStream<S>,
    mut msg_rx: mpsc::UnboundedReceiver<String>,
    mut cancel_rx: watch::Receiver<bool>,
    session_id: String,
    _peer_id: String,
    app: AppHandle,
    state: Arc<Mutex<NetworkState>>,
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
                            eprintln!("[network] session {} 读取错误: {}", sid1, e);
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
                                eprintln!("[network] session {} 写入错误: {}", sid2, e);
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
        eprintln!("[network] session {} 已关闭", session_id);
    });
}

// ============================================================
// UDP 广播（保留）
// ============================================================

async fn start_udp_broadcast(state: Arc<Mutex<NetworkState>>, mut cancel_rx: watch::Receiver<bool>) {
    let (sid, device_name, device_id) = {
        let ns = state.lock().await;
        (ns.session_id.clone(), ns.device_name.clone(), ns.device_id.clone())
    };

    tokio::spawn(async move {
        let socket = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(e) => { eprintln!("[network] UDP 广播绑定失败: {}", e); return; }
        };
        let _ = socket.set_broadcast(true);

        let mut addrs = vec![UDP_BROADCAST_ADDR.to_string()];
        if let Ok(ifaces) = local_ip_address::list_afinet_netifas() {
            for (name, ip) in &ifaces {
                if name == "lo" || name.starts_with("lo0") { continue; }
                if let std::net::IpAddr::V4(ipv4) = ip {
                    let octets = ipv4.octets();
                    let bc = format!("{}.{}.{}.255:{}", octets[0], octets[1], octets[2], UDP_BROADCAST_PORT);
                    if !addrs.contains(&bc) { addrs.push(bc); }
                }
            }
        }
        eprintln!("[network] UDP 广播目标 ({}): {:?}", addrs.len(), addrs);

        let mut send_count: u64 = 0;
        loop {
            if *cancel_rx.borrow() { eprintln!("[network] UDP 广播已取消"); return; }
            send_count += 1;
            let port = { let ns = state.lock().await; ns.ws_port };
            if port > 0 {
                let msg = serde_json::json!({
                    "id": device_id, "name": device_name, "sid": sid, "ws_port": port,
                });
                let payload = msg.to_string();
                for addr in &addrs {
                    if let Err(e) = socket.send_to(payload.as_bytes(), addr.as_str()).await {
                        if send_count <= 1 { eprintln!("[network] UDP 发送到 {} 失败: {}", addr, e); }
                    }
                }
                if send_count % 10 == 1 { eprintln!("[network] UDP 已发送 {} 次", send_count); }
            }
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
                _ = cancel_rx.changed() => { if *cancel_rx.borrow() { return; } }
            }
        }
    });
}

fn start_udp_listener(
    state: Arc<Mutex<NetworkState>>,
    app: AppHandle,
    mut cancel_rx: watch::Receiver<bool>,
) {
    tokio::spawn(async move {
        use socket2::{Domain, Protocol, Socket, Type};
        let addr = std::net::SocketAddr::new(
            std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), UDP_BROADCAST_PORT,
        );

        let socket = match Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)) {
            Ok(s) => s,
            Err(e) => { eprintln!("[network] UDP socket 创建失败: {}", e); return; }
        };
        if let Err(e) = socket.set_reuse_address(true) { eprintln!("[network] SO_REUSEADDR: {}", e); }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        unsafe {
            use std::os::fd::AsRawFd;
            let opt: libc::c_int = 1;
            let _ = libc::setsockopt(
                socket.as_raw_fd(), libc::SOL_SOCKET, libc::SO_REUSEPORT,
                &opt as *const _ as *const libc::c_void,
                std::mem::size_of_val(&opt) as libc::socklen_t,
            );
        }

        if let Err(e) = socket.bind(&addr.into()) {
            eprintln!("[network] UDP 绑定失败 ({}): {}", UDP_BROADCAST_PORT, e);
            return;
        }

        let std_socket: std::net::UdpSocket = socket.into();
        let _ = std_socket.set_nonblocking(true);
        let socket = match UdpSocket::from_std(std_socket) {
            Ok(s) => {
                eprintln!("[network] UDP 监听已启动，端口: {}", UDP_BROADCAST_PORT);
                let cleanup_state = state.clone();
                let cleanup_app = app.clone();
                let mut cleanup_cancel = cancel_rx.clone();
                tokio::spawn(async move {
                    loop {
                        if *cleanup_cancel.borrow() { return; }
                        tokio::select! {
                            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
                            _ = cleanup_cancel.changed() => { if *cleanup_cancel.borrow() { return; } }
                        }
                        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
                        let mut ns = cleanup_state.lock().await;
                        let stale: Vec<String> = ns.discovered_peers.iter()
                            .filter(|(_, p)| {
                                let last: u128 = p.last_seen.parse().unwrap_or(0);
                                now_ms.saturating_sub(last) > 15_000
                            })
                            .map(|(id, _)| id.clone()).collect();
                        for id in &stale { ns.discovered_peers.remove(id); }
                        drop(ns);
                        for id in stale {
                            let _ = cleanup_app.emit("network:peer-lost", serde_json::json!({ "id": id }));
                        }
                    }
                });
                s
            }
            Err(e) => { eprintln!("[network] UDP 转 tokio 失败: {}", e); return; }
        };

        let mut buf = vec![0u8; 2048];
        let mut recv_count: u64 = 0;
        loop {
            if *cancel_rx.borrow() { eprintln!("[network] UDP 监听已取消"); return; }
            tokio::select! {
                result = socket.recv_from(&mut buf) => {
                    match result {
                        Ok((len, src)) => {
                            if let Ok(payload) = std::str::from_utf8(&buf[..len]) {
                                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(payload) {
                                    let peer_sid = msg["sid"].as_str().unwrap_or("");
                                    let peer_id = msg["id"].as_str().unwrap_or("unknown");
                                    let peer_name = msg["name"].as_str().unwrap_or("unknown");
                                    let ws_port = msg["ws_port"].as_u64().unwrap_or(0);

                                    let mut ns = state.lock().await;
                                    if peer_sid == ns.session_id { continue; }
                                    recv_count += 1;
                                    if recv_count % 10 == 1 {
                                        eprintln!("[network] UDP 收到第 {} 个外部包 (来自 {} 设备 {})", recv_count, src, peer_name);
                                    }

                                    let address = format!("{}:{}", src.ip(), ws_port);
                                    let peer = DiscoveredPeer {
                                        id: peer_id.to_string(),
                                        name: peer_name.to_string(),
                                        transport: "lan".into(),
                                        address: address.clone(),
                                        rssi: None,
                                        last_seen: now_iso(),
                                    };
                                    let is_new = !ns.discovered_peers.contains_key(peer_id);
                                    ns.discovered_peers.insert(peer_id.to_string(), peer);
                                    drop(ns);

                                    if is_new {
                                        eprintln!("[network] 发现设备: {} ({})", peer_name, peer_id);
                                        let _ = app.emit("network:peer-discovered", serde_json::json!({
                                            "id": peer_id, "name": peer_name, "transport": "lan", "address": address,
                                        }));
                                    }
                                }
                            }
                        }
                        Err(e) => eprintln!("[network] UDP 接收错误: {}", e),
                    }
                }
                _ = cancel_rx.changed() => { if *cancel_rx.borrow() { return; } }
            }
        }
    });
}

// ============================================================
// Init
// ============================================================

pub fn init_network_state(app: &AppHandle) -> NetworkState {
    let mut ns = NetworkState::new();
    ns.device_id = get_device_id(app);
    ns.device_name = get_hostname_str();
    ns
}
