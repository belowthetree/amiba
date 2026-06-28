// ============================================================
// 变形虫 (Amiba) — Skill Curator（后台生命周期编排器）
// ============================================================
// 职责：
//   ① 确定性 prune：基于时间戳的 active → stale → archived 迁移
//   ② 归档/恢复：管理 skills/.archive/ 目录
//   ③ 运行报告：记录每次 curator 运行的前后快照
//
// 触发方式：
//   - 应用启动时自动检查（距上次运行超过 intervalHours）
//   - Settings 页面手动触发
//
// 规则：
//   - Pinned 技能完全不触碰
//   - 受保护内置技能永不修改
//   - User-created（created_by === null）默认不自动归档
//   - Agent-created（created_by === 'agent'）受 curator 管理
// ============================================================
import {
  getUsage,
  setState,
  getAgentCreatedSlugs,
  getManageableSkills,
  invalidateUsageCache,
} from './skill-usage'
import type { UsageDb, SkillUsageEntry } from './skill-usage'
import { buildConsolidationPrompt, buildConsolidationUserMessage } from './skill-consolidation-prompt'

// ---- 受保护内置技能 ----

const PROTECTED_BUILTIN_SKILLS = ['counter', 'todo', 'notes', 'service-dev']

function isProtected(slug: string): boolean {
  return PROTECTED_BUILTIN_SKILLS.includes(slug)
}

// ---- 路径 ----

const SKILLS_ROOT = 'skills'
const ARCHIVE_ROOT = 'skills/.archive'
const CURATOR_STATE_KEY = 'skills/.curator_state'
const CURATOR_LOGS_DIR = 'skills/.curator-logs'

// ---- Curator 状态 ----

interface CuratorState {
  last_run_at: string | null // ISO 8601
  run_count: number
  total_archived: number
}

async function loadCuratorState(): Promise<CuratorState> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(CURATOR_STATE_KEY, {
      baseDir: BaseDirectory.AppData,
    })
    return JSON.parse(raw) as CuratorState
  } catch {
    return { last_run_at: null, run_count: 0, total_archived: 0 }
  }
}

async function saveCuratorState(state: CuratorState): Promise<void> {
  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    )
    await mkdir('skills', {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    }).catch(() => {})
    await writeTextFile(CURATOR_STATE_KEY, JSON.stringify(state, null, 2), {
      baseDir: BaseDirectory.AppData,
    })
  } catch (e) {
    console.debug('[Curator] 保存状态失败:', e)
  }
}

// ---- 默认配置 ----

const DEFAULT_CONFIG: CuratorConfig = {
  enabled: true,
  intervalHours: 168, // 7 天
  staleAfterDays: 30,
  archiveAfterDays: 90,
  consolidateEnabled: false,
}

export interface CuratorConfig {
  enabled: boolean
  intervalHours: number
  staleAfterDays: number
  archiveAfterDays: number
  consolidateEnabled: boolean
}

// ---- 运行时配置（可从 settings 覆盖） ----

let curatorConfig: CuratorConfig = { ...DEFAULT_CONFIG }

export function updateCuratorConfig(patch: Partial<CuratorConfig>): void {
  Object.assign(curatorConfig, patch)
}

export function getCuratorConfig(): CuratorConfig {
  return { ...curatorConfig }
}

// ---- 确定性状态迁移 ----

interface Transition {
  slug: string
  from: string
  to: string
  reason: string
}

async function applyAutomaticTransitions(
  db: UsageDb,
  config: CuratorConfig
): Promise<Transition[]> {
  const transitions: Transition[] = []
  const now = Date.now()

  for (const [slug, entry] of Object.entries(db)) {
    // 跳过受保护内置
    if (isProtected(slug)) continue
    // 跳过 pinned
    if (entry.pinned) continue
    // 跳过已归档
    if (entry.state === 'archived') continue
    // 用户创建的 skill 默认不自动归档（视为用户资产）
    if (entry.created_by === null) continue

    const lastUsed = entry.last_used_at
      ? new Date(entry.last_used_at).getTime()
      : new Date(entry.created_at).getTime()

    const daysSinceUsed = (now - lastUsed) / (1000 * 60 * 60 * 24)

    if (entry.state === 'active' && daysSinceUsed > config.staleAfterDays) {
      await setState(slug, 'stale')
      console.log(`[Curator] ⏳ stale: ${slug}（${Math.round(daysSinceUsed)} 天未使用）`)
      transitions.push({
        slug,
        from: 'active',
        to: 'stale',
        reason: `未使用超过 ${config.staleAfterDays} 天（${Math.round(daysSinceUsed)} 天）`,
      })
    } else if (
      entry.state === 'stale' &&
      daysSinceUsed > config.archiveAfterDays
    ) {
      // 归档：移动目录
      await archiveSkillDir(slug)
      await setState(slug, 'archived')
      console.log(`[Curator] 📦 归档: ${slug}（${Math.round(daysSinceUsed)} 天未使用）`)
      transitions.push({
        slug,
        from: 'stale',
        to: 'archived',
        reason: `未使用超过 ${config.archiveAfterDays} 天（${Math.round(daysSinceUsed)} 天）`,
      })
    }
  }

  return transitions
}

