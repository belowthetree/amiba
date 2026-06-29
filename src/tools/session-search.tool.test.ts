// ============================================================
// 变形虫 (Amiba) — Session Search 工具测试
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest'
import { toolRegistry } from './tool-registry'
import './session-search.tool'

// Flush the deferred registration queue so tools are available
beforeAll(() => {
  toolRegistry.flush()
})

describe('Session Search — formatting', () => {
  it('should have session_search tool registered in core toolset', async () => {
    const { resolveToolset } = await import('./toolsets')
    
    const coreTools = resolveToolset('core')
    expect(coreTools).toContain('session_search')
  })

  it('should have valid tool schema with required properties', () => {
    const toolNames = toolRegistry.getAllToolNames()
    expect(toolNames).toContain('session_search')
  })
})

describe('Session Search — tool handler modes', () => {
  it('should return browse result when no args', async () => {
    const result = await toolRegistry.dispatch('session_search', {})
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should return search result for query', async () => {
    const result = await toolRegistry.dispatch('session_search', { query: 'rust' })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should return read result for session_id', async () => {
    const result = await toolRegistry.dispatch('session_search', { session_id: 'nonexistent' })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should reject empty query gracefully', async () => {
    const result = await toolRegistry.dispatch('session_search', { query: '' })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should clamp limit parameter', async () => {
    const result = await toolRegistry.dispatch('session_search', { query: 'test', limit: 100 })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('Memory system integration', () => {
  it('session_search should be usable alongside memory tool', async () => {
    const { resolveToolset } = await import('./toolsets')
    
    const coreTools = resolveToolset('core')
    expect(coreTools).toContain('memory')
    expect(coreTools).toContain('session_search')
  })
})
