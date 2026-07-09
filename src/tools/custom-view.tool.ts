// ============================================================
// 变形虫 (Amiba) — 自定义视图工具（custom_view_*）
// ============================================================
import { toolRegistry } from './tool-registry'
import { listCustomViews, loadCustomView, saveCustomView, resetCustomView } from '../config/custom-view-store'

// ================================================================
// custom_view_list — 列出所有自定义视图
// ================================================================

toolRegistry.register({
  name: 'custom_view_list',
  toolset: 'ui',
  category: 'view',
  emoji: '📋',
  description:
    '列出所有自定义视图。快捷页面(/quick)对应名称为 "quick"。用此工具了解有哪些自定义视图及是否有内容。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'custom_view_list',
      description: '列出所有自定义视图及其状态。默认至少有一个 "quick" 视图（快捷页面）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    const views = await listCustomViews()
    const hasQuick = views.some((v) => v.name === 'quick')
    if (!hasQuick) {
      views.unshift({ name: 'quick', hasContent: false, contentLength: 0 })
    }
    return JSON.stringify({ count: views.length, views })
  },
})

// ================================================================
// custom_view_read — 读取自定义视图内容
// ================================================================

toolRegistry.register({
  name: 'custom_view_read',
  toolset: 'ui',
  category: 'view',
  emoji: '👁',
  description:
    '读取指定自定义视图的完整 HTML 内容。修改前先用此工具查看当前内容。',
  maxResultSizeChars: 16000,
  schema: {
    type: 'function',
    function: {
      name: 'custom_view_read',
      description: '读取指定自定义视图名称的完整 HTML 内容。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '视图名称，如 "quick"。用 custom_view_list 查看所有可用名称。默认为 "quick"。',
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (args) => {
    const content = await loadCustomView(args.name)
    return JSON.stringify({
      name: args.name,
      has_content: !!content,
      length: content.length,
      content: content || null,
    })
  },
})

// ================================================================
// custom_view_edit — 精确查找替换（preferred 模式）
// ================================================================

toolRegistry.register({
  name: 'custom_view_edit',
  toolset: 'ui',
  category: 'edit',
  emoji: '✏️',
  description:
    '对自定义视图进行精确查找替换。首选编辑方式，只改需要改的部分。传入 old_str（查找原文）和 new_str（替换内容），old_str 必须精确匹配原内容的唯一一处。',
  maxResultSizeChars: 4000,
  schema: {
    type: 'function',
    function: {
      name: 'custom_view_edit',
      description:
        '精确查找替换指定自定义视图中的内容。old_str 必须精确匹配视图中唯一一处内容，替换为 new_str。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '视图名称，如 "quick"。默认为 "quick"。',
          },
          old_str: {
            type: 'string',
            description: '要精确查找并替换的原文本片段。必须逐字符完全匹配。',
          },
          new_str: {
            type: 'string',
            description: '替换后的新文本内容。',
          },
        },
        required: ['name', 'old_str', 'new_str'],
      },
    },
  },
  handler: async (args) => {
    const current = await loadCustomView(args.name)
    if (!current) {
      return JSON.stringify({ error: `视图 "${args.name}" 当前无内容，请使用 custom_view_write 写入初始内容` })
    }
    const firstIdx = current.indexOf(args.old_str)
    if (firstIdx === -1) {
      return JSON.stringify({ error: 'old_str 在原内容中未找到，请先用 custom_view_read 确认当前内容' })
    }
    const count = current.split(args.old_str).length - 1
    if (count > 1) {
      return JSON.stringify({ error: `old_str 在原内容中匹配到 ${count} 处，请提供更长的上下文使 old_str 唯一` })
    }
    const updated = current.replace(args.old_str, args.new_str)
    await saveCustomView(args.name, updated)
    return JSON.stringify({ ok: true, name: args.name, old_length: current.length, new_length: updated.length })
  },
})

// ================================================================
// custom_view_write — 全文覆盖写入
// ================================================================

toolRegistry.register({
  name: 'custom_view_write',
  toolset: 'ui',
  category: 'edit',
  emoji: '📝',
  description:
    '全文覆盖写入自定义视图的 HTML 内容。用于首次创建或重大重构时使用。内容为完整 HTML 片段，可包含 <style> 和 <script>。日常小改推荐使用 custom_view_edit。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'custom_view_write',
      description:
        '写入/覆盖指定自定义视图的完整 HTML 内容。内容可包含 <style> 内联样式和 <script> 内联脚本。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '视图名称，如 "quick"。默认为 "quick"。',
          },
          html: {
            type: 'string',
            description:
              '完整的 HTML 内容，可包含 <style> 内联样式和 <script> 内联脚本。脚本使用 IIFE: (function(){ ... })()。',
          },
        },
        required: ['name', 'html'],
      },
    },
  },
  handler: async (args) => {
    await saveCustomView(args.name, args.html)
    return JSON.stringify({ ok: true, name: args.name, length: args.html.length })
  },
})
