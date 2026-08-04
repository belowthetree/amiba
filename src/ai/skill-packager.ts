// ============================================================
// 变形虫 (Amiba) — SkillPackage 打包/安装引擎
// ============================================================
// 将技能目录打包为 SkillPackage 或还原安装。
// ZIP 导入和局域网分享共用此引擎。
// ============================================================

import type { SkillPackage } from '../types/skill-package'
import { parseSkillMd } from './skill-parser'
import { scanSkills, invalidateSkillCache } from './skill-commands'
import { getUsageEntry } from './skill-usage'

export async function buildSkillPackage(slug: string): Promise<SkillPackage> {
  const { readTextFile, readDir, BaseDirectory } = await import('../config/native-fs')

  const raw = await readTextFile(`skills/${slug}/SKILL.md`, { baseDir: BaseDirectory.AppData })
  const parsed = parseSkillMd(raw)

  const files: Record<string, string> = {}

  async function collectFiles(dir: string, prefix: string) {
    let entries: any[]
    try {
      entries = await readDir(dir, { baseDir: BaseDirectory.AppData })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.name) continue
      if (entry.name === 'SKILL.md') continue
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        await collectFiles(`${dir}/${entry.name}`, relPath)
      } else {
        try {
          const content = await readTextFile(`${dir}/${entry.name}`, { baseDir: BaseDirectory.AppData })
          files[relPath] = content
        } catch { /* skip unreadable files */ }
      }
    }
  }

  await collectFiles(`skills/${slug}`, '')

  const usage = await getUsageEntry(slug)
  const exportedFrom = typeof window !== 'undefined' && '__TAURI__' in window
    ? await (async () => {
        try {
          const { nativeInvoke } = await import('../config/platform-bridge')
          const id: string = await nativeInvoke('network_get_device_id')
          return id
        } catch { return undefined }
      })()
    : undefined

  return {
    formatVersion: 1,
    slug,
    manifest: parsed.frontmatter,
    body: parsed.body,
    files,
    exportedAt: new Date().toISOString(),
    exportedFrom,
  }
}

export async function installSkillPackage(pkg: SkillPackage, onConflict?: 'overwrite'): Promise<string> {
  const { writeTextFile, mkdir, remove, BaseDirectory, exists } = await import('../config/native-fs')

  const slug = pkg.slug

  const targetDir = `skills/${slug}`

  const dirExists = await exists(targetDir, { baseDir: BaseDirectory.AppData }).catch(() => false)

  if (dirExists) {
    if (onConflict === 'overwrite') {
      await remove(targetDir, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
      console.log('[SkillPackager] 覆盖已有技能:', slug)
    } else {
      throw new Error(`Skill "${slug}" 已存在`)
    }
  }

  await mkdir(targetDir, { baseDir: BaseDirectory.AppData, recursive: true })

  const frontmatterYaml = [
    `name: ${pkg.manifest.name}`,
    `description: ${pkg.manifest.description}`,
    pkg.manifest.version ? `version: ${pkg.manifest.version}` : 'version: 1.0.0',
    pkg.manifest.keywords?.length ? `keywords: [${pkg.manifest.keywords.join(', ')}]` : 'keywords: []',
    pkg.manifest.platforms?.length ? `platforms: [${pkg.manifest.platforms.join(', ')}]` : '',
  ].filter(Boolean)

  const skillMd = ['---', ...frontmatterYaml, '---', '', pkg.body].join('\n')

  await writeTextFile(`${targetDir}/SKILL.md`, skillMd, { baseDir: BaseDirectory.AppData })

  for (const [filePath, content] of Object.entries(pkg.files)) {
    const fullPath = `${targetDir}/${filePath}`
    const lastSlash = fullPath.lastIndexOf('/')
    if (lastSlash > 0) {
      const subDir = fullPath.substring(0, lastSlash)
      await mkdir(subDir, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
    }
    await writeTextFile(fullPath, content, { baseDir: BaseDirectory.AppData })
  }

  invalidateSkillCache()
  await scanSkills()

  console.log('[SkillPackager] 安装完成:', slug, '文件数:', Object.keys(pkg.files).length + 1)
  return slug
}
