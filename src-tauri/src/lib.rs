mod db;
mod web;
mod network_visibility;
mod network_session;

use tauri::Manager;
use tauri::Emitter;

/// Android: 缓存的 JavaVM 原始指针，在 setup 阶段从 ndk_context 获取
#[cfg(target_os = "android")]
pub struct AndroidJvm(pub *mut std::ffi::c_void);

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

    let client = reqwest::Client::builder()
        .user_agent("amiba-updater")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    let total = response.content_length().unwrap_or(0);
    let mut received: u64 = 0;

    // 确保目标目录存在
    let dest_path = std::path::Path::new(&dest);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let mut file = std::fs::File::create(&dest)
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("接收数据失败: {}", e))?;
        received += chunk.len() as u64;
        file.write_all(&chunk)
            .map_err(|e| format!("写入文件失败: {}", e))?;

        // 发射进度事件
        let _ = app.emit("download-progress", serde_json::json!({
            "received": received,
            "total": total,
        }));
    }

    file.flush().map_err(|e| format!("刷新文件失败: {}", e))?;

    println!("[download_file] 完成: {} → {} ({} bytes)", url, dest, received);
    Ok(dest)
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

      // Android: 缓存 JavaVM 指针
      #[cfg(target_os = "android")]
      {
        let vm_ptr = unsafe {
          type GetCreatedJavaVMsFn = unsafe extern "system" fn(
            vm_buf: *mut *mut std::ffi::c_void,
            buf_len: i32,
            n_vms: *mut i32,
          ) -> i32;

          let lib = libloading::Library::new("libnativehelper.so")
            .or_else(|_| libloading::Library::new("libandroid_runtime.so"))
            .or_else(|_| libloading::Library::new("libdvm.so"));

          match lib {
            Ok(lib) => {
              let func: libloading::Symbol<GetCreatedJavaVMsFn> =
                match unsafe { lib.get(b"JNI_GetCreatedJavaVMs") } {
                  Ok(f) => f,
                  Err(e) => {
                    eprintln!("[rust:lib] dlsym JNI_GetCreatedJavaVMs: {e}");
                    app.manage(AndroidJvm(std::ptr::null_mut()));
                    return Ok(());
                  }
                };
              let mut vm_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
              let mut n_vms: i32 = 0;
              let ret = unsafe { func(&mut vm_ptr, 1, &mut n_vms) };
              if ret != 0 || n_vms == 0 || vm_ptr.is_null() {
                eprintln!("[rust:lib] JVM not available, web_browse disabled");
                app.manage(AndroidJvm(std::ptr::null_mut()));
                return Ok(());
              }
              vm_ptr
            }
            Err(e) => {
              eprintln!("[rust:lib] dlopen libnativehelper: {e}");
              app.manage(AndroidJvm(std::ptr::null_mut()));
              return Ok(());
            }
          }
        };
        app.manage(AndroidJvm(vm_ptr));
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      download_file,
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
