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

// ---- 文件夹选取器命令族（鸿蒙壳 PickerCommands.ets；对应 Android SAF Picker 模型，方案见 docs/harmonyos-migration.md §5.7）----
// picker URI 形态 file://docs/storage/Users/currentUser/...（分层结构，子项按段 encodeURIComponent 拼接）。
// 授权持久化经 fileShare.persistPermission（ACL 受限权限，默认签名拿不到 → 降级为本次生命周期有效）。
export const PICKER_COMMANDS = {
  pickFolder: 'file_access_pick_folder', // {suffixes?: string[]} → {uri} | {files: [{uri,name,size}]} | null（取消；无 FolderSelection syscap 的设备壳层自动降级为 FILE 多选返回 files）
  fileAccessList: 'file_access_list', // {uri, pattern} → FileInfo[]（pattern 仅决定递归；glob 过滤在前端 _matchesPattern）
  fileAccessReadText: 'file_access_read_text', // {uri}（前端拼好子路径）→ {data: string}
  fileAccessReadBinary: 'file_access_read_binary', // {uri} → {data: base64}
} as const

// ---- 业务命令（Tauri Rust 侧已实现；鸿蒙壳按 docs/harmonyos-migration.md §5 映射表逐步实现）----
// web 引擎：web_fetch / web_get_content / web_click / web_input_text / web_close / web_capture_screenshot
// 会话库：search_sessions / index_message / index_message_batch / get_session
//         list_sessions_cmd / delete_session_cmd / scroll_session / read_session_cmd
// LAN 网络：network_set_visibility / network_get_visibility / network_start_discovery / network_stop_discovery
//          network_get_device_id / network_get_device_name / network_connect / network_send
//          network_disconnect / network_start_listener / network_stop_listener
//          （鸿蒙壳 NetworkCommands.ets 已实现：UDP 发现 + RFC6455 WS 服务端（NetworkWsServer/NetworkWsCodec）
//          + 官方 WS 客户端出站；另实现 Rust 注册但前端未调用的 network_get_visible_devices / network_get_ws_port）
// HTTP：download_file / cancel_download / service_http_request
// 卡片：android_widget_update / android_widget_consume_tap（Tauri/Android，widget.rs + Kotlin AppWidget）
//      form_widget_update / form_widget_consume_tap（鸿蒙壳 FormCommands.ets，FormKit，已实现）
//      · form_widget_update 线协议与 android_widget_update 逐字段对齐：{json: string}——
//        启用卡片载荷数组 JSON（元素字段见 desktop-widget-store.ts DesktopWidgetPayload）
//      · 鸿蒙最小扩展（android 版无此参数）：可选 assign: {formId, key}——重绑已放置的卡片
//        实例到指定卡片并立即刷新（Android 重绑走系统选卡页 WidgetConfigActivity；鸿蒙加卡
//        无配置 UI，onAddForm 自动绑定，重绑由前端设置/卡片管理发起）
//      · form_widget_consume_tap：{} → string，冷启动待跳转路径（读后清除，无则空串）
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
// download-complete —— 鸿蒙壳独有（Tauri 无对应事件）：Web 下载（<a download> blob 导出）
//   落盘完成通知，载荷 {path, name}（path 为沙箱 amiba/downloads/ 内绝对路径），当前前端不监听，预留
// amiba-widget-navigate —— 桌面卡片点击热通道，载荷为应用内跳转路径字符串（"/..."）。
//   Android 由 MainActivity 向 WebView 注入同名 DOM 事件；鸿蒙壳经 emitToWeb 推送
//   （FormCommands.handleHotTap），前端 App.vue 双通道监听（DOM 事件 + nativeListen）
