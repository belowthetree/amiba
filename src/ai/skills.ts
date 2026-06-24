// ============================================================
// 变形虫 (Amiba) — Skill 系统
// ============================================================
import { storageGetJSON, storageSetJSON } from '../config/storage'

export interface Skill {
  name: string
  description: string
  keywords: string[]
  template: string
}

const SKILLS_STORE_KEY = 'amiba_user_skills'

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
]

// Build template paths for built-in skills
const BUILTIN_TEMPLATES: Record<string, string> = {
  '计数器': 'counter',
  '待办清单': 'todo',
  '笔记': 'notes',
}

// User-loaded skills (reactive-ish via refresh)
let userSkills: Skill[] = []

export async function loadUserSkills(): Promise<Skill[]> {
  const saved = await storageGetJSON<Skill[]>(SKILLS_STORE_KEY)
  userSkills = saved || []
  return userSkills
}

export async function saveUserSkills(skills: Skill[]) {
  userSkills = skills
  await storageSetJSON(SKILLS_STORE_KEY, skills)
}

export function getUserSkills(): Skill[] {
  return userSkills
}

export function getAllSkills(): Skill[] {
  return [...builtinSkills.filter(s => s.template), ...userSkills]
}

// Load a skill template from built-in (lazy) or user
export async function getSkillTemplate(name: string): Promise<string | null> {
  // Check user skills first
  const us = userSkills.find(s => s.name === name)
  if (us) return us.template

  // Check built-in
  const builtinKey = BUILTIN_TEMPLATES[name]
  if (builtinKey) {
    try {
      const resp = await fetch(`/catalog/skills/${builtinKey}.json`)
      return await resp.text()
    } catch {
      return null
    }
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
