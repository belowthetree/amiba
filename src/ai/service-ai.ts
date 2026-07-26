// ============================================================
// 变形虫 (Amiba) — 服务内嵌 AI 对话（ServiceAiRunner）
// ============================================================
// 为 iframe 沙箱中的服务提供 AI 对话能力：
// - 经 JSBridge ai 模块调用，多轮历史与 API Key 全部留在宿主侧
// - 工具双层白名单：SERVICE_AI_TOOLS 之外的工具永不暴露；
//   默认仅只读（readonly）工具，敏感（sensitive）工具逐服务手动开启
// - 绕开 agent-runner 全局单例（其状态绑定 ChatPage），复用底层 streamChat
// 设计文档：docs/service-ai.md
// ============================================================

import { streamChat } from './agent'
import type { ChatMessage } from './agent'
import { getService } from '../host/registry'

// ---- 工具白名单 ----

export interface ServiceAiToolMeta {
  level: 'readonly' | 'sensitive'
}

/**
 * 服务可暴露工具清单。清单之外的工具（memory、service_file_* 写、
 * service_create、主题删除/重置等）永不暴露给服务。
 */
export const SERVICE_AI_TOOLS: Record<string, ServiceAiToolMeta> = {
  // —— 只读（默认开启）——
  doc_list:             { level: 'readonly' },
  doc_read:             { level: 'readonly' },
  doc_search:           { level: 'readonly' },
  catalog_search:       { level: 'readonly' },
  service_list:         { level: 'readonly' },
  service_view:         { level: 'readonly' },
  skills_list:          { level: 'readonly' },
  skill_view:           { level: 'readonly' },
  requirement_view:     { level: 'readonly' },
  requirements_summary: { level: 'readonly' },
  web_fetch:            { level: 'readonly' },
  // —— 敏感（需用户在服务设置中手动开启）——
  session_search:         { level: 'sensitive' },  // 可读用户聊天记录
  web_browse:             { level: 'sensitive' },  // 会弹出浏览器 WebView
  ui_theme_set_variables: { level: 'sensitive' },  // 修改全局主题变量
  ui_slot_set:            { level: 'sensitive' },  // 注入全局插槽 HTML
}

/** 默认工具集 = 全部只读工具 */
export function getDefaultServiceAiTools(): string[] {
  return Object.keys(SERVICE_AI_TOOLS).filter((n) => SERVICE_AI_TOOLS[n].level === 'readonly')
}

/** 服务实际可用工具 = 配置 ∩ 白名单（双重过滤，配置永不越出白名单） */
export function getEffectiveServiceAiTools(serviceId: string): string[] {
  const svc = getService(serviceId)
  const configured = svc?.aiConfig?.tools
  const base = configured ?? getDefaultServiceAiTools()
  return base.filter((n) => n in SERVICE_AI_TOOLS)
}

/** AI 能力是否可用：声明 ai 权限 + 设置中未关闭（声明即启用） */
export function isServiceAiEnabled(serviceId: string): boolean {
  const svc = getService(serviceId)
  if (!svc) return false
  if (!svc.manifest.permissions.includes('ai')) return false
  return svc.aiConfig?.enabled !== false
}

// ---- 会话管理 ----

/** 桥事件载荷（经 sendEvent('ai-event', payload) 推送到 iframe） */
export interface ServiceAiEvent {
  conversationId: string
  event: 'chunk' | 'reasoning' | 'tool' | 'done' | 'error'
  data: any
}

export type ServiceAiSink = (payload: ServiceAiEvent) => void

interface ServiceConversation {
  id: string
  serviceId: string
  messages: ChatMessage[]          // 宿主侧维护的多轮历史（不含 tool 消息，与主聊天一致）
  system?: string                  // 服务传入的附加系统提示
  abort: AbortController | null
  running: boolean
  lastActive: number
  sink: ServiceAiSink | null       // 事件出口；容器卸载时置 null（可用原 id 重新绑定恢复）
}

const conversations = new Map<string, ServiceConversation>()

