// ============================================================
// 变形虫 (Amiba) — ToolRegistry（工具注册窄腰）
// ============================================================
// 所有工具通过 registry.register() 注册，discoverTools() 触发自发现。
// 采用「延迟提交」模式：import 阶段的 register() 先入队列，
// bootstrap 调用 flush() 后批量提交，保证初始化顺序安全。
// ============================================================

export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any> // JSON Schema
  }
}

export interface ToolContext {
  /** 当前已启用的工具集名称列表 */
  enabledToolsets: string[]
}

export interface ToolEntry {
  name: string
  toolset: string
  schema: ToolSchema
  handler: (args: Record<string, any>, ctx?: ToolContext) => Promise<string>
  checkFn?: () => boolean // 运行时可用性检查
  description: string
  emoji?: string
  maxResultSizeChars?: number
}

const DEFAULT_MAX_RESULT_CHARS = 8000

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>()
  private generation = 0
  // 延迟提交队列：在 flush() 前暂存所有 register() 调用
  private deferred: Array<{ entry: ToolEntry; override: boolean }> | null = []

  // ---- 注册 / 注销 ----

  register(entry: ToolEntry, override = false): void {
    if (this.deferred) {
      // 启动阶段：暂存到延迟队列，等 discoverTools() 调用 flush() 后统一提交
      this.deferred.push({ entry, override })
      return
    }
    this._commit(entry, override)
  }

  deregister(name: string): void {
    if (this.deferred) {
      this.deferred = this.deferred.filter((d) => d.entry.name !== name)
    }
    this.tools.delete(name)
    this.generation++
  }

  /** discoverTools() 调用后执行一次 flush，批量提交所有延迟注册 */
  flush(): void {
    if (!this.deferred) return
    for (const { entry, override } of this.deferred) {
      this._commit(entry, override)
    }
    this.deferred = null
    console.log(`[ToolRegistry] flush 完成 — ${this.tools.size} 个工具`)
  }

  private _commit(entry: ToolEntry, override: boolean): void {
    // 影子保护：拒绝同名跨工具集注册，除非显式 override
    const existing = this.tools.get(entry.name)
    if (existing && !override) {
      console.warn(
        `[ToolRegistry] 工具 "${entry.name}" 已注册（toolset: ${existing.toolset}），跳过重复注册。` +
          `使用 override: true 可覆盖。`
      )
      return
    }
    this.tools.set(entry.name, entry)
    this.generation++
  }

  // ---- 查询 ----

  getDefinitions(toolNames: string[]): ToolSchema[] {
    const schemas: ToolSchema[] = []
    for (const name of toolNames) {
      const entry = this.tools.get(name)
      if (entry && (!entry.checkFn || entry.checkFn())) {
        schemas.push(entry.schema)
      }
    }
    return schemas
  }

  getAllToolNames(): string[] {
    return [...this.tools.keys()].filter(
      (name) => !this.tools.get(name)!.checkFn || this.tools.get(name)!.checkFn!()
    )
  }

  getToolsetForTool(name: string): string | null {
    return this.tools.get(name)?.toolset ?? null
  }

  // ---- 调度 ----

  async dispatch(name: string, args: any, ctx?: ToolContext): Promise<string> {
    const entry = this.tools.get(name)
    if (!entry) {
      return JSON.stringify({ error: `未知工具: ${name}` })
    }

    // 门控检查
    if (entry.checkFn && !entry.checkFn()) {
      return JSON.stringify({ error: `工具 "${name}" 当前不可用` })
    }

    try {
      const raw = await entry.handler(args, ctx)
      const maxChars = entry.maxResultSizeChars ?? DEFAULT_MAX_RESULT_CHARS
      if (raw.length > maxChars) {
        return raw.slice(0, maxChars) + `…[截断：原始 ${raw.length} 字符]`
      }
      return raw
    } catch (e: any) {
      // 错误隔离：异常不向上传播，作为 JSON error 返回
      console.error(`[ToolRegistry] 工具 "${name}" 执行异常:`, e)
      return JSON.stringify({ error: e.message || String(e) })
    }
  }

  // ---- 诊断 ----

  get generationNumber(): number {
    return this.generation
  }

  get size(): number {
    return this.tools.size
  }
}

/** 全局单例 */
export const toolRegistry = new ToolRegistry()
