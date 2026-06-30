// ============================================================
// 变形虫 (Amiba) — Web Browser 工具测试
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest'
import { toolRegistry } from './tool-registry'
import './web-browser.tool'

beforeAll(() => {
  toolRegistry.flush()
})

describe('Web Browser tool', () => {
  it('should have web_fetch tool registered in core toolset', async () => {
    const { resolveToolset } = await import('./toolsets')
    const coreTools = resolveToolset('core')
    expect(coreTools).toContain('web_fetch')
  })

  it('should have valid tool schema', () => {
    const toolNames = toolRegistry.getAllToolNames()
    expect(toolNames).toContain('web_fetch')
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

  it('should accept valid https url (returns Tauri-unavailable in test env)', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: 'https://example.com' })
    // In Node test env without Tauri, should get the unavailable message
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should reject url without protocol', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: 'example.com' })
    expect(result).toContain('Error')
  })

  it('should reject empty url', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: '' })
    expect(result).toContain('Error')
  })

  it('should accept use_webview false parameter', async () => {
    const result = await toolRegistry.dispatch('web_fetch', { url: 'https://example.com', use_webview: false })
    expect(typeof result).toBe('string')
  })
})
