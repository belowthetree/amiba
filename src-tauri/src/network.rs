// ============================================================
// 变形虫 (Amiba) — 局域网互联通信 (Rust 原生层 v3)
// ============================================================
// UDP 广播发现 + TCP 监听升级 WebSocket。
// mDNS 已移除，WebSocket 客户端由前端 Worker 管理。
// SO_REUSEADDR 允许多实例共享 UDP 端口。
//
// v3 变更:
//   - 握手协议: 连接后首条消息为 {"type":"handshake","peerId":"..."}
//   - 双向通信: 通过 mpsc channel 支持前端 → Rust → WebSocket 发送
//   - 消息转发: 收到的消息通过 Tauri event 转发到前端
//   - 可取消发现: network_stop_discovery 通过 watch channel 取消后台任务
// ============================================================

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::{mpsc, watch, Mutex};
use tokio_tungstenite::accept_async;
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

/// WebSocket 握手消息（前端 Worker 连接后立即发送）
#[derive(Debug, Deserialize)]
struct HandshakeMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(rename = "peerId")]
    peer_id: String,
}

// ---- Network State ----

pub struct NetworkState {
    pub device_id: String,
    pub device_name: String,
    pub session_id: String,
    pub visibility: TransportVisibility,
    pub discovered_peers: HashMap<String, DiscoveredPeer>,
    pub ws_port: u16,
    /// 已连接 peer 的 WebSocket 发送通道: peer_id → tx
    pub peer_tx: HashMap<String, mpsc::UnboundedSender<String>>,
    /// 取消发现任务: 发送 true 时 UDP 广播/监听循环退出
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
            peer_tx: HashMap::new(),
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
        if !id.is_empty() {
            return id;
        }
    }
    let id = Uuid::new_v4().to_string();
    let _ = std::fs::create_dir_all(path.parent().unwrap());
    let _ = std::fs::write(&path, &id);
    id
}

const UDP_BROADCAST_PORT: u16 = 28880;
const UDP_BROADCAST_ADDR: &str = "255.255.255.255:28880";

// ============================================================
// Tauri Commands
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

    if visibility.lan {
        // 如果已有 cancel_tx，说明之前启动过，先取消旧的
        if let Some(tx) = ns.cancel_tx.take() {
            let _ = tx.send(true);
        }
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
    // 取消旧任务
    if let Some(tx) = ns.cancel_tx.take() {
        let _ = tx.send(true);
    }
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
    if let Some(tx) = ns.cancel_tx.take() {
        let _ = tx.send(true);
        eprintln!("[network] 发现已停止");
    }
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
pub async fn network_send(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    peer_id: String,
    message: String,
) -> Result<(), String> {
    let tx = {
        let ns = state.lock().await;
        ns.peer_tx.get(&peer_id).cloned()
    };
    match tx {
        Some(tx) => tx.send(message).map_err(|e| format!("发送失败: {}", e)),
        None => Err(format!("设备 {} 未连接", peer_id)),
    }
}

#[tauri::command]
pub async fn network_disconnect(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    peer_id: String,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    ns.peer_tx.remove(&peer_id);
    eprintln!("[network] 断开 peer: {}", peer_id);
    Ok(())
}

#[tauri::command]
pub async fn network_get_ws_port(
    state: State<'_, Arc<Mutex<NetworkState>>>,
) -> Result<u16, String> {
    let ns = state.lock().await;
    Ok(ns.ws_port)
}

// ============================================================
// TCP 监听器（升级 WebSocket，接受其他 peer 的前端连接）
// ============================================================

async fn ensure_tcp_listener(
    state: &State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    if ns.ws_port != 0 {
        return Ok(());
    }
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
                handle_ws_connection(stream, addr, state, app).await;
            });
        }
    });
    Ok(())
}

