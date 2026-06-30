mod db;
mod web;

use tauri::Manager;

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
      web::web_get_content,
      web::web_close,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
