// ============================================================
// 变形虫 (Amiba) — AI 服务生成器
// ============================================================
import OpenAI from 'openai'
import { getSettings, getApiKey } from '../config/config'
import { getCatalogYamlText, validateGeneratedUI, validatePermissions, loadCatalog } from './catalog'
import { matchSkill, getSkillContext } from './skills'
import type { GeneratedService, ValidationError } from '../types/service'

const GENERATION_PROMPT = `你是变形虫平台的 AI 服务生成助手。根据用户需求生成完整的迷你应用。

规则:
1. UI 只能使用 Catalog 中列出的组件和属性，禁止编造组件
2. 逻辑代码使用 __amiba__ 全局对象调用宿主 API
3. 定时任务的 action 只能调用 Catalog 中列出的 API
4. 返回纯 JSON，不要有任何解释文字，不要用 markdown 代码块包裹
5. logic 字段中的代码必须是合法的 JavaScript，使用 window.__amiba__ 调用宿主 API

=== CATALOG ===
`

export interface GenerationProgress {
  stage: 'preparing' | 'generating' | 'validating' | 'packaging' | 'done' | 'error'
  message: string
}

export async function* generateService(
  userPrompt: string,
  onProgress?: (progress: GenerationProgress) => void
): AsyncGenerator<GeneratedService | ValidationError[]> {
  onProgress?.({ stage: 'preparing', message: '正在准备生成...' })

  const s = getSettings()
  const apiKey = await getApiKey()

  if (!apiKey) {
    onProgress?.({ stage: 'error', message: '请先在设置中配置 API Key' })
    return
  }

  // Match skill
  const skill = matchSkill(userPrompt)
  const skillCtx = getSkillContext(skill)

  // Build prompt
  const catalogText = getCatalogYamlText()
  const fullPrompt = `${GENERATION_PROMPT}${catalogText}
${skillCtx}
=== 用户需求 ===
${userPrompt}

返回纯 JSON，不要有任何解释文字。`

  onProgress?.({ stage: 'generating', message: 'AI 正在生成服务...' })

  const client = new OpenAI({
    baseURL: s.ai_base_url,
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  })

  const stream = await client.chat.completions.create({
    model: s.ai_generation_model,
    messages: [
      {
        role: 'system',
        content: '你是一个精确的 JSON 输出机器。只输出 JSON，不要 markdown，不要解释。',
      },
      { role: 'user', content: fullPrompt },
    ],
    stream: true,
  })

  let fullResponse = ''
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      fullResponse += content
    }
  }

  // Clean up response: remove markdown code fences if present
  let jsonStr = fullResponse.trim()
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7)
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3)
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3)
  }
  jsonStr = jsonStr.trim()

  // Parse JSON
  let parsed: GeneratedService
  try {
    parsed = JSON.parse(jsonStr)
  } catch (e: any) {
    // Try to extract JSON from the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch {
        onProgress?.({ stage: 'error', message: `AI 返回格式错误: ${e.message}` })
        return
      }
    } else {
      onProgress?.({ stage: 'error', message: `AI 返回格式错误: ${e.message}` })
      return
    }
  }

  onProgress?.({ stage: 'validating', message: '正在校验生成结果...' })

  // Validate
  const errors: ValidationError[] = []

  if (!parsed.manifest || !parsed.manifest.id) {
    errors.push({ node: 'manifest', message: '缺少 manifest.id' })
  }

  if (!parsed.ui || !parsed.ui.root || !parsed.ui.nodes) {
    errors.push({ node: 'ui', message: 'UI 定义不完整' })
  } else {
    const catalogDef = await loadCatalog()
    const uiErrors = validateGeneratedUI(parsed.ui, catalogDef)
    errors.push(...uiErrors)
  }

  if (parsed.manifest?.permissions) {
    const permErrors = validatePermissions(parsed.manifest.permissions)
    errors.push(...permErrors)
  }

  if (errors.length > 0) {
    yield errors
    onProgress?.({ stage: 'error', message: `校验失败: ${errors.length} 个错误` })
    return
  }

  // Ensure service id starts with "user."
  if (!parsed.manifest.id.startsWith('user.')) {
    parsed.manifest.id = 'user.' + parsed.manifest.id
  }

  onProgress?.({ stage: 'packaging', message: '正在打包服务...' })

  // Build HTML from UI tree
  const html = buildHtmlFromUI(parsed.ui, parsed.logic)

  // Attach the generated HTML to the service
  ;(parsed as any)._html = html

  yield parsed
  onProgress?.({ stage: 'done', message: '生成完成！' })
}

