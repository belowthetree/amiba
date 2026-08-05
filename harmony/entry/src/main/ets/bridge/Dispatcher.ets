import { handleFsCommand } from './FsCommands'
import { handleDbCommand, DB_COMMANDS } from './DbCommands'
import { handleHttpCommand, HTTP_COMMANDS } from './HttpCommands'
import { handleWebFetchCommand, WEB_COMMANDS } from './WebFetchCommands'
import { handlePickerCommand, PICKER_COMMANDS } from './PickerCommands'
import { handleNetworkCommand, NETWORK_COMMANDS } from './NetworkCommands'
import { handleFormCommand, FORM_COMMANDS } from './FormCommands'
import { getAppInfo } from './AppCommands'

const TAG = '[AmibaDispatcher]'

// 命令分发：与主仓 src/types/native-bridge.ts 注册表一一对应。
// 未实现命令显式抛错（H5 侧 try/catch 降级），按 docs/harmonyos-migration.md §7 路线图逐步补齐：
//   阶段1: web 引擎 6 命令（已实现，见 WebFetchCommands.ets；HTTP 三命令已实现，见 HttpCommands.ets；
//          会话库 8 命令已实现，见 DbCommands.ets）
//   阶段2: picker（已实现，见 PickerCommands.ets：file_access_* 4 命令，对应 Android SAF Picker 模型）
//   阶段3: network_*（已实现，见 NetworkCommands.ets：UDP 发现 + RFC6455 WS 服务端 + 13 命令）；
//          form_*（已实现，见 FormCommands.ets：FormKit 卡片 form_widget_update/consume_tap）
export async function dispatchCommand(cmd: string, argsJson: string): Promise<Object | null> {
  let args: Record<string, Object> = {}
  if (argsJson) {
    args = JSON.parse(argsJson) as Record<string, Object>
  }
  if (cmd.startsWith('fs_')) {
    return await handleFsCommand(cmd, args)
  }
  if (DB_COMMANDS.indexOf(cmd) >= 0) {
    return await handleDbCommand(cmd, args)
  }
  if (HTTP_COMMANDS.indexOf(cmd) >= 0) {
    return await handleHttpCommand(cmd, args)
  }
  if (WEB_COMMANDS.indexOf(cmd) >= 0) {
    return await handleWebFetchCommand(cmd, args)
  }
  if (PICKER_COMMANDS.indexOf(cmd) >= 0) {
    return await handlePickerCommand(cmd, args)
  }
  if (NETWORK_COMMANDS.indexOf(cmd) >= 0) {
    return await handleNetworkCommand(cmd, args)
  }
  if (FORM_COMMANDS.indexOf(cmd) >= 0) {
    return await handleFormCommand(cmd, args)
  }
  switch (cmd) {
    case 'get_app_info':
      return getAppInfo()
    default:
      throw new Error(`命令未实现: ${cmd}`)
  }
}
