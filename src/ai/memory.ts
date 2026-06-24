// ============================================================
// 变形虫 (Amiba) — 记忆系统 (MEMORY.md / USER.md)
// ============================================================
import type { MemoryToolParams, MemoryOperation } from '../types/service'

const MEMORY_KEY = 'amiba_memory_md'
const USER_KEY = 'amiba_user_md'
const MEMORY_MAX_CHARS = 2200
const USER_MAX_CHARS = 1375
const SEPARATOR = '\n§\n'

function getKey(target: 'memory' | 'user'): string {
  return target === 'memory' ? MEMORY_KEY : USER_KEY
}

function getMaxChars(target: 'memory' | 'user'): number {
  return target === 'memory' ? MEMORY_MAX_CHARS : USER_MAX_CHARS
}

export function getMemory(target: 'memory' | 'user'): string {
  return localStorage.getItem(getKey(target)) || ''
}

export function setMemory(target: 'memory' | 'user', content: string) {
  const maxChars = getMaxChars(target)
  let trimmed = content
  if (trimmed.length > maxChars) {
    // Trim from the beginning to keep newest
    trimmed = '…' + trimmed.slice(trimmed.length - maxChars + 1)
  }
  localStorage.setItem(getKey(target), trimmed)
}

function addEntry(target: 'memory' | 'user', content: string): string {
  const current = getMemory(target)
  const maxChars = getMaxChars(target)

  if (!content.trim()) return 'Error: content is empty'

  const newEntry = `§ ${content.trim()}`
  let result = current ? current + SEPARATOR + newEntry : newEntry

  // Trim if over limit
  while (result.length > maxChars) {
    const idx = result.indexOf(SEPARATOR)
    if (idx < 0) break
    result = result.slice(idx + SEPARATOR.length)
  }

  setMemory(target, result)
  return `已添加到 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'}`
}

function replaceEntry(target: 'memory' | 'user', old_text: string, content: string): string {
  const current = getMemory(target)
  if (!current.includes(old_text)) {
    return `Error: old_text "${old_text}" not found in ${target}`
  }
  const updated = current.replace(old_text, content.trim())
  setMemory(target, updated)
  return `已替换 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'} 中的条目`
}

function removeEntry(target: 'memory' | 'user', old_text: string): string {
  const current = getMemory(target)
  if (!current.includes(old_text)) {
    return `Error: old_text "${old_text}" not found in ${target}`
  }
  // Remove the entry and clean up separators
  let updated = current.replace(old_text, '')
  // Clean up double separators
  updated = updated.replace(new RegExp(SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*' + SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), SEPARATOR)
  updated = updated.replace(/^\n?§\n/, '').replace(/\n§\n?$/, '')
  if (!updated.trim()) updated = ''
  setMemory(target, updated)
  return `已从 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'} 中删除条目`
}

export function executeMemoryOperation(params: MemoryToolParams): string {
  const { target, action, content, old_text, operations } = params

  if (operations && operations.length > 0) {
    // Batch operations
    const results: string[] = []
    for (const op of operations) {
      results.push(executeSingleOp(target, op))
    }
    return results.join('\n')
  }

  if (action) {
    return executeSingleOp(target, { action, content, old_text })
  }

  return 'Error: either action or operations is required'
}

function executeSingleOp(
  target: 'memory' | 'user',
  op: MemoryOperation
): string {
  switch (op.action) {
    case 'add':
      if (!op.content) return 'Error: content is required for add'
      return addEntry(target, op.content)
    case 'replace':
      if (!op.old_text) return 'Error: old_text is required for replace'
      if (!op.content) return 'Error: content is required for replace'
      return replaceEntry(target, op.old_text, op.content)
    case 'remove':
      if (!op.old_text) return 'Error: old_text is required for remove'
      return removeEntry(target, op.old_text)
    default:
      return `Error: unknown action "${(op as any).action}"`
  }
}

export function getMemoryContextForPrompt(): string {
  const memory = getMemory('memory')
  const user = getMemory('user')

  const memPct = memory.length ? Math.round((memory.length / MEMORY_MAX_CHARS) * 100) : 0
  const userPct = user.length ? Math.round((user.length / USER_MAX_CHARS) * 100) : 0

  let ctx = ''

  if (memory) {
    ctx += `══════════════════════════════════════════════\n`
    ctx += `MEMORY (your personal notes) [${memPct}% — ${memory.length}/${MEMORY_MAX_CHARS} chars]\n`
    ctx += `══════════════════════════════════════════════\n`
    ctx += memory + '\n'
  }

  if (user) {
    ctx += `══════════════════════════════════════════════\n`
    ctx += `USER PROFILE (who the user is) [${userPct}% — ${user.length}/${USER_MAX_CHARS} chars]\n`
    ctx += `══════════════════════════════════════════════\n`
    ctx += user + '\n'
  }

  return ctx
}
