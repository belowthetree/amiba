// ============================================================
// 变形虫 (Amiba) — 服务工具（Service-Provided Tools）窄腰测试
// ============================================================
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { toolRegistry } from '../tools/tool-registry'

// mock registry：service-tools 仅依赖 getService（权限/toolsConfig 门控）
const mockServices: Record<string, any> = {}
vi.mock('./registry', () => ({
  getService: (id: string) => mockServices[id],
}))

import {
  toAiToolName,
  registerServiceTools,
  unregisterServiceTools,
  isServiceToolsEnabled,
  getKnownServiceTools,
} from './service-tools'
import type { ServiceToolCaller } from './service-tools'

function setupService(
  id: string,
  opts?: { permissions?: string[]; toolsConfig?: any; aiTools?: any[] }
) {
  mockServices[id] = {
    manifest: {
      id,
      name: '演示-' + id,
      version: '1.0.0',
      description: '',
      permissions: opts?.permissions ?? ['tools'],
      aiTools: opts?.aiTools,
    },
    enabled: true,
    installedAt: '',
    source: 'ai-generated',
    toolsConfig: opts?.toolsConfig,
  }
}

const okCaller: ServiceToolCaller = async (_tool, args) => ({ echoed: args })

const USED_IDS = ['user.demo', 'user.other', 'user.a.b', 'user.a_b']

beforeAll(() => {
  toolRegistry.flush()
})

beforeEach(() => {
  for (const k of Object.keys(mockServices)) delete mockServices[k]
  for (const id of USED_IDS) unregisterServiceTools(id)
})

describe('toAiToolName', () => {
  it('sanitizes serviceId and prefixes svc_', () => {
    expect(toAiToolName('user.pomodoro', 'start_timer')).toBe('svc_user_pomodoro__start_timer')
  })

  it('keeps total length within 64 chars (OpenAI 工具名约束)', () => {
    const longId = 'user.' + 'a'.repeat(40)
    const longTool = 't'.repeat(32)
    expect(toAiToolName(longId, longTool).length).toBeLessThanOrEqual(64)
  })
})

describe('registerServiceTools', () => {
  it('registers tools into ToolRegistry under svc toolset', async () => {
    setupService('user.demo')
    const res = registerServiceTools(
      'user.demo',
      [{ name: 'ping', description: 'Ping 测试', parameters: { type: 'object' } }],
      okCaller
    )
    expect(res.registered).toEqual(['ping'])
    expect(res.rejected).toEqual([])

    const entry = toolRegistry.getEntry('svc_user_demo__ping')
    expect(entry).toBeTruthy()
    expect(entry!.toolset).toBe('svc')
    expect(entry!.schema.function.description).toContain('【演示-user.demo】')

    const { resolveToolset } = await import('../tools/toolsets')
    expect(resolveToolset('svc')).toContain('svc_user_demo__ping')
  })

  it('rejects invalid decls with reasons', () => {
    setupService('user.demo')
    const res = registerServiceTools(
      'user.demo',
      [
        { name: 'bad name!', description: 'x' } as any,
        { name: 'nodesc', description: '' } as any,
        { name: 'badlevel', description: 'x', level: 'admin' } as any,
      ],
      okCaller
    )
    expect(res.registered).toEqual([])
    expect(res.rejected).toHaveLength(3)
    expect(toolRegistry.getEntry('svc_user_demo__nodesc')).toBeFalsy()
  })

  it('rejects when tools permission missing', () => {
    setupService('user.demo', { permissions: [] })
    const res = registerServiceTools('user.demo', [{ name: 'ping', description: 'x' }], okCaller)
    expect(res.registered).toEqual([])
    expect(res.rejected[0].reason).toContain('未启用')
    expect(isServiceToolsEnabled('user.demo')).toBe(false)
  })

  it('enforces per-service tool limit', () => {
    setupService('user.demo')
    const decls = Array.from({ length: 9 }, (_, i) => ({ name: 't' + i, description: 'x' }))
    const res = registerServiceTools('user.demo', decls, okCaller)
    expect(res.registered).toHaveLength(8)
    expect(res.rejected).toHaveLength(1)
  })

  it('rejects cross-service AI name collision', () => {
    setupService('user.a.b')
    setupService('user.a_b')
    const r1 = registerServiceTools('user.a.b', [{ name: 'ping', description: 'x' }], okCaller)
    const r2 = registerServiceTools('user.a_b', [{ name: 'ping', description: 'x' }], okCaller)
    expect(r1.registered).toEqual(['ping'])
    expect(r2.registered).toEqual([])
    expect(r2.rejected[0].reason).toContain('冲突')
    unregisterServiceTools('user.a.b')
    unregisterServiceTools('user.a_b')
  })
})

