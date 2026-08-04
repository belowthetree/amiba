// ============================================================
// 变形虫 (Amiba) — Skill 管理工具（skill_manage_*）
// ============================================================
// 提供 5 个 AI Agent 可调用的 skill 写入工具：
//   skill_manage_create     — 创建新 SKILL.md
//   skill_manage_patch      — 精确查找替换（首选修改方式）
//   skill_manage_edit       — 完整重写 SKILL.md（仅重大重构）
//   skill_manage_delete     — 归档 skill 到 .archive/
//   skill_manage_write_file — 向 skill 目录添加支持文件
//
// 安全门控：
//   - 内置 skill（PROTECTED_BUILTIN_SKILLS）→ 只读，拒绝写入
//   - 用户 skill → 允许全部操作
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  storageGet,
  storageSet,
  storageRemove,
  storageGetJSON,
  storageSetJSON,
} from '../config/storage'
import { parseSkillMd, toSkillSlug, validateFrontmatter } from '../ai/skill-parser'
import { getSkillCommands, scanSkills } from '../ai/skill-commands'

// ---- 受保护内置技能（不可写入） ----

const PROTECTED_BUILTIN_SKILLS = ['counter', 'todo', 'notes', 'service-dev']

function isProtected(slug: string): boolean {
  return PROTECTED_BUILTIN_SKILLS.includes(slug)
}

// ---- 路径辅助 ----

const SKILLS_ROOT = 'skills'
const ARCHIVE_ROOT = 'skills/.archive'

function skillDir(slug: string): string {
  return `${SKILLS_ROOT}/${slug}`
}

function skillMdPath(slug: string): string {
  return `${skillDir(slug)}/SKILL.md`
}

// ---- SKILL.md 读/写（Tauri FS） ----

async function readSkillMd(slug: string): Promise<string | null> {
  try {
    const { readTextFile, BaseDirectory } = await import('../config/native-fs')
    return await readTextFile(skillMdPath(slug), {
      baseDir: BaseDirectory.AppData,
    })
  } catch {
    return null
  }
}

async function writeSkillMd(slug: string, content: string): Promise<void> {
  const { writeTextFile, mkdir, BaseDirectory } = await import(
    '../config/native-fs'
  )
  await mkdir(skillDir(slug), {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  }).catch(() => {})
  await writeTextFile(skillMdPath(slug), content, {
    baseDir: BaseDirectory.AppData,
  })
}

async function removeSkillDir(slug: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('../config/native-fs')
    await remove(skillDir(slug), {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    })
  } catch {}
}

async function skillDirExists(slug: string): Promise<boolean> {
  try {
    const { exists, BaseDirectory } = await import('../config/native-fs')
    return await exists(skillDir(slug), { baseDir: BaseDirectory.AppData })
  } catch {
    return false
  }
}

// ---- 归档辅助 ----

async function moveToArchive(slug: string): Promise<string> {
  const { rename, mkdir, BaseDirectory } = await import('../config/native-fs')
  await mkdir(ARCHIVE_ROOT, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  }).catch(() => {})

  // 处理同名冲突：追加时间戳
  let archiveSlug = slug
  const existing = await skillDirInArchive(archiveSlug)
  if (existing) {
    const ts = Date.now()
    archiveSlug = `${slug}-${ts}`
  }

  await rename(skillDir(slug), `${ARCHIVE_ROOT}/${archiveSlug}`, {
    oldPathBaseDir: BaseDirectory.AppData,
    newPathBaseDir: BaseDirectory.AppData,
  })
  return archiveSlug
}

async function skillDirInArchive(slug: string): Promise<boolean> {
  try {
    const { exists, BaseDirectory } = await import('../config/native-fs')
    return await exists(`${ARCHIVE_ROOT}/${slug}`, {
      baseDir: BaseDirectory.AppData,
    })
  } catch {
    return false
  }
}

// ---- 构建 SKILL.md 内容 ----

