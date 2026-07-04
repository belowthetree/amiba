// ============================================================
// 变形虫 (Amiba) — 服务校验工具（service_validate）
// ============================================================
// 允许 Agent 主动调用校验已安装服务的内容合法性。
// 检测: localStorage / BroadcastChannel / alert / CDN / 权限一致性等。
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  validateService,
  formatValidationResult,
} from '../ai/service-validator'

toolRegistry.register({
  name: 'service_validate',
  toolset: 'service',
  category: 'view',
  emoji: '🔬',
  description:
    '校验指定服务的代码内容是否合法。检查存储 API 使用、沙箱禁用 API、权限声明一致性等。生成或修改服务后应主动调用。',
  maxResultSizeChars: 5000,
  schema: {
    type: 'function',
    function: {
      name: 'service_validate',
      description:
        '扫描服务文件内容，检测常见错误：localStorage 替代 __amiba__.storage、BroadcastChannel 跨窗口方案不可用、权限声明不一致等。修改或生成服务后调用此工具确保代码合规。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '要校验的服务 ID，如 "user.chatroom"',
          },
        },
        required: ['service_id'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    if (!serviceId) return JSON.stringify({ error: 'service_id 不能为空' })

    const result = await validateService(serviceId)
    return formatValidationResult(result)
  },
})