const MAX_CONVERSATIONS_PER_SERVICE = 3
const IDLE_TTL_MS = 30 * 60 * 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const MAX_TOOL_ITERATIONS = 10

function convKey(serviceId: string, conversationId: string): string {
  return `${serviceId}:${conversationId}`
}

// ---- 空闲回收 ----

let sweepTimer: ReturnType<typeof setInterval> | null = null

function ensureSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, conv] of conversations) {
      if (!conv.running && now - conv.lastActive > IDLE_TTL_MS) {
        conversations.delete(key)
        console.log('[ServiceAI] 空闲会话回收:', key)
      }
    }
    if (conversations.size === 0 && sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }, SWEEP_INTERVAL_MS)
}

// ---- 系统提示 ----

function buildServiceSystemPrompt(conv: ServiceConversation): string {
  const svc = getService(conv.serviceId)
  const name = svc?.manifest.name || conv.serviceId
  const desc = svc?.manifest.description || ''
  const tools = getEffectiveServiceAiTools(conv.serviceId)

  const parts = [
    `你是内嵌在「${name}」服务中的 AI 助手，正在该服务的界面内与用户对话。`,
    desc ? `服务简介：${desc}` : '',
    '',
    '规则：',
    '- 回复简洁直接，适配小型嵌入式聊天界面。',
    tools.length
      ? `- 你可以使用这些工具：${tools.join(', ')}。只能用它们获取信息，不要声称有其他能力。`
      : '- 你当前没有任何可用工具，仅依靠对话内容回答。',
    '- 你无法直接读写服务的内部数据；服务会在消息中提供必要的上下文。',
  ]
  if (conv.system) {
    parts.push('', '服务附加指令：', conv.system)
  }
  return parts.join('\n')
}

// ---- 生成循环 ----

async function runGeneration(conv: ServiceConversation, userText: string): Promise<void> {
  conv.running = true
  const controller = new AbortController()
  conv.abort = controller
  conv.lastActive = Date.now()
  conv.messages.push({ role: 'user', content: userText })

  const emit = (event: ServiceAiEvent['event'], data: any) => {
    conv.sink?.({ conversationId: conv.id, event, data })
  }

  let full = ''
  try {
    const gen = streamChat(conv.messages, {
      enabledToolsets: ['chat'], // 工具全集，实际由 allowedTools 白名单收窄
      allowedTools: getEffectiveServiceAiTools(conv.serviceId),
      maxIterations: MAX_TOOL_ITERATIONS,
      abortSignal: controller.signal,
      systemPromptOverride: buildServiceSystemPrompt(conv),
      skipMemoryCheckpoint: true,
    })

    for await (const chunk of gen) {
      // abort 后 agent.ts 会将 AbortError 包装成错误文本流出，此处直接丢弃
      if (controller.signal.aborted) break
      // streamChat 控制码协议（与 agent-runner 相同）
      if (chunk.startsWith('\x00REASONING\x00')) {
        emit('reasoning', chunk.slice(11))
      } else if (chunk.startsWith('\x00TOOL:') && chunk.endsWith('\x00')) {
        const toolName = chunk.slice(6, -1)
        console.log('[ServiceAI] 🔧', conv.serviceId, toolName)
        emit('tool', toolName)
      } else if (chunk.startsWith('\x00STEP_LIMIT:')) {
        // 达到工具轮次上限：保留已产出的部分文本，按正常完成处理
        console.warn('[ServiceAI] 达到工具调用轮次上限:', conv.serviceId)
      } else {
        full += chunk
        emit('chunk', chunk)
      }
    }

    conv.messages.push({ role: 'assistant', content: full })
    emit('done', full)
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      conv.messages.push({ role: 'assistant', content: full })
      emit('done', full)
    } else {
      console.error('[ServiceAI] 生成异常:', e)
      emit('error', e?.message || String(e))
    }
  } finally {
    conv.running = false
    conv.abort = null
    conv.lastActive = Date.now()
  }
}

// ---- 公开 API（供三条桥路径调用：前台容器 / 后台 worker / 全局 widget） ----

