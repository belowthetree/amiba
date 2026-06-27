// ============================================================
// 变形虫 (Amiba) — Memory 工具（重构自 memory.ts）
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  executeMemoryOperation,
  getMemoryContextForPrompt,
  refreshMemoryCache,
} from '../ai/memory'
import type { MemoryToolParams } from '../types/service'

toolRegistry.register({
  name: 'memory',
  toolset: 'core',
  emoji: '🧠',
  description:
    '保存跨会话的持久记忆。MEMORY.md 存 AI 笔记，USER.md 存用户画像。条目用 § 分隔，字符有限额。满时需分批删除旧条目再加新条目。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'memory',
      description:
        '保存跨会话的持久记忆。MEMORY.md 存 AI 笔记，USER.md 存用户画像。条目用 § 分隔，字符有限额。满时需分批删除旧条目再加新条目。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'replace', 'remove'],
            description: '单操作时使用。批量时用 operations 字段。',
          },
          target: {
            type: 'string',
            enum: ['memory', 'user'],
            description: '写入目标',
          },
          content: {
            type: 'string',
            description: 'add/replace 时的内容',
          },
          old_text: {
            type: 'string',
            description: 'replace/remove 时用于匹配的子串',
          },
          operations: {
            type: 'array',
            description: '批量操作 [{action, content?, old_text?}]，原子执行',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['add', 'replace', 'remove'],
                },
                content: { type: 'string' },
                old_text: { type: 'string' },
              },
              required: ['action'],
            },
          },
        },
        required: ['target'],
      },
    },
  },
  handler: async (args) => {
    const params = args as unknown as MemoryToolParams
    const result = await executeMemoryOperation(params)
    // 记忆变更后刷新缓存，保证下次 system prompt 是最新的
    await refreshMemoryCache()
    return result
  },
})

/**
 * 便捷导出：供 agent.ts system prompt 使用
 */
export { getMemoryContextForPrompt, refreshMemoryCache }
