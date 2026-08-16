// ============================================================
// Amiba Kernel — 插件上下文（浏览器主线程版 Cordis 语义）
// ============================================================
// ctx.get / set / provide / effect / on / before 的最小实现。
// 每个插件实例持有一个 scopeId，dispose 时自动清理：
//   - 自己注册的服务
//   - effect 返回的清理函数
//   - 事件/waterfall 监听
// ============================================================

import { EventBus, nextScopeId } from './events'
import type { EventListener, WaterfallListener } from './events'
import { ConsoleLogger } from './logger'
import type { Logger } from './logger'
import { PermissionManager } from './permissions'
import type { PermissionPolicy } from './types'

export type EffectDisposer = () => void | Promise<void>

export interface AmibaContextOptions {
  /** 插件实例 id；同时也是权限审计与日志 scope。 */
  id: string
  /** 插件包 id。 */
  pluginId: string
  logger: Logger
  bus: EventBus
  permissions: PermissionManager
  /** 插件声明的权限。 */
  permissionPolicy?: PermissionPolicy
  /** 当前可见的环境变量快照。 */
  env?: Record<string, string | undefined>
  /** 父上下文（子 realm 查找服务时回退到父级）。 */
  parent?: AmibaContext
}

interface EffectRecord {
  label?: string
  disposer?: EffectDisposer
  /** 异步 setup 完成后的清理函数。 */
  ready?: Promise<void>
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'
}

/** 受权限约束的环境变量门面。 */
export interface KernelEnv {
  get(name: string): string | undefined
  list(): string[]
}

export class AmibaContext {
  readonly id: string
  readonly pluginId: string
  readonly logger: Logger
  readonly bus: EventBus
  readonly permissions: PermissionManager
  readonly parent?: AmibaContext
  readonly env: KernelEnv
  readonly scopeId: string

  private readonly services = new Map<string, unknown>()
  private readonly providedServices = new Map<string, unknown>()
  private readonly effects: EffectRecord[] = []
  private readonly ownedListeners = new Set<() => void>()
  private disposed = false

  constructor(options: AmibaContextOptions) {
    this.id = options.id
    this.pluginId = options.pluginId
    this.logger = options.logger.child(options.id)
    this.bus = options.bus
    this.permissions = options.permissions
    this.parent = options.parent
    this.scopeId = nextScopeId(options.id)
    this.permissions.registerPlugin(this.pluginId, options.permissionPolicy)
    const envSnapshot = { ...(options.env ?? {}) }
    this.env = {
      get: (name) => {
        if (!this.permissions.check(this.pluginId, 'env:read', name)) return undefined
        return envSnapshot[name]
      },
      list: () => Object.keys(envSnapshot),
    }
  }

  /** 在当前 realm 取服务；没有则向父 realm 查找。 */
  get<T>(name: string): T | undefined {
    if (this.services.has(name)) return this.services.get(name) as T | undefined
    return this.parent?.get<T>(name)
  }

  /** 向当前 realm 写入服务。 */
  set<T>(name: string, value: T): T {
    this.ensureActive()
    this.services.set(name, value)
    return value
  }

  /**
   * 提供全局服务。
   * 有父 realm 时发布到父 realm（同 composition 的插件共享）；
   * 根上下文则发布到自己。插件私有状态请使用 set()。
   */
  provide<T>(name: string, value: T): T {
    this.ensureActive()
    const target = this.parent ?? this
    target.ensureActive()
    if (target.services.has(name)) {
      throw new Error(`[kernel] 插件 "${this.id}" 重复提供全局服务 "${name}"`)
    }
    target.services.set(name, value)
    this.providedServices.set(name, value)
    return value
  }

  /**
   * 注册带清理函数的资源。apply() 中的路由、工具、Slot、订阅、
   * 定时器都必须经过这里，否则卸载时无法回收。
   */
  effect(setup: () => void | EffectDisposer | Promise<void | EffectDisposer>, label?: string): void {
    this.ensureActive()
    const record: EffectRecord = { label }
    try {
      const result = setup()
      if (typeof result === 'function') {
        record.disposer = result
      } else if (isPromiseLike(result)) {
        record.ready = result.then((disposer) => {
          if (typeof disposer === 'function') record.disposer = disposer
        }).catch((error) => {
          this.logger.warn(`effect "${label ?? '(anonymous)'}" 异步初始化失败:`, error)
        })
      }
      this.effects.push(record)
    } catch (error) {
      this.logger.error(`effect "${label ?? '(anonymous)'}" 执行失败:`, error)
      throw error
    }
  }

