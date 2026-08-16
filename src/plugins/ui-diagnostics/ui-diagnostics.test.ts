// ============================================================
// @amiba/ui-diagnostics — 插件单元测试
// ============================================================
import { describe, expect, it } from 'vitest'
import { createRootContext } from '../../kernel'
import { DIAGNOSTICS_PATH, apply, name, provides } from './index'
import type { AmibaDiagnosticsService } from './index'

describe('@amiba/ui-diagnostics', () => {
  it('声明插件元数据', () => {
    expect(name).toBe('@amiba/ui-diagnostics')
    expect(provides).toEqual(['diagnostics'])
    expect(DIAGNOSTICS_PATH).toBe('/__amiba/diagnostics')
  })

  it('apply 后注册 diagnostics 服务，且组件可用', () => {
    const ctx = createRootContext()
    apply(ctx)
    const service = ctx.get<AmibaDiagnosticsService>('diagnostics')
    expect(service).toBeDefined()
    expect(service?.path).toBe(DIAGNOSTICS_PATH)
    expect(service?.title).toBe('Amiba 插件诊断')
    expect(service?.component).toBeDefined()
  })
})
