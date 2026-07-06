// ============================================================
// 变形虫 (Amiba) — SkillPackage 打包格式定义
// ============================================================
// 用于 ZIP 导出/导入和局域网技能分享的传输格式。
// ============================================================

import type { SkillFrontmatter } from '../ai/skill-parser'

export interface SkillPackage {
  formatVersion: 1
  slug: string
  manifest: SkillFrontmatter
  body: string
  files: Record<string, string>
  exportedAt: string
  exportedFrom?: string
}
