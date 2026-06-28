// ============================================================
// 变形虫 (Amiba) — Skill 使用遥测（.usage.json）
// ============================================================
// 旁路遥测层：记录每个 skill 的使用/查看/修补计数和时间戳。
// 数据与 SKILL.md 内容分离，存储在 skills/.usage.json。
//
// 设计原则（对齐 Hermes）：
//   - 旁路文件，不污染 SKILL.md 或 git diff
//   - 最佳努力、静默失败：bump 失败不影响工具调用
//   - 原子写入：temp file + rename
//   - 来源分类：agent-created / builtin / user
// ============================================================
import { storageGetJSON, storageSetJSON } from '../config/storage'

// ---- 类型 ----

export interface SkillUsageEntry {
  created_by: null | 'agent'
  use_count: number
  view_count: number
  patch_count: number
  last_used_at: string | null // ISO 8601
  last_viewed_at: string | null
  last_patched_at: string | null
  created_at: string // ISO 8601
  state: 'active' | 'stale' | 'archived'
  pinned: boolean
  archived_at: string | null
  absorbed_into?: string // 被合并到的 umbrella skill slug
}

export type UsageDb = Record<string, SkillUsageEntry>

// ---- 受保护内置技能（不会被 curator 管理） ----

const PROTECTED_BUILTIN_SKILLS = ['counter', 'todo', 'notes', 'service-dev']

// ---- 路径 ----

const USAGE_PATH = 'skills/.usage.json'

// ---- 核心读写 ----

let usageCache: UsageDb | null = null
let cacheLoaded = false

async function loadUsage(): Promise<UsageDb> {
  if (cacheLoaded && usageCache) return usageCache

  // 尝试从 Tauri FS 读取
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(USAGE_PATH, { baseDir: BaseDirectory.AppData })
    usageCache = JSON.parse(raw) as UsageDb
  } catch {
    // 文件不存在或非 Tauri 环境
    usageCache = {}
  }

  cacheLoaded = true
  return usageCache!
}

async function saveUsage(db: UsageDb): Promise<void> {
  usageCache = db
  const json = JSON.stringify(db, null, 2)

  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    )
    // 确保 skills 目录存在
    await mkdir('skills', {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    }).catch(() => {})

    // 原子写入：先写临时文件，再 rename
    const tmpPath = USAGE_PATH + '.tmp'
    await writeTextFile(tmpPath, json, { baseDir: BaseDirectory.AppData })
    const { rename, remove } = await import('@tauri-apps/plugin-fs')
    // Windows rename 可能因目标存在而失败，先删旧文件
    try {
      await remove(USAGE_PATH, { baseDir: BaseDirectory.AppData })
    } catch {
      /* 旧文件可能不存在 */
    }
    await rename(tmpPath, USAGE_PATH, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    })
  } catch {
    // 静默失败：遥测写入失败不破坏主流程
    console.debug('[SkillUsage] 写入 .usage.json 失败（非 Tauri 环境？）')
  }
}

// ---- 初始化条目 ----

function ensureEntry(db: UsageDb, slug: string): SkillUsageEntry {
  if (!db[slug]) {
    db[slug] = {
      created_by: null,
      use_count: 0,
      view_count: 0,
      patch_count: 0,
      last_used_at: null,
      last_viewed_at: null,
      last_patched_at: null,
      created_at: new Date().toISOString(),
      state: 'active',
      pinned: false,
      archived_at: null,
    }
  }
  return db[slug]
}

function ensureBuiltinEntry(db: UsageDb, slug: string): void {
  if (PROTECTED_BUILTIN_SKILLS.includes(slug) && !db[slug]) {
    db[slug] = {
      created_by: null,
      use_count: 0,
      view_count: 0,
      patch_count: 0,
      last_used_at: null,
      last_viewed_at: null,
      last_patched_at: null,
      created_at: new Date().toISOString(),
      state: 'active',
      pinned: false,
      archived_at: null,
    }
  }
}

// ---- 公共 API：计数器 bump ----

/**
 * 技能被 Agent 实际引用时调用（/skill-name 触发或 skill 加载到 prompt）
 */
export async function bumpUse(slug: string): Promise<void> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.use_count++
    entry.last_used_at = new Date().toISOString()

    // 如果处于 stale，重新激活
    if (entry.state === 'stale') {
      entry.state = 'active'
    }

    await saveUsage(db)
    console.log(`[SkillUsage] 👁️ bumpUse: ${slug} (${entry.use_count})`)
  } catch (e) {
    console.debug(`[SkillUsage] bumpUse 失败: ${slug}`, e)
  }
}

