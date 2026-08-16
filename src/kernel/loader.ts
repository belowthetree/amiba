// ============================================================
// Amiba Kernel — 插件加载器
// ============================================================
// 职责：
//   1. 根据 inject/provides 做拓扑排序；
//   2. 为每个实例创建 scoped AmibaContext；
//   3. 调用 apply(ctx, config)，记录 effect 资源；
//   4. 卸载/重载时逆序 dispose。
// 当前阶段只加载“已解析到内存的 ESM 模块”，不负责文件发现与打包。
// ============================================================

import { AmibaContext, createRootContext } from './context'
import { EventBus } from './events'
import { ConsoleLogger } from './logger'
import type { Logger } from './logger'
import { PermissionManager } from './permissions'
import type { PluginDefinition, PluginInstanceInfo, PluginManifest } from './types'

export interface KernelLoaderOptions {
  logger?: Logger
  bus?: EventBus
  permissions?: PermissionManager
  /** 内核自带服务名，无需插件提供。 */
  builtinServices?: string[]
  env?: Record<string, string | undefined>
}

interface RuntimeInstance {
  info: PluginInstanceInfo
  context: AmibaContext
  definition: PluginDefinition
}

interface TopoNode {
  definition: PluginDefinition
  index: number
  dependencies: string[]
  resolved: boolean
}

export class KernelLoader {
  readonly root: AmibaContext
  readonly bus: EventBus
  readonly logger: Logger
  readonly permissions: PermissionManager

  private readonly builtinServices: Set<string>
  private readonly envSnapshot: Record<string, string | undefined>
  private readonly instances = new Map<string, RuntimeInstance>()
  private readonly loadOrder: string[] = []

  constructor(options: KernelLoaderOptions = {}) {
    this.bus = options.bus ?? new EventBus()
    this.logger = options.logger ?? new ConsoleLogger({ scope: 'kernel' })
    this.permissions = options.permissions ?? new PermissionManager()
    this.builtinServices = new Set(options.builtinServices ?? ['logger', 'events', 'permissions', 'env'])
    this.envSnapshot = { ...(options.env ?? {}) }
    this.root = createRootContext({
      id: 'kernel',
      logger: this.logger,
      bus: this.bus,
      permissions: this.permissions,
    })
    this.root.set('logger', this.logger)
    this.root.set('events', this.bus)
    this.root.set('permissions', this.permissions)
    this.root.set('env', this.root.env)
  }

  /** 装配一批插件；返回实例信息。失败实例被跳过，不阻断其他插件。 */
  async load(definitions: PluginDefinition[]): Promise<PluginInstanceInfo[]> {
    const order = this.resolveOrder(definitions)
    const results: PluginInstanceInfo[] = []

    for (const definition of order) {
      const instanceId = definition.instanceId
      if (this.instances.has(instanceId)) {
        this.logger.warn(`插件实例 "${instanceId}" 重复装配，跳过`)
        continue
      }

      const info: PluginInstanceInfo = {
        instanceId,
        pluginId: definition.pluginId,
        name: definition.name,
        status: 'pending',
      }

      let context: AmibaContext | undefined
      try {
        context = this.createInstanceContext(definition)
        const applyResult = definition.module.apply(context, definition.config as never)
        const disposer = typeof applyResult === 'function' ? applyResult : await unwrapAsyncDisposer(applyResult)
        if (disposer) {
          context.effect(() => disposer, `${instanceId}: apply-returned-disposer`)
        }
        this.instances.set(instanceId, { info: { ...info, status: 'active' }, context, definition })
        this.loadOrder.push(instanceId)
        results.push({ ...info, status: 'active' })
        this.logger.info(`插件 "${instanceId}" 装配成功`)
      } catch (error) {
        if (context) await context.dispose()
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`插件 "${instanceId}" 装配失败:`, message)
        results.push({ ...info, status: 'failed', error: message })
      }
    }

