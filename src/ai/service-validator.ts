// ============================================================
// 变形虫 (Amiba) — 服务校验器
// ============================================================
// 纯函数模块：分析服务文件内容，检测常见错误。
// 供 service_validate 工具调用，也供系统内部使用。
// ============================================================
import {
  listServiceFiles,
  readServiceFile,
} from '../config/storage'
import { getService } from '../host/registry'

// ---- 类型 ----

export interface ValidationCheck {
  check: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  file?: string
  suggestion: string
}

export interface ServiceValidationResult {
  service_id: string
  checks: ValidationCheck[]
  summary: { pass: number; warn: number; fail: number }
}

// ---- 校验规则 ----

type CheckFn = (
  filePath: string,
  content: string,
  manifest: Record<string, any> | null
) => ValidationCheck[]

// ================================================================
// 规则 1: 禁止 localStorage / sessionStorage
// ================================================================

const checkStorageApi: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []

  // 只检查 .js 文件（.html 中的 <script> 也会被读到）
  const hasLocalStorage = /\blocalStorage\./g
  const hasSessionStorage = /\bsessionStorage\./g

  if (hasLocalStorage.test(content)) {
    const matches = content.match(/\blocalStorage\.\w+/g) || []
    results.push({
      check: 'localStorage 使用',
      status: 'fail',
      message: `使用了 localStorage（${matches.join(', ')}），iframe sandbox 中不可用`,
      file: filePath,
      suggestion: '改用 __amiba__.storage.set(key, data) / get(key) / remove(key)',
    })
  }

  if (hasSessionStorage.test(content)) {
    const matches = content.match(/\bsessionStorage\.\w+/g) || []
    results.push({
      check: 'sessionStorage 使用',
      status: 'fail',
      message: `使用了 sessionStorage（${matches.join(', ')}），iframe sandbox 中不可用`,
      file: filePath,
      suggestion: '改用 __amiba__.storage.set(key, data) / get(key) / remove(key)',
    })
  }

  return results
}

// ================================================================
// 规则 2: 禁止 BroadcastChannel / SharedWorker
// ================================================================

