// ============================================================
// @amiba/platform — 插件单元测试
// ============================================================
import { describe, expect, it } from 'vitest'
import { createRootContext } from '../../kernel'
import { apply, name, provides } from './index'
import type { AmibaPlatformService, AmibaLifecycleService } from './index'
import type { KernelEnv } from '../../kernel'

describe('@amiba/platform', () => {
  it('声明 name 与提供的服务名', () => {
    expect(name).toBe('@amiba/platform')
    expect(provides).toEqual(['platform', 'fs', 'lifecycle'])
  })

  it('apply 后注册 platform / fs / lifecycle 服务', () => {
    const ctx = createRootContext()
    apply(ctx)

    const platform = ctx.get<AmibaPlatformService>('platform')
    expect(platform).toBeDefined()
    // Node 测试环境没有 window，平台应识别为 browser。
    expect(platform?.detectHost()).toBe('browser')
    expect(platform?.isTauriRuntime()).toBe(false)

    expect(ctx.get('fs')).toBeDefined()
    expect(ctx.get<AmibaLifecycleService>('lifecycle')).toBeDefined()
    expect(ctx.get<KernelEnv>('env')).toBeUndefined()
  })
})