function buildSkillMd(frontmatter: {
  name: string
  description: string
  keywords?: string[]
  version?: string
}): string {
  const kw = frontmatter.keywords || []
  return [
    '---',
    `name: ${frontmatter.name}`,
    `description: ${frontmatter.description}`,
    `version: ${frontmatter.version || '1.0.0'}`,
    `keywords: [${kw.join(', ')}]`,
    'platforms: [web, desktop]',
    '---',
    '',
    `# ${frontmatter.name}`,
    '',
    frontmatter.description,
    '',
    '## When to Use',
    '',
    '根据用户需求使用。',
    '',
    '## Procedure',
    '',
    '根据用户指令和参考信息执行。',
    '',
  ].join('\n')
}

// ================================================================
// 工具 1: skill_manage_create
// ================================================================

toolRegistry.register({
  name: 'skill_manage_create',
  toolset: 'skills',
  emoji: '➕',
  description: '创建一个新技能（SKILL.md）。用于记录成功的工作流、克服的错误、或用户要求记住的方法。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'skill_manage_create',
      description:
        '创建一个新的技能文件。当复杂任务成功、错误被克服、用户纠正的方法奏效、或发现值得记录的工作流时使用。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能名称（会转为 slug），如 "Vue 3 项目初始化"',
          },
          description: {
            type: 'string',
            description: '简短描述（≤60 字），用于技能索引展示',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '匹配关键词数组，如 ["vue", "init", "project"]',
          },
          content: {
            type: 'string',
            description:
              'SKILL.md 的完整 Markdown 正文（包含 When to Use / Procedure / Notes 等章节）',
          },
        },
        required: ['name', 'description', 'content'],
      },
    },
  },
  handler: async (args) => {
    const name = String(args.name || '').trim()
    const description = String(args.description || '').trim()
    const keywords: string[] = Array.isArray(args.keywords)
      ? args.keywords.map((k: any) => String(k))
      : []
    const content = String(args.content || '').trim()

    if (!name) return JSON.stringify({ error: 'name 不能为空' })
    if (!description) return JSON.stringify({ error: 'description 不能为空' })
    if (!content) return JSON.stringify({ error: 'content 不能为空' })

    const slug = toSkillSlug(name)
    if (isProtected(slug)) {
      return JSON.stringify({
        error: `"${name}" 是内置技能，不能覆盖。请使用其他名称。`,
      })
    }

    // 检查是否已存在
    const existing = await readSkillMd(slug)
    if (existing) {
      return JSON.stringify({
        error: `技能 "${name}"（slug: ${slug}）已存在。使用 skill_manage_patch 修改或 skill_manage_edit 重写。`,
      })
    }

    // 构建完整 SKILL.md
    const fm = { name, description, keywords }
    const fullMd = buildSkillMd(fm) + '\n' + content

    await writeSkillMd(slug, fullMd)

    // 标记为 agent-created
    const { markAgentCreated } = await import('../ai/skill-usage')
    await markAgentCreated(slug)

    // 刷新技能缓存
    const { scanSkills } = await import('../ai/skill-commands')
    await scanSkills()

    return JSON.stringify({
      ok: true,
      action: 'create',
      slug,
      name,
      message: `技能 "${name}" 已创建 (/${slug})`,
    })
  },
})

// ================================================================
// 工具 2: skill_manage_patch（首选修改方式）
// ================================================================

