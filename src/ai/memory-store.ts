// ============================================================
// 变形虫 (Amiba) — MemoryStore（记忆写入引擎）
// ============================================================
// 根据 memory_write.md 设计：唯一写入路径 — Agent 调用 memory 工具
// → MemoryStore 即时持久化到 Tauri FS。不做自动推断。
// ============================================================
import { storageGet, storageSet } from '../config/storage'
import type { MemoryToolParams, MemoryOperation } from '../types/service'

const MEMORY_KEY = 'amiba_memory_md'
const USER_KEY = 'amiba_user_md'
const MEMORY_MAX_CHARS = 2200
const USER_MAX_CHARS = 1375
const SEPARATOR = '\n\u00a7\n'

function getKey(target: 'memory' | 'user'): string {
  return target === 'memory' ? MEMORY_KEY : USER_KEY
}

function getMaxChars(target: 'memory' | 'user'): number {
  return target === 'memory' ? MEMORY_MAX_CHARS : USER_MAX_CHARS
}

export class MemoryStore {
  private memoryCache = ''
  private userCache = ''

  // ---- 初始化 ----

  async init(): Promise<void> {
    this.memoryCache = (await storageGet(MEMORY_KEY)) || ''
    this.userCache = (await storageGet(USER_KEY)) || ''
    console.log(
      `[MemoryStore] 初始化 — MEMORY ${this.memoryCache.length}/${MEMORY_MAX_CHARS} chars, USER ${this.userCache.length}/${USER_MAX_CHARS} chars`
    )
  }

  // ---- 读取 ----

  get(target: 'memory' | 'user'): string {
    return target === 'memory' ? this.memoryCache : this.userCache
  }

  /** 直接设置内容（用于 MemoryPage 手动编辑场景） */
  async setRaw(target: 'memory' | 'user', content: string): Promise<void> {
    await this.persist(target, content)
  }

  /** 构建注入 system prompt 的记忆上下文 */
  getContextForPrompt(): string {
    const memPct = this.memoryCache.length
      ? Math.round((this.memoryCache.length / MEMORY_MAX_CHARS) * 100)
      : 0
    const userPct = this.userCache.length
      ? Math.round((this.userCache.length / USER_MAX_CHARS) * 100)
      : 0

    let ctx = ''

    if (this.memoryCache) {
      ctx += `${'═'.repeat(55)}\n`
      ctx += `MEMORY (your personal notes) [${memPct}% — ${this.memoryCache.length}/${MEMORY_MAX_CHARS} chars]\n`
      ctx += `${'═'.repeat(55)}\n`
      ctx += this.memoryCache + '\n'
    }

    if (this.userCache) {
      ctx += `${'═'.repeat(55)}\n`
      ctx += `USER PROFILE (who the user is) [${userPct}% — ${this.userCache.length}/${USER_MAX_CHARS} chars]\n`
      ctx += `${'═'.repeat(55)}\n`
      ctx += this.userCache + '\n'
    }

    return ctx
  }

  // ---- 写入（即时持久化） ----

  async executeOperation(params: MemoryToolParams): Promise<string> {
    const { target, action, content, old_text, operations } = params

    if (operations && operations.length > 0) {
      const results: string[] = []
      for (const op of operations) {
        results.push(await this.executeSingleOp(target, op))
      }
      await this.reloadCache(target)
      return results.join('\n')
    }

    if (action) {
      const result = await this.executeSingleOp(target, {
        action,
        content,
        old_text,
      })
      await this.reloadCache(target)
      return result
    }

    return 'Error: either action or operations is required'
  }

  private async executeSingleOp(
    target: 'memory' | 'user',
    op: MemoryOperation
  ): Promise<string> {
    switch (op.action) {
      case 'add':
        if (!op.content) return 'Error: content is required for add'
        return await this.addEntry(target, op.content)
      case 'replace':
        if (!op.old_text) return 'Error: old_text is required for replace'
        if (!op.content) return 'Error: content is required for replace'
        return await this.replaceEntry(target, op.old_text, op.content)
      case 'remove':
        if (!op.old_text) return 'Error: old_text is required for remove'
        return await this.removeEntry(target, op.old_text)
      default:
        return `Error: unknown action "${(op as any).action}"`
    }
  }

  private async addEntry(
    target: 'memory' | 'user',
    content: string
  ): Promise<string> {
    const current = this.get(target)
    const maxChars = getMaxChars(target)

    if (!content.trim()) return 'Error: content is empty'

    const newEntry = `\u00a7 ${content.trim()}`
    let result = current ? current + SEPARATOR + newEntry : newEntry

    while (result.length > maxChars) {
      const idx = result.indexOf(SEPARATOR)
      if (idx < 0) break
      result = result.slice(idx + SEPARATOR.length)
    }

    await this.persist(target, result)
    return `已添加到 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'}`
  }

  private async replaceEntry(
    target: 'memory' | 'user',
    oldText: string,
    content: string
  ): Promise<string> {
    const current = this.get(target)
    if (!current.includes(oldText)) {
      return `Error: old_text "${oldText}" not found in ${target}`
    }
    const updated = current.replace(oldText, content.trim())
    await this.persist(target, updated)
    return `已替换 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'} 中的条目`
  }

  private async removeEntry(
    target: 'memory' | 'user',
    oldText: string
  ): Promise<string> {
    const current = this.get(target)
    if (!current.includes(oldText)) {
      return `Error: old_text "${oldText}" not found in ${target}`
    }
    const entries = current
      .split(SEPARATOR)
      .filter((e) => !e.includes(oldText))
    const updated = entries.join(SEPARATOR)
    await this.persist(target, updated || '')
    return `已从 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'} 中删除条目`
  }

  // ---- 持久化 ----

  private async persist(target: 'memory' | 'user', content: string): Promise<void> {
    const maxChars = getMaxChars(target)
    let trimmed = content
    if (trimmed.length > maxChars) {
      trimmed = '\u2026' + trimmed.slice(trimmed.length - maxChars + 1)
    }
    await storageSet(getKey(target), trimmed)
    // 即时更新缓存
    if (target === 'memory') this.memoryCache = trimmed
    else this.userCache = trimmed
  }

  /** 重新加载单个目标到缓存 */
  private async reloadCache(target: 'memory' | 'user'): Promise<void> {
    const raw = (await storageGet(getKey(target))) || ''
    if (target === 'memory') this.memoryCache = raw
    else this.userCache = raw
  }

  // ---- 查询 ----

  getMemorySize(): number {
    return this.memoryCache.length
  }

  getUserSize(): number {
    return this.userCache.length
  }
}

/** 全局单例 */
export const memoryStore = new MemoryStore()