async fn handle_ws_connection(
    stream: tokio::net::TcpStream,
    addr: std::net::SocketAddr,
    state: Arc<Mutex<NetworkState>>,
    app: AppHandle,
) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            // 可能是网络扫描或非 WS 客户端，降低日志级别
            let err_msg = e.to_string();
            if err_msg.contains("No \"Connection: upgrade\" header") {
                // 静默忽略非 WebSocket 连接（浏览器预连接、网络扫描等）
            } else {
                eprintln!("[network] WebSocket 升级失败 ({}): {}", addr, err_msg);
            }
            return;
        }
    };
    let (mut write, mut read) = ws.split();

    // ---- 等待握手消息 ----
    let peer_id = match read.next().await {
        Some(Ok(msg)) => {
            let text = msg.into_text().unwrap_or_default();
            match serde_json::from_str::<HandshakeMessage>(&text) {
                Ok(hs) if hs.msg_type == "handshake" => hs.peer_id,
                _ => {
                    eprintln!("[network] 无效握手消息 ({}): {}", addr, text);
                    return;
                }
            }
        }
        _ => {
            eprintln!("[network] 握手超时 ({})", addr);
            return;
        }
    };

    eprintln!("[network] peer 已连接: {} (来自 {})", peer_id, addr);

    // ---- 建立双向通道 ----
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // 注册到 NetworkState
    {
        let mut ns = state.lock().await;
        ns.peer_tx.remove(&peer_id);
        ns.peer_tx.insert(peer_id.clone(), tx);
    }

    // 发送连接事件到前端
    let _ = app.emit("network:peer-connected", serde_json::json!({
        "peerId": peer_id,
    }));

    let (close_tx, close_rx) = watch::channel(false);

    // ---- 任务 1: WebSocket → 前端 (read) ----
    let peer_id1 = peer_id.clone();
    let app1 = app.clone();
    let close_tx1 = close_tx.clone();
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(tungstenite_msg) => {
                    let text = tungstenite_msg.into_text().unwrap_or_default();
                    // 跳过心跳消息
                    if text.contains("\"type\":\"pong\"") || text.contains("\"type\":\"ping\"") {
                        continue;
                    }
                    eprintln!("[network] 收到来自 {} 的消息: {}", peer_id1, &text[..text.len().min(200)]);
                    let _ = app1.emit("network:message-received", serde_json::json!({
                        "peerId": peer_id1,
                        "message": text,
                    }));
                }
                Err(e) => {
                    eprintln!("[network] WebSocket 读取错误 ({}): {}", peer_id1, e);
                    break;
                }
            }
        }
        let _ = close_tx1.send(true);
    });

    // ---- 任务 2: 前端 → WebSocket (write) + 关闭清理 ----
    let peer_id2 = peer_id.clone();
    let app2 = app.clone();
    let state2 = state.clone();
    tokio::spawn(async move {
        // Pin close_rx for select
        let mut close_rx_stream = close_rx;
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some(text) => {
                            if let Err(e) = write.send(
                                tokio_tungstenite::tungstenite::Message::Text(text.into())
                            ).await {
                                eprintln!("[network] WebSocket 写入错误 ({}): {}", peer_id2, e);
                                break;
                            }
                        }
                        None => break, // channel closed
                    }
                }
                _ = close_rx_stream.changed() => {
                    if *close_rx_stream.borrow() {
                        break;
                    }
                }
            }
        }

        // 清理
        {
            let mut ns = state2.lock().await;
            ns.peer_tx.remove(&peer_id2);
        }
        let _ = app2.emit("network:peer-disconnected", serde_json::json!({
            "peerId": peer_id2,
        }));
        eprintln!("[network] peer 已断开: {}", peer_id2);
    });
}

