mod db;
mod web;
mod network_visibility;
mod network_session;
mod picker;
mod android_util;
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::Manager;
use tauri::Emitter;
use tokio::sync::watch;
use url::Url;

/// 下载取消令牌：download_file 流式循环中检查此通道，cancel_download 触发
struct DownloadCancel(Mutex<Option<watch::Sender<bool>>>);

/// Android: 缓存的 JavaVM 原始指针，在 setup 阶段从 ndk_context 获取
#[cfg(target_os = "android")]
pub struct AndroidJvm(pub *mut std::ffi::c_void);

#[cfg(target_os = "android")]
impl AndroidJvm {
    /// 安全获取 JavaVM 引用。指针为 null 时返回可读错误而非 SIGSEGV。
    pub fn get_vm(&self) -> Result<jni::JavaVM, String> {
        if self.0.is_null() {
            return Err("JavaVM not available on this device".into());
        }
        unsafe {
            jni::JavaVM::from_raw(self.0 as *mut _)
                .map_err(|e| format!("JVM from_raw failed: {e}"))
        }
    }
}

// JVM 指针在 Android 进程生命周期内有效，跨线程传递安全
#[cfg(target_os = "android")]
unsafe impl Send for AndroidJvm {}
#[cfg(target_os = "android")]
unsafe impl Sync for AndroidJvm {}

// ============================================================
// download_file: 用 reqwest 下载文件，绕过浏览器 CORS
// 发射 download-progress 事件供前端展示进度条
// ============================================================

#[tauri::command]
async fn download_file(
    app: tauri::AppHandle,
    url: String,
    dest: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    // 建立取消通道
    let (tx, rx) = watch::channel(false);
    {
        let cancel = app.state::<DownloadCancel>();
        *cancel.0.lock().unwrap() = Some(tx);
    }

    let client = reqwest::Client::builder()
        .user_agent("amiba-updater")
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("服务器返回 HTTP {}", status.as_u16()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut received: u64 = 0;

    let dest_path = std::path::Path::new(&dest);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let mut file = std::fs::File::create(&dest)
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        // 检查是否被取消
        if *rx.borrow() {
            drop(file);
            let _ = std::fs::remove_file(&dest);
            println!("[download_file] 已取消: {}", url);
            return Err("下载已取消".into());
        }

        let chunk = chunk.map_err(|e| format!("接收数据失败: {}", e))?;
        received += chunk.len() as u64;
        file.write_all(&chunk)
            .map_err(|e| format!("写入文件失败: {}", e))?;

        let _ = app.emit("download-progress", serde_json::json!({
            "received": received,
            "total": total,
        }));
    }

    file.flush().map_err(|e| format!("刷新文件失败: {}", e))?;

    // 清理取消通道
    {
        let cancel = app.state::<DownloadCancel>();
        *cancel.0.lock().unwrap() = None;
    }

    println!("[download_file] 完成: {} → {} ({} bytes)", url, dest, received);
    Ok(dest)
}

/// 取消正在进行的下载
#[tauri::command]
fn cancel_download(app: tauri::AppHandle) -> Result<(), String> {
    let cancel = app.state::<DownloadCancel>();
    let tx = cancel.0.lock().unwrap().take();
    if let Some(tx) = tx {
        let _ = tx.send(true);
        println!("[cancel_download] 已发送取消信号");
    }
    Ok(())
}

// ============================================================
// service_http_request: 服务 HTTP 请求代理，允许 LAN IP
// 绕过浏览器 CORS 和移动端明文流量限制
// ============================================================

