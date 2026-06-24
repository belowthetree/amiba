// ============================================================
// 变形虫 (Amiba) — 记忆系统 (MEMORY.md / USER.md)
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

export async function getMemory(target: 'memory' | 'user'): Promise<string> {
  return (await storageGet(getKey(target))) || ''
}

export async function setMemory(target: 'memory' | 'user', content: string) {
  const maxChars = getMaxChars(target)
  let trimmed = content
  if (trimmed.length > maxChars) {
    trimmed = '\u2026' + trimmed.slice(trimmed.length - maxChars + 1)
  }
  await storageSet(getKey(target), trimmed)
}

async function addEntry(target: 'memory' | 'user', content: string): Promise<string> {
  const current = await getMemory(target)
  const maxChars = getMaxChars(target)

  if (!content.trim()) return 'Error: content is empty'

  const newEntry = `\u00a7 ${content.trim()}`
  let result = current ? current + SEPARATOR + newEntry : newEntry

  while (result.length > maxChars) {
    const idx = result.indexOf(SEPARATOR)
    if (idx < 0) break
    result = result.slice(idx + SEPARATOR.length)
  }

  await setMemory(target, result)
  return `已添加到 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'}`
}

async function replaceEntry(target: 'memory' | 'user', old_text: string, content: string): Promise<string> {
  const current = await getMemory(target)
  if (!current.includes(old_text)) {
    return `Error: old_text "${old_text}" not found in ${target}`
  }
  const updated = current.replace(old_text, content.trim())
  await setMemory(target, updated)
  return `已替换 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'} 中的条目`
}

async function removeEntry(target: 'memory' | 'user', old_text: string): Promise<string> {
  const current = await getMemory(target)
  if (!current.includes(old_text)) {
    return `Error: old_text "${old_text}" not found in ${target}`
  }
  // Split by separator, filter out the matching entry, rejoin
  const entries = current.split(SEPARATOR).filter(e => !e.includes(old_text))
  const updated = entries.join(SEPARATOR)
  if (!updated.trim()) {
    await setMemory(target, '')
  } else {
    await setMemory(target, updated)
  }
  return `已从 ${target === 'memory' ? 'MEMORY.md' : 'USER.md'} 中删除条目`
}

export async function executeMemoryOperation(params: MemoryToolParams): Promise<string> {
  const { target, action, content, old_text, operations } = params

  if (operations && operations.length > 0) {
    const results: string[] = []
    for (const op of operations) {
      results.push(await executeSingleOp(target, op))
    }
    return results.join('\n')
  }

  if (action) {
    return await executeSingleOp(target, { action, content, old_text })
  }

  return 'Error: either action or operations is required'
}

async function executeSingleOp(
  target: 'memory' | 'user',
  op: MemoryOperation
): Promise<string> {
  switch (op.action) {
    case 'add':
      if (!op.content) return 'Error: content is required for add'
      return await addEntry(target, op.content)
    case 'replace':
      if (!op.old_text) return 'Error: old_text is required for replace'
      if (!op.content) return 'Error: content is required for replace'
      return await replaceEntry(target, op.old_text, op.content)
    case 'remove':
      if (!op.old_text) return 'Error: old_text is required for remove'
      return await removeEntry(target, op.old_text)
    default:
      return `Error: unknown action "${(op as any).action}"`
  }
}

// Cache for sync access (used by agent's system prompt)
let memoryCache = ''
let userCache = ''

export async function refreshMemoryCache() {
  memoryCache = await getMemory('memory')
  userCache = await getMemory('user')
}

export function getMemoryContextForPrompt(): string {
  const memPct = memoryCache.length ? Math.round((memoryCache.length / MEMORY_MAX_CHARS) * 100) : 0
  const userPct = userCache.length ? Math.round((userCache.length / USER_MAX_CHARS) * 100) : 0

  let ctx = ''

  if (memoryCache) {
    ctx += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`
    ctx += `MEMORY (your personal notes) [${memPct}% — ${memoryCache.length}/${MEMORY_MAX_CHARS} chars]\n`
    ctx += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`
    ctx += memoryCache + '\n'
  }

  if (userCache) {
    ctx += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`
    ctx += `USER PROFILE (who the user is) [${userPct}% — ${userCache.length}/${USER_MAX_CHARS} chars]\n`
    ctx += `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n`
    ctx += userCache + '\n'
  }

  return ctx
}