/**
 * 创建（或恢复）会话。opts.conversationId 命中已有会话时重新绑定事件出口并恢复。
 * 抛出 Error 表示不可用（未授权 / 超上限），由桥层转为 error 响应。
 */
export function createServiceConversation(
  serviceId: string,
  opts: { conversationId?: string; system?: string },
  sink: ServiceAiSink,
): { conversationId: string; resumed: boolean } {
  if (!isServiceAiEnabled(serviceId)) {
    throw new Error('AI 能力未启用（需要 manifest 声明 ai 权限，且在服务设置中开启）')
  }
  ensureSweep()

  // 恢复已有会话（服务页面重载后用原 conversationId 重连）
  if (opts.conversationId) {
    const existing = conversations.get(convKey(serviceId, opts.conversationId))
    if (existing) {
      existing.sink = sink
      existing.lastActive = Date.now()
      if (opts.system !== undefined) existing.system = opts.system
      console.log('[ServiceAI] === 会话恢复:', serviceId, existing.id, '===')
      return { conversationId: existing.id, resumed: true }
    }
  }

  const count = [...conversations.values()].filter((c) => c.serviceId === serviceId).length
  if (count >= MAX_CONVERSATIONS_PER_SERVICE) {
    throw new Error(`AI 会话数已达上限（${MAX_CONVERSATIONS_PER_SERVICE} 个），请先 close 不再使用的会话`)
  }

  const id =
    opts.conversationId ||
    'ai_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  const conv: ServiceConversation = {
    id,
    serviceId,
    messages: [],
    system: opts.system,
    abort: null,
    running: false,
    lastActive: Date.now(),
    sink,
  }
  conversations.set(convKey(serviceId, id), conv)
  console.log('[ServiceAI] === 会话创建:', serviceId, id, '===')
  return { conversationId: id, resumed: false }
}

/** 发送消息。立即返回 ack；生成过程经 sink 推送 chunk/reasoning/tool/done/error 事件。 */
export async function sendServiceConversationMessage(
  serviceId: string,
  conversationId: string,
  text: string,
): Promise<void> {
  const conv = conversations.get(convKey(serviceId, conversationId))
  if (!conv) throw new Error('会话不存在或已回收，请重新 createConversation')
  if (!conv.sink) throw new Error('会话已断开，请重新 createConversation（带原 conversationId）恢复')
  if (conv.running) throw new Error('上一条消息正在生成中，请等待 done 或先 abort')
  if (!isServiceAiEnabled(serviceId)) throw new Error('AI 能力已被禁用')
  // 立即 ack，生成在后台进行，事件经 sink 推送
  runGeneration(conv, String(text ?? '')).catch((e) => console.warn('[ServiceAI] 生成异常:', e))
}

/** 中止当前生成（保留已产出内容） */
export function abortServiceConversation(serviceId: string, conversationId: string): void {
  conversations.get(convKey(serviceId, conversationId))?.abort?.abort()
}

/** 关闭会话并释放历史 */
export function closeServiceConversation(serviceId: string, conversationId: string): void {
  const key = convKey(serviceId, conversationId)
  const conv = conversations.get(key)
  if (conv) {
    conv.abort?.abort()
    conversations.delete(key)
    console.log('[ServiceAI] 会话关闭:', key)
  }
}

/** 容器卸载：断开该事件出口的所有会话（中止生成，保留历史供恢复） */
export function detachServiceAi(serviceId: string, sink: ServiceAiSink): void {
  for (const conv of conversations.values()) {
    if (conv.serviceId === serviceId && conv.sink === sink) {
      conv.abort?.abort()
      conv.sink = null
    }
  }
}

/** 服务删除：清理其全部 AI 会话（registry.destroyServiceRuntime 收口） */
export function dropServiceAi(serviceId: string): void {
  let dropped = 0
  for (const [key, conv] of conversations) {
    if (conv.serviceId === serviceId) {
      conv.abort?.abort()
      conversations.delete(key)
      dropped++
    }
  }
  if (dropped > 0) console.log('[ServiceAI] 服务会话已清理:', serviceId, `(${dropped} 个)`)
}