toolRegistry.register({
  name: 'skill_manage_patch',
  toolset: 'skills',
  emoji: '✏️',
  description: '精确修改技能文件的某一段落（查找替换）。优先使用此工具而非完整重写。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'skill_manage_patch',
      description:
        '在已有技能文件中进行精确的查找替换。先读取 skill_view 确认当前内容，再针对性修改。仅当修改范围大时才用 skill_manage_edit。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能 slug（如 "vue-project-init"）',
          },
          old_string: {
            type: 'string',
            description: '要替换的原文字（必须精确匹配，包含上下文）',
          },
          new_string: {
            type: 'string',
            description: '替换后的新文字',
          },
        },
        required: ['name', 'old_string', 'new_string'],
      },
    },
  },
  handler: async (args) => {
    const slug = String(args.name || '').trim()
    const oldStr = String(args.old_string || '')
    const newStr = String(args.new_string || '')

    if (!slug) return JSON.stringify({ error: 'name 不能为空' })
    if (isProtected(slug)) {
      return JSON.stringify({
        error: `"${slug}" 是内置技能，不能修改。`,
      })
    }

    const raw = await readSkillMd(slug)
    if (!raw) {
      return JSON.stringify({
        error: `技能 "${slug}" 不存在。使用 skill_manage_create 创建。`,
      })
    }

    if (!raw.includes(oldStr)) {
      return JSON.stringify({
        error: `未找到匹配的文字。请用 skill_view 查看当前内容，确认 old_string 精确匹配（含空格和换行）。`,
        hint: 'old_string 必须与 SKILL.md 中的文字完全一致。',
      })
    }

    const updated = raw.replace(oldStr, newStr)
    await writeSkillMd(slug, updated)

    // 记录 patch
    const { bumpPatch } = await import('../ai/skill-usage')
    await bumpPatch(slug)

    return JSON.stringify({
      ok: true,
      action: 'patch',
      slug,
      message: `技能 "${slug}" 已更新（patch）。`,
    })
  },
})

// ================================================================
// 工具 3: skill_manage_edit（完整重写，仅重大重构）
// ================================================================

toolRegistry.register({
  name: 'skill_manage_edit',
  toolset: 'skills',
  emoji: '📝',
  description: '完整重写一个技能的 SKILL.md 内容。仅用于需要大幅度重构时，日常修改请用 skill_manage_patch。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'skill_manage_edit',
      description:
        '完整重写技能文件的 Markdown 正文。保留 frontmatter 不变。仅当修改超过 50% 内容时使用，否则用 patch。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能 slug',
          },
          content: {
            type: 'string',
            description: '新的 Markdown 正文（不含 frontmatter）',
          },
        },
        required: ['name', 'content'],
      },
    },
  },
  handler: async (args) => {
    const slug = String(args.name || '').trim()
    const content = String(args.content || '').trim()

    if (!slug) return JSON.stringify({ error: 'name 不能为空' })
    if (!content) return JSON.stringify({ error: 'content 不能为空' })
    if (isProtected(slug)) {
      return JSON.stringify({
        error: `"${slug}" 是内置技能，不能修改。`,
      })
    }

    const raw = await readSkillMd(slug)
    if (!raw) {
      return JSON.stringify({
        error: `技能 "${slug}" 不存在。使用 skill_manage_create 创建。`,
      })
    }

    // 保留原 frontmatter
    const parsed = parseSkillMd(raw)
    const fm = parsed.frontmatter
    const newRaw = [
      '---',
      `name: ${fm.name}`,
      `description: ${fm.description}`,
      `version: ${fm.version || '1.0.0'}`,
      `keywords: [${(fm.keywords || []).join(', ')}]`,
      'platforms: [web, desktop]',
      '---',
      '',
      `# ${fm.name}`,
      '',
      content,
    ].join('\n')

    await writeSkillMd(slug, newRaw)

    // 记录 patch
    const { bumpPatch } = await import('../ai/skill-usage')
    await bumpPatch(slug)

    return JSON.stringify({
      ok: true,
      action: 'edit',
      slug,
      message: `技能 "${slug}" 已完整重写。`,
    })
  },
})

// ================================================================
// 工具 4: skill_manage_delete（归档）
// ================================================================