// ---- 归档/恢复目录操作 ----

async function archiveSkillDir(slug: string): Promise<string> {
  const { rename, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')

  await mkdir(ARCHIVE_ROOT, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  }).catch(() => {})

  // 处理同名冲突
  let archiveSlug = slug
  const { exists } = await import('@tauri-apps/plugin-fs')
  const alreadyExists = await exists(`${ARCHIVE_ROOT}/${archiveSlug}`, {
    baseDir: BaseDirectory.AppData,
  }).catch(() => false)
  if (alreadyExists) {
    archiveSlug = `${slug}-${Date.now()}`
  }

  await rename(
    `${SKILLS_ROOT}/${slug}`,
    `${ARCHIVE_ROOT}/${archiveSlug}`,
    {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    }
  )

  console.log(`[Curator] 已归档: ${slug} → .archive/${archiveSlug}`)
  return archiveSlug
}

export async function restoreSkillDir(slug: string): Promise<void> {
  const { rename, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const { exists } = await import('@tauri-apps/plugin-fs')

  // 查找归档目录
  const { readDir } = await import('@tauri-apps/plugin-fs')
  let archiveSlug = slug

  // 先尝试精确匹配
  const exact = await exists(`${ARCHIVE_ROOT}/${slug}`, {
    baseDir: BaseDirectory.AppData,
  }).catch(() => false)

  if (!exact) {
    // 查找带时间戳的变体
    try {
      const entries = await readDir(ARCHIVE_ROOT, {
        baseDir: BaseDirectory.AppData,
      })
      for (const entry of entries as any[]) {
        if (entry.isDirectory && entry.name.startsWith(slug + '-')) {
          archiveSlug = entry.name
          break
        }
      }
    } catch { /* archive 目录可能不存在 */ }
  }

  // 确保目标位置不冲突
  const targetExists = await exists(`${SKILLS_ROOT}/${slug}`, {
    baseDir: BaseDirectory.AppData,
  }).catch(() => false)

  if (targetExists) {
    throw new Error(`技能 "${slug}" 已存在，无法恢复`)
  }

  await rename(
    `${ARCHIVE_ROOT}/${archiveSlug}`,
    `${SKILLS_ROOT}/${slug}`,
    {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    }
  )

  console.log(`[Curator] 已恢复: .archive/${archiveSlug} → ${slug}`)
}

// ---- 运行报告 ----

interface CuratorReport {
  run_at: string
  config: CuratorConfig
  before: { active: number; stale: number; archived: number; total: number }
  after: { active: number; stale: number; archived: number; total: number }
  transitions: Transition[]
  consolidation?: ConsolidationResult | null
}

interface ConsolidationResult {
  ran: boolean
  skippedReason?: string
  consolidations: { from: string; into: string; action: string; reason: string }[]
  skips: { slug: string; reason: string }[]
  umbrellasCreated: number
  skillsArchived: number
}

async function saveReport(report: CuratorReport): Promise<void> {
  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    )
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '-')
    const logDir = `${CURATOR_LOGS_DIR}/${ts}`
    await mkdir(logDir, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    }).catch(() => {})

    await writeTextFile(
      `${logDir}/report.json`,
      JSON.stringify(report, null, 2),
      { baseDir: BaseDirectory.AppData }
    )

    console.log(`[Curator] 报告已保存: ${logDir}/report.json`)
  } catch (e) {
    console.debug('[Curator] 保存报告失败:', e)
  }
}

// ---- 主入口 ----

export interface CuratorResult {
  ran: boolean
  skippedReason?: string
  report?: CuratorReport
}

