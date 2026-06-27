// ============================================================
// 变形虫 (Amiba) — Catalog 查询工具
// ============================================================
import { toolRegistry } from './tool-registry'
import { getCatalogYamlText, loadCatalog } from '../ai/catalog'

toolRegistry.register({
  name: 'catalog_search',
  toolset: 'core',
  emoji: '📋',
  description:
    '浏览 UI 组件目录。列出可用于生成服务的 UI 组件及其属性定义，供 AI 在生成服务时参考。',
  maxResultSizeChars: 4000,
  schema: {
    type: 'function',
    function: {
      name: 'catalog_search',
      description:
        '查询可用的 UI 组件目录。返回组件列表及其属性，帮助 AI 在生成 Web 服务时选择合适的组件。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '按组件名称或描述搜索（可选，为空则返回完整目录）',
          },
        },
      },
    },
  },
  handler: async (args) => {
    const query = args.query ? String(args.query).toLowerCase() : ''

    // 加载 catalog
    const catalog = await loadCatalog()

    if (query) {
      // 搜索
      const results = catalog.components.filter(
        (c) =>
          c.type.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query)
      )
      if (results.length === 0) {
        return JSON.stringify({
          query,
          results: [],
          hint: '未找到匹配的组件，尝试其他关键词或留空获取完整列表',
        })
      }
      return JSON.stringify({
        query,
        count: results.length,
        components: results.map((c) => ({
          type: c.type,
          description: c.description,
          props: c.props,
        })),
      })
    }

    // 返回完整目录的摘要文本（用 getCatalogYamlText 节省 token）
    return getCatalogYamlText()
  },
})
