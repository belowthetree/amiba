// ============================================================
// 变形虫 (Amiba) — 全局 Agent 执行器
// ============================================================
// 全局单例，拥有 Agent 生命周期。页面切换不影响 Agent 运行。
// ChatPage 只是"观察者"，绑定此模块的响应式状态。
// ============================================================

import { ref } from 'vue'
import { streamChat, buildMessages } from './agent'
import type { ChatMessage } from './agent'
import { i18n } from '../i18n'
import {
  getSession,
  saveHistory,
  addUserMessage,
  addAssistantMessage,
  addToolMessage,
} from './session'
import { detectSlashCommand, buildSkillInvocationMessage } from './skill-commands'

// ---- 响应式状态（ChatPage 只读绑定） ----

/** 当前是否有 Agent 在运行 */
export const running = ref(false)

/** 当前流出的推理文字（思考链） */
export const streamingReasoning = ref('')

/** 是否显示步数限制弹窗 */
export const showStepLimit = ref(false)

/** 已达步数 */
export const stepLimitCount = ref(0)

// ---- 内部状态 ----

let _abortController: AbortController | null = null

// ---- 内部辅助 ----

function t(key: string): string {
  return (i18n.global.t as any)(key) as string
}

/**
 * 核心流式循环：构建 chatMsgs → streamChat → 处理输出。
 * 由 sendMessage / continueGeneration 调用。
 */
async function _streamLoop(chatMsgs: ChatMessage[]): Promise<void> {
  const session = getSession()

  const gen = streamChat(chatMsgs, {
    turnCount: session.turnCount.value,
    abortSignal: _abortController!.signal,
    // 允许注入服务端联网搜索（实际生效取决于默认供应商 protocol/webSearch 开关）
    webSearch: true,
  })

  for await (const chunk of gen) {
    if (chunk.startsWith('\x00REASONING\x00')) {
      streamingReasoning.value += chunk.slice(11)
    } else if (chunk.startsWith('\x00TOOL:') && chunk.endsWith('\x00')) {
      const toolName = chunk.slice(6, -1)
      console.log('[AgentRunner] 🔧', toolName)
      if (session.streamingContent.value || streamingReasoning.value) {
        addAssistantMessage(session.streamingContent.value, streamingReasoning.value || undefined)
        session.streamingContent.value = ''
        streamingReasoning.value = ''
      }
      addToolMessage(toolName)
      saveHistory()
    } else if (chunk.startsWith('\x00STEP_LIMIT:')) {
      const n = parseInt(chunk.split(':')[1])
      if (session.streamingContent.value) {
        addAssistantMessage(session.streamingContent.value, streamingReasoning.value || undefined)
        session.streamingContent.value = ''
        streamingReasoning.value = ''
      }
      stepLimitCount.value = n
      showStepLimit.value = true
    } else {
      session.streamingContent.value += chunk
    }
  }
}

function _startRun(): void {
  const session = getSession()
  running.value = true
  session.sending.value = true
  session.streaming.value = true
  session.streamingContent.value = ''
  streamingReasoning.value = ''
  _abortController = new AbortController()
}

function _finishRun(): void {
  const session = getSession()
  _abortController = null
  session.sending.value = false
  session.streaming.value = false
  session.streamingContent.value = ''
  streamingReasoning.value = ''
  running.value = false
}

// ---- 公开方法 ----

/**
 * 发送用户消息并流式获取 AI 回复。
 * 调用前 ChatPage 已完成：输入校验、API Key 检查、内置命令检查。
 */
export async function sendMessage(text: string): Promise<void> {
  const session = getSession()

  // 1. 添加用户消息
  addUserMessage(text)
  saveHistory()

  // 2. 斜杠命令检测与展开
  let injectedUserMsg: string = text
  if (text.startsWith('/')) {
    const detected = await detectSlashCommand(text)
    if (detected) {
      console.log(`[AgentRunner] === 斜杠命令: /${detected.skill.slug} (${detected.skill.name}) ===`)
      const expanded = await buildSkillInvocationMessage(
        detected.skill.slug,
        detected.userInstruction,
      )
      if (expanded) {
        injectedUserMsg = expanded
      }
    }
  }

  // 3. 设置执行状态
  _startRun()

  try {
    // 4. 构建消息（历史 + 当前用户消息）
    const history = session.messages.value
      .filter((m) => !m.hidden && m.role !== 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const chatMsgs = buildMessages(history.slice(0, -1))
    chatMsgs.push({ role: 'user', content: injectedUserMsg })

    // 5. 流式执行
    await _streamLoop(chatMsgs)

    // 6. 最终保存剩余内容
    if (session.streamingContent.value) {
      addAssistantMessage(session.streamingContent.value, streamingReasoning.value || undefined)
      streamingReasoning.value = ''
      saveHistory()
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      session.errorMessage.value = `${t('chat.errorPrefix')}: ${e.message}`
    }
  } finally {
    _finishRun()
  }
}

/** 中止当前 Agent 生成 */
export function stopGeneration(): void {
  if (_abortController) {
    _abortController.abort()
    _abortController = null
  }
  running.value = false
}

/** 步数限制后继续生成 */
export async function continueGeneration(): Promise<void> {
  const session = getSession()

  showStepLimit.value = false
  const continueMsg = t('chat.stepLimitContinueMsg')
  addUserMessage(continueMsg)
  saveHistory()

  _startRun()

  try {
    // 构建完整历史（不 slice 最后一条，因为 continue 消息已在历史中）
    const history = session.messages.value
      .filter((m) => !m.hidden && m.role !== 'tool')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const chatMsgs = buildMessages(history)

    await _streamLoop(chatMsgs)

    if (session.streamingContent.value) {
      addAssistantMessage(session.streamingContent.value, streamingReasoning.value || undefined)
      streamingReasoning.value = ''
      saveHistory()
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      session.errorMessage.value = `${t('chat.errorPrefix')}: ${e.message}`
    }
  } finally {
    _finishRun()
  }
}

console.log('[AgentRunner] 模块已加载（全局单例）')