toolRegistry.register({
  name: 'skill_manage_delete',
  toolset: 'skills',
  emoji: '🗑️',
  description: '归档一个技能（移到 .archive/，可恢复）。可声明 absorbed_into 说明被哪个技能取代。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'skill_manage_delete',
      description:
        '归档一个技能。技能不会被永久删除，而是移到 .archive/ 目录。当技能被合并到 umbrella skill 时，设置 absorbed_into。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能 slug',
          },
          absorbed_into: {
            type: 'string',
            description: '可选：声明该技能的内容已被合并到哪个 umbrella skill',
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (args) => {
    const slug = String(args.name || '').trim()
    const absorbedInto = args.absorbed_into
      ? String(args.absorbed_into).trim()
      : undefined

    if (!slug) return JSON.stringify({ error: 'name 不能为空' })
    if (isProtected(slug)) {
      return JSON.stringify({
        error: `"${slug}" 是内置技能，不能归档。`,
      })
    }

    const exists = await skillDirExists(slug)
    if (!exists) {
      return JSON.stringify({
        error: `技能 "${slug}" 不存在。`,
      })
    }

    // 检查是否 pinned
    const { getUsage } = await import('../ai/skill-usage')
    const usage = await getUsage()
    const entry = usage[slug]
    if (entry?.pinned) {
      return JSON.stringify({
        error: `技能 "${slug}" 已被固定（pinned），不能归档。请先取消固定。`,
      })
    }

    // 移动到归档
    const archiveSlug = await moveToArchive(slug)

    // 更新 usage 状态
    const { archiveUsage } = await import('../ai/skill-usage')
    await archiveUsage(slug, absorbedInto)

    // 刷新缓存
    const { scanSkills } = await import('../ai/skill-commands')
    await scanSkills()

    return JSON.stringify({
      ok: true,
      action: 'delete',
      slug,
      archivePath: `.archive/${archiveSlug}`,
      absorbed_into: absorbedInto || null,
      message: absorbedInto
        ? `技能 "${slug}" 已归档，内容已合并到 "${absorbedInto}"。`
        : `技能 "${slug}" 已归档。`,
    })
  },
})

// ================================================================
// 工具 5: skill_manage_write_file（添加支持文件）
// ================================================================

toolRegistry.register({
  name: 'skill_manage_write_file',
  toolset: 'skills',
  emoji: '📎',
  description: '向技能目录添加支持文件（如 references/、templates/、scripts/）。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'skill_manage_write_file',
      description:
        '向技能目录写入额外的支持文件，如 references/api-docs.md、templates/boilerplate.html、scripts/setup.sh 等。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能 slug',
          },
          file_path: {
            type: 'string',
            description: '文件相对路径，如 "references/api.md" 或 "templates/index.html"',
          },
          file_content: {
            type: 'string',
            description: '文件内容',
          },
        },
        required: ['name', 'file_path', 'file_content'],
      },
    },
  },
  handler: async (args) => {
    const slug = String(args.name || '').trim()
    const filePath = String(args.file_path || '').trim()
    const fileContent = String(args.file_content || '')

    if (!slug) return JSON.stringify({ error: 'name 不能为空' })
    if (!filePath) return JSON.stringify({ error: 'file_path 不能为空' })

    // 安全检查
    if (filePath.includes('..') || filePath.startsWith('/') || filePath.startsWith('\\')) {
      return JSON.stringify({ error: 'file_path 包含非法字符' })
    }
    if (isProtected(slug)) {
      return JSON.stringify({
        error: `"${slug}" 是内置技能，不能写入文件。`,
      })
    }

    // 确保技能目录存在
    const dirExists = await skillDirExists(slug)
    if (!dirExists) {
      return JSON.stringify({
        error: `技能 "${slug}" 不存在。使用 skill_manage_create 先创建。`,
      })
    }

    const { writeTextFile, mkdir, BaseDirectory } = await import(
      '../config/native-fs'
    )
    const fullPath = `${SKILLS_ROOT}/${slug}/${filePath}`

    // 确保子目录存在
    const dir = filePath.includes('/')
      ? filePath.substring(0, filePath.lastIndexOf('/'))
      : ''
    if (dir) {
      await mkdir(`${SKILLS_ROOT}/${slug}/${dir}`, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      }).catch(() => {})
    }

    await writeTextFile(fullPath, fileContent, {
      baseDir: BaseDirectory.AppData,
    })

    return JSON.stringify({
      ok: true,
      action: 'write_file',
      slug,
      file_path: filePath,
      size_bytes: fileContent.length,
      message: `已写入 ${filePath}（${fileContent.length} 字节）`,
    })
  },
})