/**
 * 判断是否应该运行 curator
 */
async function shouldRunNow(config: CuratorConfig): Promise<boolean> {
  if (!config.enabled) return false

  const state = await loadCuratorState()
  if (!state.last_run_at) return true // 首次运行

  const lastRun = new Date(state.last_run_at).getTime()
  const elapsed = (Date.now() - lastRun) / (1000 * 60 * 60)

  return elapsed >= config.intervalHours
}

/**
 * 运行 curator（如果满足条件）
 *
 * 由 bootstrap() 在应用启动时调用，或由 Settings 页面手动触发。
 * 设置 force=true 可跳过时间间隔检查。
 */
export async function maybeRunCurator(
  config?: Partial<CuratorConfig>,
  force = false
): Promise<CuratorResult> {
  if (config) {
    updateCuratorConfig(config)
  }

  const cfg = getCuratorConfig()

  if (!force && !(await shouldRunNow(cfg))) {
    const state = await loadCuratorState()
    return {
      ran: false,
      skippedReason: state.last_run_at
        ? `距上次运行不足 ${cfg.intervalHours} 小时`
        : 'curator 未启用',
    }
  }

  console.log('[Curator] 开始运行...')
  const db = await getUsage()

  // 快照前
  const before = countByState(db)

  // 确定性迁移
  const transitions = await applyAutomaticTransitions(db, cfg)

  // LLM 智能合并（在确定性迁移之后）
  let consolidation: ConsolidationResult | null = null
  if (cfg.consolidateEnabled) {
    console.log('[Curator] 开始 LLM 合并遍历...')
    consolidation = await runConsolidation(cfg)
    if (consolidation.ran) {
      console.log(
        `[Curator] 合并完成: ${consolidation.umbrellasCreated} 个 umbrella, ${consolidation.skillsArchived} 个归档`
      )
    } else {
      console.log(`[Curator] 合并跳过: ${consolidation.skippedReason}`)
    }
  }

  // 刷新缓存，重新读取
  invalidateUsageCache()
  const dbAfter = await getUsage()
  const after = countByState(dbAfter)

  // 更新 curator 状态
  const curatorState = await loadCuratorState()
  curatorState.last_run_at = new Date().toISOString()
  curatorState.run_count++
  curatorState.total_archived += transitions.filter(
    (t) => t.to === 'archived'
  ).length
  if (consolidation?.ran) {
    curatorState.total_archived += consolidation.skillsArchived
  }
  await saveCuratorState(curatorState)

  // 保存报告
  const report: CuratorReport = {
    run_at: new Date().toISOString(),
    config: cfg,
    before,
    after,
    transitions,
    consolidation,
  }
  await saveReport(report)

  console.log(`[Curator] 完成 — ${transitions.length} 个迁移`)

  return { ran: true, report }
}

/**
 * 手动运行 curator（Settings 页面触发）
 */
export async function runCuratorNow(
  config?: Partial<CuratorConfig>
): Promise<CuratorResult> {
  return maybeRunCurator(config, true)
}

/**
 * 获取上次运行报告
 */
export async function getLastReport(): Promise<CuratorReport | null> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(CURATOR_LOGS_DIR, {
      baseDir: BaseDirectory.AppData,
    })
    // 按名称排序取最新
    const dirs = (entries as any[])
      .filter((e: any) => e.isDirectory)
      .sort((a: any, b: any) => b.name.localeCompare(a.name))

    if (dirs.length === 0) return null

    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(
      `${CURATOR_LOGS_DIR}/${dirs[0].name}/report.json`,
      { baseDir: BaseDirectory.AppData }
    )
    return JSON.parse(raw) as CuratorReport
  } catch {
    return null
  }
}

/**
 * 获取 curator 运行历史列表
 */
export async function getCuratorHistory(): Promise<
  { timestamp: string; transitions: number }[]
> {
  try {
    const { readDir, readTextFile, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    )
    const entries = await readDir(CURATOR_LOGS_DIR, {
      baseDir: BaseDirectory.AppData,
    })
    const dirs = (entries as any[])
      .filter((e: any) => e.isDirectory)
      .sort((a: any, b: any) => b.name.localeCompare(a.name))

    const results: { timestamp: string; transitions: number }[] = []
    for (const dir of dirs.slice(0, 10)) {
      try {
        const raw = await readTextFile(
          `${CURATOR_LOGS_DIR}/${dir.name}/report.json`,
          { baseDir: BaseDirectory.AppData }
        )
        const report = JSON.parse(raw) as CuratorReport
        results.push({
          timestamp: report.run_at,
          transitions: report.transitions.length,
        })
      } catch {
        /* skip corrupt */
      }
    }
    return results
  } catch {
    return []
  }
}

