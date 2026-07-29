// ============================================================
// 变形虫 (Amiba) — 服务工具（Service-Provided Tools）窄腰
// ============================================================
// 服务经 JSBridge tools 模块运行时注册工具，本模块校验后同步进
// 全局 ToolRegistry（toolset='svc'，动态工具集）；AI 调用经
// callServiceTool 路由回服务 iframe 执行，结果 JSON 化回流。
// 生命周期：服务桥销毁 / ServiceContext.destroy 时整体注销。
// 设计文档：docs/service-tools.md
// ============================================================

import { toolRegistry } from '../tools/tool-registry'
import { getService } from './registry'
import type { ServiceToolDecl } from '../types/service'

/** 宿主 → 服务 iframe 的工具调用函数（由桥层注入） */
export type ServiceToolCaller = (tool: string, args: Record<string, any>) => Promise<any>

interface ServiceToolEntry {
  decl: ServiceToolDecl
  aiName: string // AI 可见名 svc_<serviceId>__<tool>
  call: ServiceToolCaller
}

/** 注册结果回执（经 api-response 返回给服务） */
export interface ServiceToolRegisterResult {
  registered: string[]
  rejected: { name: string; reason: string }[]
}

// serviceId → (本地工具名 → entry)
const toolTable = new Map<string, Map<string, ServiceToolEntry>>()
// AI 可见名 → serviceId（跨服务撞名检测）
const aiNameOwners = new Map<string, string>()

const MAX_TOOLS_PER_SERVICE = 8
const MAX_DESC_CHARS = 512
const MAX_ARGS_CHARS = 16 * 1024
const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/

// ---- 命名 ----

/** AI 可见名：svc_<清洗后的 serviceId>__<本地名>，总长 ≤ 64（OpenAI 工具名约束） */
export function toAiToolName(serviceId: string, localName: string): string {
  const sid = serviceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)
  return `svc_${sid}__${localName}`.slice(0, 64)
}

// ---- 可用性门控 ----

/** 服务工具能力是否可用：声明 tools 权限 + 设置中未关闭（声明即启用） */
export function isServiceToolsEnabled(serviceId: string): boolean {
  const svc = getService(serviceId)
  if (!svc) return false
  if (!svc.manifest.permissions.includes('tools')) return false
  return svc.toolsConfig?.enabled !== false
}

/** 单个工具是否启用：总开关 +（显式列表 ∩）级别默认（sensitive 默认关） */
export function isServiceToolEnabled(
  serviceId: string,
  localName: string,
  level?: 'readonly' | 'sensitive'
): boolean {
  if (!isServiceToolsEnabled(serviceId)) return false
  const configured = getService(serviceId)?.toolsConfig?.enabledTools
  if (configured) return configured.includes(localName)
  return level !== 'sensitive'
}

// ---- 校验 ----

function validateDecl(decl: ServiceToolDecl): string | null {
  if (!decl || typeof decl !== 'object') return '条目必须是对象'
  if (typeof decl.name !== 'string' || !NAME_RE.test(decl.name)) {
    return `工具名非法（需 ^[a-zA-Z0-9_-]{1,32}$）: ${String(decl?.name)}`
  }
  if (typeof decl.description !== 'string' || !decl.description.trim()) return 'description 必填'
  if (decl.description.length > MAX_DESC_CHARS) return `description 超过 ${MAX_DESC_CHARS} 字符`
  if (
    decl.parameters !== undefined &&
    (typeof decl.parameters !== 'object' || decl.parameters === null || Array.isArray(decl.parameters))
  ) {
    return 'parameters 必须是 JSON Schema 对象'
  }
  if (decl.level !== undefined && decl.level !== 'readonly' && decl.level !== 'sensitive') {
    return 'level 必须是 readonly 或 sensitive'
  }
  return null
}

// ---- 注册 / 注销 ----

/**
 * 注册服务工具。由桥层（前台容器 / 后台 worker）在收到 tools/register 时调用。
 * 同名重注册 = 覆盖（服务重载场景）；回执含被拒条目及原因。
 */
