// ============================================================
// Amiba Kernel — 单元测试（P1 第 1 步）
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  AmibaContext,
  EventBus,
  KernelLoader,
  PermissionManager,
  capabilityMatches,
  createLogger,
  createRootContext,
  parseCompositionYaml,
  resolveComposition,
} from './index'
import type { AmibaPluginModule, PluginDefinition } from './index'

describe('composition', () => {
  it('解析 YAML 并按低到高合并 insert/modify/remove', () => {
    const base = parseCompositionYaml(`
- insert:
    - id: shell
      name: '@amiba/ui-shell'
      config:
        keepAlive: true
    - id: chat
      name: '@amiba/ui-chat'
`)
    const patch = parseCompositionYaml(`
- modify:
    id: shell
    config:
      keepAlive: false
- remove:
    id: chat
`)
    const result = resolveComposition([base, patch])
    expect(result.map((entry) => entry.id)).toEqual(['shell'])
    expect(result[0]?.config).toEqual({ keepAlive: false })
  })

  it('过滤 disabled 条目', () => {
    const result = resolveComposition([
      [
        { id: 'a', name: '@amiba/a', disabled: true },
        { id: 'b', name: '@amiba/b' },
      ],
    ])
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(result.filter((entry) => entry.disabled !== true).map((entry) => entry.id)).toEqual(['b'])
  })

  it('拒绝非法 id 与缺少字段的条目', () => {
    expect(() => resolveComposition([[{ id: 'bad id', name: '@amiba/x' }]])).toThrow(/不合法/)
    expect(() => resolveComposition([[{ id: 'ok', name: '' }]])).toThrow(/非空字符串/)
  })
})

describe('permissions', () => {
  it('默认拒绝，allow 放行，deny 覆盖 allow，* 通配生效', () => {
    const manager = new PermissionManager()
    manager.registerPlugin('demo', { allow: ['network:*', 'credential:resolve:DEEPSEEK_API_KEY'], deny: ['network:lan'] })
    expect(capabilityMatches('network:*', 'network:https')).toBe(true)
    expect(capabilityMatches('network:https', 'network:lan')).toBe(false)
    expect(manager.check('demo', 'network:https')).toBe(true)
    expect(manager.check('demo', 'network:lan')).toBe(false)
    expect(manager.check('demo', 'credential:resolve', 'DEEPSEEK_API_KEY')).toBe(true)
    expect(manager.check('demo', 'credential:resolve', 'OTHER_KEY')).toBe(false)
    expect(manager.check('unknown', 'network:https')).toBe(false)
  })
})

describe('events', () => {
  it('emit 隔离 listener 异常并继续执行', async () => {
    const bus = new EventBus()
    const calls: string[] = []
    bus.on('scope-a', 'ping', () => { calls.push('a') })
    bus.on('scope-b', 'ping', () => { throw new Error('boom') })
    bus.on('scope-c', 'ping', () => { calls.push('c') })
    await bus.emit('ping')
    expect(calls).toEqual(['a', 'c'])
  })

  it('waterfall 按注册顺序改写值', async () => {
    const bus = new EventBus()
    bus.before<number>('scope-a', 'double', (value, next) => next(value + 1))
    bus.before<number>('scope-b', 'double', (value, next) => next(value * 2))
    expect(await bus.runWaterfall('double', 1)).toBe(4)
  })
})

describe('context', () => {
  it('effect 逆序清理；dispose 后事件监听被移除', async () => {
    const ctx = createRootContext()
    const calls: string[] = []
    ctx.effect(() => () => { calls.push('first') }, 'first')
    ctx.effect(() => () => { calls.push('second') }, 'second')
    let observed = false
    ctx.on('tick', () => { observed = true })
    await ctx.dispose()
    expect(calls).toEqual(['second', 'first'])
    await ctx.bus.emit('tick')
    expect(observed).toBe(false)
  })

  it('provide 拒绝同 realm 重复注册', () => {
    const ctx = createRootContext()
    ctx.provide('svc', 1)
    expect(() => ctx.provide('svc', 2)).toThrow(/重复提供/)
  })
})

