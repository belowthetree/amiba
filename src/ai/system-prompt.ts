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
import { soulManager } from './soul'

// ---- 缓存（stable 层缓存，volatile 层每次重建） ----

let cachedStable: string | null = null
let cachedStableToolsets: string[] = [] // 记录缓存的工具集，变化时重建 stable

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
  const toolsets = options.enabledToolsets || ['chat']
  const toolsetsKey = [...toolsets].sort().join(',')

  // stable 层：工具集变化或强制重建时才重建
  if (!cachedStable || options.force || cachedStableToolsets.join(',') !== toolsetsKey) {
    console.log('[SystemPrompt] 构建 stable 层... (toolsets:', toolsets, ')')
    cachedStable = buildStable(options)
    cachedStableToolsets = toolsets
    console.log('[SystemPrompt] stable 构建完成 —', cachedStable.length, '字符')
  } else {
    console.log('[SystemPrompt] stable 缓存命中 —', cachedStable.length, '字符')
  }

  // volatile 层：每次调用重建（nudge / 时间 / 记忆快照可能变化）
  const volatile = buildVolatile(options)

  const full = [cachedStable, volatile].filter(Boolean).join('\n\n')
  console.log('[SystemPrompt] 完整 prompt:', full.length, '字符 (turnCount:', options.turnCount, ')')
  return full
}

export function invalidateSystemPrompt(): void {
  console.log('[SystemPrompt] 缓存已失效')
  cachedStable = null
  cachedStableToolsets = []
}

// ---- 组装 ----

