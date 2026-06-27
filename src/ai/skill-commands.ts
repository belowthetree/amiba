// ============================================================
// 变形虫 (Amiba) — Skill 命令系统（/skill-name 检测 + 技能展开）
// ============================================================
import { parseSkillMd, platformMatches, toSkillSlug } from './skill-parser'
import type { SkillFrontmatter } from './skill-parser'

export interface SkillInfo {
  /** 规范化 slug（如 "counter"、"todo"） */
  slug: string
  /** 显示名称（如 "计数器"） */
  name: string
  /** 简短描述 */
  description: string
  /** 匹配关键词 */
  keywords: string[]
  /** 技能目录路径 */
  skillDir: string
  /** 完整 frontmatter */
  frontmatter: SkillFrontmatter
}

// ---- 懒加载缓存（Promise-lock 防竞态） ----

let skillCommands: Map<string, SkillInfo> | null = null
let scanPromise: Promise<Map<string, SkillInfo>> | null = null

/**
 * 扫描 skills/ 目录下所有 SKILL.md 文件
 *
 * - Tauri 环境：使用 Tauri FS plugin 的 readDir
 * - 浏览器环境：使用 import.meta.glob 预索引（构建时内联路径）
 *   → 运行时按路径 fetch 内容
 */
export async function scanSkills(): Promise<Map<string, SkillInfo>> {
  if (skillCommands) return skillCommands
  if (scanPromise) return scanPromise // 复用进行中的扫描

  scanPromise = (async () => {
    const skills = new Map<string, SkillInfo>()

    // 内置技能目录列表（构建时已知）
    const builtinDirs = ['counter', 'notes', 'todo', 'service-dev']

    for (const dir of builtinDirs) {
      try {
        const info = await loadSkillFromDir(dir)
        if (info) {
          skills.set(info.slug, info)
        }
      } catch (e) {
        console.warn(`[SkillCommands] 加载内置技能 ${dir} 失败:`, e)
      }
    }

    // Tauri 环境下扫描用户技能
    try {
      const { readDir, exists, BaseDirectory } = await import(
        '@tauri-apps/plugin-fs'
      )
      const skillsRoot = 'skills'

      const hasRoot = await exists(skillsRoot, {
        baseDir: BaseDirectory.AppData,
      })
      if (hasRoot) {
        const entries = await readDir(skillsRoot, {
          baseDir: BaseDirectory.AppData,
        })
        for (const entry of entries as any[]) {
          if (!entry.isDirectory) continue
          const dirName = entry.name
          // 跳过已加载的内置技能
          if (skills.has(dirName)) continue
          try {
            const info = await loadSkillFromTauriDir(dirName)
            if (info) {
              skills.set(info.slug, info)
            }
          } catch (e) {
            console.warn(
              `[SkillCommands] 加载用户技能 ${dirName} 失败:`,
              e
            )
          }
        }
      }
    } catch {
      // 浏览器模式：仅使用内置技能
      console.log('[SkillCommands] Tauri FS 不可用，仅加载内置技能')
    }

    skillCommands = skills
    console.log(`[SkillCommands] 扫描完成 — ${skills.size} 个技能`)
    return skills
  })()

  return scanPromise
}

/**
 * 从内置技能目录加载 SKILL.md（浏览器兼容）
 */
async function loadSkillFromDir(
  dirName: string
): Promise<SkillInfo | null> {
  try {
    const resp = await fetch(`/catalog/skills/${dirName}/SKILL.md`)
    if (!resp.ok) return null
    const raw = await resp.text()
    const parsed = parseSkillMd(raw)

    if (!parsed.frontmatter.name) {
      console.warn(`[SkillCommands] ${dirName}/SKILL.md frontmatter 缺少 name`)
      return null
    }

    const slug = toSkillSlug(dirName)
    return {
      slug,
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description || '',
      keywords: parsed.frontmatter.keywords || [],
      skillDir: `skills/${dirName}`,
      frontmatter: parsed.frontmatter,
    }
  } catch {
    return null
  }
}

/**
 * 从 Tauri AppData 目录加载用户技能
 */
async function loadSkillFromTauriDir(
  dirName: string
): Promise<SkillInfo | null> {
  const { readTextFile, BaseDirectory } = await import(
    '@tauri-apps/plugin-fs'
  )
  const path = `skills/${dirName}/SKILL.md`

  let raw: string
  try {
    raw = await readTextFile(path, { baseDir: BaseDirectory.AppData })
  } catch {
    return null
  }

  const parsed = parseSkillMd(raw)
  if (!parsed.frontmatter.name) return null

  const slug = toSkillSlug(dirName)
  return {
    slug,
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description || '',
    keywords: parsed.frontmatter.keywords || [],
    skillDir: `skills/${dirName}`,
    frontmatter: parsed.frontmatter,
  }
}

// ---- 公共 API ----

/**
 * 获取已扫描的技能映射表（确保只扫描一次）
 */
export async function getSkillCommands(): Promise<Map<string, SkillInfo>> {
  return scanSkills()
}

/**
 * 读取技能目录下的 SKILL.md 原始内容
 */
export async function getSkillContent(slug: string): Promise<string | null> {
  const skills = await getSkillCommands()
  const info = skills.get(slug)
  if (!info) return null

  // 尝试内置路径
  try {
    const resp = await fetch(`/${info.skillDir}/SKILL.md`)
    if (resp.ok) return await resp.text()
  } catch {
    /* fall through */
  }

  // 尝试 Tauri 路径
  try {
    const { readTextFile, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    )
    return await readTextFile(`${info.skillDir}/SKILL.md`, {
      baseDir: BaseDirectory.AppData,
    })
  } catch {
    return null
  }
}

// ---- Slash 命令检测与展开 ----

/**
 * 检测用户输入是否以 /skill-name 开头
 * 返回匹配的 SkillInfo 和剩余用户指令，或 null
 */
export async function detectSlashCommand(
  input: string
): Promise<{ skill: SkillInfo; userInstruction: string } | null> {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  // 提取命令部分
  const spaceIdx = trimmed.indexOf(' ')
  const cmdPart = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1)
  const userInstruction =
    spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : ''

  if (!cmdPart) return null

  const skills = await getSkillCommands()
  const skill = skills.get(cmdPart.toLowerCase())

  if (!skill) return null

  return { skill, userInstruction }
}

/**
 * 构建技能调用消息（作为 user message 注入，不改变 system prompt）
 */
export async function buildSkillInvocationMessage(
  slug: string,
  userInstruction: string
): Promise<string | null> {
  const skills = await getSkillCommands()
  const skill = skills.get(slug)
  if (!skill) return null

  const content = await getSkillContent(slug)
  if (!content) return null

  const lines = [
    `[用户调用了技能「${skill.name}」，请遵循以下技能内容执行。]`,
    '',
    content,
    '',
    `[技能目录: ${skill.skillDir}]`,
  ]

  if (userInstruction) {
    lines.push(`用户附带指令: ${userInstruction}`)
  }

  return lines.join('\n')
}

/**
 * 构建技能索引文本（注入到 system prompt，简短摘要）
 */
export async function buildSkillIndex(): Promise<string> {
  const skills = await getSkillCommands()
  if (skills.size === 0) return ''

  const entries: string[] = []
  for (const [slug, info] of skills) {
    entries.push(`- /${slug} — ${info.description}`)
  }

  return entries.join('\n')
}