export function registerServiceTools(
  serviceId: string,
  decls: ServiceToolDecl[],
  call: ServiceToolCaller,
): ServiceToolRegisterResult {
  const result: ServiceToolRegisterResult = { registered: [], rejected: [] }
  if (!isServiceToolsEnabled(serviceId)) {
    console.warn(
      '[SvcTools] 注册被拒（服务工具能力未启用）:',
      serviceId,
      (decls ?? []).map((d) => d?.name ?? '?').join(', '),
    )
    for (const d of decls ?? []) {
      result.rejected.push({
        name: d?.name ?? '?',
        reason: '服务工具能力未启用（需要 manifest 声明 tools 权限，且在服务设置中开启）',
      })
    }
    return result
  }

  let table = toolTable.get(serviceId)
  if (!table) {
    table = new Map()
    toolTable.set(serviceId, table)
  }
  const svcName = getService(serviceId)?.manifest.name || serviceId

  for (const decl of decls ?? []) {
    const invalid = validateDecl(decl)
    if (invalid) {
      result.rejected.push({ name: decl?.name ?? '?', reason: invalid })
      continue
    }
    if (!table.has(decl.name) && table.size >= MAX_TOOLS_PER_SERVICE) {
      result.rejected.push({ name: decl.name, reason: `每服务最多 ${MAX_TOOLS_PER_SERVICE} 个工具` })
      continue
    }

    const aiName = toAiToolName(serviceId, decl.name)
    const owner = aiNameOwners.get(aiName)
    if (owner && owner !== serviceId) {
      result.rejected.push({ name: decl.name, reason: `AI 工具名冲突: ${aiName} 已被服务 ${owner} 占用` })
      continue
    }

    // 同名重注册：先移除旧的 registry 条目
    if (table.has(decl.name)) toolRegistry.deregister(table.get(decl.name)!.aiName)

    const level = decl.level ?? 'readonly'
    const localName = decl.name
    const description = `【${svcName}】${decl.description}`

    toolRegistry.register(
      {
        name: aiName,
        toolset: 'svc',
        category: level === 'sensitive' ? 'manage' : 'view',
        emoji: '🔌',
        description,
        schema: {
          type: 'function',
          function: {
            name: aiName,
            description,
            parameters: decl.parameters ?? { type: 'object', properties: {} },
          },
        },
        checkFn: () =>
          isServiceToolEnabled(serviceId, localName, level) &&
          toolTable.get(serviceId)?.has(localName) === true,
        handler: async (args) => {
          const argsSize = JSON.stringify(args ?? {}).length
          if (argsSize > MAX_ARGS_CHARS) {
            console.warn('[SvcTools] 参数体积超限:', serviceId, localName, `(${argsSize} > ${MAX_ARGS_CHARS} 字符)`)
            return JSON.stringify({ error: `参数体积超限（${argsSize} > ${MAX_ARGS_CHARS} 字符）` })
          }
          console.log('[SvcTools] 🔌→', serviceId, localName)
          try {
            const r = await call(localName, args ?? {})
            const out = typeof r === 'string' ? r : JSON.stringify(r ?? null)
            console.log('[SvcTools] 🔌✓', serviceId, localName, `(结果 ${out.length} 字符)`)
            return out
          } catch (e: any) {
            console.warn('[SvcTools] 🔌✗', serviceId, localName, e?.message || e)
            throw e
          }
        },
      },
      true, // override：本模块自行管理生命周期（注销时 deregister）
    )

    table.set(localName, { decl: { ...decl, level }, aiName, call })
    aiNameOwners.set(aiName, serviceId)
    result.registered.push(localName)
  }

  if (result.registered.length > 0) {
    console.log('[SvcTools] === 服务工具注册:', serviceId, result.registered.join(', '), '===')
  }
  if (result.rejected.length > 0) {
    console.warn('[SvcTools] 部分工具被拒:', serviceId, JSON.stringify(result.rejected))
  }
  return result
}

/**
 * 注销服务工具。names 缺省 = 全部；caller 提供时仅注销该桥实例注册的工具
 * （前台/后台并存时互不误删）。
 */
export function unregisterServiceTools(serviceId: string, names?: string[], caller?: ServiceToolCaller): void {
  const table = toolTable.get(serviceId)
  if (!table) return
  const targets = names ?? [...table.keys()]
  const removed: string[] = []
  for (const n of targets) {
    const e = table.get(n)
    if (!e) continue
    if (caller && e.call !== caller) continue // 属于其他实例（前台/后台并存）
    toolRegistry.deregister(e.aiName)
    aiNameOwners.delete(e.aiName)
    table.delete(n)
    removed.push(n)
  }
  if (table.size === 0) toolTable.delete(serviceId)
  if (removed.length > 0) console.log('[SvcTools] 服务工具注销:', serviceId, removed.join(', '))
}

// ---- 查询 ----

/** 服务当前运行时注册的工具元数据（设置页展示用） */
export function getRuntimeServiceTools(serviceId: string): ServiceToolDecl[] {
  const table = toolTable.get(serviceId)
  return table ? [...table.values()].map((e) => e.decl) : []
}

/** 服务全部已知工具：manifest 静态声明 ∪ 运行时注册（同名去重，运行时优先） */
export function getKnownServiceTools(serviceId: string): ServiceToolDecl[] {
  const map = new Map<string, ServiceToolDecl>()
  for (const d of getService(serviceId)?.manifest.aiTools ?? []) map.set(d.name, d)
  for (const d of getRuntimeServiceTools(serviceId)) map.set(d.name, d)
  return [...map.values()]
}