// ---- LLM 智能合并 ----

/** 按 slug 前缀聚类（取第一个 - 之前的部分，如 vue-* → vue） */
function clusterByPrefix(slugs: string[]): { prefix: string; slugs: string[] }[] {
  const groups = new Map<string, string[]>()

  for (const slug of slugs) {
    const dashIdx = slug.indexOf('-')
    const prefix = dashIdx > 0 ? slug.slice(0, dashIdx) : slug
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix)!.push(slug)
  }

  // 只保留有 2+ 成员的聚类
  return [...groups.entries()]
    .filter(([, s]) => s.length >= 2)
    .map(([prefix, s]) => ({ prefix, slugs: s }))
    .sort((a, b) => b.slugs.length - a.slugs.length)
}

/**
 * 读取技能 SKILL.md 获取名称和描述
 */
async function readSkillInfo(
  slug: string
): Promise<{ name: string; description: string }> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(`skills/${slug}/SKILL.md`, {
      baseDir: BaseDirectory.AppData,
    })
    const { parseSkillMd } = await import('./skill-parser')
    const parsed = parseSkillMd(raw)
    return {
      name: parsed.frontmatter.name || slug,
      description: parsed.frontmatter.description || '',
    }
  } catch {
    return { name: slug, description: '' }
  }
}

/**
 * 运行 LLM 合并遍历
 *
 * 仅在 consolidateEnabled 为 true 且有足够 agent-created skill 时执行。
 * 使用独立 OpenAI client，不污染主对话。
 */
async function runConsolidation(
  config: CuratorConfig
): Promise<ConsolidationResult> {
  if (!config.consolidateEnabled) {
    return {
      ran: false,
      skippedReason: 'consolidateEnabled 为 false',
      consolidations: [],
      skips: [],
      umbrellasCreated: 0,
      skillsArchived: 0,
    }
  }

  // 获取 agent-created 且 active/stale 的技能
  const agentSlugs = await getAgentCreatedSlugs()
  const activeSlugs = agentSlugs.filter((s) => !isProtected(s))

  if (activeSlugs.length < 3) {
    return {
      ran: false,
      skippedReason: `agent-created 技能不足（${activeSlugs.length} < 3），跳过合并`,
      consolidations: [],
      skips: [],
      umbrellasCreated: 0,
      skillsArchived: 0,
    }
  }

  // 前缀聚类
  const clusters = clusterByPrefix(activeSlugs)
  if (clusters.length === 0) {
    return {
      ran: false,
      skippedReason: '无显著前缀聚类',
      consolidations: [],
      skips: [],
      umbrellasCreated: 0,
      skillsArchived: 0,
    }
  }

  console.log(`[Curator] 合并遍历: ${activeSlugs.length} 个候选, ${clusters.length} 个聚类`)

  // 构建候选信息
  const usageDb = await getUsage()
  const candidateSkills: {
    slug: string
    name: string
    description: string
    useCount: number
  }[] = []

  for (const slug of activeSlugs) {
    const info = await readSkillInfo(slug)
    candidateSkills.push({
      slug,
      name: info.name,
      description: info.description,
      useCount: usageDb[slug]?.use_count || 0,
    })
  }

  // 构建 prompt
  const systemPrompt = buildConsolidationPrompt(candidateSkills, clusters)
  const userMessage = buildConsolidationUserMessage()

  // 独立 LLM 调用
  try {
    const { getSettings, getApiKey } = await import('../config/config')
    const s = getSettings()
    const apiKey = await getApiKey()

    if (!apiKey) {
      return {
        ran: false,
        skippedReason: 'API Key 未配置',
        consolidations: [],
        skips: [],
        umbrellasCreated: 0,
        skillsArchived: 0,
      }
    }

    const OpenAI = (await import('openai')).default
    const client = new OpenAI({
      baseURL: s.ai_base_url,
      apiKey,
      dangerouslyAllowBrowser: true,
    })

    console.log('[Curator] 正在调用合并 LLM...')

    const response = await client.chat.completions.create({
      model: s.ai_model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      // 不使用工具 —— 合并 agent 只分析并输出 YAML 决策
    })

    const reply = response.choices[0]?.message?.content || ''

    // 解析 YAML 输出
    const parsed = parseConsolidationYaml(reply)
    console.log('[Curator] 🤖 LLM 合并决策:', parsed.consolidations.length, '个合并,', parsed.skips.length, '个跳过')
    for (const c of parsed.consolidations) {
      console.log(`[Curator]   → ${c.from} → ${c.into} (${c.action}): ${c.reason}`)
    }

    // 执行合并
    let umbrellasCreated = 0
    let skillsArchived = 0

    for (const c of parsed.consolidations) {
      try {
        if (c.action === 'create') {
          // 为 from 技能创建 umbrella，合并内容
          await executeConsolidationCreate(c.from, c.into)
          umbrellasCreated++
        } else {
          // patch：追加到已有 umbrella
          await executeConsolidationPatch(c.from, c.into)
        }
        skillsArchived++
      } catch (e: any) {
        console.warn(`[Curator] 合并失败: ${c.from} → ${c.into}:`, e.message)
      }
    }

    // 刷新技能缓存
    const { scanSkills } = await import('./skill-commands')
    await scanSkills()

    return {
      ran: true,
      consolidations: parsed.consolidations,
      skips: parsed.skips,
      umbrellasCreated,
      skillsArchived,
    }
  } catch (e: any) {
    console.error('[Curator] 合并 LLM 调用失败:', e.message || e)
    return {
      ran: false,
      skippedReason: `LLM 调用失败: ${e.message || '未知错误'}`,
      consolidations: [],
      skips: [],
      umbrellasCreated: 0,
      skillsArchived: 0,
    }
  }
}

