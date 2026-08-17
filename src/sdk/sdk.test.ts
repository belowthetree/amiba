// ============================================================
// @amiba/sdk — 单元测试
// ============================================================
import { describe, expect, it } from 'vitest'
import { defineAmibaPlugin } from './index'

describe('@amiba/sdk', () => {
  it('返回同一插件定义并保留类型', () => {
    const plugin = defineAmibaPlugin({
      name: 'demo',
      inject: [],
      provides: ['svc'],
      apply() {},
    })
    expect(plugin.name).toBe('demo')
    expect(plugin.provides).toEqual(['svc'])
  })

  it('拒绝非法定义', () => {
    expect(() => defineAmibaPlugin({ name: '', apply() {} })).toThrow(/name/)
    expect(() => defineAmibaPlugin({ name: 'x', inject: [1] as never, apply() {} })).toThrow(/inject/)
    expect(() => defineAmibaPlugin({ name: 'x' } as never)).toThrow(/apply/)
  })
})
