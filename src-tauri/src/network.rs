// ============================================================
// 变形虫 (Amiba) — 局域网 / 蓝牙互联通信 (Rust 原生层)
// ============================================================
// LAN: mDNS 发现 + WebSocket 对等消息传递
// BLE: btleplug 扫描（桌面平台）
// ============================================================

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::{accept_async, connect_async, tungstenite::Message};
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
    pub visibility: TransportVisibility,
    pub mdns: ServiceDaemon,
    pub discovered_peers: HashMap<String, DiscoveredPeer>,
    pub outbound_tx: HashMap<String, tokio::sync::mpsc::UnboundedSender<String>>,
    pub ws_port: u16,
    pub browsing: bool,
}

impl NetworkState {
    pub fn new() -> Self {
        Self {
            device_id: String::new(),
            device_name: String::new(),
            visibility: TransportVisibility { lan: true, ble: false },
            mdns: ServiceDaemon::new().expect("Failed to create mDNS daemon"),
            discovered_peers: HashMap::new(),
            outbound_tx: HashMap::new(),
            ws_port: 0,
            browsing: false,
        }
    }
}

// ---- Helpers ----

fn now_iso() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    ms.to_string()
}

fn get_hostname_str() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "amiba-device".into())
}

/// 获取或生成设备 ID（持久化在 app data）
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

/// 从 mDNS ServiceInfo 的属性中提取字符串值
fn get_prop(info: &ServiceInfo, key: &str) -> String {
    info.get_property_val_str(key).unwrap_or("unknown").to_string()
}

const MDNS_SERVICE_TYPE: &str = "_amiba._tcp.local.";

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
        ensure_ws_listener(&state).await?;
        start_mdns_advertise(&state, &app).await?;
    } else {
        let _ = ns.mdns.unregister(MDNS_SERVICE_TYPE);
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
        let mut ns = state.lock().await;
        if !ns.browsing {
            let receiver = ns
                .mdns
                .browse(MDNS_SERVICE_TYPE)
                .map_err(|e| format!("mDNS browse 失败: {}", e))?;
            ns.browsing = true;
            drop(ns);
            spawn_mdns_event_loop(receiver, state.inner().clone(), app.clone());
        }
    }
    if transport == "ble" || transport == "all" {
        #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
        {
            let app_clone = app.clone();
            tokio::spawn(async move { ble_scan_loop(app_clone).await });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn network_stop_discovery(
    _state: State<'_, Arc<Mutex<NetworkState>>>,
    _transport: String,
) -> Result<(), String> {
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
pub async fn network_connect(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
    peer_id: String,
) -> Result<(), String> {
    let address = {
        let ns = state.lock().await;
        ns.discovered_peers
            .get(&peer_id)
            .map(|p| p.address.clone())
            .ok_or_else(|| format!("设备未找到: {}", peer_id))?
    };

    let url = format!("ws://{}", address);
    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    {
        let mut ns = state.lock().await;
        ns.outbound_tx.insert(peer_id.clone(), tx);
    }

    let _pid_send = peer_id.clone();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let app_c = app.clone();
    let pid2 = peer_id.clone();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = read.next().await {
            if let Message::Text(text) = msg {
                let _ = app_c.emit("network:message-received", serde_json::json!({
                    "peerId": pid2,
                    "message": text,
                    "timestamp": now_iso(),
                }));
            }
        }
    });

    let _ = app.emit("network:peer-connected", serde_json::json!({
        "id": peer_id,
        "transport": "lan",
    }));
    Ok(())
}

#[tauri::command]
pub async fn network_send(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    peer_id: String,
    message: serde_json::Value,
) -> Result<(), String> {
    let msg_str = if let Some(s) = message.as_str() {
        s.to_string()
    } else {
        serde_json::to_string(&message).map_err(|e| format!("序列化失败: {}", e))?
    };

    let tx = {
        let ns = state.lock().await;
        ns.outbound_tx.get(&peer_id).cloned()
    };
    tx.ok_or_else(|| format!("未连接到设备: {}", peer_id))?
        .send(msg_str)
        .map_err(|e| format!("发送失败: {}", e))
}

#[tauri::command]
pub async fn network_disconnect(
    state: State<'_, Arc<Mutex<NetworkState>>>,
    app: AppHandle,
    peer_id: String,
) -> Result<(), String> {
    let mut ns = state.lock().await;
    ns.outbound_tx.remove(&peer_id);
    drop(ns);

    let _ = app.emit("network:peer-disconnected", serde_json::json!({
        "id": peer_id,
        "transport": "lan",
    }));
    Ok(())
}

// ============================================================
// LAN — WebSocket 监听器
// ============================================================

async fn ensure_ws_listener(state: &State<'_, Arc<Mutex<NetworkState>>>) -> Result<(), String> {
    let mut ns = state.lock().await;
    if ns.ws_port != 0 {
        return Ok(());
    }
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("WS 绑定失败: {}", e))?;
    ns.ws_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(ns);

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                if let Ok(ws) = accept_async(stream).await {
                    let (mut write, mut read) = ws.split();
                    while let Some(Ok(Message::Text(txt))) = read.next().await {
                        let _ = write.send(Message::Text(format!("echo:{}", txt))).await;
                    }
                }
            });
        }
    });
    Ok(())
}

