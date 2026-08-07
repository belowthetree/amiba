// ============================================================
// 变形虫 (Amiba) — 经验库（.experiences.json）
// ============================================================
// Skill 审查的「经验暂存层」：对话中发现的零散可复用经验先记入经验库
// 并按主题计数，同一经验复现 >= SKILL_THRESHOLD 次后才固化为 skill。
// 数据存储在 skills/.experiences.json（旁路文件，不污染技能目录）。
//
// 设计原则（对齐 skill-usage.ts）：
//   - 旁路 JSON 文件，点号前缀避免 scanSkills 误扫
//   - 最佳努力、静默失败：持久化失败不影响内存计数
// ============================================================

// ---- 类型 ----

export interface ExperienceEntry {
  id: string // 递增 id，如 "exp-1"
  title: string // 经验主题（类级别，如 "DeepSeek Responses 接入"）
  content: string // 经验内容摘要（可复用的流程/技巧/配置）
  count: number // 复现计数
  created_at: string // ISO 8601
  updated_at: string // ISO 8601
}

/** 经验复现次数达到该阈值即应固化为 skill */
export const SKILL_THRESHOLD = 3

export interface RecordResult {
  entry: ExperienceEntry
  /** 'created' 新建（count=1）/ 'incremented' 已有计数+1 */
  action: 'created' | 'incremented'
  /** 计数是否已达固化阈值（>= SKILL_THRESHOLD） */
  thresholdReached: boolean
}

// ---- 路径 ----

const EXPERIENCES_PATH = 'skills/.experiences.json'

// ---- 核心读写（惰性缓存 + 静默失败） ----

let cache: ExperienceEntry[] | null = null

async function loadExperiences(): Promise<ExperienceEntry[]> {
  if (cache) return cache
  try {
    const { readTextFile, BaseDirectory } = await import('../config/native-fs')
    const raw = await readTextFile(EXPERIENCES_PATH, { baseDir: BaseDirectory.AppData })
    const parsed = JSON.parse(raw)
    cache = Array.isArray(parsed) ? parsed : []
  } catch {
    cache = []
  }
  return cache!
}

async function saveExperiences(): Promise<void> {
  if (!cache) return
  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import('../config/native-fs')
    await mkdir('skills', { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
    await writeTextFile(EXPERIENCES_PATH, JSON.stringify(cache, null, 2), {
      baseDir: BaseDirectory.AppData,
    })
  } catch (e) {
    console.warn('[ExperienceStore] 持久化失败（仅保留内存副本）:', e)
  }
}

// ---- 匹配辅助 ----

/** 标题归一化：小写 + 压缩空白，用于宽松查重 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

function nextId(list: ExperienceEntry[]): string {
  let max = 0
  for (const e of list) {
    const m = /^exp-(\d+)$/.exec(e.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `exp-${max + 1}`
}

// ---- CRUD ----

/** 列出全部经验（按更新时间倒序） */
export async function listExperiences(): Promise<ExperienceEntry[]> {
  const list = await loadExperiences()
  return [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

/**
 * 记录一条经验：
 * - 传 id 且命中 → 该经验计数+1（可附带新 content 覆盖补充）
 * - 未传 id 但标题归一化后命中已有经验 → 同上计数+1
 * - 否则新建经验（count=1）
 */
export async function recordExperience(input: {
  id?: string
  title: string
  content: string
}): Promise<RecordResult> {
  const list = await loadExperiences()
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title) throw new Error('经验标题不能为空')

  let entry: ExperienceEntry | undefined
  if (input.id) entry = list.find(e => e.id === input.id)
  if (!entry) {
    const norm = normalizeTitle(title)
    entry = list.find(e => normalizeTitle(e.title) === norm)
  }

  const now = new Date().toISOString()
  if (entry) {
    entry.count += 1
    if (content) entry.content = content
    entry.updated_at = now
    console.log(`[ExperienceStore] 经验计数+1: ${entry.id}「${entry.title}」→ ${entry.count}`)
  } else {
    entry = { id: nextId(list), title, content, count: 1, created_at: now, updated_at: now }
    list.push(entry)
    console.log(`[ExperienceStore] 新经验入库: ${entry.id}「${entry.title}」`)
  }

  await saveExperiences()
  return {
    entry: { ...entry },
    action: entry.count === 1 ? 'created' : 'incremented',
    thresholdReached: entry.count >= SKILL_THRESHOLD,
  }
}

/** 删除经验（固化为 skill 后调用）；返回是否删除成功 */
export async function removeExperience(id: string): Promise<boolean> {
  const list = await loadExperiences()
  const idx = list.findIndex(e => e.id === id)
  if (idx === -1) return false
  const [removed] = list.splice(idx, 1)
  console.log(`[ExperienceStore] 经验已移除: ${removed.id}「${removed.title}」`)
  await saveExperiences()
  return true
}

/** 测试专用：清空内存缓存（下次操作重新从磁盘加载） */
export function __resetExperienceCache(): void {
  cache = null
}
