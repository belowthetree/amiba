// ============================================================
// 变形虫 (Amiba) — Skill 审查引擎
// ============================================================
// 借鉴 Hermes background_review.py 的审查 Agent 设计。
// 在多个触发点 fork 独立 LLM 调用，审查对话内容，自动维护 skill 库。
//
// 触发点：
//   session_end  — /new 时审查旧会话
//   manual       — /review 命令
//   curator      — 7 天 curator 运行时附带
//   mid_session  — 超过 20 轮时后台审查
// ============================================================

import { ref, type Ref } from 'vue'
import { generateText, isStepCount } from 'ai'
import { getSettings, getApiKey } from '../config/config'
import { buildSystemPrompt } from './system-prompt'
import { toAISdkTools } from '../tools/toolsets'
import { createModelFromConfig } from './provider-factory'

/** 是否正在执行审查（ChatPage 用于显示进度指示器和禁用输入） */
export const isReviewing: Ref<boolean> = ref(false)

/** 最近一次审查结果（ChatPage 用于显示完成汇总） */
export const lastReviewResult: Ref<ReviewResult | null> = ref(null)

export type ReviewTrigger = 'session_end' | 'manual' | 'curator' | 'mid_session'

export interface ReviewResult {
  ran: boolean
  trigger: ReviewTrigger
  skillsCreated: number
  skillsPatched: number
  skillsDeleted: number
  summary: string
  error?: string
}

// ---- 审查专用 System Prompt ----

const REVIEW_PROMPT = `## Skill 审查模式

你是 Amiba 的 **Skill 审查员**。你的任务是审查对话记录，判断是否需要创建或更新 skill。

### 可用工具
- skills_list — 列出所有 skill
- skill_view — 查看 skill 详情
- skill_manage_create — 创建新 skill
- skill_manage_patch — 精确修补已有 skill
- skill_manage_delete — 归档无用 skill

### 审查规则（按优先级）

**1. PATCH 已存在的 skill**（最高优先）
- 对话中加载/使用过的 skill 有错误、过时、不完整 → 立即修补
- 用户纠正过你的做法 → 把纠正固化到 skill 中

**2. CREATE 新 skill**
- 完成了 5+ 步的复杂任务 → 创建 skill 记录流程
- 发现了可复用的技巧、配置、命令序列

**3. DELETE 过时 skill**
- 某个 skill 完全被另一个取代 → 归档（设 absorbed_into）

**4. 什么都不做**
- 对话太短、没有新知识、纯信息查询
- 输出 "审查完成：无需更新。"

### 不要记录
- 环境相关的一次性错误（缺依赖、网络问题）
- "X 坏了 / 不能用" 这类否定性声明
- 单次任务（"帮我查 X"）

### 风格要求
- 新 skill 命名用类级别（如 "deploy-railway"），不用单次任务名
- patch 优先于 create
- 中文，简洁
`

// ---- 审查引擎 ----

const MIN_MESSAGES = 5

export async function forkReviewAgent(
  messages: { role: string; content: string }[],
  trigger: ReviewTrigger,
  loadedSkillSlugs: string[] = [],
): Promise<ReviewResult> {
  // 防止并发审查
  if (isReviewing.value) {
    return {
      ran: false,
      trigger,
      skillsCreated: 0,
      skillsPatched: 0,
      skillsDeleted: 0,
      summary: `跳过：已有审查在进行中`,
    }
  }

  const visibleMessages = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && !m.content.startsWith('/'),
  )

  if (visibleMessages.length < MIN_MESSAGES) {
    const skipResult: ReviewResult = {
      ran: false,
      trigger,
      skillsCreated: 0,
      skillsPatched: 0,
      skillsDeleted: 0,
      summary: `跳过：消息不足（${visibleMessages.length} < ${MIN_MESSAGES}）`,
    }
    lastReviewResult.value = skipResult
    return skipResult
  }

  const s = getSettings()
  const apiKey = await getApiKey()
  if (!apiKey) {
    const errResult: ReviewResult = { ran: false, trigger, skillsCreated: 0, skillsPatched: 0, skillsDeleted: 0, summary: '', error: 'No API key' }
    lastReviewResult.value = errResult
    return errResult
  }

  // 仅用户感知的触发（手动或会话结束）才在 UI 显示进度
  // mid_session / curator 是后台维护，不阻塞 UI
  const isUserFacing = trigger === 'manual' || trigger === 'session_end'
  if (isUserFacing) {
    isReviewing.value = true
  }
  console.log(`[SkillReviewer] 🔍 开始审查 (${trigger})...`)

  // === AI SDK: 创建 provider + model ===
  const { model: languageModel } = createModelFromConfig(s.ai_base_url, apiKey, s.ai_model)

  // 限制工具：只看 skill 管理
  const reviewToolset = 'review'
  const tools = toAISdkTools([reviewToolset])

  // 构建对话摘要（取最近 30 条，截断过长内容）
  const conversationSummary = visibleMessages
    .slice(-30)
    .map((m) => `[${m.role === 'user' ? '用户' : 'AI'}]: ${m.content.slice(0, 300)}`)
    .join('\n\n')

  // 根据 trigger 微调 prompt
  let triggerNote = ''
  switch (trigger) {
    case 'session_end':
      triggerNote = '\n这是一个完整的会话，请全面审查。'
      break
    case 'mid_session':
      triggerNote = '\n这是对话中段（仍在进行）。只做明显的修补，不要创建新 skill（信息可能不完整）。'
      break
    case 'curator':
      triggerNote = '\n这是定期维护审查。重点检查长期未用的 skill 是否需要归档，或是否有多个 skill 可以合并。'
      break
  }

  const systemMsg = `${
    buildSystemPrompt({ enabledToolsets: [reviewToolset], force: true }).split('\n\n').slice(1).join('\n\n')
  }\n\n${REVIEW_PROMPT}${triggerNote}`

  try {
    const result = await generateText({
      model: languageModel,
      messages: [
        { role: 'user', content: `请审查以下对话，必要时更新 skill：\n\n${conversationSummary}\n\n开始审查。` },
      ],
      instructions: systemMsg,
      tools,
      stopWhen: isStepCount(5),
    })

    let skillsCreated = 0
    let skillsPatched = 0
    let skillsDeleted = 0
    const allSteps = await result.steps

    for (const step of allSteps) {
      for (const tc of step.toolCalls) {
        if (tc.toolName === 'skill_manage_create') skillsCreated++
        else if (tc.toolName === 'skill_manage_patch' || tc.toolName === 'skill_manage_edit') skillsPatched++
        else if (tc.toolName === 'skill_manage_delete') skillsDeleted++
      }
    }

    const summary = (await result.text).slice(0, 500)

    const reviewResult: ReviewResult = {
      ran: true,
      trigger,
      skillsCreated,
      skillsPatched,
      skillsDeleted,
      summary,
    }

    console.log(
      `[SkillReviewer] 审查完成 (${trigger}): ` +
      `创建 ${skillsCreated}, 修补 ${skillsPatched}, 删除 ${skillsDeleted}`,
    )

    lastReviewResult.value = reviewResult
    return reviewResult
  } catch (e: any) {
    console.error('[SkillReviewer] 审查失败:', e)
    const errResult: ReviewResult = {
      ran: true,
      trigger,
      skillsCreated: 0,
      skillsPatched: 0,
      skillsDeleted: 0,
      summary: '',
      error: e.message || String(e),
    }
    lastReviewResult.value = errResult
    return errResult
  } finally {
    if (isUserFacing) {
      isReviewing.value = false
    }
  }
}
