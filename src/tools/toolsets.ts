// ============================================================
// 变形虫 (Amiba) — 工具集（Toolsets）定义
// ============================================================
import { tool, jsonSchema } from 'ai'
import { toolRegistry } from './tool-registry'
import type { ToolSchema } from './tool-registry'

// ---- 核心工具集 ----

const CORE_TOOLS = [
  'memory',
  'catalog_search',
  'skill_view',
  'skills_list',
  'skill_manage_create',
  'skill_manage_patch',
  'skill_manage_edit',
  'skill_manage_delete',
  'skill_manage_write_file',
  'soul_save',
  'requirement_view',
  'requirement_update',
  'requirements_summary',
  'session_search',
  'web_fetch',
  'web_browse',
]

// ---- 工具集定义 ----

export interface ToolsetDef {
  tools: string[]
  includes?: string[] // 继承其他工具集
}

export const TOOLSETS: Record<string, ToolsetDef> = {
  core: { tools: CORE_TOOLS },

  service: {
    tools: [
      'service_list',
      'service_view',
      'service_create',
      'service_file_list',
      'service_file_read',
      'service_file_edit',
      'service_file_write',
      'service_validate',
    ],
  },

  docs: {
    tools: ['doc_list', 'doc_read', 'doc_search'],
  },

  chat: {
    tools: ['memory'],
    includes: ['core', 'service', 'docs', 'ui'],
  },

  review: {
    tools: [
      'skill_view',
      'skills_list',
      'skill_manage_create',
      'skill_manage_patch',
      'skill_manage_edit',
      'skill_manage_delete',
    ],
  },

  ui: {
    tools: [
      'ui_theme_view',
      'ui_theme_list',
      'ui_theme_set_variable',
      'ui_theme_set_variables',
      'ui_theme_set_css',
      'ui_theme_reset',
      'ui_theme_create',
      'ui_theme_delete',
      'ui_theme_switch',
      'ui_slot_list',
      'ui_slot_get',
      'ui_slot_set',
      'ui_slot_remove',
    ],
  },
}

// ---- 解析 ----

/**
 * 递归解析工具集名称 → 展开后的工具名列表（不重复 + 循环检测）
 */
export function resolveToolset(
  name: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(name)) {
    console.warn(`[Toolset] 检测到循环引用: ${name}`)
    return []
  }
  visited.add(name)

  const def = TOOLSETS[name]
  if (!def) {
    console.warn(`[Toolset] 未知工具集: ${name}`)
    return []
  }

  const names = new Set<string>()

  // 递归解析 includes
  if (def.includes) {
    for (const inc of def.includes) {
      for (const t of resolveToolset(inc, visited)) {
        names.add(t)
      }
    }
  }

  // 添加直接工具
  for (const t of def.tools) {
    names.add(t)
  }

  return [...names]
}

/**
 * 根据启用的工具集名称列表，返回对应的 ToolSchema 数组
 */
export function getToolDefinitions(
  enabledToolsets: string[]
): ToolSchema[] {
  const toolNames = new Set<string>()

  for (const tsName of enabledToolsets) {
    for (const name of resolveToolset(tsName)) {
      toolNames.add(name)
    }
  }

  return toolRegistry.getDefinitions([...toolNames])
}

// ---- AI SDK 工具桥接 ----

/**
 * 将 ToolRegistry 中的工具转换为 AI SDK v7 的 ToolSet 格式
 * 供 streamText / generateText 使用
 */
export function toAISdkTools(enabledToolsets: string[]): Record<string, any> {
  const toolNames = new Set<string>()

  for (const tsName of enabledToolsets) {
    for (const name of resolveToolset(tsName)) {
      toolNames.add(name)
    }
  }

  const tools: Record<string, any> = {}

  for (const name of toolNames) {
    const entry = toolRegistry.getEntry(name)
    if (!entry || (entry.checkFn && !entry.checkFn())) continue

    const schema = entry.schema

    tools[name] = tool({
      description: schema.function.description,
      inputSchema: jsonSchema(schema.function.parameters),
      execute: async (input: any) => {
        console.log('[AI SDK] 🔧', name, 'args=', JSON.stringify(input).slice(0, 200))
        return toolRegistry.dispatch(name, input, { enabledToolsets })
      },
    })
  }

  return tools
}