/**
 * 解析合并 agent 的 YAML 输出
 */
function parseConsolidationYaml(
  reply: string
): {
  consolidations: { from: string; into: string; action: string; reason: string }[]
  skips: { slug: string; reason: string }[]
} {
  const consolidations: {
    from: string
    into: string
    action: string
    reason: string
  }[] = []
  const skips: { slug: string; reason: string }[] = []

  try {
    // 提取 YAML 块
    const yamlMatch = reply.match(/```yaml\s*([\s\S]*?)```/)
    const yamlText = yamlMatch ? yamlMatch[1] : reply

    // 简易行解析
    let section: 'consolidations' | 'skips' | null = null

    for (const line of yamlText.split('\n')) {
      const trimmed = line.trim()

      if (trimmed.startsWith('consolidations:')) {
        section = 'consolidations'
        continue
      }
      if (trimmed.startsWith('skips:')) {
        section = 'skips'
        continue
      }

      if (section === 'consolidations' && trimmed.startsWith('- from:')) {
        const from = extractYamlValue(trimmed, 'from:')
        const into = extractYamlValue(trimmed, 'into:') || ''
        const action = extractYamlValue(trimmed, 'action:') || 'patch'
        const reason = extractYamlValue(trimmed, 'reason:') || ''

        if (from) {
          consolidations.push({ from, into, action, reason })
        }
      }

      if (section === 'skips' && trimmed.startsWith('- slug:')) {
        const slug = extractYamlValue(trimmed, 'slug:')
        const reason = extractYamlValue(trimmed, 'reason:') || ''

        if (slug) {
          skips.push({ slug, reason })
        }
      }
    }
  } catch (e) {
    console.warn('[Curator] YAML 解析失败:', e)
  }

  return { consolidations, skips }
}

function extractYamlValue(line: string, key: string): string | null {
  // 支持 "key: value" 和 "key: "value"" 格式
  const regex = new RegExp(`${key.replace(':', '')}\\s*["']?(.+?)["']?\\s*(?:#|$)`)
  const match = line.match(regex)
  return match ? match[1].trim() : null
}

/**
 * 执行合并：创建 umbrella skill 并归档 from skill
 */
