// ============================================================
// 变形虫 (Amiba) — Skill ZIP 导入/导出
// ============================================================
// 基于 JSZip，支持 Tauri 和浏览器双环境。
// 导入：ZIP → SkillPackage → 安装写入
// 导出：buildSkillPackage → JSZip → 保存到磁盘
// ============================================================

import { buildSkillPackage, installSkillPackage } from './skill-packager'
import { toSkillSlug } from './skill-parser'
import type { SkillPackage } from '../types/skill-package'

/**
 * 从 ZIP File / Blob / URL / 文件路径 导入技能
 * 在 Tauri 环境下，先通过 dialog.open 获取文件路径，再 readFile 读取二进制数据
 * 在浏览器环境下，通过 <input type="file"> 获取 File 对象
 */
export async function importSkillFromZip(
  data: Blob | Uint8Array | string
): Promise<string> {
  const JSZip = (await import('jszip')).default

  let zip: any
  if (data instanceof Blob) {
    const buf = await data.arrayBuffer()
    zip = await JSZip.loadAsync(buf)
  } else if (data instanceof Uint8Array) {
    zip = await JSZip.loadAsync(data)
  } else if (typeof data === 'string') {
    // 文件路径（Tauri 环境），读取二进制
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(data)
    zip = await JSZip.loadAsync(bytes)
  } else {
    throw new Error('不支持的输入类型')
  }

  // 1. 找到 SKILL.md
  const skillMdFile = zip.file('SKILL.md')
  if (!skillMdFile || skillMdFile.length === 0) {
    // 尝试在一级子目录中查找（兼容 zip 内含文件夹的结构）
    let foundSkill: any = null
    let foundPrefix = ''
    for (const [path, entry] of Object.entries(zip.files) as [string, any][]) {
      if (entry.dir) continue
      const parts = path.split('/')
      if (parts.length === 2 && parts[1] === 'SKILL.md') {
        foundSkill = entry
        foundPrefix = parts[0] + '/'
        break
      }
    }
    if (!foundSkill) {
      throw new Error('ZIP 中没有找到 SKILL.md')
    }
    return await importFromZipRoot(zip, foundSkill, foundPrefix)
  }

  return await importFromZipRoot(zip, skillMdFile, '')
}

async function importFromZipRoot(zip: any, skillMdEntry: any, prefix: string): Promise<string> {
  const skillMdRaw = await skillMdEntry.async('string')

  const { parseSkillMd } = await import('./skill-parser')
  const parsed = parseSkillMd(skillMdRaw)

  if (!parsed.frontmatter.name) {
    throw new Error('SKILL.md 缺少 name 字段')
  }

  // 确定 slug
  let slug = toSkillSlug(parsed.frontmatter.name)

  // 收集支持文件
  const files: Record<string, string> = {}
  for (const [path, entry] of Object.entries(zip.files) as [string, any][]) {
    if (entry.dir) continue
    if (path === prefix + 'SKILL.md') continue

    let relPath = path
    if (prefix && path.startsWith(prefix)) {
      relPath = path.slice(prefix.length)
    }
    if (!relPath) continue

    const content = await entry.async('string')
    files[relPath] = content
  }

  const pkg: SkillPackage = {
    formatVersion: 1,
    slug,
    manifest: parsed.frontmatter,
    body: parsed.body,
    files,
    exportedAt: new Date().toISOString(),
  }

  return await installSkillPackage(pkg, 'overwrite')
}

/**
 * 导出技能为 ZIP Blob（浏览器环境）或 Uint8Array（Tauri 环境）
 */
export async function exportSkillToZip(slug: string): Promise<{ data: Uint8Array; filename: string }> {
  const JSZip = (await import('jszip')).default
  const pkg = await buildSkillPackage(slug)

  const zip = new JSZip()

  // 重建 SKILL.md
  const frontmatterYaml = [
    `name: ${pkg.manifest.name}`,
    `description: ${pkg.manifest.description}`,
    pkg.manifest.version ? `version: ${pkg.manifest.version}` : 'version: 1.0.0',
    pkg.manifest.keywords?.length ? `keywords: [${pkg.manifest.keywords.join(', ')}]` : 'keywords: []',
    pkg.manifest.platforms?.length ? `platforms: [${pkg.manifest.platforms.join(', ')}]` : '',
  ].filter(Boolean)

  const skillMd = ['---', ...frontmatterYaml, '---', '', pkg.body].join('\n')
  zip.file('SKILL.md', skillMd)

  for (const [filePath, content] of Object.entries(pkg.files)) {
    zip.file(filePath, content)
  }

  const data = await zip.generateAsync({ type: 'uint8array' })
  const filename = `${pkg.slug}.zip`

  return { data, filename }
}

/**
 * 弹出文件选择器并导入 ZIP（统一入口，自动适配 Tauri/浏览器）
 */
export async function pickAndImportZip(): Promise<string> {
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      multiple: false,
      title: '选择 Skill ZIP 文件',
    })
    if (!selected || typeof selected !== 'string') {
      throw new Error('用户取消')
    }
    return await importSkillFromZip(selected)
  } else {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.zip'
      input.style.display = 'none'
      document.body.appendChild(input)
      input.onchange = async () => {
        document.body.removeChild(input)
        const file = input.files?.[0]
        if (!file) { reject(new Error('用户取消')); return }
        try {
          const slug = await importSkillFromZip(file)
          resolve(slug)
        } catch (e) {
          reject(e)
        }
      }
      input.click()
    })
  }
}

/**
 * 导出技能并弹出保存对话框（自动适配 Tauri/浏览器）
 */
export async function exportAndSaveZip(slug: string): Promise<void> {
  const { data, filename } = await exportSkillToZip(slug)

  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const savePath = await save({
      defaultPath: filename,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      title: '保存 Skill ZIP',
    })
    if (!savePath) return
    await writeFile(savePath, data)
  } else {
    const blob = new Blob([data as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  console.log('[SkillZip] 导出完成:', filename)
}

/**
 * 通过 URL 下载 ZIP 并导入技能
 */
export async function importSkillFromUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载失败: HTTP ${res.status}`)
  }
  const buf = await res.arrayBuffer()
  return await importSkillFromZip(new Uint8Array(buf))
}