describe('availability gating (checkFn)', () => {
  it('readonly 默认可见，sensitive 默认隐藏，显式列表可开启', () => {
    setupService('user.demo')
    registerServiceTools(
      'user.demo',
      [
        { name: 'ro', description: 'x' },
        { name: 'sec', description: 'x', level: 'sensitive' },
      ],
      okCaller
    )
    let names = toolRegistry.getAllToolNames()
    expect(names).toContain('svc_user_demo__ro')
    expect(names).not.toContain('svc_user_demo__sec')

    // 用户显式开启 sensitive
    mockServices['user.demo'].toolsConfig = { enabled: true, enabledTools: ['ro', 'sec'] }
    names = toolRegistry.getAllToolNames()
    expect(names).toContain('svc_user_demo__sec')
  })

  it('总开关关闭后全部隐藏', () => {
    setupService('user.demo')
    registerServiceTools('user.demo', [{ name: 'ro', description: 'x' }], okCaller)
    expect(toolRegistry.getAllToolNames()).toContain('svc_user_demo__ro')

    mockServices['user.demo'].toolsConfig = { enabled: false }
    expect(toolRegistry.getAllToolNames()).not.toContain('svc_user_demo__ro')
  })
})

describe('dispatch routing', () => {
  it('routes args to caller and JSON-stringifies result', async () => {
    setupService('user.demo')
    registerServiceTools('user.demo', [{ name: 'echo', description: 'x' }], okCaller)
    const out = await toolRegistry.dispatch('svc_user_demo__echo', { a: 1 })
    expect(JSON.parse(out)).toEqual({ echoed: { a: 1 } })
  })

  it('passes through string results', async () => {
    setupService('user.demo')
    registerServiceTools('user.demo', [{ name: 's', description: 'x' }], async () => 'plain')
    expect(await toolRegistry.dispatch('svc_user_demo__s', {})).toBe('plain')
  })

  it('isolates caller errors as JSON error', async () => {
    setupService('user.demo')
    registerServiceTools('user.demo', [{ name: 'boom', description: 'x' }], async () => {
      throw new Error('服务炸了')
    })
    const err = JSON.parse(await toolRegistry.dispatch('svc_user_demo__boom', {}))
    expect(err.error).toContain('服务炸了')
  })

  it('rejects oversized args', async () => {
    setupService('user.demo')
    registerServiceTools('user.demo', [{ name: 'big', description: 'x' }], okCaller)
    const out = JSON.parse(await toolRegistry.dispatch('svc_user_demo__big', { blob: 'x'.repeat(20 * 1024) }))
    expect(out.error).toContain('参数体积超限')
  })
})

describe('unregisterServiceTools', () => {
  it('removes tools from registry', () => {
    setupService('user.demo')
    registerServiceTools('user.demo', [{ name: 't1', description: 'x' }], okCaller)
    unregisterServiceTools('user.demo')
    expect(toolRegistry.getEntry('svc_user_demo__t1')).toBeFalsy()
  })

  it('caller 守护：其他桥实例注销不误删（前台/后台并存）', () => {
    setupService('user.demo')
    const callerB: ServiceToolCaller = async () => null
    registerServiceTools('user.demo', [{ name: 't1', description: 'x' }], okCaller)

    unregisterServiceTools('user.demo', undefined, callerB)
    expect(toolRegistry.getEntry('svc_user_demo__t1')).toBeTruthy()

    unregisterServiceTools('user.demo', undefined, okCaller)
    expect(toolRegistry.getEntry('svc_user_demo__t1')).toBeFalsy()
  })
})

describe('getKnownServiceTools', () => {
  it('merges manifest aiTools with runtime registrations', () => {
    setupService('user.demo', {
      aiTools: [{ name: 'declared', description: 'd', parameters: { type: 'object' } }],
    })
    registerServiceTools('user.demo', [{ name: 'runtime', description: 'r' }], okCaller)
    const names = getKnownServiceTools('user.demo').map((t) => t.name)
    expect(names).toContain('declared')
    expect(names).toContain('runtime')
  })
})
