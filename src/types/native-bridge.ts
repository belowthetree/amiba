// ==== 原生桥命令注册表 ====
// 前端 platform-bridge.ts / native-fs.ts 与鸿蒙壳 ArkTS Dispatcher 的协议单一事实源。
// 新增原生命令时：此处登记 → ArkTS 侧 Dispatcher 实现 → 前端经 nativeInvoke 调用。
// 迁移方案总览见 docs/harmonyos-migration.md。

// ---- 文件系统命令族（native-fs.ts 兼容 shim 的远端实现）----
// 线协议：nativeInvoke(cmd, args) → ArkTS 返回 JSON；二进制内容一律 base64。
export const FS_COMMANDS = {
  readTextFile: 'fs_read_text_file', // {path, baseDir?} → {data: string}
  writeTextFile: 'fs_write_text_file', // {path, data, baseDir?} → {}
  readFile: 'fs_read_file', // {path, baseDir?} → {data: base64}
  writeFile: 'fs_write_file', // {path, data: base64, baseDir?} → {}
  readDir: 'fs_read_dir', // {path, baseDir?} → {entries: FsDirEntryWire[]}
  mkdir: 'fs_mkdir', // {path, recursive?, baseDir?} → {}
  remove: 'fs_remove', // {path, recursive?, baseDir?} → {}
  exists: 'fs_exists', // {path, baseDir?} → {exists: boolean}
  rename: 'fs_rename', // {oldPath, newPath, oldPathBaseDir?, newPathBaseDir?} → {}
  stat: 'fs_stat', // {path, baseDir?} → FsStatWire
  appDataDir: 'fs_app_data_dir', // {} → {path: string}
  appCacheDir: 'fs_app_cache_dir', // {} → {path: string}
} as const

// ---- 应用信息命令族 ----
export const APP_COMMANDS = {
  getAppInfo: 'get_app_info', // {} → {version: string}
} as const

// ---- 业务命令（Tauri Rust 侧已实现；鸿蒙壳按 docs/harmonyos-migration.md §5 映射表逐步实现）----
// web 引擎：web_fetch / web_get_content / web_click / web_input_text / web_close / web_capture_screenshot
// 会话库：search_sessions / index_message / index_message_batch / get_session
//         list_sessions_cmd / delete_session_cmd / scroll_session / read_session_cmd
// LAN 网络：network_set_visibility / network_get_visibility / network_start_discovery / network_stop_discovery
//          network_get_device_id / network_get_device_name / network_connect / network_send
//          network_disconnect / network_start_listener / network_stop_listener
// HTTP：download_file / cancel_download / service_http_request
// 卡片：android_widget_update / android_widget_consume_tap（鸿蒙对应 FormKit form_* 命令族，阶段3）
// 下线：read_tombstone（鸿蒙无对等 API）

// ---- fs 线协议类型 ----

export interface FsDirEntryWire {
  name: string
  isDirectory: boolean
  isFile: boolean
  isSymlink: boolean
}

export interface FsStatWire {
  size: number
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  /** 毫秒时间戳；null 表示平台不提供 */
  mtimeMs: number | null
  atimeMs: number | null
  btimeMs: number | null
}

// ---- 原生 → 前端事件名（与 Tauri emit 保持一致，鸿蒙壳经 __amiba_harmony_emit__ 推送）----
// network:peer-discovered / network:peer-lost / network:session-created
// network:session-message / network:session-closed / network:session-error
// download-progress / webview-screenshot