describe('kernel loader', () => {
  function definePlugin(options: {
    instanceId: string
    name?: string
    inject?: string[]
    provides?: string[]
    permissions?: string[]
    apply?: AmibaPluginModule['apply']
  }): PluginDefinition {
    const module: AmibaPluginModule = {
      name: options.name ?? options.instanceId,
      inject: options.inject,
      provides: options.provides,
      apply: options.apply ?? (() => {}),
    }
    return {
      instanceId: options.instanceId,
      pluginId: options.name ?? options.instanceId,
      name: options.name ?? options.instanceId,
      kind: 'plugin',
      module,
      config: {},
      manifest: options.permissions
        ? { apiVersion: 1, id: options.instanceId, kind: 'plugin', permissions: { allow: options.permissions } }
        : undefined,
    }
  }

  it('按 inject/provides 拓扑装配，服务可被下游插件取到', async () => {
    const loader = new KernelLoader()
    const provider = definePlugin({
      instanceId: 'provider',
      provides: ['clock'],
      apply: (ctx) => { ctx.provide('clock', { now: () => 42 }) },
    })
    let got: number | undefined
    const consumer = definePlugin({
      instanceId: 'consumer',
      inject: ['clock'],
      apply: (ctx) => {
        const clock = ctx.get<{ now(): number }>('clock')
        got = clock?.now()
      },
    })

    const results = await loader.load([consumer, provider])
    expect(results.map((item) => [item.instanceId, item.status])).toEqual([
      ['provider', 'active'],
      ['consumer', 'active'],
    ])
    expect(got).toBe(42)
    await loader.dispose()
  })

  it('reload provider 成功时替换服务，失败时保留旧实例', async () => {
    const loader = new KernelLoader()
    let version = 1
    let failNext = false
    const makeProvider = (): PluginDefinition => definePlugin({
      instanceId: 'provider',
      provides: ['clock'],
      apply: (ctx) => {
        if (failNext) throw new Error('reload boom')
        ctx.provide('clock', version)
      },
    })
    await loader.load([makeProvider()])
    expect(loader.root.get('clock')).toBe(1)

    version = 2
    const reloaded = await loader.reload(makeProvider())
    expect(reloaded.status).toBe('active')
    expect(loader.root.get('clock')).toBe(2)

    version = 3
    failNext = true
    const failed = await loader.reload(makeProvider())
    expect(failed.status).toBe('failed')
    expect(loader.root.get('clock')).toBe(2)
    await loader.dispose()
  })

  it('卸载 provider 后，其发布的全局服务被撤销', async () => {
    const loader = new KernelLoader()
    const provider = definePlugin({
      instanceId: 'provider',
      provides: ['clock'],
      apply: (ctx) => { ctx.provide('clock', 42) },
    })
    await loader.load([provider])
    expect(loader.root.get('clock')).toBe(42)
    await loader.unload('provider')
    expect(loader.root.get('clock')).toBeUndefined()
    await loader.dispose()
  })

  it('缺失依赖时整批装配失败并报告依赖名', async () => {
    const loader = new KernelLoader()
    await expect(loader.load([definePlugin({ instanceId: 'consumer', inject: ['ghost'] })])).rejects.toThrow(/缺失依赖/)
    expect(loader.listInstances()).toEqual([])
    await loader.dispose()
  })

  it('apply 抛错只影响自身实例；已注册 effect 与监听被清理', async () => {
    const loader = new KernelLoader()
    let cleanupRan = false
    let eventFired = false
    const failing = definePlugin({
      instanceId: 'failing',
      apply: (ctx) => {
        ctx.effect(() => () => { cleanupRan = true })
        ctx.on('leak-check', () => { eventFired = true })
        throw new Error('apply failed')
      },
    })
    const healthy = definePlugin({ instanceId: 'healthy' })
    const results = await loader.load([failing, healthy])
    expect(results.find((item) => item.instanceId === 'failing')?.status).toBe('failed')
    expect(results.find((item) => item.instanceId === 'healthy')?.status).toBe('active')
    expect(cleanupRan).toBe(true)
    await loader.bus.emit('leak-check')
    expect(eventFired).toBe(false)
    await loader.dispose()
  })

  it('env 按权限读取', async () => {
    const loader = new KernelLoader({ env: { FOO: 'bar', SECRET: 's3cret' } })
    let foo: string | undefined
    let secret: string | undefined
    const reader = definePlugin({
      instanceId: 'reader',
      permissions: ['env:read:FOO'],
      apply: (ctx) => {
        foo = ctx.env.get('FOO')
        secret = ctx.env.get('SECRET')
      },
    })
    await loader.load([reader])
    expect(foo).toBe('bar')
    expect(secret).toBeUndefined()
    await loader.dispose()
  })

  it('子 context 继承父级服务', () => {
    const root = createRootContext()
    root.provide('svc', 1)
    const child = root.fork({ id: 'child' })
    expect(child.get('svc')).toBe(1)
  })
})

describe('AmibaContext', () => {
  it('导出类型可用且可实例化', () => {
    const ctx = new AmibaContext({
      id: 'demo',
      pluginId: 'demo',
      logger: createLogger({ scope: 'test' }),
      bus: new EventBus(),
      permissions: new PermissionManager(),
    })
    expect(ctx.disposedState).toBe(false)
  })
})
