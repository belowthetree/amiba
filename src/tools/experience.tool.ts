// ============================================================
// 变形虫 (Amiba) — 经验库工具（experience_*）
// ============================================================
// Skill 审查专用（review 工具集）：零散经验先入库计数，
// 复现 >= 3 次才固化为 skill，避免单次任务污染技能库。
//   experience_list   — 列出经验库
//   experience_record — 记录经验（已有同主题 → 计数+1）
//   experience_remove — 删除经验（固化为 skill 后调用）
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  listExperiences,
  recordExperience,
  removeExperience,
  SKILL_THRESHOLD,
} from '../ai/experience-store'

// ---- experience_list ----

toolRegistry.register({
  name: 'experience_list',
  toolset: 'skills',
  emoji: '📋',
  category: 'view',
  description: '列出经验库中的全部经验（含 id、标题、计数、内容摘要）。',
  schema: {
    type: 'function',
    function: {
      name: 'experience_list',
      description:
        '列出经验库中的全部经验。记录新经验前先调用查重：同主题经验已存在则用 experience_record 传其 id 计数；已被某个 skill 覆盖的经验不要记录。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    const list = await listExperiences()
    if (list.length === 0) return JSON.stringify({ experiences: [], message: '经验库为空' })
    return JSON.stringify({
      experiences: list.map(e => ({
        id: e.id,
        title: e.title,
        count: e.count,
        thresholdReached: e.count >= SKILL_THRESHOLD,
        content: e.content.slice(0, 200),
      })),
    })
  },
})

// ---- experience_record ----

toolRegistry.register({
  name: 'experience_record',
  toolset: 'skills',
  emoji: '📝',
  category: 'manage',
  description: `记录一条可复用经验。同主题经验已存在时计数+1；计数达到 ${SKILL_THRESHOLD} 次时应固化为 skill。`,
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'experience_record',
      description:
        `把对话中发现的零散可复用经验（技巧/配置/命令序列）记入经验库。同主题经验已存在时传其 id 使计数+1；不传 id 时按标题模糊查重。返回计数达到 ${SKILL_THRESHOLD} 次（thresholdReached=true）时，必须用 skill_manage_create 把该经验固化为 skill，再用 experience_remove 删除该经验。`,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '已有经验的 id（来自 experience_list，用于计数+1）；新建时省略',
          },
          title: {
            type: 'string',
            description: '经验主题（类级别，不用单次任务名），如 "DeepSeek Responses 接入"',
          },
          content: {
            type: 'string',
            description: '经验内容摘要：可复用的流程、关键步骤、注意事项',
          },
        },
        required: ['title', 'content'],
      },
    },
  },
  handler: async (args) => {
    const result = await recordExperience({
      id: args.id ? String(args.id) : undefined,
      title: String(args.title || ''),
      content: String(args.content || ''),
    })
    return JSON.stringify({
      id: result.entry.id,
      title: result.entry.title,
      count: result.entry.count,
      action: result.action,
      thresholdReached: result.thresholdReached,
      message: result.thresholdReached
        ? `该经验已复现 ${result.entry.count} 次，达到固化阈值：请用 skill_manage_create 创建 skill，然后用 experience_remove 删除此经验（id: ${result.entry.id}）`
        : `已记录，当前计数 ${result.entry.count}/${SKILL_THRESHOLD}`,
    })
  },
})

// ---- experience_remove ----

toolRegistry.register({
  name: 'experience_remove',
  toolset: 'skills',
  emoji: '🗑️',
  category: 'manage',
  description: '从经验库删除一条经验（固化为 skill 后调用）。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'experience_remove',
      description: '从经验库删除指定经验。经验被固化为 skill 后必须删除，避免重复创建。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的经验 id（如 "exp-1"）' },
        },
        required: ['id'],
      },
    },
  },
  handler: async (args) => {
    const ok = await removeExperience(String(args.id || ''))
    return JSON.stringify(ok ? { success: true } : { error: '经验不存在' })
  },
})
