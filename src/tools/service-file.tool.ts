// ============================================================
// 变形虫 (Amiba) — Service 文件编辑工具
// ============================================================
// 允许 Agent 对指定的服务目录中文件进行 列出/读取/编辑/写入，
// 用于 AI 迭代修改已生成服务，无需重新生成整个包。
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  listServiceFiles,
  readServiceFile,
  writeServiceFile,
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
  toolset: 'service',
  category: 'edit',
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
  toolset: 'service',
  category: 'edit',
  emoji: '📖',
  description:
    '读取指定服务目录中的某个文件内容。用于查看 HTML/CSS/JS 代码后决定如何修改。',
  maxResultSizeChars: 12000,
  schema: {
    type: 'function',
    function: {
      name: 'service_file_read',
      description:
        '读取指定服务的某个文件内容。支持分页（offset/limit），在修改文件之前先阅读现有代码。大文件建议先用 offset=1,limit=80 快速浏览头部，再根据需要翻页。',
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
          offset: {
            type: 'number',
            description: '可选，起始行号（1-based），默认 1。与 limit 配合实现分页读取。',
          },
          limit: {
            type: 'number',
            description: '可选，返回的最大行数，默认 200，最大 500。不传则返回完整文件内容。',
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

      const lines = content.split('\n')
      const totalLines = lines.length

      // 分页模式：传了 offset 或 limit 时启用
      const usePagination = args.offset !== undefined || args.limit !== undefined
      if (usePagination) {
        const offsetNum = Math.max(1, Math.floor(Number(args.offset ?? 1)))
        const limitNum = Math.max(1, Math.min(500, Math.floor(Number(args.limit ?? 200))))
        const startIdx = offsetNum - 1 // 转为 0-based
        const endIdx = Math.min(startIdx + limitNum, totalLines)
        const sliced = lines.slice(startIdx, endIdx).join('\n')

        return JSON.stringify({
          service_id: serviceId,
          file_path: filePath,
          total_lines: totalLines,
          start_line: startIdx + 1,
          end_line: endIdx,
          has_more_before: startIdx > 0,
          has_more_after: endIdx < totalLines,
          content: sliced,
        })
      }

      // 完整读取模式（向后兼容）
      return JSON.stringify({
        service_id: serviceId,
        file_path: filePath,
        total_lines: totalLines,
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
  toolset: 'service',
  category: 'edit',
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
      await afterServiceFileChange(serviceId, filePath)
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

/** 服务文件写入后处理：
 *  - manifest.json：热刷新注册表内存（权限等立即生效，无需重启）
 *  - desktop-widgets/：重扫卡片注册（新卡片自动启用推送，无需重启），并重跑该卡片逻辑刷新桌面显示 */
async function afterServiceFileChange(serviceId: string, filePath: string) {
  if (filePath === 'manifest.json') {
    try {
      const { refreshServiceManifest } = await import('../host/registry')
      await refreshServiceManifest(serviceId)
    } catch (e) {
      console.warn('[Registry] manifest 热刷新失败:', e)
    }
    return
  }
  if (!filePath.startsWith('desktop-widgets/')) return
  try {
    const { rescanDesktopWidgets } = await import('../config/desktop-widget-store')
    const { refreshWidgetCard } = await import('../host/desktop-widget-runner')
    await rescanDesktopWidgets()
    const m = filePath.match(/^desktop-widgets\/([^/]+)\//)
    if (m) await refreshWidgetCard(`${serviceId}/${m[1]}`)
  } catch (e) {
    console.warn('[DesktopWidget] 文件变更后刷新失败:', e)
  }
}

// ---- service_file_edit ----

toolRegistry.register({
  name: 'service_file_edit',
  toolset: 'service',
  category: 'edit',
  emoji: '✂️',
  description:
    '精确修改服务文件的某一段落（查找替换）。只替换目标行，不影响文件其余部分。优先使用此工具而非 service_file_write 完整重写。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'service_file_edit',
      description:
        '在服务文件中进行精确的查找替换。先用 service_file_read 确认当前代码，再提供足够的上下文确保 find 唯一匹配。仅修改少量行时用此工具，大范围改动才用 service_file_write。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '服务 ID，如 "user.todo"',
          },
          file_path: {
            type: 'string',
            description: '文件路径，如 "app.js"、"style.css"',
          },
          find: {
            type: 'string',
            description: '要替换的原文字。必须精确匹配（含空格、缩进、换行），并提供足够上下文确保唯一匹配。',
          },
          replace: {
            type: 'string',
            description: '替换后的新文字',
          },
        },
        required: ['service_id', 'file_path', 'find', 'replace'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    const filePath = String(args.file_path || '').trim()
    const find = String(args.find || '')
    const replace = String(args.replace ?? '')

    const err = validateServiceId(serviceId)
    if (err) return JSON.stringify({ error: err })

    if (!filePath) return JSON.stringify({ error: 'file_path 不能为空' })
    if (!find) return JSON.stringify({ error: 'find 不能为空' })

    try {
      const content = await readServiceFile(serviceId, filePath)
      if (content === null) {
        return JSON.stringify({
          error: `文件 "${filePath}" 不存在于服务 ${serviceId}`,
          hint: '使用 service_file_list 查看可用文件',
        })
      }

      const count = (content.match(escapeForRegex(find)) || []).length
      if (count === 0) {
        return JSON.stringify({
          error: `未找到匹配的文字。请用 service_file_read 查看当前内容，确认 find 精确匹配（含空格、缩进和换行）。`,
          hint: 'find 必须与文件中的文字完全一致。',
        })
      }
      if (count > 1) {
        return JSON.stringify({
          error: `找到 ${count} 处匹配，不够精确。请增加更多上下文使 find 唯一。`,
          hint: '多选几行代码作为 find，确保整段文字只在文件中出现一次。',
        })
      }

      const updated = content.replace(find, replace)
      await writeServiceFile(serviceId, filePath, updated)
      await afterServiceFileChange(serviceId, filePath)

      return JSON.stringify({
        success: true,
        service_id: serviceId,
        file_path: filePath,
        old_size: content.length,
        new_size: updated.length,
        message: `已修改 ${filePath}（${content.length} → ${updated.length} 字符）`,
      })
    } catch (e: any) {
      return JSON.stringify({ error: e.message })
    }
  },
})

function escapeForRegex(str: string): RegExp {
  const escaped = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, 'g')
}

