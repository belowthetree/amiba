// ============================================================
// 变形虫 (Amiba) — 文档索引模块
// ============================================================
// 管理 public/docs/（内置）和 {AppData}/amiba/docs/（用户）目录下的 .md 文档。
// 提供索引、搜索和内容读取能力，供 doc_list/read/search 工具调用。
// ============================================================

// ---- 类型 ----

export interface DocEntry {
  /** 文档相对路径，如 "sandbox.md" */
  path: string
  /** YAML frontmatter 标题 */
  title: string
  /** YAML frontmatter 描述 */
  description: string
  /** YAML frontmatter 关键词 */
  keywords: string[]
  /** 分类: platform | api | guide */
  category: string
  /** 来源: builtin | user */
  source: 'builtin' | 'user'
}

// ---- 缓存 ----

let _index: DocEntry[] | null = null
let _indexPromise: Promise<DocEntry[]> | null = null

// ---- Frontmatter 解析 ----

function parseFrontmatter(
  raw: string
): { frontmatter: Record<string, any>; body: string } | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!match) return null

  const fmBlock = match[1]
  const body = raw.slice(match[0].length)

  const frontmatter: Record<string, any> = {}
  const lines = fmBlock.split('\n')
  let currentKey = ''
  for (const line of lines) {
    const keyMatch = line.match(/^(\w[\w_-]*)\s*:\s*(.*)/)
    if (keyMatch) {
      currentKey = keyMatch[1]
      const val = keyMatch[2].trim()
      if (val.startsWith('[') && val.endsWith(']')) {
        frontmatter[currentKey] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
      } else {
        frontmatter[currentKey] = val.replace(/^['"]|['"]$/g, '')
      }
    } else if (currentKey && frontmatter[currentKey] !== undefined) {
      // multi-line continuation (simplified)
    }
  }

  return { frontmatter, body }
}

function normalizeEntry(
  path: string,
  fm: Record<string, any>,
  source: 'builtin' | 'user'
): DocEntry {
  const title = fm.title || fm.name || path.replace(/\.md$/, '')
  return {
    path,
    title: String(title),
    description: String(fm.description || ''),
    keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
    category: String(fm.category || 'guide'),
    source,
  }
}

// ---- 扫描内置文档（public/docs/） ----

async function scanBuiltinDocs(): Promise<DocEntry[]> {
  const entries: DocEntry[] = []
  const builtinFiles = ['sandbox.md', 'jbridge.md', 'network.md', 'room.md', 'storage.md', 'widgets.md', 'ui-customization.md', 'service-style.md', 'desktop-widgets.md']

  for (const file of builtinFiles) {
    try {
      const resp = await fetch(`/docs/${file}`)
      if (!resp.ok) continue
      const raw = await resp.text()
      const parsed = parseFrontmatter(raw)
      if (parsed) {
        entries.push(normalizeEntry(file, parsed.frontmatter, 'builtin'))
      }
    } catch {
      console.warn(`[DocIndex] 加载内置文档 ${file} 失败`)
    }
  }

  return entries
}

// ---- 扫描用户文档（{AppData}/amiba/docs/） ----

async function scanUserDocs(): Promise<DocEntry[]> {
  const entries: DocEntry[] = []

  try {
    const { readDir, readTextFile, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    )
    const docsRoot = 'amiba/docs'

    const userFiles: string[] = []
    try {
      const dirEntries = await readDir(docsRoot, {
        baseDir: BaseDirectory.AppData,
      })
      for (const entry of dirEntries as any[]) {
        if (entry.name?.endsWith('.md')) {
          userFiles.push(entry.name)
        }
      }
    } catch {
      // 目录不存在，无用户文档
      return entries
    }

    for (const file of userFiles) {
      try {
        const raw = await readTextFile(`${docsRoot}/${file}`, {
          baseDir: BaseDirectory.AppData,
        })
        const parsed = parseFrontmatter(raw)
        if (parsed) {
          entries.push(normalizeEntry(file, parsed.frontmatter, 'user'))
        }
      } catch {
        console.warn(`[DocIndex] 加载用户文档 ${file} 失败`)
      }
    }
  } catch {
    // 非 Tauri 环境
  }

  return entries
}

// ---- 公共 API ----

/**
 * 获取文档索引（首次加载后缓存）
 * 用户文档优先覆盖同名内置文档
 */
export async function getDocIndex(): Promise<DocEntry[]> {
  if (_index) return _index
  if (_indexPromise) return _indexPromise

  _indexPromise = (async () => {
    const builtin = await scanBuiltinDocs()
    const user = await scanUserDocs()

    // 用户文档覆盖同名内置
    const merged = new Map<string, DocEntry>()
    for (const entry of builtin) {
      merged.set(entry.path, entry)
    }
    for (const entry of user) {
      merged.set(entry.path, entry)
    }

    _index = [...merged.values()]
    console.log(`[DocIndex] 索引完成: ${_index.length} 份文档 (内置 ${builtin.length}, 用户 ${user.length})`)
    return _index
  })()

  return _indexPromise
}

/**
 * 读取文档完整内容
 */
export async function getDocContent(path: string): Promise<string | null> {
  if (!path || path.includes('..') || path.includes('/')) {
    return null
  }

  // 尝试用户文档
  try {
    const { readTextFile, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    )
    const raw = await readTextFile(`amiba/docs/${path}`, {
      baseDir: BaseDirectory.AppData,
    })
    if (raw) return raw
  } catch {
    /* fall through to builtin */
  }

  // 回退内置文档
  try {
    const resp = await fetch(`/docs/${path}`)
    if (resp.ok) return await resp.text()
  } catch {
    /* not found */
  }

  return null
}

/**
 * 强制重建缓存
 */
export async function refreshDocIndex(): Promise<void> {
  _index = null
  _indexPromise = null
  await getDocIndex()
}

// ---- 搜索 ----

export interface SearchResult {
  entry: DocEntry
  snippets: string[]
  score: number
}

/**
 * 搜索文档：匹配 title + keywords + 正文
 */
export async function searchDocs(
  keyword: string,
  maxResults = 5
): Promise<SearchResult[]> {
  const kw = keyword.toLowerCase().trim()
  if (!kw) return []

  const index = await getDocIndex()
  const results: SearchResult[] = []

  for (const entry of index) {
    const snippets: string[] = []
    let score = 0

    // 标题匹配
    if (entry.title.toLowerCase().includes(kw)) {
      score += 10
      snippets.push(`标题: ${entry.title}`)
    }

    // 关键词匹配
    const kwMatch = entry.keywords.filter((k) => k.toLowerCase().includes(kw))
    if (kwMatch.length > 0) {
      score += 8
      snippets.push(`关键词: ${kwMatch.join(', ')}`)
    }

    // 描述匹配
    if (entry.description.toLowerCase().includes(kw)) {
      score += 5
      snippets.push(entry.description)
    }

    // 正文匹配（前 4000 字）
    try {
      const content = await getDocContent(entry.path)
      if (content) {
        const body = content.slice(0, 4000).toLowerCase()
        let idx = body.indexOf(kw)
        const bodySnippets: string[] = []
        while (idx !== -1 && bodySnippets.length < 3) {
          const start = Math.max(0, idx - 40)
          const end = Math.min(body.length, idx + kw.length + 40)
          const snippet = content.slice(start, end).replace(/\n/g, ' ')
          bodySnippets.push(`...${snippet}...`)
          score += 3
          idx = body.indexOf(kw, idx + 1)
        }
        snippets.push(...bodySnippets)
      }
    } catch {
      // 读取失败不影响搜索
    }

    if (score > 0) {
      results.push({ entry, snippets, score })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, maxResults)
}
