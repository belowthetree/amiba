import { handleFsCommand } from './FsCommands'
import { getAppInfo } from './AppCommands'

const TAG = '[AmibaDispatcher]'

// 命令分发：与主仓 src/types/native-bridge.ts 注册表一一对应。
// 未实现命令显式抛错（H5 侧 try/catch 降级），按 docs/harmonyos-migration.md §7 路线图逐步补齐：
//   阶段1: web_fetch / search_sessions 等会话库 / download_file / service_http_request
//   阶段2: web_click / web_input_text / web_get_content / web_capture_screenshot / picker
//   阶段3: network_* / form_*（FormKit 卡片）
export async function dispatchCommand(cmd: string, argsJson: string): Promise<Object | null> {
  let args: Record<string, Object> = {}
  if (argsJson) {
    args = JSON.parse(argsJson) as Record<string, Object>
  }
  if (cmd.startsWith('fs_')) {
    return await handleFsCommand(cmd, args)
  }
  switch (cmd) {
    case 'get_app_info':
      return getAppInfo()
    default:
      throw new Error(`命令未实现: ${cmd}`)
  }
}
