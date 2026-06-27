// ============================================================
// 变形虫 (Amiba) — Generate Service 工具
// ============================================================
// 注意：此工具仅收集参数并返回 JSON 指令给 Agent。
// 实际服务生成由 ChatPage 在 Agent 返回后解析 tool result 并调用
// generator.ts 的 generateService()，因为它需要非流式 UI 交互。
// ============================================================
import { toolRegistry } from './tool-registry'

toolRegistry.register({
  name: 'generate_service',
  toolset: 'core',
  emoji: '⚡',
  description:
    '根据用户需求生成一个完整的迷你 Web 应用（服务）。生成的服务包含 manifest + files（index.html / style.css / app.js），运行在 iframe 沙箱中。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'generate_service',
      description:
        '根据用户需求生成一个完整的迷你 Web 应用服务包。会调用 AI 生成器来创建包括 index.html、style.css、app.js 在内的完整应用。',
      parameters: {
        type: 'object',
        properties: {
          requirement: {
            type: 'string',
            description: '用户对应用需求的完整描述',
          },
          name: {
            type: 'string',
            description: '应用名称（可选，AI 会根据需求自动命名）',
          },
        },
        required: ['requirement'],
      },
    },
  },
  handler: async (args) => {
    const requirement = String(args.requirement || '')
    const name = args.name ? String(args.name) : ''

    if (!requirement.trim()) {
      return JSON.stringify({ error: 'requirement 不能为空' })
    }

    // 返回指令 JSON — ChatPage 解析此结果并启动真正的 generateService()
    return JSON.stringify({
      action: 'generate_service',
      requirement: requirement.trim(),
      name: name.trim() || undefined,
    })
  },
})
