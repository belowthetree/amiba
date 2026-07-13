// ============================================================
// 变形虫 (Amiba) — 服务管理工具（service_list / service_view / service_create）
// ============================================================
// 提供 Agent 浏览、查看和创建新服务的能力。
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  getService,
  getAllServices,
  getServicePackage,
  registerService,
} from '../host/registry'
import { writeServiceFile } from '../config/storage'
import type { Permission } from '../types/service'

// ================================================================
// service_list — 列出所有用户服务
// ================================================================

toolRegistry.register({
  name: 'service_list',
  toolset: 'service',
  category: 'view',
  emoji: '📋',
  description:
    '列出所有已安装的用户服务及其 ID。Agent 在编辑生成服务前先用此工具获取服务列表。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'service_list',
      description:
        '列出所有已安装的用户服务（名称和 ID），供 Agent 选择要操作的服务。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  handler: async () => {
    const all = getAllServices()
    const userServices = all.filter((s) => !s.manifest.id.startsWith('system.'))
    const list = userServices.map((s) => ({
      id: s.manifest.id,
      name: s.manifest.name,
      description: s.manifest.description,
      enabled: s.enabled,
      source: s.source,
    }))
    return JSON.stringify({ count: list.length, services: list })
  },
})

// ================================================================
// service_view — 查看单个服务完整信息
// ================================================================

toolRegistry.register({
  name: 'service_view',
  toolset: 'service',
  category: 'view',
  emoji: '🔍',
  description:
    '查看指定服务的完整信息：manifest、文件列表、安装状态。在编辑服务文件前先用此工具了解服务结构。',
  maxResultSizeChars: 5000,
  schema: {
    type: 'function',
    function: {
      name: 'service_view',
      description:
        '查看一个服务的详细信息，包括 manifest 元数据、所有文件列表和安装状态。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '服务 ID，如 "user.todo"、"user.counter"',
          },
        },
        required: ['service_id'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    if (!serviceId) return JSON.stringify({ error: 'service_id 不能为空' })

    const entry = getService(serviceId)
    if (!entry) {
      return JSON.stringify({
        error: `服务 "${serviceId}" 不存在`,
        hint: '使用 service_list 查看所有可用服务',
      })
    }

    const manifest = entry.manifest

    // 获取文件列表（仅用户服务）
    let files: string[] = []
    let widgetCount = 0
    if (!serviceId.startsWith('system.')) {
      try {
        const pkg = await getServicePackage(serviceId)
        if (pkg) {
          files = pkg.files.map((f) => f.path)
          widgetCount = files.filter((f) => f.startsWith('widgets/')).length
          files = files.filter(
            (f) => !f.startsWith('widgets/') && f !== 'manifest.json' && f !== 'tasks.json'
          )
        }
      } catch {
        // 文件列表获取失败不影响主流程
      }
    }

    const result: any = {
      service_id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      permissions: manifest.permissions,
      enabled: entry.enabled,
      source: entry.source,
      installed_at: entry.installedAt,
    }

    if (files.length > 0) {
      result.files_count = files.length
      result.files = files
    }

    if (widgetCount > 0) {
      result.widgets_count = widgetCount
    }

    return JSON.stringify(result)
  },
})

// ================================================================
// service_create — 创建新服务骨架
// ================================================================

const VALID_PERMISSIONS = ['storage', 'notification', 'widgets', 'network', 'fetch']
const VALID_ID_REGEX = /^[a-z0-9._-]+$/