/**
 * skill_view 工具被调用时触发
 */
export async function bumpView(slug: string): Promise<void> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.view_count++
    entry.last_viewed_at = new Date().toISOString()
    await saveUsage(db)
    console.log(`[SkillUsage] 📖 bumpView: ${slug} (${entry.view_count})`)
  } catch (e) {
    console.debug(`[SkillUsage] bumpView 失败: ${slug}`, e)
  }
}

/**
 * skill_manage_patch 或 skill_manage_edit 被调用时触发
 */
export async function bumpPatch(slug: string): Promise<void> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.patch_count++
    entry.last_patched_at = new Date().toISOString()
    await saveUsage(db)
    console.log(`[SkillUsage] ✏️ bumpPatch: ${slug} (${entry.patch_count})`)
  } catch (e) {
    console.debug(`[SkillUsage] bumpPatch 失败: ${slug}`, e)
  }
}

// ---- 公共 API：生命周期管理 ----

/**
 * 标记技能为 agent-created（Curator 可管理）
 */
export async function markAgentCreated(slug: string): Promise<void> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.created_by = 'agent'
    await saveUsage(db)
    console.debug(`[SkillUsage] markAgentCreated: ${slug}`)
  } catch (e) {
    console.debug(`[SkillUsage] markAgentCreated 失败: ${slug}`, e)
  }
}

/**
 * 归档技能（更新状态）
 */
export async function archiveUsage(
  slug: string,
  absorbedInto?: string
): Promise<void> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.state = 'archived'
    entry.archived_at = new Date().toISOString()
    if (absorbedInto) {
      entry.absorbed_into = absorbedInto
    }
    await saveUsage(db)
    console.debug(`[SkillUsage] archiveUsage: ${slug}`)
  } catch (e) {
    console.debug(`[SkillUsage] archiveUsage 失败: ${slug}`, e)
  }
}

/**
 * 恢复技能（从 archived 到 active）
 */
export async function restoreUsage(slug: string): Promise<void> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.state = 'active'
    entry.archived_at = null
    entry.absorbed_into = undefined
    await saveUsage(db)
    console.debug(`[SkillUsage] restoreUsage: ${slug}`)
  } catch (e) {
    console.debug(`[SkillUsage] restoreUsage 失败: ${slug}`, e)
  }
}

/**
 * 切换 pin 状态
 */
export async function togglePin(slug: string): Promise<boolean> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.pinned = !entry.pinned
    await saveUsage(db)
    console.debug(`[SkillUsage] togglePin: ${slug} → ${entry.pinned}`)
    return entry.pinned
  } catch (e) {
    console.debug(`[SkillUsage] togglePin 失败: ${slug}`, e)
    return false
  }
}

/**
 * 设置技能状态（curator 使用）
 */
export async function setState(
  slug: string,
  state: 'active' | 'stale' | 'archived'
): Promise<void> {
  try {
    const db = await loadUsage()
    const entry = ensureEntry(db, slug)
    entry.state = state
    if (state === 'archived') {
      entry.archived_at = new Date().toISOString()
    }
    await saveUsage(db)
    console.debug(`[SkillUsage] setState: ${slug} → ${state}`)
  } catch (e) {
    console.debug(`[SkillUsage] setState 失败: ${slug}`, e)
  }
}

// ---- 查询 API ----

/**
 * 获取完整 usage 数据
 */
export async function getUsage(): Promise<UsageDb> {
  return loadUsage()
}

/**
 * 获取单个技能的 usage 条目
 */
export async function getUsageEntry(
  slug: string
): Promise<SkillUsageEntry | null> {
  const db = await loadUsage()
  return db[slug] || null
}

/**
 * 获取所有 agent-created 技能 slug（供 curator 使用）
 */
export async function getAgentCreatedSlugs(): Promise<string[]> {
  const db = await loadUsage()
  return Object.entries(db)
    .filter(([, entry]) => entry.created_by === 'agent')
    .map(([slug]) => slug)
}

/**
 * 获取所有非内置、非归档技能
 */
export async function getManageableSkills(): Promise<
  { slug: string; entry: SkillUsageEntry }[]
> {
  const db = await loadUsage()
  return Object.entries(db)
    .filter(
      ([slug, entry]) =>
        !PROTECTED_BUILTIN_SKILLS.includes(slug) &&
        entry.state !== 'archived'
    )
    .map(([slug, entry]) => ({ slug, entry }))
}

/**
 * 使缓存失效（用于 curator 运行后重新加载）
 */
export function invalidateUsageCache(): void {
  cacheLoaded = false
  usageCache = null
}
