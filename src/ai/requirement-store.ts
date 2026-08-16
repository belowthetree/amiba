// ============================================================
// 变形虫 (Amiba) — 需求追踪引擎（REQUIREMENT.md）
// ============================================================
// 管理两个层级的需求文件：
//   - 单服务: services/<id>/REQUIREMENT.md
//   - 全局:   services/REQUIREMENTS.md
//
// 格式: YAML frontmatter + Markdown 条目列表
// ============================================================
import { parseSkillMd } from './skill-parser'

// ---- 类型 ----

export interface RequirementFrontmatter {
  service_id?: string
  service_name?: string
  version?: string
  last_reviewed?: string
  status?: 'active' | 'stale' | 'completed'
  priority?: 'high' | 'medium' | 'low'
  updated_at?: string
  service_count?: number
  [key: string]: any
}

export interface RequirementDoc {
  frontmatter: RequirementFrontmatter
  sections: {
    current: string[]     // 当前需求
    done: string[]        // 已完成
    optimize: string[]    // 待优化
    feedback: string[]    // 用户反馈
  }
}

// ---- Tauri FS 辅助 ----

async function readFile(path: string): Promise<string | null> {
  try {
    const { readTextFile, BaseDirectory } = await import('../config/native-fs')
    return await readTextFile(path, { baseDir: BaseDirectory.AppData })
  } catch {
    return null
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  const { writeTextFile, mkdir, BaseDirectory } = await import('../config/native-fs')
  // 确保父目录存在
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash > 0) {
    await mkdir(path.substring(0, lastSlash), {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    }).catch(() => {})
  }
  await writeTextFile(path, content, { baseDir: BaseDirectory.AppData })
}

// ---- 单服务 REQUIREMENT.md ----

function serviceReqPath(serviceId: string): string {
  return `services/${serviceId}/REQUIREMENT.md`
}

/** 解析 REQUIREMENT.md 为结构化对象 */
function parseRequirementMd(raw: string, serviceId?: string): RequirementDoc {
  const parsed = parseSkillMd(raw)
  const body = parsed.body
  const sections: RequirementDoc['sections'] = {
    current: [],
    done: [],
    optimize: [],
    feedback: [],
  }

  let currentSection: keyof RequirementDoc['sections'] | null = null

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## 当前需求') || trimmed.startsWith('## Current')) {
      currentSection = 'current'
      continue
    }
    if (trimmed.startsWith('## 已完成') || trimmed.startsWith('## Done')) {
      currentSection = 'done'
      continue
    }
    if (trimmed.startsWith('## 待优化') || trimmed.startsWith('## Optimize')) {
      currentSection = 'optimize'
      continue
    }
    if (trimmed.startsWith('## 用户反馈') || trimmed.startsWith('## Feedback')) {
      currentSection = 'feedback'
      continue
    }
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      currentSection = null
      continue
    }

    if (currentSection && trimmed.startsWith('- ')) {
      sections[currentSection].push(trimmed.slice(2).trim())
    }
  }

  return {
    frontmatter: parsed.frontmatter as RequirementFrontmatter,
    sections,
  }
}

/** 构建 REQUIREMENT.md 文本 */
function buildRequirementMd(
  fm: RequirementFrontmatter,
  sections: RequirementDoc['sections']
): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(fm)) {
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'string') {
        lines.push(`${key}: ${value}`)
      } else {
        lines.push(`${key}: ${value}`)
      }
    }
  }
  lines.push('---', '')

  if (fm.service_name) {
    lines.push(`# ${fm.service_name} — 需求追踪`, '')
  }

  lines.push('## 当前需求', '')
  if (sections.current.length > 0) {
    sections.current.forEach((s) => lines.push(`- ${s}`))
  } else {
    lines.push('- （暂无）')
  }
  lines.push('')

  lines.push('## 已完成需求', '')
  if (sections.done.length > 0) {
    sections.done.forEach((s) => lines.push(`- ${s}`))
  } else {
    lines.push('- （暂无）')
  }
  lines.push('')

  lines.push('## 待优化', '')
  if (sections.optimize.length > 0) {
    sections.optimize.forEach((s) => lines.push(`- ${s}`))
  } else {
    lines.push('- （暂无）')
  }
  lines.push('')

  lines.push('## 用户反馈', '')
  if (sections.feedback.length > 0) {
    sections.feedback.forEach((s) => lines.push(`- ${s}`))
  } else {
    lines.push('- （暂无）')
  }
  lines.push('')

  return lines.join('\n')
}

// ---- 公共 API ----

/** 读取或初始化单服务需求文档 */
export async function getServiceRequirement(
  serviceId: string,
  serviceName?: string
): Promise<RequirementDoc> {
  const path = serviceReqPath(serviceId)
  const raw = await readFile(path)

  if (raw) {
    return parseRequirementMd(raw, serviceId)
  }

  // 初始化空文档
  return {
    frontmatter: {
      service_id: serviceId,
      service_name: serviceName || serviceId,
      version: '1.0.0',
      last_reviewed: new Date().toISOString(),
      status: 'active',
      priority: 'medium',
    },
    sections: {
      current: [],
      done: [],
      optimize: [],
      feedback: [],
    },
  }
}

/** 追加一条需求条目 */
export async function addRequirement(
  serviceId: string,
  serviceName: string | undefined,
  section: keyof RequirementDoc['sections'],
  content: string
): Promise<void> {
  const doc = await getServiceRequirement(serviceId, serviceName)
  doc.sections[section].push(content)
  doc.frontmatter.last_reviewed = new Date().toISOString()

  const md = buildRequirementMd(doc.frontmatter, doc.sections)
  await writeFile(serviceReqPath(serviceId), md)

  console.log(`[Requirement] ➕ ${section}: ${serviceId} — "${content.slice(0, 50)}"`)

  // 同步更新全局文件
  await syncGlobalRequirements()
}