// ============================================================
// LAN — mDNS
// ============================================================

async fn start_mdns_advertise(
    state: &State<'_, Arc<Mutex<NetworkState>>>,
    app: &AppHandle,
) -> Result<(), String> {
    let (device_id, device_name, port) = {
        let mut ns = state.lock().await;
        if ns.device_id.is_empty() {
            ns.device_id = get_device_id(app);
            ns.device_name = get_hostname_str();
        }
        if ns.ws_port == 0 {
            drop(ns);
            ensure_ws_listener(state).await?;
            let ns2 = state.lock().await;
            (ns2.device_id.clone(), ns2.device_name.clone(), ns2.ws_port)
        } else {
            (ns.device_id.clone(), ns.device_name.clone(), ns.ws_port)
        }
    };

    let ip = local_ip_address::local_ip()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());

    let short_id = &device_id[..device_id.len().min(8)];
    let instance_name = format!("{}.{}", device_name, short_id);
    let hostname = get_hostname_str();

    let properties = [
        ("id".to_string(), device_id),
        ("name".to_string(), device_name),
    ];

    // mdns-sd 0.11: ServiceInfo::new(ty, name, host, ip, port, props)
    let service_info = ServiceInfo::new(
        MDNS_SERVICE_TYPE,
        &instance_name,
        &hostname,
        ip.parse::<IpAddr>().map_err(|e| e.to_string())?,
        port,
        &properties[..],
    )
    .map_err(|e| format!("创建 mDNS 服务失败: {}", e))?;

    let ns = state.lock().await;
    ns.mdns
        .register(service_info)
        .map_err(|e| format!("注册 mDNS 失败: {}", e))?;
    Ok(())
}

fn spawn_mdns_event_loop(
    receiver: mdns_sd::Receiver<ServiceEvent>,
    state: Arc<Mutex<NetworkState>>,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        loop {
            match receiver.recv() {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    let peer_id = get_prop(&info, "id");
                    let peer_name = get_prop(&info, "name");
                    let addr = info
                        .get_addresses()
                        .iter()
                        .next()
                        .map(|a| format!("{}:{}", a, info.get_port()))
                        .unwrap_or_default();

                    let state = state.clone();
                    let app = app.clone();
                    let pid = peer_id.clone();
                    let pname = peer_name.clone();
                    let addr_c = addr.clone();

                    let rt = tokio::runtime::Handle::current();
                    let _ = rt.spawn(async move {
                        let mut ns = state.lock().await;
                        if pid == ns.device_id {
                            return;
                        }
                        let peer = DiscoveredPeer {
                            id: pid.clone(),
                            name: pname.clone(),
                            transport: "lan".into(),
                            address: addr_c,
                            rssi: None,
                            last_seen: now_iso(),
                        };
                        ns.discovered_peers.insert(pid.clone(), peer);
                        drop(ns);

                        let _ = app.emit("network:peer-discovered", serde_json::json!({
                            "id": pid,
                            "name": pname,
                            "transport": "lan",
                        }));
                    });
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });
}

// ============================================================
// BLE
// ============================================================

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
async fn ble_scan_loop(app: AppHandle) {
    use btleplug::api::{Central, Manager as BtManager, Peripheral as _, ScanFilter};
    use btleplug::platform::Manager;

    let manager = match Manager::new().await {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[network] BLE init failed: {}", e);
            return;
        }
    };
    let adapters = match manager.adapters().await {
        Ok(a) => a,
        Err(_) => return,
    };
    let central = match adapters.into_iter().next() {
        Some(c) => c,
        None => return,
    };
    if central.start_scan(ScanFilter::default()).await.is_err() {
        return;
    }

    let mut seen = std::collections::HashSet::new();
    loop {
        if let Ok(peripherals) = central.peripherals().await {
            for p in &peripherals {
                if let Ok(Some(props)) = p.properties().await {
                    let name = props.local_name.unwrap_or_else(|| p.id().to_string());
                    if seen.insert(name.clone()) {
                        let _ = app.emit("network:peer-discovered", serde_json::json!({
                            "id": p.id().to_string(),
                            "name": name,
                            "transport": "ble",
                            "rssi": props.rssi,
                        }));
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
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
