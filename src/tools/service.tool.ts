// ============================================================
// 变形虫 (Amiba) — 服务查看工具（service_list / service_view）
// ============================================================
// 提供 Agent 浏览和查看已安装服务的能力。
// ============================================================
import { toolRegistry } from './tool-registry'
import { getService, getAllServices, getServicePackage } from '../host/registry'

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
