// ============================================================
// 变形虫 (Amiba) — 设备可见性与发现 (network_visibility.rs)
// ============================================================
// UDP 广播发现 + 可见性编排。
// 与 network_session.rs 解耦：本模块只管"被看见"。
// TCP 监听由各服务按需启动（network_start_listener 命令），
// 本模块仅通过 SessionStore.ws_port 读取端口用于广播。
// ============================================================

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::UdpSocket;
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

use crate::network_session::SessionStore;

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

// ---- Visibility State ----

pub struct VisibilityState {
    pub device_id: String,
    pub device_name: String,
    /// 本机发现会话标识（过滤自己发出的广播）
    pub session_id: String,
    pub visibility: TransportVisibility,
    pub discovered_peers: HashMap<String, DiscoveredPeer>,
    /// 取消 UDP 广播/监听任务
    pub cancel_tx: Option<watch::Sender<bool>>,
}

impl VisibilityState {
    pub fn new() -> Self {
        Self {
            device_id: String::new(),
            device_name: String::new(),
            session_id: Uuid::new_v4().to_string(),
            visibility: TransportVisibility { lan: true, ble: false },
            discovered_peers: HashMap::new(),
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

pub fn init_visibility_state(app: &AppHandle) -> VisibilityState {
    let mut ns = VisibilityState::new();
    ns.device_id = get_device_id(app);
    ns.device_name = get_hostname_str();
    ns
}

// ============================================================
// Tauri Commands — 可见性 & 发现
// ============================================================

#[tauri::command]
pub async fn network_get_device_id(
    state: State<'_, Arc<Mutex<VisibilityState>>>,
) -> Result<String, String> {
    let ns = state.lock().await;
    Ok(ns.device_id.clone())
}

#[tauri::command]
pub async fn network_set_visibility(
    vis_state: State<'_, Arc<Mutex<VisibilityState>>>,
    sess_state: State<'_, Arc<Mutex<SessionStore>>>,
    app: AppHandle,
    visibility: TransportVisibility,
) -> Result<TransportVisibility, String> {
    let mut ns = vis_state.lock().await;
    ns.visibility = visibility.clone();

    // 无论开关，先取消旧 UDP 任务
    if let Some(tx) = ns.cancel_tx.take() { let _ = tx.send(true); }

    if visibility.lan {
        let (cancel_tx, cancel_rx) = watch::channel(false);
        ns.cancel_tx = Some(cancel_tx);
        drop(ns);
        // 只启 UDP 广播/监听；TCP listener 由服务按需启动（network_start_listener）
        start_udp_broadcast(vis_state.inner().clone(), sess_state.inner().clone(), cancel_rx.clone()).await;
        start_udp_listener(vis_state.inner().clone(), app.clone(), cancel_rx);
    }
    // 关可见性时仅停 UDP；TCP listener 由服务自行管理
    Ok(visibility)
}

#[tauri::command]
pub async fn network_get_visibility(
    state: State<'_, Arc<Mutex<VisibilityState>>>,
) -> Result<TransportVisibility, String> {
    let ns = state.lock().await;
    Ok(ns.visibility.clone())
}

#[tauri::command]
pub async fn network_start_discovery(
    vis_state: State<'_, Arc<Mutex<VisibilityState>>>,
    sess_state: State<'_, Arc<Mutex<SessionStore>>>,
    app: AppHandle,
    transport: String,
) -> Result<(), String> {
    let mut ns = vis_state.lock().await;
    if let Some(tx) = ns.cancel_tx.take() { let _ = tx.send(true); }
    let (cancel_tx, cancel_rx) = watch::channel(false);
    ns.cancel_tx = Some(cancel_tx);
    drop(ns);

    if transport == "lan" || transport == "all" {
        // startDiscovery 不启动 TCP listener（与文档一致：仅 setVisibility 启动）
        start_udp_listener(vis_state.inner().clone(), app.clone(), cancel_rx.clone());
        start_udp_broadcast(vis_state.inner().clone(), sess_state.inner().clone(), cancel_rx).await;
    }
    if transport == "ble" || transport == "all" {
        return Err("BLE 当前平台暂不支持".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn network_stop_discovery(
    state: State<'_, Arc<Mutex<VisibilityState>>>,
    #[allow(unused)] transport: Option<String>,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    if let Some(tx) = ns.cancel_tx.take() { let _ = tx.send(true); }
    Ok(())
}

#[tauri::command]
pub async fn network_get_visible_devices(
    state: State<'_, Arc<Mutex<VisibilityState>>>,
) -> Result<Vec<DiscoveredPeer>, String> {
    let ns = state.lock().await;
    Ok(ns.discovered_peers.values().cloned().collect())
}

// ============================================================
// UDP 广播
// ============================================================

async fn start_udp_broadcast(
    vis_state: Arc<Mutex<VisibilityState>>,
    sess_store: Arc<Mutex<SessionStore>>,
    mut cancel_rx: watch::Receiver<bool>,
) {
    let (sid, device_name, device_id) = {
        let ns = vis_state.lock().await;
        (ns.session_id.clone(), ns.device_name.clone(), ns.device_id.clone())
    };

    tokio::spawn(async move {
        let socket = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(e) => { eprintln!("[net-vis] UDP 广播绑定失败: {}", e); return; }
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
        eprintln!("[net-vis] UDP 广播目标 ({}): {:?}", addrs.len(), addrs);

        let mut send_count: u64 = 0;
        loop {
            if *cancel_rx.borrow() { eprintln!("[net-vis] UDP 广播已取消"); return; }
            send_count += 1;
            // 从 session 模块读 ws_port
            let port = { let ss = sess_store.lock().await; ss.ws_port };
            if port > 0 {
                let msg = serde_json::json!({
                    "id": device_id, "name": device_name, "sid": sid, "ws_port": port,
                });
                let payload = msg.to_string();
                for addr in &addrs {
                    if let Err(e) = socket.send_to(payload.as_bytes(), addr.as_str()).await {
                        if send_count <= 1 { eprintln!("[net-vis] UDP 发送到 {} 失败: {}", addr, e); }
                    }
                }
                if send_count % 10 == 1 { eprintln!("[net-vis] UDP 已发送 {} 次", send_count); }
            }
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
                _ = cancel_rx.changed() => { if *cancel_rx.borrow() { return; } }
            }
        }
    });
}

fn start_udp_listener(
    vis_state: Arc<Mutex<VisibilityState>>,
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
            Err(e) => { eprintln!("[net-vis] UDP socket 创建失败: {}", e); return; }
        };
        if let Err(e) = socket.set_reuse_address(true) { eprintln!("[net-vis] SO_REUSEADDR: {}", e); }

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
            eprintln!("[net-vis] UDP 绑定失败 ({}): {}", UDP_BROADCAST_PORT, e);
            return;
        }

        let std_socket: std::net::UdpSocket = socket.into();
        let _ = std_socket.set_nonblocking(true);
        let socket = match UdpSocket::from_std(std_socket) {
            Ok(s) => {
                eprintln!("[net-vis] UDP 监听已启动，端口: {}", UDP_BROADCAST_PORT);
                let cleanup_state = vis_state.clone();
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
            Err(e) => { eprintln!("[net-vis] UDP 转 tokio 失败: {}", e); return; }
        };

        let mut buf = vec![0u8; 2048];
        let mut recv_count: u64 = 0;
        loop {
            if *cancel_rx.borrow() { eprintln!("[net-vis] UDP 监听已取消"); return; }
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

                                    let mut ns = vis_state.lock().await;
                                    if peer_sid == ns.session_id { continue; }
                                    recv_count += 1;
                                    if recv_count % 10 == 1 {
                                        eprintln!("[net-vis] UDP 收到第 {} 个外部包 (来自 {} 设备 {})", recv_count, src, peer_name);
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
                                        eprintln!("[net-vis] 发现设备: {} ({})", peer_name, peer_id);
                                        let _ = app.emit("network:peer-discovered", serde_json::json!({
                                            "id": peer_id, "name": peer_name, "transport": "lan", "address": address,
                                        }));
                                    }
                                }
                            }
                        }
                        Err(e) => eprintln!("[net-vis] UDP 接收错误: {}", e),
                    }
                }
                _ = cancel_rx.changed() => { if *cancel_rx.borrow() { return; } }
            }
        }
    });
}
