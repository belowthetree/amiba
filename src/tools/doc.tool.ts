// ============================================================
// 变形虫 (Amiba) — 文档查询工具（doc_list / doc_read / doc_search）
// ============================================================
// 允许 Agent 查询和阅读平台内置和用户自定义的文档。
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  getDocIndex,
  getDocContent,
  searchDocs,
  refreshDocIndex,
} from '../ai/doc-index'

// ================================================================
// doc_list — 列出所有文档
// ================================================================

toolRegistry.register({
  name: 'doc_list',
  toolset: 'docs',
  category: 'view',
  emoji: '📚',
  description:
    '列出可用的文档列表。按分类或关键词过滤，了解有哪些文档可以参考。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'doc_list',
      description:
        '列出所有可用的平台文档。可用于了解有哪些主题的文档，再选择读取。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: '可选：按分类过滤（platform/api/guide）',
          },
          query: {
            type: 'string',
            description: '可选：按标题或关键词模糊匹配',
          },
        },
      },
    },
  },
  handler: async (args) => {
    const index = await getDocIndex()
    const query = args.query ? String(args.query).toLowerCase() : ''
    const category = args.category ? String(args.category).toLowerCase() : ''

    let docs = index
    if (category) {
      docs = docs.filter((d) => d.category === category)
    }
    if (query) {
      docs = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(query) ||
          d.keywords.some((k) => k.toLowerCase().includes(query))
      )
    }

    return JSON.stringify({
      count: docs.length,
      docs: docs.map((d) => ({
        path: d.path,
        title: d.title,
        description: d.description,
        keywords: d.keywords,
        category: d.category,
        source: d.source,
      })),
      usage: '使用 doc_read({ path }) 读取完整内容，doc_search({ keyword }) 搜索具体主题',
    })
  },
})

// ================================================================
// doc_read — 读取完整文档
// ================================================================

toolRegistry.register({
  name: 'doc_read',
  toolset: 'docs',
  category: 'view',
  emoji: '📖',
  description:
    '读取指定文档的完整 Markdown 内容。用于获取平台能力、API 规范、开发指南等详细信息。',
  maxResultSizeChars: 6000,
  schema: {
    type: 'function',
    function: {
      name: 'doc_read',
      description:
        '读取一份文档的完整内容。先生成服务前应阅读 sandbox.md 和 jbridge.md，开发网络功能时读 network.md。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文档路径，如 "sandbox.md"、"jbridge.md"。通过 doc_list 获取可用路径列表。',
          },
        },
        required: ['path'],
      },
    },
  },
  handler: async (args) => {
    const path = String(args.path || '').trim()
    if (!path) return JSON.stringify({ error: 'path 不能为空' })

    const content = await getDocContent(path)
    if (!content) {
      return JSON.stringify({
        error: `文档 "${path}" 不存在`,
        hint: '使用 doc_list 查看可用文档列表',
      })
    }

    return content
  },
})

// ================================================================
// doc_search — 搜索文档
// ================================================================

toolRegistry.register({
  name: 'doc_search',
  toolset: 'docs',
  category: 'view',
  emoji: '🔍',
  description:
    '按关键词搜索文档内容。在不确定哪个文档包含所需信息时使用，返回匹配片段。',
  maxResultSizeChars: 5000,
  schema: {
    type: 'function',
    function: {
      name: 'doc_search',
      description:
        '在所有文档中搜索关键词，返回匹配的文档列表和内容片段。用于快速定位相关文档。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '搜索关键词，如 "storage"、"P2P"、"权限"',
          },
          limit: {
            type: 'number',
            description: '最大返回结果数，默认 5',
          },
        },
        required: ['keyword'],
      },
    },
  },
  handler: async (args) => {
    const keyword = String(args.keyword || '').trim()
    if (!keyword) return JSON.stringify({ error: 'keyword 不能为空' })

    const limit = Math.max(1, Math.min(10, Number(args.limit) || 5))
    const results = await searchDocs(keyword, limit)

    if (results.length === 0) {
      return JSON.stringify({
        keyword,
        results: [],
        hint: '未找到匹配的文档。尝试其他关键词，或用 doc_list 浏览所有文档。',
      })
    }

    return JSON.stringify({
      keyword,
      count: results.length,
      results: results.map((r) => ({
        path: r.entry.path,
        title: r.entry.title,
        description: r.entry.description,
        category: r.entry.category,
        snippets: r.snippets,
      })),
      usage: `使用 doc_read({ path: "…" }) 读取完整文档`,
    })
  },
})
