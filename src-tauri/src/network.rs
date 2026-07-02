// ============================================================
// 变形虫 (Amiba) — 局域网互联通信 (Rust 原生层 v2)
// ============================================================
// UDP 广播发现 + TCP 监听升级 WebSocket。
// mDNS 已移除，WebSocket 客户端由前端 Worker 管理。
// SO_REUSEADDR 允许多实例共享 UDP 端口。
// ============================================================

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::Mutex;
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

// ---- Network State ----

pub struct NetworkState {
    pub device_id: String,
    pub device_name: String,
    pub session_id: String,
    pub visibility: TransportVisibility,
    pub discovered_peers: HashMap<String, DiscoveredPeer>,
    pub ws_port: u16,
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
pub async fn network_set_visibility(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
    visibility: TransportVisibility,
) -> Result<TransportVisibility, String> {
    let mut ns = state.lock().await;
    ns.visibility = visibility.clone();

    if visibility.lan {
        drop(ns);
        ensure_tcp_listener(&state).await?;
        start_udp_broadcast(state.inner().clone()).await;
        start_udp_listener(state.inner().clone(), app.clone());
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
    if transport == "lan" || transport == "all" {
        start_udp_listener(state.inner().clone(), app.clone());
    }
    if transport == "ble" || transport == "all" {
        return Err("BLE 当前平台暂不支持".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn network_stop_discovery() -> Result<(), String> {
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
pub async fn network_connect() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn network_send() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn network_disconnect() -> Result<(), String> {
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

async fn ensure_tcp_listener(state: &State<'_, Arc<Mutex<NetworkState>>>) -> Result<(), String> {
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

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                if let Ok(ws) = accept_async(stream).await {
                    let (mut write, mut read) = ws.split();
                    while let Some(Ok(msg)) = read.next().await {
                        let _ = write.send(tokio_tungstenite::tungstenite::Message::Text(
                            format!("echo:{}", msg.into_text().unwrap_or_default()),
                        )).await;
                    }
                }
            });
        }
    });
    Ok(())
}

// ============================================================
// UDP 广播
// ============================================================

async fn start_udp_broadcast(state: Arc<Mutex<NetworkState>>) {
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

        loop {
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
                if let Err(e) = socket.send_to(payload.as_bytes(), UDP_BROADCAST_ADDR).await {
                    eprintln!("[network] UDP 发送失败: {}", e);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
}

fn start_udp_listener(state: Arc<Mutex<NetworkState>>, app: AppHandle) {
    tokio::spawn(async move {
        // socket2: SO_REUSEADDR 允许多实例共享同一 UDP 端口
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
        // macOS/iOS 必须 SO_REUSEPORT 才能多 socket 共享 UDP 端口
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
                s
            }
            Err(e) => {
                eprintln!("[network] UDP 转 tokio 失败: {}", e);
                return;
            }
        };

        let mut buf = vec![0u8; 2048];
        loop {
            match socket.recv_from(&mut buf).await {
                Ok((len, src)) => {
                    if let Ok(payload) = std::str::from_utf8(&buf[..len]) {
                        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(payload) {
                            let peer_sid = msg["sid"].as_str().unwrap_or("");
                            let peer_id = msg["id"].as_str().unwrap_or("unknown");
                            let peer_name = msg["name"].as_str().unwrap_or("unknown");
                            let ws_port = msg["ws_port"].as_u64().unwrap_or(0);

                            let mut ns = state.lock().await;
                            if peer_sid == ns.session_id { continue; }

                            let address = format!("{}:{}", src.ip(), ws_port);
                            let peer = DiscoveredPeer {
                                id: peer_id.to_string(),
                                name: peer_name.to_string(),
                                transport: "lan".into(),
                                address,
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
                                }));
                            }
                        }
                    }
                }
                Err(e) => eprintln!("[network] UDP 接收错误: {}", e),
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