function buildHtmlFromUI(
  ui: { version: string; root: string; nodes: Record<string, any> },
  logic: string
): string {
  const styles = generateStyles(ui)
  const bodyHtml = renderNodeTree(ui.root, ui.nodes)

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; min-height: 100vh; }
${styles}
</style>
</head>
<body>
${bodyHtml}
<script>
// Incore Bridge Shim — will be replaced by host
if (!window.__amiba__) {
  window.__amiba__ = {
    storage: {
      set: async (k, v) => { localStorage.setItem('_s_' + k, JSON.stringify(v)); },
      get: async (k) => { const r = localStorage.getItem('_s_' + k); return r ? JSON.parse(r) : null; },
      remove: async (k) => { localStorage.removeItem('_s_' + k); },
    },
    showToast: async (title, icon) => { console.log('[Toast]', title, icon); },
    navigateTo: (url) => { console.log('[Navigate]', url); },
  };
}
</script>
<script>
${logic}
</script>
</body>
</html>`
}

function generateStyles(ui: {
  nodes: Record<string, any>
}): string {
  // Generate inline styles for each node based on props
  // This is a simplified renderer that maps catalog props to CSS
  let css = ''
  for (const [id, node] of Object.entries(ui.nodes)) {
    const props = node.props || {}
    const rules: string[] = []

    if (props.padding !== undefined) rules.push(`padding: ${sizeValue(props.padding)}px`)
    if (props.margin !== undefined) rules.push(`margin: ${sizeValue(props.margin)}px`)
    if (props.backgroundColor) rules.push(`background-color: ${props.backgroundColor}`)
    if (props.borderRadius !== undefined) rules.push(`border-radius: ${props.borderRadius}px`)
    if (props.spacing !== undefined) rules.push(`gap: ${sizeValue(props.spacing)}px`)

    if (props.direction === 'horizontal') rules.push('display: flex; flex-direction: row')
    if (props.direction === 'vertical') rules.push('display: flex; flex-direction: column')

    if (props.alignment === 'center') rules.push('align-items: center; justify-content: center')
    if (props.alignment === 'start') rules.push('align-items: flex-start; justify-content: flex-start')
    if (props.alignment === 'end') rules.push('align-items: flex-end; justify-content: flex-end')
    if (props.alignment === 'stretch') rules.push('align-items: stretch')

    if (props.elevation !== undefined) {
      rules.push(`box-shadow: 0 ${props.elevation}px ${props.elevation * 2}px rgba(0,0,0,0.1)`)
    }

    if (props.size !== undefined && node.type === 'text') rules.push(`font-size: ${props.size}px`)
    if (props.color) rules.push(`color: ${props.color}`)
    if (props.weight === 'bold') rules.push('font-weight: bold')
    if (props.weight === 'light') rules.push('font-weight: 300')
    if (props.align && node.type === 'text') rules.push(`text-align: ${props.align}`)
    if (props.maxLines) {
      rules.push(`overflow: hidden; display: -webkit-box; -webkit-line-clamp: ${props.maxLines}; -webkit-box-orient: vertical`)
    }

    // Button styles
    if (node.type === 'button') {
      rules.push('cursor: pointer; border: none; border-radius: 8px; padding: 8px 16px; font-size: 14px')
      if (props.variant === 'primary' || (!props.variant && !props.variant)) rules.push('background: #1976D2; color: white')
      if (props.variant === 'secondary') rules.push('background: #9C27B0; color: white')
      if (props.variant === 'outline') rules.push('background: transparent; border: 1px solid #1976D2; color: #1976D2')
      if (props.variant === 'ghost') rules.push('background: transparent; color: #1976D2')
      if (props.disabled) rules.push('opacity: 0.5; pointer-events: none')
      if (props.size === 'small') rules.push('padding: 4px 8px; font-size: 12px')
      if (props.size === 'large') rules.push('padding: 12px 24px; font-size: 16px')
    }

    // Input styles
    if (node.type === 'input') {
      rules.push('border: 1px solid #ccc; border-radius: 8px; padding: 8px 12px; font-size: 14px; width: 100%')
      if (props.type === 'multiline') rules.push('min-height: 80px; resize: vertical')
    }

    // Divider styles
    if (node.type === 'divider') {
      rules.push(`height: ${props.thickness || 1}px; background: ${props.color || '#e0e0e0'}; width: 100%`)
    }

    // Spacer
    if (node.type === 'spacer') {
      rules.push(`flex: ${props.flex || 1}`)
    }

    // Image
    if (node.type === 'image') {
      rules.push(`object-fit: ${props.fit || 'cover'}`)
      if (props.width) rules.push(`width: ${sizeValue(props.width)}px`)
      if (props.height) rules.push(`height: ${sizeValue(props.height)}px`)
    }

    if (rules.length > 0) {
      css += `  #${id} { ${rules.join('; ')} }\n`
    }
  }
  return css
}

