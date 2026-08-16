// ============================================================
// Amiba Kernel — 事件总线（普通事件 + waterfall 中间件）
// ============================================================
// 普通事件：ctx.on / emit，返回值忽略。
// Waterfall：ctx.before / runWaterfall，允许中间件改写 value 并交给 next。
// 本文件不依赖 Vue 或任何业务模块。
// ============================================================

export type EventListener = (...args: unknown[]) => unknown

export type WaterfallListener<Value = unknown> = (
  value: Value,
  next: (nextValue?: Value) => Value | Promise<Value>,
) => Value | Promise<Value>

interface EventRegistration {
  listener: EventListener
  once: boolean
  scopeId: string
}

interface WaterfallRegistration<Value = unknown> {
  listener: WaterfallListener<Value>
  scopeId: string
}

let eventIdSeq = 0

/**
 * 轻量事件总线。
 * 支持按 scopeId 批量移除（插件卸载时不会残留自己的监听）。
 */
export class EventBus {
  private readonly events = new Map<string, Set<EventRegistration>>()
  private readonly waterfalls = new Map<string, WaterfallRegistration[]>()

  /** 订阅普通事件；返回取消函数。 */
  on(scopeId: string, event: string, listener: EventListener): () => void {
    let set = this.events.get(event)
    if (!set) {
      set = new Set()
      this.events.set(event, set)
    }
    const registration: EventRegistration = { listener, once: false, scopeId }
    set.add(registration)
    return () => set.delete(registration)
  }

  /** 订阅一次性事件。 */
  once(scopeId: string, event: string, listener: EventListener): () => void {
    let set = this.events.get(event)
    if (!set) {
      set = new Set()
      this.events.set(event, set)
    }
    const registration: EventRegistration = { listener, once: true, scopeId }
    set.add(registration)
    return () => set.delete(registration)
  }

  /** 触发普通事件；listener 异常被隔离，不阻断其他 listener。 */
  async emit(event: string, ...args: unknown[]): Promise<void> {
    const set = this.events.get(event)
    if (!set || set.size === 0) return
    const pending: EventRegistration[] = []
    for (const registration of [...set]) {
      if (registration.once) set.delete(registration)
      pending.push(registration)
    }
    for (const registration of pending) {
      try {
        await registration.listener(...args)
      } catch (error) {
        console.warn(`[kernel:events] 事件 "${event}" 的 listener 执行失败:`, error)
      }
    }
  }

  /** 注册 waterfall 中间件。返回取消函数。 */
  before<Value>(scopeId: string, event: string, listener: WaterfallListener<Value>): () => void {
    const list = this.waterfalls.get(event) ?? []
    list.push({ listener: listener as WaterfallListener<unknown>, scopeId })
    this.waterfalls.set(event, list)
    return () => {
      const current = this.waterfalls.get(event)
      if (!current) return
      const index = current.findIndex((item) => item.listener === (listener as WaterfallListener<unknown>))
      if (index >= 0) current.splice(index, 1)
    }
  }

  /** 运行 waterfall。中间件返回 promise 时顺序等待。 */
  async runWaterfall<Value>(event: string, initial: Value): Promise<Value> {
    const list = this.waterfalls.get(event) ?? []
    let index = 0
    let current: Value = initial

    const next = async (...nextArgs: [nextValue?: Value]): Promise<Value> => {
      if (nextArgs.length > 0) current = nextArgs[0] as Value
      if (index >= list.length) return current
      const registration = list[index]
      index += 1
      try {
        const result = await registration.listener(current, async (...args: [value?: unknown]) => {
          if (args.length > 0) current = args[0] as Value
          return next(current)
        })
        return result as Value
      } catch (error) {
        console.warn(`[kernel:events] waterfall "${event}" 的中间件执行失败:`, error)
        throw error
      }
    }

    return next()
  }

  /** 移除某 scope 注册的全部监听。 */
  removeScope(scopeId: string): void {
    for (const set of this.events.values()) {
      for (const registration of [...set]) {
        if (registration.scopeId === scopeId) set.delete(registration)
      }
    }
    for (const [event, list] of this.waterfalls) {
      const next = list.filter((registration) => registration.scopeId !== scopeId)
      if (next.length === 0) this.waterfalls.delete(event)
      else this.waterfalls.set(event, next)
    }
  }

  /** 诊断用：事件名列表。 */
  listEvents(): string[] {
    return [...this.events.keys()].sort()
  }
}

/** 生成内核内部 scope id。 */
export function nextScopeId(prefix: string): string {
  eventIdSeq += 1
  return `${prefix}:${eventIdSeq}`
}