/** 标记需求为已完成 */
export async function markRequirementDone(
  serviceId: string,
  serviceName: string | undefined,
  content: string
): Promise<void> {
  const doc = await getServiceRequirement(serviceId, serviceName)

  // 从 current/optimize/feedback 中移除
  for (const sec of ['current', 'optimize', 'feedback'] as const) {
    const idx = doc.sections[sec].findIndex((s) => s.includes(content))
    if (idx >= 0) {
      const removed = doc.sections[sec].splice(idx, 1)[0]
      doc.sections.done.push(`~~${removed}~~ (${new Date().toISOString().slice(0, 10)})`)
      break
    }
  }

  doc.frontmatter.last_reviewed = new Date().toISOString()
  const md = buildRequirementMd(doc.frontmatter, doc.sections)
  await writeFile(serviceReqPath(serviceId), md)

  await syncGlobalRequirements()
}

/** 删除一条需求条目（任意分区），供记忆管理页手动管理 */
export async function removeRequirementEntry(
  serviceId: string,
  section: keyof RequirementDoc['sections'],
  content: string
): Promise<void> {
  const doc = await getServiceRequirement(serviceId)
  const list = doc.sections[section]
  // 优先精确匹配，回退子串匹配（与 markRequirementDone 一致）
  let idx = list.findIndex((s) => s === content)
  if (idx < 0) idx = list.findIndex((s) => s.includes(content))
  if (idx < 0) return
  list.splice(idx, 1)

  doc.frontmatter.last_reviewed = new Date().toISOString()
  await writeFile(serviceReqPath(serviceId), buildRequirementMd(doc.frontmatter, doc.sections))
  console.log(`[Requirement] 🗑 ${section}: ${serviceId} — "${content.slice(0, 50)}"`)

  await syncGlobalRequirements()
}

/** 列出所有已有 REQUIREMENT.md 的服务需求文档（记忆管理页浏览用） */
export async function listServiceRequirements(): Promise<
  { serviceId: string; doc: RequirementDoc }[]
> {
  let serviceDirs: string[] = []
  try {
    const { readDir, BaseDirectory } = await import('../config/native-fs')
    const entries = await readDir('services', { baseDir: BaseDirectory.AppData })
    serviceDirs = (entries as any[])
      .filter((e: any) => e.isDirectory && !e.name.startsWith('.'))
      .map((e: any) => e.name)
  } catch {
    return []
  }

  const result: { serviceId: string; doc: RequirementDoc }[] = []
  for (const dir of serviceDirs) {
    const raw = await readFile(serviceReqPath(dir))
    if (!raw) continue // 只列出真实存在的需求文件，不为浏览创建空文档
    result.push({ serviceId: dir, doc: parseRequirementMd(raw, dir) })
  }
  return result
}

// ---- 全局 REQUIREMENTS.md ----

const GLOBAL_REQ_PATH = 'services/REQUIREMENTS.md'

/** 读取全局需求汇总 */
export async function getGlobalRequirements(): Promise<string> {
  const raw = await readFile(GLOBAL_REQ_PATH)
  return raw || '# 全局需求汇总\n\n（暂无记录）\n'
}

/** 同步全局需求文件：汇总所有服务的最新需求 */
export async function syncGlobalRequirements(): Promise<void> {
  // 列出所有服务目录
  let serviceDirs: string[] = []
  try {
    const { readDir, BaseDirectory } = await import('../config/native-fs')
    const entries = await readDir('services', { baseDir: BaseDirectory.AppData })
    serviceDirs = (entries as any[])
      .filter((e: any) => e.isDirectory && !e.name.startsWith('.'))
      .map((e: any) => e.name)
  } catch {
    /* 非 Tauri */
  }

  const lines: string[] = [
    '---',
    `updated_at: ${new Date().toISOString()}`,
    `service_count: ${serviceDirs.length}`,
    '---',
    '',
    '# 全局需求汇总',
    '',
    '## 活跃服务需求',
    '',
  ]

  for (const dir of serviceDirs) {
    const doc = await getServiceRequirement(dir)
    const fm = doc.frontmatter
    const name = fm.service_name || dir
    const priority = fm.priority || 'medium'
    const activeReqs = [
      ...doc.sections.current.map((s) => s),
      ...doc.sections.optimize.map((s) => `[优化] ${s}`),
    ]

    if (activeReqs.length > 0) {
      lines.push(`### ${name} (${dir}) [${priority}]`)
      activeReqs.forEach((r) => lines.push(`- ${r}`))
      lines.push('')
    }
  }

  // 潜在新服务机会（从 memory 中提取的关键词）
  lines.push('## 潜在新服务机会', '')
  lines.push('（由 AI 在需求检查时自动填充）', '')

  await writeFile(GLOBAL_REQ_PATH, lines.join('\n'))
  console.log(`[Requirement] 📊 全局同步: ${serviceDirs.length} 个服务`)
}

/** 向全局文件追加潜在服务机会 */
export async function addGlobalOpportunity(
  description: string,
  suggestedService: string
): Promise<void> {
  const raw = await getGlobalRequirements()
  const entry = `| 需求来源 | ${description} | ${suggestedService} |`

  // 插入到「潜在新服务机会」节
  const sectionMarker = '## 潜在新服务机会'
  const idx = raw.indexOf(sectionMarker)
  if (idx >= 0) {
    const insertIdx = raw.indexOf('\n', idx + sectionMarker.length) + 1
    const updated =
      raw.slice(0, insertIdx) +
      entry + '\n' +
      raw.slice(insertIdx)
    await writeFile(GLOBAL_REQ_PATH, updated)
  }
}
