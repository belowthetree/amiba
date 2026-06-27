// ============================================================
// 变形虫 (Amiba) — System Prompt 组装器
// ============================================================
// 基于 systemprompt.md 设计：
// - 两层结构：stable（身份+规则+技能索引）+ volatile（记忆快照+时间+nudge）
// - 缓存机制：会话期间复用，避免每轮重建
// - 工具 schemas 走 API tools 参数，不在 system prompt 中
// - 记忆快照在构建时冻结
// ============================================================
import { memoryStore } from './memory-store'
import { getSkillCommands } from './skill-commands'
import { resolveToolset } from '../tools/toolsets'

// ---- 缓存 ----

let cachedSystemPrompt: string | null = null

export function buildSystemPrompt(
  options: {
    /** 启用工具集（用于条件注入行为指引） */
    enabledToolsets?: string[]
    /** 当前对话轮次（用于 nudge 提示） */
    turnCount?: number
    /** 强制重建（忽略缓存） */
    force?: boolean
  } = {}
): string {
  if (cachedSystemPrompt && !options.force) {
    console.log('[SystemPrompt] 缓存命中 —', cachedSystemPrompt.length, '字符')
    return cachedSystemPrompt
  }

  console.log('[SystemPrompt] 构建中... (turnCount:', options.turnCount, ', toolsets:', options.enabledToolsets, ')')
  const parts = assembleParts(options)
  cachedSystemPrompt = [parts.stable, parts.volatile]
    .filter(Boolean)
    .join('\n\n')
  console.log('[SystemPrompt] 构建完成 —', cachedSystemPrompt.length, '字符')
  console.log('[SystemPrompt] 预览 (前120字):', cachedSystemPrompt.slice(0, 120).replace(/\n/g, '↵'))
  return cachedSystemPrompt
}

export function invalidateSystemPrompt(): void {
  console.log('[SystemPrompt] 缓存已失效')
  cachedSystemPrompt = null
}

// ---- 组装 ----

interface SystemPromptParts {
  stable: string
  volatile: string
}

function assembleParts(options: {
  enabledToolsets?: string[]
  turnCount?: number
}): SystemPromptParts {
  const availableTools = resolveToolNames(options.enabledToolsets || ['chat'])

  const stable = [
    buildIdentity(),
    buildBehaviorGuidance(availableTools),
    buildSkillsIndexSync(),
  ]
    .filter(Boolean)
    .join('\n\n')

  const volatile = [
    memoryStore.formatForSystemPrompt(),
    buildTimestamp(),
    buildNudge(options.turnCount),
  ]
    .filter(Boolean)
    .join('\n\n')

  return { stable, volatile }
}

// ---- Stable: 身份定义 ----

const AMIBA_AGENT_IDENTITY = `你是变形虫 (Amiba) 平台的 AI 助手。你可以帮助用户完成各种任务，包括使用工具保存记忆、生成服务等。

## 当前平台信息
- 变形虫是一个跨平台应用，允许用户使用 AI 自由生成类似小程序的即时应用
- 内置功能: 首页、AI 对话、AI 生成服务、设置、我的服务、记忆管理
- 用户生成的服务运行在安全的 iframe 沙箱中，通过 JSBridge 调用宿主能力
- 服务中可使用 Chart.js v4 绘制图表（<script src="/libs/chart.umd.min.js">）
- 如果用户需要编辑已有服务，使用 service_file_list/read/write 工具，不要重新生成

请用中文回复，保持简洁有帮助。`

function buildIdentity(): string {
  return AMIBA_AGENT_IDENTITY
}

// ---- Stable: 行为指引（按可用工具条件注入） ----

const MEMORY_GUIDANCE = `## 记忆使用指引
当对话中出现以下情况时，使用 memory 工具保存:
- 用户提供了个人偏好、背景信息 → 保存到 USER.md
- 用户提出了重要目标或约束 → 保存到 MEMORY.md
- 项目进展到关键节点 → 更新 MEMORY.md
- 用户明确说"记住这个" → 保存

注意: 记忆条目用 § 分隔，字符有限额 (MEMORY: 2200, USER: 1375)。满时自动挤掉旧条目。`

const GENERATE_GUIDANCE = `## 服务生成指引
当用户要求「开发/创建/写一个 XX」时:
1. 如果用户指定了具体需求 → 使用 generate_service 工具
2. 如果用户使用 /skill-name 或提及某个技能 → 按技能内容执行
3. 生成的 ServicePackage 必须包含 manifest + files（必须有 index.html）

生成后如需修改: 使用 service_file_list/read/write 直接编辑文件，不要重新生成整个服务。`

const SKILL_GUIDANCE = `## 技能使用指引
用户可通过 /skill-name 触发技能。技能内容会展开到对话中。
你可以通过 skill_view 工具查看技能详情，skills_list 浏览可用技能列表。`

function buildBehaviorGuidance(availableTools: string[]): string {
  const parts: string[] = []
  if (availableTools.includes('memory')) {
    parts.push(MEMORY_GUIDANCE)
  }
  if (availableTools.includes('generate_service')) {
    parts.push(GENERATE_GUIDANCE)
  }
  if (availableTools.includes('skill_view')) {
    parts.push(SKILL_GUIDANCE)
  }
  return parts.join('\n\n')
}

// ---- Stable: 技能索引（同步占位，异步补充） ----

function buildSkillsIndexSync(): string {
  // 同步返回空字符串——技能索引由 agent.ts 在 streamChat 中异步构建后
  // 通过 buildSkillsIndex() 追加到 system prompt 末尾
  return ''
}

/**
 * 异步构建技能索引（由 agent.ts 在 streamChat 中调用）
 */
export async function buildSkillsIndex(): Promise<string> {
  const skills = await getSkillCommands()
  if (skills.size === 0) return ''

  const lines = ['## 可用技能', '']
  for (const [slug, info] of skills) {
    lines.push(`- /${slug} — ${info.description}`)
  }
  lines.push('', '调用方式: 输入 /skill-name 或使用 skill_view 工具')
  return lines.join('\n')
}

// ---- Volatile: 记忆快照 + 时间 + nudge ----

function buildTimestamp(): string {
  return `对话时间: ${new Date().toISOString().slice(0, 10)}`
}

function buildNudge(turnCount?: number): string {
  if (turnCount === undefined || turnCount <= 0) return ''
  const NUDGE_INTERVAL = 10
  if (turnCount % NUDGE_INTERVAL === 0) {
    return `[提示: 当前已是第 ${turnCount} 轮对话。如果对话中出现了值得长期保存的信息，可以用 memory 工具保存到 MEMORY.md 或 USER.md。]`
  }
  return ''
}

// ---- 辅助 ----

function resolveToolNames(toolsetNames: string[]): string[] {
  const names = new Set<string>()
  for (const ts of toolsetNames) {
    for (const name of resolveToolset(ts)) {
      names.add(name)
    }
  }
  return [...names]
}
