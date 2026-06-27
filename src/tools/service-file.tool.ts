// ============================================================
// 变形虫 (Amiba) — Service 文件管理工具
// ============================================================
// 允许 Agent 对指定的服务目录中文件进行 列出/读取/编辑/删除，
// 用于 AI 迭代修改已生成服务，无需重新生成整个包。
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  listServiceFiles,
  readServiceFile,
  writeServiceFile,
  removeServiceFile,
  listServiceDirs,
} from '../config/storage'
import { getService } from '../host/registry'

// ---- 辅助：校验 serviceId 合法性 ----

function validateServiceId(serviceId: string): string | null {
  if (!serviceId || typeof serviceId !== 'string' || !serviceId.trim()) {
    return 'service_id 不能为空'
  }
  // 只允许操作 user.* 服务（保护系统内置服务）
  if (serviceId.startsWith('system.')) {
    return '系统内置服务不可编辑'
  }
  // 检查服务是否存在
  const svc = getService(serviceId)
  if (!svc) {
    return `服务 "${serviceId}" 不存在`
  }
  return null
}

// ---- service_file_list ----

toolRegistry.register({
  name: 'service_file_list',
  toolset: 'core',
  emoji: '📂',
  description:
    '列出指定服务目录中的所有文件。返回文件名列表，用于了解服务结构后再读取或编辑。',
  maxResultSizeChars: 4000,
  schema: {
    type: 'function',
    function: {
      name: 'service_file_list',
      description:
        '列出指定已安装服务的所有文件。可用于查看服务结构，确定要读取或修改哪些文件。',
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
    const err = validateServiceId(serviceId)
    if (err) return JSON.stringify({ error: err })

    try {
      const files = await listServiceFiles(serviceId)
      return JSON.stringify({
        service_id: serviceId,
        count: files.length,
        files,
      })
    } catch (e: any) {
      return JSON.stringify({ error: e.message })
    }
  },
})

// ---- service_file_read ----

toolRegistry.register({
  name: 'service_file_read',
  toolset: 'core',
  emoji: '📖',
  description:
    '读取指定服务目录中的某个文件内容。用于查看 HTML/CSS/JS 代码后决定如何修改。',
  maxResultSizeChars: 8000,
  schema: {
    type: 'function',
    function: {
      name: 'service_file_read',
      description:
        '读取指定服务的某个文件完整内容。在修改文件之前先阅读现有代码。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '服务 ID，如 "user.todo"',
          },
          file_path: {
            type: 'string',
            description: '文件路径，如 "index.html"、"style.css"、"app.js"',
          },
        },
        required: ['service_id', 'file_path'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    const filePath = String(args.file_path || '').trim()

    const err = validateServiceId(serviceId)
    if (err) return JSON.stringify({ error: err })

    if (!filePath) return JSON.stringify({ error: 'file_path 不能为空' })

    try {
      const content = await readServiceFile(serviceId, filePath)
      if (content === null) {
        return JSON.stringify({
          error: `文件 "${filePath}" 不存在于服务 ${serviceId}`,
        })
      }
      return JSON.stringify({
        service_id: serviceId,
        file_path: filePath,
        content,
      })
    } catch (e: any) {
      return JSON.stringify({ error: e.message })
    }
  },
})

// ---- service_file_write ----

toolRegistry.register({
  name: 'service_file_write',
  toolset: 'core',
  emoji: '✏️',
  description:
    '写入/编辑指定服务目录中的某个文件。覆盖式写入，用于 AI 修改服务的 HTML/CSS/JS 代码。',
  maxResultSizeChars: 1000,
  schema: {
    type: 'function',
    function: {
      name: 'service_file_write',
      description:
        '将内容写入指定服务的某个文件。覆盖式写入（会替换整个文件内容）。修改前建议先用 service_file_read 查看现有代码。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '服务 ID，如 "user.todo"',
          },
          file_path: {
            type: 'string',
            description: '文件路径，如 "index.html"、"style.css"、"app.js"',
          },
          content: {
            type: 'string',
            description: '要写入的完整文件内容',
          },
        },
        required: ['service_id', 'file_path', 'content'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    const filePath = String(args.file_path || '').trim()
    const content = String(args.content ?? '')

    const err = validateServiceId(serviceId)
    if (err) return JSON.stringify({ error: err })

    if (!filePath) return JSON.stringify({ error: 'file_path 不能为空' })

    try {
      await writeServiceFile(serviceId, filePath, content)
      return JSON.stringify({
        success: true,
        service_id: serviceId,
        file_path: filePath,
        size: content.length,
      })
    } catch (e: any) {
      return JSON.stringify({ error: e.message })
    }
  },
})

// ---- service_list (列出所有服务) ----

toolRegistry.register({
  name: 'service_list',
  toolset: 'core',
  emoji: '📋',
  description:
    '列出所有已安装的服务及其 ID。Agent 在编辑服务文件前先用此工具获取服务列表。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'service_list',
      description:
        '列出所有已安装的服务（名称和 ID），供 Agent 选择要操作的服务。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  handler: async () => {
    const { getAllServices } = await import('../host/registry')
    const all = getAllServices()
    // 仅列出可编辑的用户服务（排除系统内置）
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