function renderNodeTree(
  rootId: string,
  nodes: Record<string, any>,
  depth = 0
): string {
  const node = nodes[rootId]
  if (!node) return ''

  const props = node.props || {}
  const childrenIds: string[] = node.children || props.children || []
  const childrenHtml = childrenIds.map((cid) => renderNodeTree(cid, nodes, depth + 1)).join('\n')

  const eventAttrs = buildEventAttrs(node, props)

  switch (node.type) {
    case 'container':
      return `<div id="${rootId}"${eventAttrs}>${childrenHtml}</div>`
    case 'card':
      return `<div id="${rootId}"${eventAttrs}>${childrenHtml}</div>`
    case 'scroll':
      return `<div id="${rootId}" style="overflow:auto"${eventAttrs.slice(0, -1)}>${childrenHtml}</div>`
    case 'text':
      return `<span id="${rootId}"${eventAttrs}>${escapeHtml(String(props.content ?? ''))}</span>`
    case 'button':
      return `<button id="${rootId}"${eventAttrs}>${escapeHtml(String(props.label ?? ''))}</button>`
    case 'input':
      if (props.type === 'multiline') {
        return `<textarea id="${rootId}" placeholder="${escapeHtml(String(props.placeholder ?? ''))}" maxlength="${props.maxLength ?? ''}"${eventAttrs}>${escapeHtml(String(props.value ?? ''))}</textarea>`
      }
      return `<input id="${rootId}" type="${props.type || 'text'}" placeholder="${escapeHtml(String(props.placeholder ?? ''))}" value="${escapeHtml(String(props.value ?? ''))}" maxlength="${props.maxLength ?? ''}"${eventAttrs}>`
    case 'image':
      return `<img id="${rootId}" src="${escapeHtml(String(props.src ?? ''))}"${eventAttrs}>`
    case 'list':
      return `<div id="${rootId}"${eventAttrs}>${childrenHtml}</div>`
    case 'spacer':
      return `<div id="${rootId}"></div>`
    case 'divider':
      return `<div id="${rootId}"></div>`
    case 'webview':
      return `<iframe id="${rootId}" src="${escapeHtml(String(props.src ?? ''))}" style="width:100%;height:300px;border:none"${eventAttrs.slice(0, -1)}></iframe>`
    default:
      return `<div id="${rootId}"${eventAttrs}>${childrenHtml}</div>`
  }
}

function buildEventAttrs(
  node: { type: string },
  props: Record<string, any>
): string {
  let attrs = ''
  if (node.type === 'button' && props.onTap) {
    attrs += ` onclick="${props.onTap}()"`
  }
  if (node.type === 'input' && props.onChange) {
    attrs += ` oninput="${props.onChange}(this.value)"`
  }
  if (node.type === 'input' && props.onSubmit) {
    attrs += ` onkeydown="if(event.key==='Enter')${props.onSubmit}()"`
  }
  if (node.type === 'image' && props.onTap) {
    attrs += ` onclick="${props.onTap}()"`
  }
  return attrs
}

function sizeValue(val: any): number {
  if (typeof val === 'number') return val
  const sizes: Record<string, number> = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 }
  return sizes[val] ?? 16
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