  /** 订阅普通事件。 */
  on(event: string, listener: EventListener): () => void {
    this.ensureActive()
    const dispose = this.bus.on(this.scopeId, event, listener)
    this.ownedListeners.add(dispose)
    return () => {
      dispose()
      this.ownedListeners.delete(dispose)
    }
  }

  /** 注册 waterfall 中间件。 */
  before<Value>(event: string, listener: WaterfallListener<Value>): () => void {
    this.ensureActive()
    const dispose = this.bus.before<Value>(this.scopeId, event, listener)
    this.ownedListeners.add(dispose)
    return () => {
      dispose()
      this.ownedListeners.delete(dispose)
    }
  }

  /** 创建子 realm：服务查找可回退到当前上下文。 */
  fork(options: Partial<Omit<AmibaContextOptions, 'logger' | 'bus' | 'permissions' | 'parent' | 'env'>> & {
    id: string
    pluginId?: string
    permissionPolicy?: PermissionPolicy
    env?: Record<string, string | undefined>
  }): AmibaContext {
    this.ensureActive()
    return new AmibaContext({
      ...options,
      pluginId: options.pluginId ?? options.id,
      logger: this.logger,
      bus: this.bus,
      permissions: this.permissions,
      parent: this,
    })
  }

  /**
   * 暂时从父 realm 摘除本实例发布的全局服务。
   * 用于事务性 reload：新实例先 apply，失败时用 resumeProvidedServices() 恢复旧服务。
   */
  suspendProvidedServices(): void {
    const target = (this.parent ?? this).services
    for (const [name, value] of this.providedServices) {
      if (target.get(name) === value) target.delete(name)
    }
  }

  /** 恢复 suspendProvidedServices() 摘除的全局服务。 */
  resumeProvidedServices(): void {
    const target = (this.parent ?? this).services
    for (const [name, value] of this.providedServices) {
      if (!target.has(name)) target.set(name, value)
    }
  }

  /** 逆序清理全部资源。可安全重复调用。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    for (const dispose of [...this.ownedListeners]) {
      try { dispose() } catch (error) { this.logger.warn('移除监听失败:', error) }
    }
    this.ownedListeners.clear()
    this.bus.removeScope(this.scopeId)

    for (const record of [...this.effects].reverse()) {
      try {
        await record.ready
        await record.disposer?.()
      } catch (error) {
        this.logger.warn(`effect "${record.label ?? '(anonymous)'}" 清理失败:`, error)
      }
    }
    this.effects.length = 0

    // 撤销本实例通过 provide() 发布到父 realm 的服务。
    const providedTarget = (this.parent ?? this).services
    for (const [name, value] of this.providedServices) {
      if (providedTarget.get(name) === value) providedTarget.delete(name)
    }
    this.providedServices.clear()
    this.services.clear()
    // 权限策略是配置级数据，不随实例 dispose 删除；
    // 由 PermissionManager 显式 removePlugin() 或用户策略更新管理。
  }

  get disposedState(): boolean {
    return this.disposed
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error(`[kernel] 插件上下文 "${this.id}" 已销毁，不能继续注册资源`)
    }
  }
}

/** 创建独立的内核上下文（无插件身份，用于测试/内核初始化）。 */
export function createRootContext(options: {
  id?: string
  logger?: Logger
  bus?: EventBus
  permissions?: PermissionManager
} = {}): AmibaContext {
  const id = options.id ?? 'kernel'
  return new AmibaContext({
    id,
    pluginId: id,
    logger: options.logger ?? new ConsoleLogger({ scope: 'kernel' }),
    bus: options.bus ?? new EventBus(),
    permissions: options.permissions ?? new PermissionManager(),
  })
}
