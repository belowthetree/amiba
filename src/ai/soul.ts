// ============================================================
// 变形虫 (Amiba) — 人格系统（SOUL.md）
// ============================================================
// 基于 soul.md 设计：
// - 每个人格是一个 souls/<name>.md 文件
// - SoulManager 管理加载/切换/列表/创建
// - 切换人格 → invalidateSystemPrompt → 下一轮对话生效
// ============================================================
import { invalidateSystemPrompt } from './system-prompt'
import { parseSkillMd } from './skill-parser'

const SOUL_DIR = 'souls/'
const ACTIVE_SOUL_KEY = 'amiba_active_soul'

export interface Soul {
  name: string
  label: string
  filePath: string
  rawContent: string
  frontmatter: Record<string, any>
}

// ---- 默认 SOUL ----

export const DEFAULT_SOUL_CONTENT = `---
name: default
label: 默认人格
version: 1.0.0
---

## Identity

你是变形虫平台的 AI 助手。你的用户正在与你对话。

## Behavior

- 用中文回复，保持简洁有帮助
- 使用工具时先说明意图
- 不确定时主动承认

## Rules

- 不要编造信息
- 保存记忆前确保内容准确
`

// ---- SoulManager ----

export class SoulManager {
  private currentSoul: Soul | null = null

  async init(): Promise<void> {
    try {
      const { BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const activeName =
        (await this.readActiveName()) || 'default'
      await this.loadSoul(activeName)
      console.log(`[Soul] 当前人格: ${this.currentSoul?.label || 'default'}`)
    } catch {
      this.currentSoul = {
        name: 'default',
        label: '默认人格',
        filePath: '',
        rawContent: DEFAULT_SOUL_CONTENT,
        frontmatter: { name: 'default', label: '默认人格' },
      }
      console.log('[Soul] 浏览器模式，使用默认人格')
    }
  }

  async loadSoul(name: string): Promise<Soul> {
    let raw: string
    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      raw = await readTextFile(`${SOUL_DIR}${name}.md`, {
        baseDir: BaseDirectory.AppData,
      })
    } catch {
      raw = DEFAULT_SOUL_CONTENT
    }

    const parsed = parseSkillMd(raw)
    this.currentSoul = {
      name,
      label: parsed.frontmatter.label || name,
      filePath: `${SOUL_DIR}${name}.md`,
      rawContent: raw,
      frontmatter: parsed.frontmatter || {},
    }

    await this.saveActiveName(name)
    invalidateSystemPrompt()
    return this.currentSoul
  }

  getCurrentContent(): string {
    return this.currentSoul?.rawContent || DEFAULT_SOUL_CONTENT
  }

  getCurrentName(): string {
    return this.currentSoul?.name || 'default'
  }

  async listSouls(): Promise<Pick<Soul, 'name' | 'label' | 'frontmatter'>[]> {
    try {
      const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const entries = await readDir(SOUL_DIR, { baseDir: BaseDirectory.AppData })
      const souls: Pick<Soul, 'name' | 'label' | 'frontmatter'>[] = []
      for (const e of entries as any[]) {
        if (!e.name?.endsWith('.md')) continue
        const name = e.name.replace(/\.md$/, '')
        try {
          const { readTextFile } = await import('@tauri-apps/plugin-fs')
          const raw = await readTextFile(`${SOUL_DIR}${e.name}`, {
            baseDir: BaseDirectory.AppData,
          })
          const p = parseSkillMd(raw)
          souls.push({ name, label: p.frontmatter.label || name, frontmatter: p.frontmatter || {} })
        } catch {
          souls.push({ name, label: name, frontmatter: {} })
        }
      }
      return souls
    } catch {
      return [{ name: 'default', label: '默认人格', frontmatter: {} }]
    }
  }

  async saveSoul(name: string, content: string): Promise<void> {
    try {
      const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      await mkdir(SOUL_DIR, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
      await writeTextFile(`${SOUL_DIR}${name}.md`, content, { baseDir: BaseDirectory.AppData })
    } catch {
      throw new Error('无法保存人格文件（非 Tauri 环境）')
    }
    if (this.currentSoul?.name === name) {
      this.currentSoul.rawContent = content
      invalidateSystemPrompt()
    }
  }

  async ensureDefaultSoul(): Promise<void> {
    try {
      const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const ok = await exists(`${SOUL_DIR}default.md`, { baseDir: BaseDirectory.AppData })
      if (!ok) {
        await this.saveSoul('default', DEFAULT_SOUL_CONTENT)
        console.log('[Soul] 已创建默认人格文件')
      }
    } catch { /* 浏览器模式 */ }
  }

  /** 首次启动引导：检查是否需要创建人格 */
  async isFirstLaunch(): Promise<boolean> {
    try {
      const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const ok = await exists(`${SOUL_DIR}default.md`, { baseDir: BaseDirectory.AppData })
      return !ok
    } catch {
      return false
    }
  }

  /** 生成首次引导指令（注入 system prompt） */
  getOnboardingDirective(): string {
    return `[系统指令: 这是用户首次使用。请**逐步**引导用户完成以下步骤，**每次只问一个问题**，等用户回复后再问下一个:

第1步: 先打招呼，然后问用户希望你怎么称呼 TA（姓名或昵称）
→ 等用户回复后

第2步: 问用户希望给你取什么名字（如"小助手"、"代码伙伴"等）
→ 等用户回复后

第3步: 确认你的主要职责和风格（如"通用助手"、"编程专家"等）

全部完成后，使用 memory 工具保存:
- target='user', action='add', content='用户称呼: [用户的回答]'
并告知用户可以在设置中修改人格。如果用户跳过或回答模糊，使用默认值。`
  }

  private async readActiveName(): Promise<string | null> {
    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      return await readTextFile(ACTIVE_SOUL_KEY, { baseDir: BaseDirectory.AppData })
    } catch { return null }
  }

  private async saveActiveName(name: string): Promise<void> {
    try {
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(ACTIVE_SOUL_KEY, name, { baseDir: BaseDirectory.AppData })
    } catch { /* 浏览器模式 */ }
  }
}

export const soulManager = new SoulManager()
