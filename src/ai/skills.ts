// ============================================================
// 变形虫 (Amiba) — Skill 系统
// ============================================================
import { readSkillFile, readSkillJson, writeSkillFile, removeSkillFile, removeSkillDir, listSkillFiles, copySkillFolder } from '../config/storage'

export interface Skill {
  name: string
  description: string
  keywords: string[]
  template: string
}

// Built-in skills
const builtinSkills: Skill[] = [
  {
    name: '计数器',
    description: '带计数的简单点击应用',
    keywords: ['计数', '统计', '点击', '计数器', 'counter'],
    template: '',
  },
  {
    name: '待办清单',
    description: '简单的 TODO 列表',
    keywords: ['待办', 'todo', '列表', '任务', '清单'],
    template: '',
  },
  {
    name: '笔记',
    description: '简单的笔记应用',
    keywords: ['笔记', 'note', '记事', '备忘录', '便签'],
    template: '',
  },
  {
    name: '服务开发',
    description: 'Amiba 服务开发完整指南',
    keywords: ['开发服务', '创建服务', '服务开发', '开发', 'service', 'server-dev', '写一个', '做一个', '帮我写', '帮我做'],
    template: '',
  },
]

// Build template paths for built-in skills
const BUILTIN_TEMPLATES: Record<string, string> = {
  '计数器': 'counter',
  '待办清单': 'todo',
  '笔记': 'notes',
  '服务开发': 'server-dev',
}

// User-loaded skills (reactive-ish via refresh)
let userSkills: Skill[] = []

export async function loadUserSkills(): Promise<Skill[]> {
  const names = await listSkillFiles()
  const skills: Skill[] = []
  for (const name of names) {
    try {
      const raw = await readSkillJson(name)
      if (raw) {
        const skill = JSON.parse(raw) as Skill
        skills.push(skill)
      }
    } catch (e) {
      console.warn('[Skills] 跳过损坏的 skill:', name, e)
    }
  }
  userSkills = skills
  return userSkills
}

export async function saveUserSkills(skills: Skill[]) {
  userSkills = skills
  // Write each skill as a separate file
  for (const skill of skills) {
    await writeSkillFile(skill.name, JSON.stringify(skill))
  }
}

export function getUserSkills(): Skill[] {
  return userSkills
}

export async function addUserSkill(skill: Skill): Promise<void> {
  // Check for duplicate name
  if (userSkills.some(s => s.name === skill.name)) {
    throw new Error(`Skill "${skill.name}" 已存在`)
  }
  userSkills.push(skill)
  await writeSkillFile(skill.name, JSON.stringify(skill))
}

export async function updateUserSkill(oldName: string, skill: Skill): Promise<void> {
  const idx = userSkills.findIndex(s => s.name === oldName)
  if (idx === -1) throw new Error(`Skill "${oldName}" 不存在`)

  // Check if old skill was folder-based
  let wasDir = false
  try {
    const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    wasDir = await exists(`skills/${oldName}/skill.json`, { baseDir: BaseDirectory.AppData })
  } catch { /* ignore */ }

  if (wasDir) {
    // Rename/move the directory if name changed
    if (oldName !== skill.name) {
      // Remove old dir (we'll re-create via write)
      await removeSkillDir(oldName)
      // Write skill.json into new directory
      await writeSkillFile(skill.name, JSON.stringify(skill))
    } else {
      // Update skill.json in-place inside the directory
      await writeSkillFile(skill.name, JSON.stringify(skill))
    }
  } else {
    // Flat file: remove old, write new
    if (oldName !== skill.name) {
      await removeSkillFile(oldName)
    }
    await writeSkillFile(skill.name, JSON.stringify(skill))
  }

  userSkills[idx] = skill
}

export async function deleteUserSkill(name: string): Promise<void> {
  const idx = userSkills.findIndex(s => s.name === name)
  if (idx === -1) throw new Error(`Skill "${name}" 不存在`)
  userSkills.splice(idx, 1)
  await removeSkillFile(name)
  await removeSkillDir(name) // also clean up folder-based skill if present
}

export async function importSkillFromFolder(sourceDir: string): Promise<Skill> {
  // Read skill.json from source folder
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  let raw: string
  try {
    raw = await readTextFile(sourceDir + '/skill.json')
  } catch {
    throw new Error('所选文件夹中没有 skill.json')
  }
  const skill: Skill = JSON.parse(raw)
  if (!skill.name) throw new Error('skill.json 缺少 name 字段')

  // Check for duplicate
  if (userSkills.some(s => s.name === skill.name)) {
    throw new Error(`Skill "${skill.name}" 已存在`)
  }

  // Copy folder into skills/
  await copySkillFolder(sourceDir, skill.name)

  // Add to in-memory list
  userSkills.push(skill)
  return skill
}

export function getAllSkills(): Skill[] {
  return [...builtinSkills.filter(s => s.template), ...userSkills]
}

// Load a skill template from built-in (lazy) or user
export async function getSkillTemplate(name: string): Promise<string | null> {
  // Check user skills first
  const us = userSkills.find(s => s.name === name)
  if (us) return us.template

  // Check built-in: load SKILL.md from skill directory
  const builtinKey = BUILTIN_TEMPLATES[name]
  if (builtinKey) {
    try {
      const resp = await fetch(`/catalog/skills/${builtinKey}/SKILL.md`)
      if (resp.ok) return await resp.text()
    } catch { /* fall through */ }

    // Fallback: try legacy prompt.md
    try {
      const resp = await fetch(`/catalog/skills/${builtinKey}/prompt.md`)
      if (resp.ok) return await resp.text()
    } catch { /* fall through */ }

    // Fallback: try legacy flat JSON file
    try {
      const resp = await fetch(`/catalog/skills/${builtinKey}.json`)
      if (resp.ok) return await resp.text()
    } catch { return null }
  }
  return null
}

export function matchSkill(userPrompt: string): Skill | null {
  const lower = userPrompt.toLowerCase()
  const all = [...builtinSkills, ...userSkills]
  for (const skill of all) {
    for (const kw of skill.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return skill
      }
    }
  }
  return null
}

export async function getSkillContext(skill: Skill | null): Promise<string> {
  if (!skill) return ''
  const template = await getSkillTemplate(skill.name)
  if (!template) return ''
  return `\n=== SKILL CONTEXT ===\n名称: ${skill.name}\n描述: ${skill.description}\n参考模板:\n${template}\n`
}
