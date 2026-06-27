// ============================================================
// 变形虫 (Amiba) — SKILL.md 解析器
// ============================================================
// 解析 SKILL.md 文件的 YAML frontmatter 和 Markdown body。
// 使用已有依赖 js-yaml 解析 frontmatter，避免手写边界情况。
// ============================================================
import { load as yamlLoad } from 'js-yaml'

export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  keywords?: string[]
  platforms?: string[]
  metadata?: Record<string, any>
  [key: string]: any
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter
  body: string // frontmatter 之后的 Markdown 正文
  raw: string // 原始文件内容
}

/**
 * 解析 SKILL.md 文件内容
 *
 * 格式：
 * ---
 * name: 技能名
 * description: 描述
 * ---
 * Markdown body...
 */
export function parseSkillMd(raw: string): ParsedSkill {
  const lines = raw.split('\n')

  // 检测 frontmatter 分隔符
  if (lines[0]?.trim() !== '---') {
    return {
      frontmatter: { name: '', description: '' },
      body: raw,
      raw,
    }
  }

  // 查找结束的 ---
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i
      break
    }
  }

  if (endIdx === -1) {
    return {
      frontmatter: { name: '', description: '' },
      body: raw,
      raw,
    }
  }

  // 提取 YAML 部分
  const yamlStr = lines.slice(1, endIdx).join('\n')
  const body = lines.slice(endIdx + 1).join('\n').trim()

  let frontmatter: SkillFrontmatter
  try {
    frontmatter = yamlLoad(yamlStr) as SkillFrontmatter
  } catch (e: any) {
    console.warn('[SkillParser] YAML 解析失败:', e.message)
    frontmatter = { name: '', description: '' }
  }

  return { frontmatter, body, raw }
}

/**
 * 校验 frontmatter 必填字段，返回缺失列表
 */
export function validateFrontmatter(fm: SkillFrontmatter): string[] {
  const errors: string[] = []

  if (!fm.name || typeof fm.name !== 'string' || !fm.name.trim()) {
    errors.push('缺少 name 字段')
  } else if (fm.name.length > 30) {
    errors.push(`name 超过 30 字符限制 (${fm.name.length})`)
  }

  if (
    !fm.description ||
    typeof fm.description !== 'string' ||
    !fm.description.trim()
  ) {
    errors.push('缺少 description 字段')
  } else if (fm.description.length > 60) {
    errors.push(
      `description 超过 60 字符限制 (${fm.description.length})`
    )
  }

  if (!fm.keywords || !Array.isArray(fm.keywords) || fm.keywords.length === 0) {
    errors.push('缺少 keywords 数组或为空')
  }

  if (fm.platforms && !Array.isArray(fm.platforms)) {
    errors.push('platforms 必须是数组')
  }

  return errors
}

/**
 * 检查当前平台是否匹配 skill 的 platforms 门控
 */
export function platformMatches(
  fm: SkillFrontmatter,
  currentPlatform: 'web' | 'desktop'
): boolean {
  if (!fm.platforms || fm.platforms.length === 0) return true
  return fm.platforms.includes(currentPlatform)
}

/**
 * 规范化技能名称为 hyphens slug
 */
export function toSkillSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