const checkMultiContextApi: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []

  if (/\bnew BroadcastChannel\(/.test(content)) {
    results.push({
      check: 'BroadcastChannel 使用',
      status: 'fail',
      message: '使用了 BroadcastChannel API，iframe 沙箱中无法多窗口通信',
      file: filePath,
      suggestion: '多用户/协作场景使用 network 权限：多人房间用 __amiba__.network.createRoom/joinRoom，一对一用 P2P session API',
    })
  }

  if (/\bnew SharedWorker\(/.test(content)) {
    results.push({
      check: 'SharedWorker 使用',
      status: 'fail',
      message: '使用了 SharedWorker，iframe 沙箱不支持',
      file: filePath,
      suggestion: '需要用 network 权限实现多端通信：多人房间用 __amiba__.network.createRoom/joinRoom，一对一用 P2P session API',
    })
  }

  return results
}

// ================================================================
// 规则 3: 禁止 alert / confirm / prompt
// ================================================================

const checkBlockedDialogs: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []

  if (/\balert\(/.test(content)) {
    results.push({
      check: 'alert() 使用',
      status: 'fail',
      message: '使用了 alert()，iframe sandbox 中弹窗被阻止',
      file: filePath,
      suggestion: '改用 __amiba__.showToast(title, icon) 显示通知',
    })
  }

  if (/\bconfirm\(/.test(content)) {
    results.push({
      check: 'confirm() 使用',
      status: 'fail',
      message: '使用了 confirm()，iframe sandbox 中弹窗被阻止',
      file: filePath,
      suggestion: '用自定义模态框替代浏览器 confirm',
    })
  }

  if (/\bprompt\(/.test(content)) {
    results.push({
      check: 'prompt() 使用',
      status: 'fail',
      message: '使用了 prompt()，iframe sandbox 中弹窗被阻止',
      file: filePath,
      suggestion: '用自定义输入框替代浏览器 prompt',
    })
  }

  return results
}

// ================================================================
// 规则 4: 检查外部 CDN / fetch 外部 URL
// ================================================================

const checkExternalResources: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []

  // CDN script references
  const cdnPattern = /<script\s[^>]*src\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi
  const cdnMatches = content.match(cdnPattern)
  if (cdnMatches && cdnMatches.length > 0) {
    results.push({
      check: '外部 CDN 引用',
      status: 'warn',
      message: `引用了外部脚本 (${cdnMatches.length} 处)，可能被 CSP 阻止`,
      file: filePath,
      suggestion: '优先使用平台预置库（如 /libs/chart.umd.min.js），避免引用外部 CDN',
    })
  }

  // fetch to external URLs (not relative or __amiba__)
  if (/\bfetch\(['"]https?:\/\//.test(content)) {
    results.push({
      check: 'fetch 外部 API',
      status: 'warn',
      message: '使用了 fetch() 访问外部 URL，可能被 CORS 或沙箱阻止',
      file: filePath,
      suggestion: '避免 fetch 外部 API，如有需要可通过宿主转发',
    })
  }

  return results
}

// ================================================================
// 规则 5: 存储 API 权限一致性
// ================================================================

const checkStoragePermissionConsistency: CheckFn = (filePath, content, manifest) => {
  const results: ValidationCheck[] = []
  if (!manifest) return results

  const declared = manifest.permissions || []

  // 使用了 __amiba__.storage 但没声明 storage 权限
  if (/__amiba__\.storage/.test(content) && !declared.includes('storage')) {
    results.push({
      check: 'storage 权限缺失',
      status: 'fail',
      message: '代码使用了 __amiba__.storage 但 manifest 未声明 storage 权限',
      file: filePath,
      suggestion: '在 manifest.permissions 中添加 "storage"',
    })
  }

  return results
}

// ================================================================
// 规则 6: 网络 API 权限一致性
// ================================================================

const checkNetworkPermissionConsistency: CheckFn = (filePath, content, manifest) => {
  const results: ValidationCheck[] = []
  if (!manifest) return results

  const declared = manifest.permissions || []

  // 使用了 __amiba__.network.* 但没声明 network 权限
  if (/__amiba__\.network\./.test(content) && !declared.includes('network')) {
    results.push({
      check: 'network 权限缺失',
      status: 'fail',
      message: '代码使用了 __amiba__.network.* 但 manifest 未声明 network 权限',
      file: filePath,
      suggestion: '在 manifest.permissions 中添加 "network"',
    })
  }

  return results
}

// ================================================================
// 规则 7: Widget 权限一致性
// ================================================================

const checkWidgetPermissionConsistency: CheckFn = (filePath, content, manifest) => {
  const results: ValidationCheck[] = []
  if (!manifest) return results

  const declared = manifest.permissions || []

  if (/__amiba__\.widgets\./.test(content) && !declared.includes('widgets')) {
    results.push({
      check: 'widgets 权限缺失',
      status: 'fail',
      message: '代码使用了 __amiba__.widgets.* 但 manifest 未声明 widgets 权限',
      file: filePath,
      suggestion: '在 manifest.permissions 中添加 "widgets"',
    })
  }

  return results
}

// ================================================================
// 规则 8: 通知权限一致性
// ================================================================

const checkNotificationPermissionConsistency: CheckFn = (filePath, content, manifest) => {
  const results: ValidationCheck[] = []
  if (!manifest) return results

  const declared = manifest.permissions || []

  if (/__amiba__\.showToast/.test(content) && !declared.includes('notification')) {
    results.push({
      check: 'notification 权限缺失',
      status: 'fail',
      message: '代码使用了 __amiba__.showToast() 但 manifest 未声明 notification 权限',
      file: filePath,
      suggestion: '在 manifest.permissions 中添加 "notification"',
    })
  }

  return results
}

// ================================================================
// 规则 8.5: AI 权限一致性
// ================================================================

const checkAiPermissionConsistency: CheckFn = (filePath, content, manifest) => {
  const results: ValidationCheck[] = []
  if (!manifest) return results

  const declared = manifest.permissions || []

  // 使用了 __amiba__.ai.* 但没声明 ai 权限
  if (/__amiba__\.ai\./.test(content) && !declared.includes('ai')) {
    results.push({
      check: 'ai 权限缺失',
      status: 'fail',
      message: '代码使用了 __amiba__.ai.* 但 manifest 未声明 ai 权限',
      file: filePath,
      suggestion: '在 manifest.permissions 中添加 "ai"',
    })
  }

  return results
}

// ================================================================
// 规则 8.6: tools 权限一致性（服务向 AI 提供工具）
// ================================================================

const checkToolsPermissionConsistency: CheckFn = (filePath, content, manifest) => {
  const results: ValidationCheck[] = []
  if (!manifest) return results

  const declared = manifest.permissions || []

  // 使用了 __amiba__.tools.* 但没声明 tools 权限
  if (/__amiba__\.tools\./.test(content) && !declared.includes('tools')) {
    results.push({
      check: 'tools 权限缺失',
      status: 'fail',
      message: '代码使用了 __amiba__.tools.* 但 manifest 未声明 tools 权限',
      file: filePath,
      suggestion: '在 manifest.permissions 中添加 "tools"',
    })
  }

  return results
}

// ================================================================
// 规则 9: index.html 存在性 + 结构
// ================================================================

const checkIndexHtml: CheckFn = (filePath, content) => {
  if (filePath !== 'index.html') return []

  const results: ValidationCheck[] = []

  if (!/<script\s[^>]*src\s*=\s*["']app\.js["'][^>]*>\s*<\/script>/i.test(content)) {
    results.push({
      check: 'app.js 引用',
      status: 'warn',
      message: 'index.html 中未发现 <script src="app.js"> 引用',
      file: filePath,
      suggestion: '在 index.html 的 </body> 前添加 <script src="app.js"></script>',
    })
  }

  if (!/<link\s[^>]*href\s*=\s*["']style\.css["'][^>]*\/?>/i.test(content)) {
    results.push({
      check: 'style.css 引用',
      status: 'warn',
      message: 'index.html 中未发现 <link href="style.css"> 引用',
      file: filePath,
      suggestion: '在 index.html 的 <head> 中添加 <link rel="stylesheet" href="style.css">',
    })
  }

  // Vue 脚本顺序检查：app.js 应在 Vue 库之后
  if (/\/libs\/vue\.global\.prod\.js/.test(content)) {
    const vuePos = content.search(/<script\s[^>]*src\s*=\s*["']\/libs\/vue\.global\.prod\.js["']/)
    const appPos = content.search(/<script\s[^>]*src\s*=\s*["']app\.js["']/)
    if (vuePos >= 0 && appPos >= 0 && appPos < vuePos) {
      results.push({
        check: 'Vue 脚本顺序',
        status: 'warn',
        message: 'app.js 的引用位置在 Vue 库之前，会报 Vue 未定义错误',
        file: filePath,
        suggestion: '将 <script src="/libs/vue.global.prod.js"> 放在 <script src="app.js"> 之前',
      })
    }
  }

  return results
}

// ================================================================
// 规则 10: __amiba__ API 使用提醒
// ================================================================

const checkAmibaApiUsage: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []
  // 仅检查 .js 文件
  if (!filePath.endsWith('.js')) return results

  // JS 文件检查是否使用了 __amiba__（正面提示）
  if (!/__amiba__\./.test(content) && content.length > 100) {
    results.push({
      check: '__amiba__ API 使用',
      status: 'warn',
      message: 'app.js 未使用 __amiba__ API，服务可能是纯静态页面',
      file: filePath,
      suggestion: '可通过 __amiba__.storage / showToast / navigateTo 等增强交互能力',
    })
  }

  return results
}

// ================================================================
// 规则 11–15: Vue.js 专项校验
// ================================================================

// 规则 11: Vue 库引用检查
const checkVueLibMissing: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []
  if (filePath !== 'index.html') return results

  if (/createApp\s*\(/.test(content) && !/\/libs\/vue\.global\.prod\.js/.test(content)) {
    results.push({
      check: 'Vue 库引用',
      status: 'fail',
      message: '代码中使用 Vue.createApp() 但未引用 Vue 库',
      file: filePath,
      suggestion: '在 app.js 前添加 <script src="/libs/vue.global.prod.js"></script>',
    })
  }

  return results
}

// 规则 12: 模板中禁止调异步 API
const checkVueTemplateAmiba: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []
  if (!filePath.endsWith('.html')) return results

  const templateAmiba = /\{\{\s*__amiba__\./g
  if (templateAmiba.test(content)) {
    results.push({
      check: 'Vue 模板异步 API',
      status: 'fail',
      message: '在 {{ }} 中调用了 __amiba__ 方法，会显示 [object Promise]',
      file: filePath,
      suggestion: '在 mounted() 中 await API 后赋值到 data，模板中只渲染 data 属性',
    })
  }

  return results
}

// 规则 13: data() 中不允许异步调用（跨行匹配）
const checkVueDataAsync: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []
  if (!filePath.endsWith('.js')) return results

  const dataPattern = /data\s*\(\s*\)\s*\{[\s\S]*?__amiba__\./g
  if (dataPattern.test(content)) {
    results.push({
      check: 'Vue data() 异步调用',
      status: 'fail',
      message: 'data() 中直接调用了 __amiba__ 方法，返回 Promise 而非值',
      file: filePath,
      suggestion: '在 mounted() 中 await __amiba__ API 后再通过 this.xxx = value 赋值',
    })
  }

  return results
}

// 规则 14: v-html 安全警告
const checkVueVHtmlSecurity: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []
  if (!filePath.endsWith('.html') && filePath !== 'index.html') return results

  const vHtmlMatch = content.match(/v-html\s*=\s*["']([^"']+)["']/g)
  if (vHtmlMatch) {
    const riskyPattern = /user|input|message|content|text|data|name/i
    for (const match of vHtmlMatch) {
      if (riskyPattern.test(match)) {
        results.push({
          check: 'v-html 安全隐患',
          status: 'warn',
          message: `检测到 v-html="${match.split('=')[1]}"，可能渲染用户输入导致 XSS`,
          file: filePath,
          suggestion: '仅用于受信任的静态 HTML。用户输入内容用 {{ }} 插值或 v-text 替代',
        })
        break
      }
    }
  }

  return results
}

// 规则 15: 不使用 Vue 时误加载
const checkVueUnnecessaryLoad: CheckFn = (filePath, content) => {
  const results: ValidationCheck[] = []
  if (filePath !== 'index.html') return results

  const hasVueScript = /\/libs\/vue\.global\.prod\.js/.test(content)
  const hasCreateApp = /createApp\s*\(/.test(content)
  if (hasVueScript && !hasCreateApp && !/app\.js/.test(content)) {
    results.push({
      check: 'Vue 不必要加载',
      status: 'warn',
      message: '引用了 Vue 库但未使用 Vue.createApp，130KB 资源浪费',
      file: filePath,
      suggestion: '简单服务用原生 JS 即可，只有需要响应式数据绑定时才用 Vue',
    })
  }

  return results
}

// ================================================================
// 所有规则列表
// ================================================================

const ALL_CHECKS: CheckFn[] = [
  checkStorageApi,
  checkMultiContextApi,
  checkBlockedDialogs,
  checkExternalResources,
  checkStoragePermissionConsistency,
  checkNetworkPermissionConsistency,
  checkWidgetPermissionConsistency,
  checkNotificationPermissionConsistency,
  checkAiPermissionConsistency,
  checkToolsPermissionConsistency,
  checkIndexHtml,
  checkAmibaApiUsage,
  checkVueLibMissing,
  checkVueTemplateAmiba,
  checkVueDataAsync,
  checkVueVHtmlSecurity,
  checkVueUnnecessaryLoad,
]

// ================================================================
// 公共 API
// ================================================================

export async function validateService(
  serviceId: string
): Promise<ServiceValidationResult> {
  const checks: ValidationCheck[] = []

  // 初始检查
  if (!serviceId || typeof serviceId !== 'string' || !serviceId.trim()) {
    checks.push({
      check: 'service_id',
      status: 'fail',
      message: 'service_id 不能为空',
      suggestion: '提供有效的服务 ID',
    })
    return {
      service_id: serviceId,
      checks,
      summary: { pass: 0, warn: 0, fail: 1 },
    }
  }

  if (serviceId.startsWith('system.')) {
    checks.push({
      check: 'service_id',
      status: 'fail',
      message: '系统内置服务不可校验',
      suggestion: '仅支持校验 user.* 服务',
    })
    return {
      service_id: serviceId,
      checks,
      summary: { pass: 0, warn: 0, fail: 1 },
    }
  }

  const entry = getService(serviceId)
  if (!entry) {
    checks.push({
      check: 'service_id',
      status: 'fail',
      message: `服务 "${serviceId}" 不存在`,
      suggestion: '使用 service_list 查看可用服务，或先通过 service_create 创建',
    })
    return {
      service_id: serviceId,
      checks,
      summary: { pass: 0, warn: 0, fail: 1 },
    }
  }

  // 读取 manifest
  let manifest: Record<string, any> | null = null
  try {
    const raw = await readServiceFile(serviceId, 'manifest.json')
    if (raw) {
      manifest = JSON.parse(raw)
    }
  } catch {
    checks.push({
      check: 'manifest.json',
      status: 'fail',
      message: '无法读取 manifest.json',
      suggestion: '检查 manifest.json 是否存在且格式正确',
    })
  }

  // 读取所有文件
  let files: string[] = []
  try {
    files = await listServiceFiles(serviceId)
  } catch {
    checks.push({
      check: '文件列表',
      status: 'fail',
      message: '无法读取服务文件列表',
      suggestion: '检查服务目录是否可访问',
    })
    return {
      service_id: serviceId,
      checks,
      summary: { pass: 0, warn: 0, fail: 1 },
    }
  }

  // 检查 index.html 是否存在
  if (!files.includes('index.html')) {
    checks.push({
      check: 'index.html 存在性',
      status: 'fail',
      message: '服务缺少 index.html 入口文件',
      suggestion: '用 service_file_write 创建 index.html',
    })
  }

  // 对每个文件运行所有规则
  const filesToCheck = files.filter(
    (f) =>
      f.endsWith('.js') ||
      f.endsWith('.html') ||
      f.endsWith('.css') ||
      f === 'index.html'
  )

  for (const filePath of filesToCheck) {
    try {
      const content = await readServiceFile(serviceId, filePath)
      if (!content) continue

      for (const checkFn of ALL_CHECKS) {
        const result = checkFn(filePath, content, manifest)
        checks.push(...result)
      }
    } catch {
      // 跳过无法读取的文件
    }
  }

  // ---- manifest 级检查：aiTools 声明与 tools 权限一致性 ----
  if (manifest) {
    const declared: string[] = manifest.permissions || []
    const aiTools = manifest.aiTools
    if (Array.isArray(aiTools) && aiTools.length > 0 && !declared.includes('tools')) {
      checks.push({
        check: 'aiTools/tools 权限一致性',
        status: 'fail',
        message: 'manifest 声明了 aiTools 但未声明 tools 权限',
        suggestion: '在 manifest.permissions 中添加 "tools"',
      })
    }
    if (Array.isArray(aiTools)) {
      for (const t of aiTools) {
        if (!t || typeof t.name !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(t.name)) {
          checks.push({
            check: 'aiTools 声明格式',
            status: 'fail',
            message: `aiTools 条目工具名非法: ${String(t?.name)}`,
            suggestion: '工具名需满足 ^[a-zA-Z0-9_-]{1,32}$',
          })
        } else if (typeof t.description !== 'string' || !t.description.trim()) {
          checks.push({
            check: 'aiTools 声明格式',
            status: 'fail',
            message: `aiTools 条目 ${t.name} 缺少 description`,
            suggestion: '为每个工具提供 description 与 parameters（JSON Schema）',
          })
        }
      }
    }
  }

  // 汇总
  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  }

  return { service_id: serviceId, checks, summary }
}

/**
 * 快速校验：仅返回 fail 项，适合 AI tool 调用
 */
export function formatValidationResult(
  result: ServiceValidationResult
): string {
  const lines: string[] = []

  lines.push(`=== ${result.service_id} 校验报告 ===`)
  lines.push(
    `通过: ${result.summary.pass} | 警告: ${result.summary.warn} | 失败: ${result.summary.fail}`
  )
  lines.push('')

  if (result.checks.length === 0) {
    lines.push('✓ 未发现问题。')
    return lines.join('\n')
  }

  // 按严重程度排序：fail > warn > pass
  const sorted = [...result.checks].sort((a, b) => {
    const order = { fail: 0, warn: 1, pass: 2 }
    return order[a.status] - order[b.status]
  })

  for (const c of sorted) {
    const icon = c.status === 'fail' ? '✗' : c.status === 'warn' ? '⚠' : '✓'
    const fileInfo = c.file ? ` [${c.file}]` : ''
    lines.push(`${icon} ${c.status.toUpperCase()}: ${c.check}${fileInfo}`)
    lines.push(`   ${c.message}`)
    lines.push(`   → ${c.suggestion}`)
    lines.push('')
  }

  return lines.join('\n')
}
