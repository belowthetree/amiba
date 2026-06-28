// ============================================================
// 变形虫 (Amiba) — Skill 浏览工具（skill_view / skills_list）
// ============================================================
import { toolRegistry } from './tool-registry'

// ---- skill_view ----

toolRegistry.register({
  name: 'skill_view',
  toolset: 'skills',
  emoji: '📖',
  description:
    '查看一个技能的完整内容（SKILL.md）。当用户通过 /skill-name 触发或 Agent 需要参考技能指导时使用。',
  maxResultSizeChars: 6000,
  schema: {
    type: 'function',
    function: {
      name: 'skill_view',
      description:
        '查看指定技能的完整 SKILL.md 内容，包含使用时机、操作步骤、注意事项等。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能名称（hyphens slug），如 "counter"、"todo"、"notes"',
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (args) => {
    const name = String(args.name || '').trim()
    if (!name) return JSON.stringify({ error: 'name 不能为空' })

    // 记录查看
    const { bumpView } = await import('../ai/skill-usage')
    await bumpView(name)

    // 动态导入避免循环依赖
    const { getSkillContent } = await import('../ai/skill-commands')
    const content = await getSkillContent(name)

    if (!content) {
      return JSON.stringify({
        error: `未找到技能 "${name}"`,
        hint: '可用的技能列表可通过 skills_list 工具查看',
      })
    }

    return content
  },
})

// ---- skills_list ----

toolRegistry.register({
  name: 'skills_list',
  toolset: 'skills',
  emoji: '📚',
  description: '列出所有可用的技能及其简介。Agent 可在需要时先列出技能，再选择查看。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'skills_list',
      description:
        '列出所有已安装技能的名称、描述和关键词，帮助 Agent 了解可用能力。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '可选：按名称或关键词过滤',
          },
        },
      },
    },
  },
  handler: async (args) => {
    const query = args.query ? String(args.query).toLowerCase() : ''

    const { getSkillCommands } = await import('../ai/skill-commands')
    const skills = await getSkillCommands()

    const list: {
      name: string
      description: string
      keywords: string[]
    }[] = []

    for (const [cmdKey, info] of skills) {
      if (
        !query ||
        info.name.toLowerCase().includes(query) ||
        info.keywords.some((kw) => kw.toLowerCase().includes(query)) ||
        cmdKey.includes(query)
      ) {
        list.push({
          name: info.name,
          description: info.description,
          keywords: info.keywords,
        })
      }
    }

    return JSON.stringify({
      count: list.length,
      skills: list,
      usage: '使用 /skill-name 触发，或通过 skill_view 查看完整内容',
    })
  },
})