function buildStable(options: {
  enabledToolsets?: string[]
  turnCount?: number
}): string {
  const availableTools = resolveToolNames(options.enabledToolsets || ['chat'])

  return [
    buildIdentity(),
    buildPlatformCapabilities(),
    buildBehaviorGuidance(availableTools),
    buildSkillsIndexSync(),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildVolatile(options: {
  enabledToolsets?: string[]
  turnCount?: number
}): string {
  return [
    memoryStore.formatForSystemPrompt(),
    buildTimestamp(),
    buildNudge(options.turnCount),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 记忆检查点：/new 时捕获上一会话片段，提示 AI 保存记忆。
 * 在 buildSystemPrompt 入口处异步注入到 volatile 之后。
 */
let memoryCheckpointCache: string | null = null

export async function consumeMemoryCheckpointPrompt(): Promise<string> {
  if (memoryCheckpointCache !== null) {
    const cp = memoryCheckpointCache
    memoryCheckpointCache = null
    return cp
  }

  try {
    const checkpoint = await import('../config/storage').then((m) =>
      m.storageGetJSON<{ context: string }>('amiba_memory_checkpoint')
    )
    if (checkpoint?.context) {
      // 读取后清除
      const { storageSetJSON } = await import('../config/storage')
      await storageSetJSON('amiba_memory_checkpoint', null)
      return checkpoint.context
    }
  } catch {
    /* 非 Tauri 环境 */
  }
  return ''
}

/** session.ts 在 newSession() 时调用此函数设置检查点缓存 */
export function setMemoryCheckpointFromCache(context: string): void {
  memoryCheckpointCache = context
}

// ---- Stable: 身份定义（来自 SOUL.md） ----

function buildIdentity(): string {
  return soulManager.getCurrentContent()
}

// ---- Stable: 平台能力提示（告诉人格能做什么） ----

const PLATFORM_CAPABILITIES = `## 平台能力

你运行在变形虫 (Amiba) 桌面应用中。以下是你可以使用的平台能力:

- **生成服务**: 根据用户需求生成完整的迷你 Web 应用（HTML/CSS/JS），运行在 iframe 沙箱中
- **编辑服务**: 使用 service_file_list/read/write 工具直接编辑已生成服务的文件
- **持久记忆**: 使用 memory 工具保存信息到 MEMORY.md（AI 笔记）或 USER.md（用户画像）
- **技能系统**: 用户可通过 /skill-name 触发技能，或通过 skill_view 查看技能内容
- **Chart.js**: 生成的服务中可使用 Chart.js v4 绘制图表（<script src="/libs/chart.umd.min.js">）
- **JSBridge**: 服务通过 window.__amiba__ 调用存储、通知、导航等宿主能力
- **命令**: 输入 /new 开始新会话

请用中文回复，保持简洁有帮助。`

function buildPlatformCapabilities(): string {
  return PLATFORM_CAPABILITIES
}

// ---- Stable: 行为指引（按可用工具条件注入） ----

const MEMORY_GUIDANCE = `## 记忆使用指引（重要：请主动使用！）
你拥有持久记忆能力。当对话中出现以下情况时，**主动调用 memory 工具**保存，不要等待用户指令：
- 用户提供了个人偏好、背景信息、称呼 → 保存到 USER.md（target="user"）
- 用户提出了重要目标、约束、决策 → 保存到 MEMORY.md（target="memory"）
- 项目进展到关键节点、完成了重要任务 → 更新 MEMORY.md
- 用户明确说"记住这个" → 保存
- 每次对话达到 10 轮时 → 系统会强制要求你检查记忆

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

const SKILL_MANAGE_GUIDANCE = `## 技能创建与改进指引
当以下情况发生时，你应该创建或修补技能：
- 复杂任务成功完成（5+ 次 tool call）
- 错误被克服，找到了奏效的方法
- 用户纠正了一个方法且该方法有效
- 发现了值得记录的非平凡工作流
- 用户明确要求记住某个流程

修改技能时优先使用 skill_manage_patch（精确查找替换），
只有在需要大幅度重写（超过 50% 内容变更）时才使用 skill_manage_edit。
删除技能用 skill_manage_delete，可声明 absorbed_into 说明被哪个技能取代。
使用 skill_manage_write_file 向技能目录添加 references/、templates/ 等支持文件。

⚠️ 内置技能（counter / todo / notes / service-dev）不可修改或删除。`

const REQUIREMENT_GUIDANCE = `## 需求追踪指引（重要：主动使用！）
你拥有需求追踪能力。当对话涉及已生成的服务时，**主动使用 requirement_update 工具**记录：
- 用户提出新功能需求 → type="requirement"，追加到对应服务
- 用户反馈界面/体验问题 → type="optimization" 或 type="feedback"
- 需求完成 → type="done"
- 需求可能暗示需要全新服务 → 设 global_opportunity 参数

生成新服务前，先用 requirements_summary 检查是否已有类似需求或可通过修改现有服务满足。`

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
  if (availableTools.includes('skill_manage_create')) {
    parts.push(SKILL_MANAGE_GUIDANCE)
  }
  if (availableTools.includes('requirement_update')) {
    parts.push(REQUIREMENT_GUIDANCE)
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
    console.log(`[SystemPrompt] 🧠 记忆 nudge 触发 — 第 ${turnCount} 轮`)
    return [
      '=== 记忆与需求保存检查（必须执行） ===',
      `当前是第 ${turnCount} 轮对话。你必须执行以下步骤：`,
      '',
      '1. 快速回顾本轮的对话内容',
      '2. 记忆检查：',
      '   - 用户偏好、背景、习惯 → memory(target="user")',
      '   - 重要决策、项目约束、待办 → memory(target="memory")',
      '3. 需求检查（如果对话涉及已生成的服务）：',
      '   - 新功能需求 → requirement_update(type="requirement")',
      '   - 界面/体验优化 → requirement_update(type="optimization")',
      '   - 用户反馈 → requirement_update(type="feedback")',
      '   - 需求如果无法通过修改现有服务满足 → 标记 global_opportunity',
      '4. 如果有内容需要保存，立即调用相应工具，然后再回复用户',
      '5. 如果确实没有新信息，说明「本轮无需更新」即可',
      '',
      '注意：这些检查必须在回复用户之前完成。',
    ].join('\n')
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
