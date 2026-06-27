// ============================================================
// 变形虫 (Amiba) — 内置命令模块
// ============================================================
// 与 skills（用户安装）不同，commands 是平台内置的 / 命令集合。
// 每个命令有名称、描述、handler。
// ============================================================
import { newSession } from './session'

export interface Command {
  /** 命令名（不含 / 前缀），如 "new" */
  name: string
  /** 简短描述 */
  description: string
  /** 执行命令，返回给用户展示的结果消息 */
  handler: () => Promise<string> | string
}

/** 所有注册的内置命令 */
const commands: Command[] = []

export function registerCommand(cmd: Command): void {
  commands.push(cmd)
}

export function getCommands(): Command[] {
  return commands
}

/** 匹配输入是否为命令，返回匹配的 Command */
export function matchCommand(input: string): Command | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const spaceIdx = trimmed.indexOf(' ')
  const cmdName = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1)
  return commands.find((c) => c.name === cmdName.toLowerCase()) || null
}

// ---- 内置命令: /new ----

registerCommand({
  name: 'new',
  description: '开始新的对话会话',
  handler: () => newSession(),
})