    return results
  }

  /** 卸载实例：dispose context 并移除。 */
  async unload(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    await instance.context.dispose()
    this.instances.delete(instanceId)
    const index = this.loadOrder.indexOf(instanceId)
    if (index >= 0) this.loadOrder.splice(index, 1)
    this.logger.info(`插件 "${instanceId}" 已卸载`)
    return true
  }

  /** 卸载全部实例（逆序）。 */
  async dispose(): Promise<void> {
    for (const instanceId of [...this.loadOrder].reverse()) {
      await this.unload(instanceId)
    }
    await this.root.dispose()
  }

  /** 重载：新实例成功后再卸载旧实例；新实例失败时保留旧实例。 */
  async reload(definition: PluginDefinition): Promise<PluginInstanceInfo> {
    const old = this.instances.get(definition.instanceId)
    if (!old) {
      const [created] = await this.load([definition])
      return created ?? {
        instanceId: definition.instanceId,
        pluginId: definition.pluginId,
        name: definition.name,
        status: 'failed',
        error: 'reload: 原实例不存在且新建失败',
      }
    }

    const order = this.resolveOrder([definition])
    const target = order.find((item) => item.instanceId === definition.instanceId)
    if (!target) {
      return { ...old.info, status: 'failed', error: 'reload: 拓扑排序未产生目标实例' }
    }

    // 事务性重载：先摘除旧实例发布的全局服务，让新实例可以注册同名服务；
    // 新实例 apply 失败时恢复旧服务，保证旧实例继续可用。
    old.context.suspendProvidedServices()
    let next: RuntimeInstance
    let nextContext: AmibaContext | undefined
    try {
      nextContext = this.createInstanceContext(target)
      const applyResult = target.module.apply(nextContext, target.config as never)
      const disposer = typeof applyResult === 'function' ? applyResult : await unwrapAsyncDisposer(applyResult)
      if (disposer) {
        nextContext.effect(() => disposer, `${target.instanceId}: apply-returned-disposer`)
      }
      next = { info: { ...old.info, status: 'active' }, context: nextContext, definition: target }
    } catch (error) {
      if (nextContext) await nextContext.dispose()
      old.context.resumeProvidedServices()
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`插件 "${definition.instanceId}" 重载失败，保留旧实例:`, message)
      return { ...old.info, status: 'failed', error: message }
    }

    await old.context.dispose()
    this.instances.set(definition.instanceId, next)
    this.logger.info(`插件 "${definition.instanceId}" 重载成功`)
    return next.info
  }

  /** 查询实例信息。 */
  getInstance(instanceId: string): PluginInstanceInfo | undefined {
    const instance = this.instances.get(instanceId)
    return instance ? { ...instance.info } : undefined
  }

  listInstances(): PluginInstanceInfo[] {
    return this.loadOrder
      .map((id) => this.instances.get(id))
      .filter((item): item is RuntimeInstance => item !== undefined)
      .map((item) => ({ ...item.info }))
  }

  /** 获取实例上下文（供内核集成/诊断页使用）。 */
  getContext(instanceId: string): AmibaContext | undefined {
    return this.instances.get(instanceId)?.context
  }

  /**
   * 拓扑排序。
   * 依赖解析规则：优先按服务名（module.provides / manifest.provides.services），
   * 其次允许直接引用插件包 id 或实例 id。
   */
  resolveOrder(definitions: PluginDefinition[]): PluginDefinition[] {
    const nodes: TopoNode[] = definitions.map((definition, index) => ({
      definition,
      index,
      dependencies: [...(definition.module.inject ?? []), ...(definition.manifest?.inject ?? [])],
      resolved: false,
    }))

    const providerByService = new Map<string, string>()
    for (const node of nodes) {
      const def = node.definition
      const provides = [
        ...(def.module.provides ?? []),
        ...(def.manifest?.provides?.services ?? []),
        def.pluginId,
        def.instanceId,
      ]
      for (const serviceName of provides) {
        const owner = providerByService.get(serviceName)
        if (owner !== undefined && owner !== def.instanceId) {
          throw new Error(`[kernel:loader] 服务/插件 id "${serviceName}" 被多个插件提供: ${owner}, ${def.instanceId}`)
        }
        providerByService.set(serviceName, def.instanceId)
      }
    }

    const byId = new Map(nodes.map((node) => [node.definition.instanceId, node]))
    const missing = new Set<string>()
    for (const node of nodes) {
      for (const dependency of node.dependencies) {
        if (this.builtinServices.has(dependency)) continue
        const owner = providerByService.get(dependency)
        if (owner === undefined || owner === node.definition.instanceId) {
          missing.add(`${node.definition.instanceId} 依赖 "${dependency}"`)
          continue
        }
        const target = byId.get(owner)
        if (!target) {
          missing.add(`${node.definition.instanceId} 依赖 "${dependency}" 的提供者 "${owner}" 不在本次装配中`)
        }
      }
    }
    if (missing.size > 0) {
      throw new Error(`[kernel:loader] 装配失败，缺失依赖:\n- ${[...missing].join('\n- ')}`)
    }

    const inDegree = new Map<string, number>()
    const dependents = new Map<string, string[]>()
    for (const node of nodes) {
      inDegree.set(node.definition.instanceId, 0)
    }
    for (const node of nodes) {
      for (const dependency of node.dependencies) {
        if (this.builtinServices.has(dependency)) continue
        const owner = providerByService.get(dependency)
        if (owner === undefined || owner === node.definition.instanceId) continue
        const target = byId.get(owner)
        if (!target) continue
        const list = dependents.get(owner) ?? []
        list.push(node.definition.instanceId)
        dependents.set(owner, list)
        inDegree.set(node.definition.instanceId, (inDegree.get(node.definition.instanceId) ?? 0) + 1)
      }
    }

    const queue = nodes
      .filter((node) => (inDegree.get(node.definition.instanceId) ?? 0) === 0)
      .sort((a, b) => (a.definition.order ?? 0) - (b.definition.order ?? 0) || a.index - b.index)

    const result: PluginDefinition[] = []
    while (queue.length > 0) {
      const node = queue.shift()
      if (!node) break
      node.resolved = true
      result.push(node.definition)
      const children = dependents.get(node.definition.instanceId) ?? []
      for (const childId of children) {
        const nextDegree = (inDegree.get(childId) ?? 0) - 1
        inDegree.set(childId, nextDegree)
        if (nextDegree === 0) {
          const child = byId.get(childId)
          if (child) queue.push(child)
        }
      }
      queue.sort((a, b) => (a.definition.order ?? 0) - (b.definition.order ?? 0) || a.index - b.index)
    }

    if (result.length !== nodes.length) {
      const unresolved = nodes.filter((node) => !node.resolved).map((node) => node.definition.instanceId)
      throw new Error(`[kernel:loader] 装配失败，存在循环依赖: ${unresolved.join(', ')}`)
    }

    return result
  }

  private createInstanceContext(definition: PluginDefinition): AmibaContext {
    const manifest = definition.manifest
    const config: Record<string, unknown> = {
      ...(manifest?.config?.defaults ?? {}),
      ...definition.config,
    }

    const policy = {
      allow: [...(manifest?.permissions?.allow ?? [])],
      deny: [...(manifest?.permissions?.deny ?? [])],
    }

    return this.root.fork({
      id: definition.instanceId,
      pluginId: definition.pluginId,
      permissionPolicy: policy,
      env: { ...this.envSnapshot },
    })
  }
}

async function unwrapAsyncDisposer(value: unknown): Promise<(() => void | Promise<void>) | undefined> {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'function') return value as () => void | Promise<void>
  if (typeof value === 'object' && 'then' in value) {
    const awaited = await (value as Promise<unknown>)
    return typeof awaited === 'function' ? (awaited as () => void | Promise<void>) : undefined
  }
  return undefined
}

export function isPluginManifest(value: unknown): value is PluginManifest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['id'] === 'string' && typeof record['apiVersion'] === 'number'
}
