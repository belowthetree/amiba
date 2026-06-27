// ============================================================
// 变形虫 (Amiba) — 工具自动发现（import.meta.glob）
// ============================================================
import { toolRegistry } from './tool-registry'

/**
 * 利用 Vite 的 import.meta.glob 实现构建时自动扫描。
 * 每个 *.tool.ts 文件在模块顶层调用 toolRegistry.register()，
 * register() 在启动阶段进入延迟队列，flush() 后批量提交。
 *
 * 调用时机：bootstrap() 中，在 initStorage/config 完成后、
 * agent 首次使用前调用。
 */
export function discoverTools(): void {
  // 触发所有 *.tool.ts 模块的副作用导入（顶层 register() 调用）
  const modules = import.meta.glob('./*.tool.ts', { eager: true })

  // 模块已加载，register() 调用已入 deferred 队列
  console.log(`[discoverTools] 发现 ${Object.keys(modules).length} 个工具模块`)

  // 批量提交所有延迟注册
  toolRegistry.flush()

  console.log(`[discoverTools] 工具注册完成 — ${toolRegistry.size} 个工具`)
}
