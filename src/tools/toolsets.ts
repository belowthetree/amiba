// ============================================================
// 变形虫 (Amiba) — 工具集（Toolsets）定义
// ============================================================
import { toolRegistry } from './tool-registry'
import type { ToolSchema } from './tool-registry'

// ---- 核心工具集 ----

const CORE_TOOLS = [
  'memory',
  'generate_service',
  'catalog_search',
  'skill_view',
  'skills_list',
  'service_list',
  'service_file_list',
  'service_file_read',
  'service_file_write',
]

// ---- 工具集定义 ----

export interface ToolsetDef {
  tools: string[]
  includes?: string[] // 继承其他工具集
}

export const TOOLSETS: Record<string, ToolsetDef> = {
  core: { tools: CORE_TOOLS },

  chat: { tools: ['memory'], includes: ['core'] },

  create: {
    tools: ['generate_service', 'catalog_search'],
    includes: ['core'],
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
 * 根据启用的工具集名称列表，返回对应的 OpenAI ToolSchema 数组
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
