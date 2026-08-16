// ============================================================
// @amiba/skills — 技能系统服务插件
// ============================================================
// 把现有 ai/skill* 模块统一暴露为 ctx.get('skills')。
// 本阶段不改变各模块内部实现与存储格式。
// ============================================================

import * as userSkills from '../../ai/skills'
import * as skillParser from '../../ai/skill-parser'
import * as skillCommands from '../../ai/skill-commands'
import * as skillPackager from '../../ai/skill-packager'
import * as skillZip from '../../ai/skill-zip'
import * as skillUsage from '../../ai/skill-usage'
import * as skillCurator from '../../ai/skill-curator'
import * as skillConsolidationPrompt from '../../ai/skill-consolidation-prompt'
import * as skillReviewer from '../../ai/skill-reviewer'
import * as experienceStore from '../../ai/experience-store'
import type { AmibaContext } from '../../kernel'

export const name = '@amiba/skills'
export const inject = ['storage', 'settings']
export const provides = ['skills']

/** `ctx.get('skills')` 返回的服务面。 */
export interface AmibaSkillsService {
  user: typeof userSkills
  parser: typeof skillParser
  commands: typeof skillCommands
  packager: typeof skillPackager
  zip: typeof skillZip
  usage: typeof skillUsage
  curator: typeof skillCurator
  consolidationPrompt: typeof skillConsolidationPrompt
  reviewer: typeof skillReviewer
  experience: typeof experienceStore
}

export function apply(ctx: AmibaContext): void {
  const service: AmibaSkillsService = {
    user: userSkills,
    parser: skillParser,
    commands: skillCommands,
    packager: skillPackager,
    zip: skillZip,
    usage: skillUsage,
    curator: skillCurator,
    consolidationPrompt: skillConsolidationPrompt,
    reviewer: skillReviewer,
    experience: experienceStore,
  }
  ctx.provide('skills', service)
}