#[tauri::command]
async fn service_http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("Blocked protocol: {scheme}"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("AmibaService/1.0")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let method_upper = method.to_uppercase();
    let mut req = match method_upper.as_str() {
        "GET" => client.get(parsed.as_str()),
        "POST" => client.post(parsed.as_str()),
        "PUT" => client.put(parsed.as_str()),
        "DELETE" => client.delete(parsed.as_str()),
        _ => return Err(format!("Unsupported HTTP method: {method}")),
    };

    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }

    if let Some(ref b) = body {
        req = req.body(b.clone());
    }

    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    let status = resp.status().as_u16();
    let resp_body = resp.text().await.map_err(|e| format!("Read response: {e}"))?;

    Ok(serde_json::json!({
        "status": status,
        "body": resp_body,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      app.handle().plugin(tauri_plugin_fs::init())?;
      app.handle().plugin(tauri_plugin_dialog::init())?;
      app.handle().plugin(tauri_plugin_opener::init())?;
      app.handle().plugin(tauri_plugin_android_installer::init())?;
      app.handle().plugin(tauri_plugin_android_fs::init())?;

      // 初始化 SQLite session DB
      let db_path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("amiba")
        .join("state.db");
      let db = db::SessionDB::open(&db_path)
        .expect("Failed to open session database");
      app.manage(db);

      // 初始化浏览器池
      app.manage(web::BrowserPool::new());

      // 初始化网络互联状态（可见性 + 会话两个独立状态）
      let vis_state = network_visibility::init_visibility_state(app.handle());
      app.manage(std::sync::Arc::new(tokio::sync::Mutex::new(vis_state)));
      let sess_state = network_session::init_session_store();
      app.manage(std::sync::Arc::new(tokio::sync::Mutex::new(sess_state)));

      // 下载取消令牌
      app.manage(DownloadCancel(Mutex::new(None)));

      // Android: 缓存 JavaVM 指针（libloading 动态查找）
      #[cfg(target_os = "android")]
      {
        let vm_ptr = (|| -> *mut std::ffi::c_void {
          unsafe {
            type GetCreatedJavaVMsFn = unsafe extern "system" fn(
              vm_buf: *mut *mut std::ffi::c_void,
              buf_len: i32,
              n_vms: *mut i32,
            ) -> i32;

            let lib = libloading::Library::new("libnativehelper.so")
              .or_else(|_| libloading::Library::new("libandroid_runtime.so"))
              .or_else(|_| libloading::Library::new("libdvm.so"));

            let lib = match lib {
              Ok(l) => l,
              Err(e) => {
                eprintln!("[rust:lib] dlopen failed: {e}");
                return std::ptr::null_mut();
              }
            };

            let func: libloading::Symbol<GetCreatedJavaVMsFn> =
              match lib.get(b"JNI_GetCreatedJavaVMs") {
                Ok(f) => f,
                Err(e) => {
                  eprintln!("[rust:lib] dlsym JNI_GetCreatedJavaVMs: {e}");
                  return std::ptr::null_mut();
                }
              };

            let mut vp: *mut std::ffi::c_void = std::ptr::null_mut();
            let mut n_vms: i32 = 0;
            let ret = func(&mut vp, 1, &mut n_vms);
            if ret != 0 || n_vms == 0 || vp.is_null() {
              eprintln!("[rust:lib] JVM not available via libloading (ret={ret}, n={n_vms})");
              std::ptr::null_mut()
            } else {
              eprintln!("[rust:lib] ✓ JVM obtained via libloading");
              vp
            }
          }
        })();

        if vm_ptr.is_null() {
          eprintln!("[rust:lib] ✗ JVM unavailable — web_browse / folder_picker will use fallback");
        }
        app.manage(AndroidJvm(vm_ptr));
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      download_file,
      cancel_download,
      service_http_request,
      db::commands::search_sessions,
      db::commands::index_message,
      db::commands::index_message_batch,
      db::commands::get_session,
      db::commands::list_sessions_cmd,
      db::commands::delete_session_cmd,
      db::commands::scroll_session,
      db::commands::read_session_cmd,
      web::web_fetch,
      web::web_eval,
      web::web_click,
      web::web_input_text,
      web::web_get_content,
      web::web_close,
      web::web_capture_screenshot,
      network_visibility::network_set_visibility,
      network_visibility::network_get_visibility,
      network_visibility::network_start_discovery,
      network_visibility::network_stop_discovery,
      network_visibility::network_get_visible_devices,
      network_session::network_connect,
      network_session::network_send,
      network_session::network_disconnect,
      network_session::network_get_ws_port,
      network_session::network_start_listener,
      network_session::network_stop_listener,
      network_visibility::network_get_device_id,
      network_visibility::network_get_device_name,
      picker::read_tombstone,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
