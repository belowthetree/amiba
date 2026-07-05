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
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    // 检查 HTTP 状态码（reqwest 自动跟随重定向）
    let status = response.status();
    if !status.is_success() {
        return Err(format!("服务器返回 HTTP {}", status.as_u16()));
    }

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

// ============================================================
// open_downloaded_file: 跨平台打开下载的文件（安装包等）
// Android: JNI → WebViewHelper.openFile（FileProvider + Intent）
// 桌面: std::process::Command（绕过 tauri-plugin-opener 的 Android bug）
// ============================================================

#[tauri::command]
fn open_downloaded_file(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let jvm_ptr = app.state::<crate::AndroidJvm>();
        let jvm = unsafe {
            jni::JavaVM::from_raw(jvm_ptr.0 as *mut _)
                .map_err(|e| format!("JVM from_raw 失败: {}", e))?
        };
        let mut env = jvm
            .attach_current_thread()
            .map_err(|e| format!("JVM attach 失败: {}", e))?;

        // 先获取 Application Context 并初始化 WebViewHelper（幂等）
        let app_ctx = get_android_app_context(&mut env)
            .map_err(|e| format!("获取 ApplicationContext 失败: {}", e))?;

        let helper_cls = find_app_class_android(&mut env, "com.amiba.desktop.WebViewHelper")
            .map_err(|e| format!("找不到 WebViewHelper: {}", e))?;

        // 确保 WebViewHelper 已初始化（内部创建隐藏 WebView，供 openFile 使用）
        let init_ok: bool = env
            .call_static_method(
                &helper_cls,
                "init",
                "(Landroid/content/Context;)Z",
                &[jni::objects::JValue::Object(&app_ctx)],
            )
            .map_err(|e| format!("调用 init 失败: {}", e))?
            .z()
            .map_err(|e| format!("解析 init 返回值: {}", e))?;
        if !init_ok {
            return Err("WebViewHelper.init 失败".into());
        }

        let path_jstr = env
            .new_string(&file_path)
            .map_err(|e| format!("new_string 失败: {}", e))?;
        let mime_str = env
            .new_string("application/vnd.android.package-archive")
            .map_err(|e| format!("new_string mime 失败: {}", e))?;

        let result = env
            .call_static_method(
                &helper_cls,
                "openFile",
                "(Ljava/lang/String;Ljava/lang/String;)Z",
                &[jni::objects::JValue::Object(&path_jstr.into()), jni::objects::JValue::Object(&mime_str.into())],
            )
            .map_err(|e| format!("调用 openFile 失败: {}", e))?;

        let ok: bool = result.z().map_err(|e| format!("解析返回值失败: {}", e))?;
        if ok {
            eprintln!("[open_downloaded_file] Android OK: {}", file_path);
            Ok(())
        } else {
            Err("openFile 返回 false（主线程超时？）".into())
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = &app; // desktop 路径用系统命令，不需要 app handle
        open_desktop(&file_path)
    }
}

/// 桌面：用系统默认程序打开文件
#[cfg(not(target_os = "android"))]
fn open_desktop(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", path])
            .spawn()
            .map_err(|e| format!("启动程序失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("启动程序失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("启动程序失败: {}", e))?;
    }
    eprintln!("[open_downloaded_file] desktop OK: {}", path);
    Ok(())
}

/// Android JNI: 从 Application Context ClassLoader 查找类（与 web.rs 一致）
#[cfg(target_os = "android")]
fn find_app_class_android<'a>(
    env: &mut jni::JNIEnv<'a>,
    name: &str,
) -> Result<jni::objects::JClass<'a>, String> {
    use jni::objects::JObject;

    let at_cls = env
        .find_class("android/app/ActivityThread")
        .map_err(|e| format!("findClass ActivityThread: {e}"))?;
    let at_obj = env
        .call_static_method(
            &at_cls,
            "currentActivityThread",
            "()Landroid/app/ActivityThread;",
            &[],
        )
        .map_err(|e| format!("currentActivityThread: {e}"))?;
    let at_raw = at_obj
        .l()
        .map_err(|e| format!("at_obj.l(): {e}"))?;
    let app_obj = env
        .call_method(
            &unsafe { JObject::from_raw(at_raw.cast()) },
            "getApplication",
            "()Landroid/app/Application;",
            &[],
        )
        .map_err(|e| format!("getApplication: {e}"))?;
    let app_raw = app_obj
        .l()
        .map_err(|e| format!("app_obj.l(): {e}"))?;
    let app = unsafe { JObject::from_raw(app_raw.cast()) };
    let cls_loader_obj = env
        .call_method(&app, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
        .map_err(|e| format!("getClassLoader: {e}"))?;
    let loader_raw = cls_loader_obj
        .l()
        .map_err(|e| format!("cls_loader.l(): {e}"))?;
    let loader = unsafe { JObject::from_raw(loader_raw.cast()) };
    let jname = env
        .new_string(name.replace('.', "/"))
        .map_err(|e| format!("newString: {e}"))?;
    let cls_obj = env
        .call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[jni::objects::JValue::Object(&jname.into())],
        )
        .map_err(|e| format!("loadClass {name}: {e}"))?;
    let cls_raw = cls_obj
        .l()
        .map_err(|e| format!("cls.l(): {e}"))?;
    Ok(unsafe { jni::objects::JClass::from_raw(cls_raw.cast()) })
}

/// Android JNI: 获取 Application Context（用于初始化 WebView 等组件）
#[cfg(target_os = "android")]
fn get_android_app_context<'a>(
    env: &mut jni::JNIEnv<'a>,
) -> Result<jni::objects::JObject<'a>, String> {
    use jni::objects::JObject;

    let at_cls = env
        .find_class("android/app/ActivityThread")
        .map_err(|e| format!("findClass ActivityThread: {e}"))?;
    let at_obj = env
        .call_static_method(
            &at_cls,
            "currentActivityThread",
            "()Landroid/app/ActivityThread;",
            &[],
        )
        .map_err(|e| format!("currentActivityThread: {e}"))?;
    let at_raw = at_obj.l().map_err(|e| format!("at_obj.l(): {e}"))?;
    let app_obj = env
        .call_method(
            &unsafe { JObject::from_raw(at_raw.cast()) },
            "getApplication",
            "()Landroid/app/Application;",
            &[],
        )
        .map_err(|e| format!("getApplication: {e}"))?;
    let app_raw = app_obj.l().map_err(|e| format!("app_obj.l(): {e}"))?;
    Ok(unsafe { JObject::from_raw(app_raw.cast()) })
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
      open_downloaded_file,
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
