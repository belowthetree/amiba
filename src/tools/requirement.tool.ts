// ============================================================
// 变形虫 (Amiba) — 需求追踪工具（requirement_*）
// ============================================================
// 提供 3 个 AI Agent 可调用的需求管理工具：
//   requirement_view    — 查看服务需求文档
//   requirement_update  — 追加需求/反馈/优化条目
//   requirements_summary — 查看全局需求汇总
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  getServiceRequirement,
  addRequirement,
  markRequirementDone,
  getGlobalRequirements,
  addGlobalOpportunity,
} from '../ai/requirement-store'

// ---- 辅助：获取服务名 ----

async function getServiceName(serviceId: string): Promise<string | undefined> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(`services/${serviceId}/REQUIREMENT.md`, {
      baseDir: BaseDirectory.AppData,
    })
    const { parseSkillMd } = await import('../ai/skill-parser')
    const parsed = parseSkillMd(raw)
    return parsed.frontmatter.service_name
  } catch {
    return undefined
  }
}

// ================================================================
// requirement_view — 查看单个服务的需求文档
// ================================================================

toolRegistry.register({
  name: 'requirement_view',
  toolset: 'core',
  emoji: '📋',
  description: '查看指定服务的需求追踪文档（REQUIREMENT.md），包含当前需求、已完成、待优化、用户反馈。',
  maxResultSizeChars: 5000,
  schema: {
    type: 'function',
    function: {
      name: 'requirement_view',
      description: '查看一个服务的需求文档。用于了解该服务还有哪些待做需求，或用户反馈了什么问题。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '服务 ID，如 "user.todo-app" 或 "user.notes-app"',
          },
        },
        required: ['service_id'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    if (!serviceId) return JSON.stringify({ error: 'service_id 不能为空' })

    const name = await getServiceName(serviceId)
    const doc = await getServiceRequirement(serviceId, name)

    // 构建可读输出
    const lines: string[] = [
      `# ${doc.frontmatter.service_name || serviceId} — 需求追踪`,
      `状态: ${doc.frontmatter.status || 'active'} | 优先级: ${doc.frontmatter.priority || 'medium'}`,
      '',
    ]

    lines.push('## 当前需求')
    if (doc.sections.current.length > 0) {
      doc.sections.current.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    } else {
      lines.push('（暂无）')
    }
    lines.push('')

    lines.push('## 待优化')
    if (doc.sections.optimize.length > 0) {
      doc.sections.optimize.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    } else {
      lines.push('（暂无）')
    }
    lines.push('')

    lines.push('## 用户反馈')
    if (doc.sections.feedback.length > 0) {
      doc.sections.feedback.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    } else {
      lines.push('（暂无）')
    }
    lines.push('')

    lines.push('## 已完成')
    if (doc.sections.done.length > 0) {
      doc.sections.done.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
    } else {
      lines.push('（暂无）')
    }

    return lines.join('\n')
  },
})

// ================================================================
// requirement_update — 追加需求条目
// ================================================================

toolRegistry.register({
  name: 'requirement_update',
  toolset: 'core',
  emoji: '➕',
  description:
    '向服务需求文档追加条目。类型: requirement（新需求）、optimization（优化建议）、feedback（用户反馈）、done（标记完成）。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'requirement_update',
      description:
        '更新服务需求追踪文档。用于记录用户提出的新功能、优化建议、反馈，或标记已完成的需求。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '服务 ID',
          },
          type: {
            type: 'string',
            enum: ['requirement', 'optimization', 'feedback', 'done'],
            description: '条目类型',
          },
          content: {
            type: 'string',
            description: '条目内容（一句话描述）',
          },
          global_opportunity: {
            type: 'string',
            description: '可选：如果此需求暗示了需要全新服务，在此描述建议的新服务名称',
          },
        },
        required: ['service_id', 'type', 'content'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    const type = String(args.type || '').trim()
    const content = String(args.content || '').trim()
    const globalOpp = args.global_opportunity
      ? String(args.global_opportunity).trim()
      : undefined

    if (!serviceId) return JSON.stringify({ error: 'service_id 不能为空' })
    if (!content) return JSON.stringify({ error: 'content 不能为空' })

    const name = await getServiceName(serviceId)

    const sectionMap: Record<string, keyof RequirementDoc['sections']> = {
      requirement: 'current',
      optimization: 'optimize',
      feedback: 'feedback',
      done: 'done',
    }

    const section = sectionMap[type]
    if (!section) {
      return JSON.stringify({
        error: `type 必须为 requirement / optimization / feedback / done，收到: "${type}"`,
      })
    }

    if (type === 'done') {
      await markRequirementDone(serviceId, name, content)
    } else {
      await addRequirement(serviceId, name, section, content)
    }

    // 如果标记了全局机会
    if (globalOpp) {
      await addGlobalOpportunity(content, globalOpp)
    }

    return JSON.stringify({
      ok: true,
      action: 'requirement_update',
      service_id: serviceId,
      type,
      content,
      global_opportunity: globalOpp || null,
      message: `已更新 ${serviceId} 需求文档（${type}: ${content.slice(0, 50)}）`,
    })
  },
})

// ================================================================
// requirements_summary — 全局需求汇总
// ================================================================

toolRegistry.register({
  name: 'requirements_summary',
  toolset: 'core',
  emoji: '📊',
  description:
    '查看全局需求汇总（REQUIREMENTS.md），包含所有服务的活跃需求、潜在新服务机会。用于判定是否需要创建新服务。',
  maxResultSizeChars: 6000,
  schema: {
    type: 'function',
    function: {
      name: 'requirements_summary',
      description:
        '读取全局需求汇总文件，了解所有服务的需求状态和潜在新服务机会。在决定是否生成新服务之前应该先查看此文件。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  handler: async () => {
    const raw = await getGlobalRequirements()
    return raw
  },
})

// 类型引用（来自 requirement-store）
import type { RequirementDoc } from '../ai/requirement-store'
