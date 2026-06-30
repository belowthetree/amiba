// ============================================================
// 变形虫 (Amiba) — Web Browser 工具测试
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest'
import { toolRegistry } from './tool-registry'
import './web-browser.tool'

beforeAll(() => {
  toolRegistry.flush()
})

describe('Web Fetch tool', () => {
  it('should have web_fetch registered in core toolset', async () => {
    const { resolveToolset } = await import('./toolsets')
    expect(resolveToolset('core')).toContain('web_fetch')
  })

  it('should reject missing url', async () => {
    const result = await toolRegistry.dispatch('web_fetch', {})
    expect(result).toContain('Error')
  })

  it('should reject non-http url', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: 'file:///etc/passwd' })
    expect(result).toContain('Error')
  })

  it('should reject javascript protocol', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: 'javascript:alert(1)' })
    expect(result).toContain('Error')
  })

  it('should reject empty url', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: '' })
    expect(result).toContain('Error')
  })

  it('should reject url without protocol', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: 'example.com' })
    expect(result).toContain('Error')
  })
})

describe('Web Browse tool', () => {
  it('should have web_browse registered in core toolset', async () => {
    const { resolveToolset } = await import('./toolsets')
    expect(resolveToolset('core')).toContain('web_browse')
  })

  it('should reject missing action', async () => {
    const result = await toolRegistry.dispatch('web_browse', {})
    expect(result).toContain('Error')
  })

  it('should reject navigate without url', async () => {
    const result = await toolRegistry.dispatch('web_browse', { action: 'navigate' })
    expect(result).toContain('Error')
  })

  it('should reject click without selector', async () => {
    const result = await toolRegistry.dispatch('web_browse', { action: 'click' })
    expect(result).toContain('Error')
  })

  it('should accept get_content without args', async () => {
    const result = await toolRegistry.dispatch('web_browse', { action: 'get_content' })
    // In Node env, should return Tauri unavailable message
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should accept close without args', async () => {
    const result = await toolRegistry.dispatch('web_browse', { action: 'close' })
    expect(typeof result).toBe('string')
  })

  it('should reject input_text without selector', async () => {
    const result = await toolRegistry.dispatch('web_browse', { action: 'input_text', text: 'hi' })
    expect(result).toContain('Error')
  })

  it('should reject input_text without text', async () => {
    const result = await toolRegistry.dispatch('web_browse', { action: 'input_text', selector: '#x' })
    expect(result).toContain('Error')
  })
})