toolRegistry.register({
  name: 'service_create',
  toolset: 'service',
  category: 'manage',
  emoji: '🆕',
  description:
    '创建新服务骨架：注册 manifest、创建服务目录。之后用 service_file_write 写入代码文件。创建前务必用 service_list 检查是否有重复服务。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'service_create',
      description:
        '创建一个新的用户服务。传入 manifest 信息，系统自动创建目录并注册。随后用 service_file_write 逐个写入 index.html、style.css、app.js 等文件。创建前务必用 service_list 检查 ID 是否冲突。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              '服务唯一标识，必须以 "user." 开头，如 "user.chatroom"、"user.todo-app"。仅允许小写字母、数字、点、连字符和下划线。',
          },
          name: {
            type: 'string',
            description: '显示名称（中文优先），如 "聊天室"、"番茄钟"',
          },
          description: {
            type: 'string',
            description: '简短描述，≤30 字',
          },
          version: {
            type: 'string',
            description: '版本号，默认 "1.0.0"',
            default: '1.0.0',
          },
          permissions: {
            type: 'array',
              description:
                '需要的权限列表。storage=数据持久化，notification=Toast通知，widgets=悬浮块，network=局域网P2P通信，fetch=HTTP请求代理（绕过CORS）。多人/协作/聊天场景需要 network。',
            items: {
              type: 'string',
              enum: ['storage', 'notification', 'widgets', 'network', 'fetch'],
            },
          },
        },
        required: ['id', 'name', 'description'],
      },
    },
  },
  handler: async (args) => {
    const id = String(args.id || '').trim()
    const name = String(args.name || '').trim()
    const description = String(args.description || '').trim()
    const version = String(args.version || '1.0.0').trim()
    const permissions: string[] = Array.isArray(args.permissions)
      ? args.permissions.filter((p: any) => VALID_PERMISSIONS.includes(String(p)))
      : []

    // 校验 id
    if (!id) return JSON.stringify({ error: 'id 不能为空' })
    if (!id.startsWith('user.')) {
      return JSON.stringify({
        error: `服务 ID 必须以 "user." 开头，收到: "${id}"`,
        suggestion: `建议使用 "user.${id.replace(/^user\.?/, '').replace(/[^a-z0-9._-]/g, '-')}"`,
      })
    }
    if (!VALID_ID_REGEX.test(id)) {
      return JSON.stringify({
        error: `服务 ID 包含非法字符: "${id}"。仅允许小写字母、数字、点、连字符、下划线`,
        suggestion: id.replace(/[^a-z0-9._-]/g, '-'),
      })
    }
    if (id.startsWith('system.')) {
      return JSON.stringify({ error: '不能创建系统内置服务' })
    }

    // 检查重复
    const existing = getService(id)
    if (existing) {
      return JSON.stringify({
        error: `服务 "${id}" 已存在（${existing.manifest.name}）`,
        hint: '使用 service_list 查看已有服务，或换一个 ID',
      })
    }

    // 校验 name / description
    if (!name) return JSON.stringify({ error: 'name 不能为空' })
    if (!description) return JSON.stringify({ error: 'description 不能为空' })

    // 构建 manifest
    const manifest = { id, name, version, description, permissions }

    try {
      await registerService(manifest as any, 'ai-generated')
      await writeServiceFile(id, 'manifest.json', JSON.stringify(manifest, null, 2))

      return JSON.stringify({
        success: true,
        service_id: id,
        name,
        version,
        description,
        permissions,
        message: `服务 "${name}" (${id}) 已创建。使用 service_file_write 写入 index.html、style.css、app.js 等文件。`,
        reminder: `⚠️ 写入代码前请确保已阅读 service-dev 技能（调用 skill_view("service-dev")），了解 sandbox 约束和 API 规范。`,
        next_steps: [
          `service_file_write({ service_id: "${id}", file_path: "index.html", content: "..." })`,
          `service_file_write({ service_id: "${id}", file_path: "style.css", content: "..." })`,
          `service_file_write({ service_id: "${id}", file_path: "app.js", content: "..." })`,
          `service_validate({ service_id: "${id}" })`,
        ],
      })
    } catch (e: any) {
      console.error('[ServiceCreate] 创建失败:', e)
      return JSON.stringify({ error: e.message || String(e) })
    }
  },
})
