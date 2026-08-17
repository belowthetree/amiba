// ============================================================
// Amiba Kernel — 权限仲裁
// ============================================================
// 默认拒绝。插件 manifest 声明 allow；用户装配层可 deny/收窄。
// capability 格式：domain:action[:target]，支持 * 通配。
// ============================================================

import { PermissionError } from './types'
import type { PermissionPolicy } from './types'

export { PermissionError }

export interface PermissionAudit {
  pluginId: string
  capability: string
  target?: string
  allowed: boolean
  at: string
}

export interface PermissionManagerOptions {
  /** 审计回调；不设置则只写 console.debug。 */
  onAudit?: (audit: PermissionAudit) => void
  /** 调试开关。 */
  debug?: boolean
}

interface PluginPermissionEntry {
  pluginId: string
  policy: PermissionPolicy
}

/**
 * 简单 glob：`*` 可匹配任意字符（含冒号/点）。
 * 例如 `network:*` 匹配 `network:https`；`*` 匹配所有。
 */
export function capabilityMatches(pattern: string, capability: string): boolean {
  if (pattern === '*') return true
  let patternIndex = 0
  let capabilityIndex = 0
  let starIndex = -1
  let matchIndex = 0

  while (capabilityIndex < capability.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === capability[capabilityIndex]) {
      patternIndex += 1
      capabilityIndex += 1
    } else if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
      starIndex = patternIndex
      matchIndex = capabilityIndex
      patternIndex += 1
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1
      matchIndex += 1
      capabilityIndex = matchIndex
    } else {
      return false
    }
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
    patternIndex += 1
  }
  return patternIndex === pattern.length
}

export class PermissionManager {
  private readonly plugins = new Map<string, PluginPermissionEntry>()
  private readonly userDenies = new Map<string, string[]>()
  private readonly onAudit?: (audit: PermissionAudit) => void
  private readonly debug: boolean

  constructor(options: PermissionManagerOptions = {}) {
    this.onAudit = options.onAudit
    this.debug = options.debug ?? false
  }

  /**
   * 注册插件声明的权限策略。
   * 重复注册（多实例/重载）时合并 deny，确保用户收紧策略不会被覆盖。
   */
  registerPlugin(pluginId: string, policy: PermissionPolicy = {}): void {
    const existing = this.plugins.get(pluginId)
    if (!existing) {
      this.plugins.set(pluginId, { pluginId, policy: { ...policy } })
      return
    }
    existing.policy = {
      allow: [...new Set([...(existing.policy.allow ?? []), ...(policy.allow ?? [])])],
      deny: [...new Set([...(existing.policy.deny ?? []), ...(policy.deny ?? [])])],
    }
  }

  /** 应用用户层策略（可多次覆盖；deny 只增不减）。 */
  applyUserPolicy(pluginId: string, policy: PermissionPolicy): void {
    const entry = this.plugins.get(pluginId)
    if (entry) {
      entry.policy = {
        allow: [...(entry.policy.allow ?? [])],
        deny: [...(entry.policy.deny ?? []), ...(policy.deny ?? [])],
      }
    } else {
      this.registerPlugin(pluginId, policy)
    }
    const denies = this.userDenies.get(pluginId) ?? []
    this.userDenies.set(pluginId, [...new Set([...denies, ...(policy.deny ?? [])])])
  }

  /** 注册用户层 allow 仅用于无 manifest 的调试插件，不覆盖已有 allow。 */
  registerUserAllow(pluginId: string, allow: string[]): void {
    const entry = this.plugins.get(pluginId)
    if (entry) return
    this.registerPlugin(pluginId, { allow })
  }

  /**
   * 检查插件是否有权调用 capability。
   * @returns true 允许；false 拒绝。
   */
  check(pluginId: string, capability: string, target?: string): boolean {
    const entry = this.plugins.get(pluginId)
    const denied = entry?.policy.deny ?? []
    const allowed = entry?.policy.allow ?? []

    const explicitDeny = denied.some((pattern) => capabilityMatches(pattern, capability))
    const explicitAllow = allowed.some((pattern) => capabilityMatches(pattern, capability))

    const result = !explicitDeny && explicitAllow
    if (target !== undefined) {
      const targetedDeny = denied.some((pattern) => capabilityMatches(pattern, `${capability}:${target}`))
      const targetedAllow = allowed.some((pattern) => capabilityMatches(pattern, `${capability}:${target}`))
      if (targetedAllow) {
        return this.finishCheck(pluginId, capability, target, true)
      }
      if (targetedDeny) {
        return this.finishCheck(pluginId, capability, target, false)
      }
    }

    return this.finishCheck(pluginId, capability, target, result)
  }

  /** 检查失败抛 PermissionError。 */
  assert(pluginId: string, capability: string, target?: string): void {
    if (!this.check(pluginId, capability, target)) {
      throw new PermissionError(pluginId, capability, target)
    }
  }

  /** 诊断：插件当前策略。 */
  getPolicy(pluginId: string): PermissionPolicy | undefined {
    const entry = this.plugins.get(pluginId)
    return entry ? { ...entry.policy } : undefined
  }

  /** 诊断：全部插件策略。 */
  listPolicies(): Array<{ pluginId: string; policy: PermissionPolicy }> {
    return [...this.plugins.values()].map((entry) => ({
      pluginId: entry.pluginId,
      policy: { ...entry.policy },
    }))
  }

  removePlugin(pluginId: string): void {
    this.plugins.delete(pluginId)
    this.userDenies.delete(pluginId)
  }

  private finishCheck(pluginId: string, capability: string, target: string | undefined, allowed: boolean): boolean {
    const audit: PermissionAudit = {
      pluginId,
      capability,
      target,
      allowed,
      at: new Date().toISOString(),
    }
    if (this.debug && !allowed) console.debug('[kernel:permissions] 拒绝:', audit)
    try {
      this.onAudit?.(audit)
    } catch (error) {
      console.warn('[kernel:permissions] 审计回调执行失败:', error)
    }
    return allowed
  }
}
