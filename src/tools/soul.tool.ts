// ============================================================
// 变形虫 (Amiba) — Soul 管理工具（soul_save）
// ============================================================
// 允许 AI Agent 在首次引导期间或用户要求时创建/更新人格文件。
// 人格文件存储在 souls/<name>.md，格式为 YAML frontmatter + Markdown。
// ============================================================
import { toolRegistry } from './tool-registry'
import { invalidateSystemPrompt } from '../ai/system-prompt'

// ================================================================
// soul_save — 创建或更新人格文件
// ================================================================

toolRegistry.register({
  name: 'soul_save',
  toolset: 'core',
  emoji: '🧠',
  description:
    '创建或更新 AI 人格配置文件（souls/<name>.md）。用于首次引导完成后固化人格，或用户要求调整 AI 的行为风格。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'soul_save',
      description:
        '保存 AI 人格配置到 souls/<name>.md 文件。在首次引导收集完用户偏好后调用，或用户明确要求修改人格时调用。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '人格文件名（不含扩展名），如 "default"、"coding-expert"',
          },
          label: {
            type: 'string',
            description: '人格显示名称，如 "默认人格"、"编程专家"',
          },
          user_name: {
            type: 'string',
            description: '用户希望被称呼的名字，如 "老大"、"张三"',
          },
          ai_name: {
            type: 'string',
            description: '用户给 AI 取的名字，如 "小助手"、"小变"',
          },
          style: {
            type: 'string',
            description: '职责风格描述，如 "通用助手"、"编程专家"、"效率达人"',
          },
        },
        required: ['name', 'label'],
      },
    },
  },
  handler: async (args) => {
    const name = String(args.name || 'default').trim()
    const label = String(args.label || '默认人格').trim()
    const userName = String(args.user_name || '用户').trim()
    const aiName = String(args.ai_name || 'AI 助手').trim()
    const style = String(args.style || '通用助手').trim()

    // 构建 SOUL.md 内容
    const content = [
      '---',
      `name: ${name}`,
      `label: ${label}`,
      'version: 1.0.0',
      '---',
      '',
      '## Identity',
      '',
      `你是「${aiName}」，变形虫平台的 AI 助手。你的用户希望你称呼 TA 为「${userName}」。`,
      '',
      `你的核心定位是：**${style}**。`,
      '',
      '## Behavior',
      '',
      '- 用中文回复，保持简洁有帮助',
      '- 使用工具时先说明意图',
      '- 不确定时主动承认',
      `- 称呼用户为「${userName}」`,
      '',
      '## Rules',
      '',
      '- 不要编造信息',
      '- 保存记忆前确保内容准确',
      '',
      `## 风格偏好`,
      '',
      `用户期望的风格: ${style}`,
      '',
    ].join('\n')

    // 写入文件
    try {
      const { writeTextFile, mkdir, BaseDirectory } = await import(
        '../config/native-fs'
      )
      const SOUL_DIR = 'souls'
      await mkdir(SOUL_DIR, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      }).catch(() => {})
      await writeTextFile(`${SOUL_DIR}/${name}.md`, content, {
        baseDir: BaseDirectory.AppData,
      })

      // 同时保存 active soul 名称
      await writeTextFile('amiba_active_soul', name, {
        baseDir: BaseDirectory.AppData,
      })

      // 使 system prompt 缓存失效，下次对话生效
      invalidateSystemPrompt()

      console.log(`[SoulTool] 人格已保存: ${name} ("${label}")`)
    } catch (e: any) {
      return JSON.stringify({
        error: `无法保存人格文件: ${e.message || '未知错误'}`,
      })
    }

    return JSON.stringify({
      ok: true,
      action: 'soul_save',
      name,
      label,
      user_name: userName,
      ai_name: aiName,
      style,
      message: `人格「${label}」已保存。AI 将以「${aiName}」的身份称呼用户「${userName}」，风格为「${style}」。`,
    })
  },
})
