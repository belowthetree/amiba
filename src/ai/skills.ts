// ============================================================
// 变形虫 (Amiba) — Skill 系统 v2
// ============================================================
// 底层使用 skills/<slug>/SKILL.md 目录格式。
// 公共 API 保持兼容，内部使用 skill-parser / skill-commands 扫描。
// ============================================================
import {
  removeSkillDir,
  copySkillFolder,
} from '../config/storage'
import { parseSkillMd, toSkillSlug } from './skill-parser'
import { getSkillCommands, getSkillContent, invalidateSkillCache } from './skill-commands'

export interface Skill {
  name: string
  description: string
  keywords: string[]
  template: string
  /** v2: 规范化 slug */
  slug?: string
}

// ---- 内置技能 ----

const BUILTIN_SLUGS = ['counter', 'todo', 'notes', 'service-dev']

const BUILTIN_SLUG_MAP: Record<string, string> = {
  '计数器': 'counter',
  '待办清单': 'todo',
  '笔记': 'notes',
  '服务开发': 'service-dev',
}

// ---- User Skills ----

let userSkills: Skill[] = []

export async function loadUserSkills(): Promise<Skill[]> {
  invalidateSkillCache()
  const commands = await getSkillCommands()
  const skills: Skill[] = []

  for (const [slug, info] of commands) {
    if (BUILTIN_SLUGS.includes(slug)) continue

    skills.push({
      name: info.name,
      description: info.description,
      keywords: info.keywords,
      template: '',
      slug,
    })
  }

  userSkills = skills
  return userSkills
}

export async function saveUserSkills(skills: Skill[]) {
  userSkills = skills
  for (const skill of skills) {
    await writeSkillAsMarkdown(skill)
  }
}

export function getUserSkills(): Skill[] {
  return userSkills
}

export async function addUserSkill(skill: Skill): Promise<void> {
  const slug = skill.slug || toSkillSlug(skill.name)

  if (userSkills.some((s) => (s.slug || toSkillSlug(s.name)) === slug)) {
    throw new Error(`Skill "${skill.name}" 已存在`)
  }

  skill.slug = slug
  userSkills.push(skill)
  await writeSkillAsMarkdown(skill)
}

export async function updateUserSkill(
  oldName: string,
  skill: Skill
): Promise<void> {
  const oldSlug = toSkillSlug(oldName)
  const idx = userSkills.findIndex(
    (s) => (s.slug || toSkillSlug(s.name)) === oldSlug
  )
  if (idx === -1) throw new Error(`Skill "${oldName}" 不存在`)

  const newSlug = skill.slug || toSkillSlug(skill.name)
  skill.slug = newSlug

  if (oldSlug !== newSlug) {
    await removeSkillDir(oldSlug)
  }

  await writeSkillAsMarkdown(skill)
  userSkills[idx] = skill
}

export async function deleteUserSkill(name: string): Promise<void> {
  const slug = toSkillSlug(name)
  const idx = userSkills.findIndex(
    (s) => (s.slug || toSkillSlug(s.name)) === slug
  )
  if (idx === -1) throw new Error(`Skill "${name}" 不存在`)
  userSkills.splice(idx, 1)
  await removeSkillDir(slug)
}

export async function importSkillFromFolder(
  sourceDir: string
): Promise<Skill> {
  const { isHarmonyRuntime } = await import('../config/platform-bridge')
  const { isHarmonyPickerUri, harmonyPickerChildUri } = await import('../config/folder-picker')

  let raw: string
  try {
    if (isHarmonyRuntime() && isHarmonyPickerUri(sourceDir)) {
      // 鸿蒙 picker URI（沙箱外授权目录）：native-fs resolveSafe 会拒绝，走壳层 fileAccess 命令族
      const { nativeInvoke } = await import('../config/platform-bridge')
      const { PICKER_COMMANDS } = await import('../types/native-bridge')
      const r = await nativeInvoke<{ data: string }>(PICKER_COMMANDS.fileAccessReadText, {
        uri: harmonyPickerChildUri(sourceDir, 'SKILL.md'),
      })
      raw = r.data
    } else {
      const { readTextFile } = await import('../config/native-fs')
      raw = await readTextFile(sourceDir + '/SKILL.md')
    }
  } catch {
    throw new Error('所选文件夹中没有 SKILL.md')
  }

  const parsed = parseSkillMd(raw)
  if (!parsed.frontmatter.name) throw new Error('SKILL.md 缺少 name 字段')

  const skill: Skill = {
    name: parsed.frontmatter.name,
    description: parsed.frontmatter.description,
    keywords: parsed.frontmatter.keywords || [],
    template: parsed.body,
    slug: toSkillSlug(parsed.frontmatter.name),
  }

  if (
    userSkills.some(
      (s) => (s.slug || toSkillSlug(s.name)) === skill.slug
    )
  ) {
    throw new Error(`Skill "${skill.name}" 已存在`)
  }

  await copySkillFolder(sourceDir, skill.slug!)

  userSkills.push(skill)
  return skill
}

// ---- 辅助 ----

async function writeSkillAsMarkdown(skill: Skill): Promise<void> {
  const slug = skill.slug || toSkillSlug(skill.name)
  const keywords = skill.keywords || []

  const content = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    'version: 1.0.0',
    `keywords: [${keywords.join(', ')}]`,
    'platforms: [web, desktop]',
    '---',
    '',
    `# ${skill.name}`,
    '',
    skill.description,
    '',
    '## When to Use',
    '',
    '根据用户需求使用。',
    '',
    '## Procedure',
    '',
    '根据用户指令和参考信息执行。',
    '',
    skill.template || '',
  ].join('\n')

  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import(
      '../config/native-fs'
    )
    await mkdir(`skills/${slug}`, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    }).catch(() => {})
    await writeTextFile(`skills/${slug}/SKILL.md`, content, {
      baseDir: BaseDirectory.AppData,
    })
    console.log(`[Skills] 写入 ${slug}/SKILL.md`)
  } catch {
    console.warn(`[Skills] 写入失败（非 Tauri 环境）: ${slug}`)
  }
}

// ---- 公共查询 ----

export function getAllSkills(): Skill[] {
  const builtins: Skill[] = BUILTIN_SLUGS.map((slug) => ({
    name:
      Object.entries(BUILTIN_SLUG_MAP).find(([, v]) => v === slug)?.[0] ||
      slug,
    description: '',
    keywords: [],
    template: '',
    slug,
  }))
  return [...builtins, ...userSkills]
}

export async function getSkillTemplate(name: string): Promise<string | null> {
  const slug = BUILTIN_SLUG_MAP[name] || toSkillSlug(name)
  return await getSkillContent(slug)
}

export function matchSkill(userPrompt: string): Skill | null {
  const lower = userPrompt.toLowerCase()
  const all = getAllSkills()
  for (const skill of all) {
    for (const kw of skill.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return skill
      }
    }
  }
  return null
}

export async function getSkillContext(
  skill: Skill | null
): Promise<string> {
  if (!skill) return ''
  const template = await getSkillTemplate(skill.name)
  if (!template) return ''

  console.log(`[Skill] 🎯 Generator 关键词匹配: ${skill.name} (slug: ${skill.slug || '?'})`)

  return [
    '',
    '=== SKILL CONTEXT ===',
    `名称: ${skill.name}`,
    `描述: ${skill.description}`,
    '参考模板:',
    template,
    '',
  ].join('\n')
}
