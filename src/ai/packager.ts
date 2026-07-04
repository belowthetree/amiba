// ============================================================
// 变形虫 (Amiba) — 服务包打包器
// ============================================================
// 将 ServicePackage 多文件包内联为单个 HTML 字符串，
// 供 iframe srcdoc 渲染。
// ============================================================
import type { ServicePackage } from '../types/service'

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
      return _match
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

  // Bridge placeholder
  const shim = `<!-- AMIBA_BRIDGE -->`
  html = html.replace(/(<body[^>]*>)/i, '$1\n' + shim)

  return html
}
