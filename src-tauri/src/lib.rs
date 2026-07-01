mod db;
mod web;

use tauri::Manager;

/// Android: 缓存的 JavaVM 原始指针，在 setup 阶段从 ndk_context 获取
#[cfg(target_os = "android")]
pub struct AndroidJvm(pub *mut std::ffi::c_void);

// JVM 指针在 Android 进程生命周期内有效，跨线程传递安全
#[cfg(target_os = "android")]
unsafe impl Send for AndroidJvm {}
#[cfg(target_os = "android")]
unsafe impl Sync for AndroidJvm {}

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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
