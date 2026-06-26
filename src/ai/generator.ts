// ============================================================
// 变形虫 (Amiba) — AI 服务生成器 (多文件 Web 应用包)
// ============================================================
import OpenAI from 'openai'
import { getSettings, getApiKey } from '../config/config'
import { getCatalogYamlText, validatePermissions } from './catalog'
import { matchSkill, getSkillContext } from './skills'
import type { ServicePackage, ServiceFile } from '../types/service'

const GENERATION_PROMPT = `你是变形虫平台的 AI 服务生成助手。根据用户需求生成一个完整的迷你 Web 应用。

输出格式：一个 JSON，包含 manifest 和 files 数组。files 中每个文件有 path 和 content 字段。

规则:
1. 必须包含 "index.html" 文件作为入口
2. CSS 写在 "style.css" 中，JS 写在 "app.js" 中（不要内联在 HTML 里）
3. app.js 中使用 window.__amiba__ 调用宿主 API
4. UI 完全自由设计 —— 直接用 HTML/CSS，参考 Catalog 中的组件风格（但不必严格拘泥）
5. 返回纯 JSON，不要 markdown 代码块包裹，不要解释文字
6. content 中的代码必须是合法可运行的

=== CATALOG (组件风格参考) ===
`

export interface GenerationProgress {
  stage: 'preparing' | 'generating' | 'validating' | 'packaging' | 'done' | 'error'
  message: string
}

export async function* generateService(
  userPrompt: string,
  onProgress?: (progress: GenerationProgress) => void
): AsyncGenerator<ServicePackage | { node: string; message: string }[]> {
  onProgress?.({ stage: 'preparing', message: '正在准备生成...' })

  const s = getSettings()
  const apiKey = await getApiKey()

  if (!apiKey) {
    onProgress?.({ stage: 'error', message: '请先在设置中配置 API Key' })
    return
  }

  // Match skill
  const skill = matchSkill(userPrompt)
  const skillCtx = await getSkillContext(skill)

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
  let parsed: any
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
  const errors: { node: string; message: string }[] = []

  if (!parsed.manifest || !parsed.manifest.id) {
    errors.push({ node: 'manifest', message: '缺少 manifest.id' })
  }
  if (!parsed.manifest?.name) {
    errors.push({ node: 'manifest', message: '缺少 manifest.name' })
  }

  if (!parsed.files || !Array.isArray(parsed.files) || parsed.files.length === 0) {
    errors.push({ node: 'files', message: '缺少 files 数组或为空' })
  } else {
    const hasIndexHtml = parsed.files.some((f: any) => f.path === 'index.html')
    if (!hasIndexHtml) {
      errors.push({ node: 'files', message: '必须包含 index.html 文件' })
    }
    for (const f of parsed.files) {
      if (!f.path || typeof f.path !== 'string') {
        errors.push({ node: 'files', message: '文件缺少 path 字段' })
        break
      }
      if (typeof f.content !== 'string') {
        errors.push({ node: `files/${f.path || '?'}`, message: '文件缺少 content 字段' })
        break
      }
    }
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

  const pkg: ServicePackage = {
    manifest: parsed.manifest,
    files: parsed.files,
    tasks: parsed.tasks,
  }

  yield pkg
  onProgress?.({ stage: 'done', message: '生成完成！' })
}

// --- Package Inlining ---

/**
 * Inline a ServicePackage into a single self-contained HTML string
 * ready for iframe srcdoc rendering.
 *
 * Rules:
 * - index.html is the skeleton
 * - <link rel="stylesheet" href="style.css"> → inline CSS into <style>
 * - <script src="app.js"> → inline JS into <script>
 * - Files not referenced are appended as <!-- comments -->
 */
export function inlinePackage(pkg: ServicePackage): string {
  const fileMap = new Map<string, string>()
  for (const f of pkg.files) {
    fileMap.set(f.path, f.content)
  }

  let html = fileMap.get('index.html') || ''
  if (!html) {
    // Fallback: if no index.html, concatenate all files
    html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>No index.html found</p></body></html>'
  }

  // Inline CSS: replace <link href="style.css" ...> with <style>...</style>
  html = html.replace(
    /<link\s+[^>]*href\s*=\s*["']([^"']+\.css)["'][^>]*\/?>/gi,
    (_match, href) => {
      const content = fileMap.get(href)
      if (content) {
        return `<style>/* ${href} */\n${content}\n</style>`
      }
      return _match // keep as-is if not found
    }
  )

  // Inline JS: replace <script src="app.js">...</script> with <script>...</script>
  html = html.replace(
    /<script\s+[^>]*src\s*=\s*["']([^"']+\.js)["'][^>]*>\s*<\/script>/gi,
    (_match, src) => {
      const content = fileMap.get(src)
      if (content) {
        return `<script>\n/* ${src} */\n${content}\n</script>`
      }
      return _match
    }
  )

  // Bridge placeholder — replaced by service-container with real bridge script
  const shim = `<!-- AMIBA_BRIDGE -->`
  html = html.replace(/(<body[^>]*>)/i, '$1\n' + shim)

  return html
}