// ============================================================
// UDP 广播
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

        // 构建广播目标：255.255.255.255 + 每网卡子网广播 (.255 结尾)
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
            if *cancel_rx.borrow() {
                eprintln!("[network] UDP 广播已取消");
                return;
            }

            send_count += 1;
            let port = {
                let ns = state.lock().await;
                ns.ws_port
            };
            if port > 0 {
                let msg = serde_json::json!({
                    "id": device_id,
                    "name": device_name,
                    "sid": sid,
                    "ws_port": port,
                });
                let payload = msg.to_string();
                for addr in &addrs {
                    if let Err(e) = socket.send_to(payload.as_bytes(), addr.as_str()).await {
                        if send_count <= 1 {
                            eprintln!("[network] UDP 发送到 {} 失败: {}", addr, e);
                        }
                    }
                }
                if send_count % 10 == 1 {
                    eprintln!("[network] UDP 已发送 {} 次", send_count);
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        eprintln!("[network] UDP 广播已取消");
                        return;
                    }
                }
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
            std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED),
            UDP_BROADCAST_PORT,
        );

        let socket = match Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[network] UDP socket 创建失败: {}", e);
                return;
            }
        };

        if let Err(e) = socket.set_reuse_address(true) {
            eprintln!("[network] SO_REUSEADDR 设置失败: {}", e);
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        unsafe {
            use std::os::fd::AsRawFd;
            let opt: libc::c_int = 1;
            let ret = libc::setsockopt(
                socket.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_REUSEPORT,
                &opt as *const _ as *const libc::c_void,
                std::mem::size_of_val(&opt) as libc::socklen_t,
            );
            if ret != 0 {
                eprintln!("[network] SO_REUSEPORT 设置失败: {}", std::io::Error::last_os_error());
            }
        }

        if let Err(e) = socket.bind(&addr.into()) {
            eprintln!("[network] UDP 绑定失败 (端口 {}): {}", UDP_BROADCAST_PORT, e);
            return;
        }

        let std_socket: std::net::UdpSocket = socket.into();
        let _ = std_socket.set_nonblocking(true);

        let socket = match UdpSocket::from_std(std_socket) {
            Ok(s) => {
                eprintln!("[network] UDP 监听已启动，端口: {} (SO_REUSEADDR)", UDP_BROADCAST_PORT);

                // 定期清理过期 peer（15 秒未收到广播即视为离线）
                let cleanup_state = state.clone();
                let cleanup_app = app.clone();
                let mut cleanup_cancel = cancel_rx.clone();
                tokio::spawn(async move {
                    loop {
                        if *cleanup_cancel.borrow() {
                            return;
                        }
                        tokio::select! {
                            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
                            _ = cleanup_cancel.changed() => {
                                if *cleanup_cancel.borrow() { return; }
                            }
                        }
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        let mut ns = cleanup_state.lock().await;
                        let stale: Vec<String> = ns
                            .discovered_peers
                            .iter()
                            .filter(|(_, p)| {
                                let last: u128 = p.last_seen.parse().unwrap_or(0);
                                now_ms.saturating_sub(last) > 15_000
                            })
                            .map(|(id, _)| id.clone())
                            .collect();
                        for id in &stale { ns.discovered_peers.remove(id); }
                        drop(ns);
                        for id in stale {
                            eprintln!("[network] 设备离线: {}", id);
                            let _ = cleanup_app.emit("network:peer-lost", serde_json::json!({ "id": id }));
                        }
                    }
                });

                s
            }
            Err(e) => {
                eprintln!("[network] UDP 转 tokio 失败: {}", e);
                return;
            }
        };

        let mut buf = vec![0u8; 2048];
        let mut recv_count: u64 = 0;
        loop {
            if *cancel_rx.borrow() {
                eprintln!("[network] UDP 监听已取消");
                return;
            }

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
                                            "id": peer_id,
                                            "name": peer_name,
                                            "transport": "lan",
                                            "address": address,
                                        }));
                                    }
                                }
                            }
                        }
                        Err(e) => eprintln!("[network] UDP 接收错误: {}", e),
                    }
                }
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        eprintln!("[network] UDP 监听已取消");
                        return;
                    }
                }
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
