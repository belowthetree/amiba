// ============================================================
// @amiba/tool-registry — AI 工具注册表服务插件
// ============================================================
// 包装现有 tools/tool-registry.ts 全局单例与 tools/discover.ts。
// 本阶段保持工具文件顶层 register() 的既有写法不变；
// discover() 仍由 legacy-bootstrap 在原启动位置调用。
// ============================================================

import { toolRegistry } from '../../tools/tool-registry'
import type { ToolRegistry } from '../../tools/tool-registry'
import { discoverTools } from '../../tools/discover'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/tool-registry'
export const inject: string[] = []
export const provides = ['toolRegistry']

/** `ctx.get('toolRegistry')` 返回的服务面。 */
export interface AmibaToolRegistryService {
  registry: ToolRegistry
  discover(): void
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaToolRegistryService = {
    registry: toolRegistry,
    discover: () => discoverTools(),
  }
  ctx.provide('toolRegistry', service)
}