async function executeConsolidationCreate(
  fromSlug: string,
  umbrellaName: string
): Promise<void> {
  // 读取 from skill 内容
  const raw = await readSkillFile(fromSlug)
  if (!raw) {
    console.warn(`[Curator] 无法读取 ${fromSlug}，跳过合并`)
    return
  }

  const { parseSkillMd, toSkillSlug } = await import('./skill-parser')
  const parsed = parseSkillMd(raw)
  const umbrellaSlug = toSkillSlug(umbrellaName)

  // 检查 umbrella 是否已存在
  const existing = await readSkillFile(umbrellaSlug)

  if (!existing) {
    // 创建新 umbrella
    const fm = {
      name: umbrellaName,
      description: `综合技能：涵盖 ${umbrellaName} 相关操作`,
      keywords: [umbrellaSlug],
    }
    const fullMd = buildUmbrellaMd(fm) + '\n' + buildSection(parsed.frontmatter.name, parsed.body)
    await writeSkillFile(umbrellaSlug, fullMd)

    const { markAgentCreated } = await import('./skill-usage')
    await markAgentCreated(umbrellaSlug)

    console.log(`[Curator] 创建 umbrella: ${umbrellaSlug}`)
  } else {
    // 追加到已有 umbrella
    const umbrellaRaw = await readSkillFile(umbrellaSlug)
    const newContent =
      umbrellaRaw + '\n' + buildSection(parsed.frontmatter.name, parsed.body)
    await writeSkillFile(umbrellaSlug, newContent)

    console.log(`[Curator] 追加到 umbrella: ${umbrellaSlug} ← ${fromSlug}`)
  }

  // 归档 from skill
  await archiveSkillDir(fromSlug)
  await setState(fromSlug, 'archived')
  const { archiveUsage } = await import('./skill-usage')
  await archiveUsage(fromSlug, umbrellaSlug)
}

/**
 * 执行合并：patch 到已有 umbrella
 */
async function executeConsolidationPatch(
  fromSlug: string,
  intoSlug: string
): Promise<void> {
  const raw = await readSkillFile(fromSlug)
  const intoRaw = await readSkillFile(intoSlug)

  if (!raw) {
    console.warn(`[Curator] 无法读取 ${fromSlug}，跳过合并`)
    return
  }

  const { parseSkillMd } = await import('./skill-parser')
  const parsed = parseSkillMd(raw)

  if (intoRaw) {
    // Patch：追加章节
    const newContent =
      intoRaw + '\n' + buildSection(parsed.frontmatter.name, parsed.body)
    await writeSkillFile(intoSlug, newContent)
    console.log(`[Curator] patch: ${intoSlug} ← ${fromSlug}`)
  } else {
    // umbrella 不存在？创建之
    await executeConsolidationCreate(fromSlug, intoSlug)
    return
  }

  // 归档 from skill
  await archiveSkillDir(fromSlug)
  await setState(fromSlug, 'archived')
  const { archiveUsage } = await import('./skill-usage')
  await archiveUsage(fromSlug, intoSlug)
}

function buildSection(title: string, body: string): string {
  return [
    '',
    `## ${title}`,
    '',
    body,
    '',
  ].join('\n')
}

function buildUmbrellaMd(fm: { name: string; description: string; keywords: string[] }): string {
  const kw = fm.keywords || []
  return [
    '---',
    `name: ${fm.name}`,
    `description: ${fm.description}`,
    'version: 1.0.0',
    `keywords: [${kw.join(', ')}]`,
    'platforms: [web, desktop]',
    '---',
    '',
    `# ${fm.name}`,
    '',
    fm.description,
    '',
    '## 概述',
    '',
    '本技能由 Curator 自动合并生成，整合了以下相关技能的操作方法。',
    '',
  ].join('\n')
}

// ---- Tauri FS 辅助（供合并使用） ----

async function readSkillFile(slug: string): Promise<string | null> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return await readTextFile(`skills/${slug}/SKILL.md`, {
      baseDir: BaseDirectory.AppData,
    })
  } catch {
    return null
  }
}

async function writeSkillFile(slug: string, content: string): Promise<void> {
  const { writeTextFile, mkdir, BaseDirectory } = await import(
    '@tauri-apps/plugin-fs'
  )
  await mkdir(`skills/${slug}`, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  }).catch(() => {})
  await writeTextFile(`skills/${slug}/SKILL.md`, content, {
    baseDir: BaseDirectory.AppData,
  })
}

// ---- 辅助 ----

function countByState(db: UsageDb): {
  active: number
  stale: number
  archived: number
  total: number
} {
  let active = 0
  let stale = 0
  let archived = 0

  for (const entry of Object.values(db)) {
    if (entry.state === 'active') active++
    else if (entry.state === 'stale') stale++
    else if (entry.state === 'archived') archived++
  }

  return { active, stale, archived, total: active + stale + archived }
}

export { PROTECTED_BUILTIN_SKILLS, isProtected }
