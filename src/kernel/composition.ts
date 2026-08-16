// ============================================================
// Amiba Kernel — 装配清单解析（amiba.plugins.yaml）
// ============================================================
// 支持 DSH 风格的补丁动作：insert / modify / remove。
// 多层按低 → 高合并；同 id 由高层覆盖；remove 删除该实例。
// 本模块是纯函数，不读写文件。
// ============================================================

import { load } from 'js-yaml'
import type { PermissionPolicy } from './types'

export interface CompositionEntry {
  id: string
  /** 插件包/目录 id。 */
  name: string
  config?: Record<string, unknown>
  disabled?: boolean
  order?: number
  group?: boolean
  isolate?: Record<string, unknown>
  permissions?: PermissionPolicy
}

export interface InsertAction {
  insert: CompositionEntry[]
}

export interface ModifyAction {
  modify: {
    id: string
    config?: Record<string, unknown>
    disabled?: boolean
    order?: number
    permissions?: PermissionPolicy
  }
}

export interface RemoveAction {
  remove: {
    id: string
  }
}

export type CompositionAction = InsertAction | ModifyAction | RemoveAction

/** 一个装配层：内置组合 / 用户 patch / 运行时覆盖。 */
export type CompositionLayer = CompositionEntry[] | CompositionAction[] | CompositionEntry | CompositionAction

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export class CompositionError extends Error {
  constructor(message: string) {
    super(`[kernel:composition] ${message}`)
    this.name = 'CompositionError'
  }
}

/** 判断对象是否形如 insert/modify/remove 动作。 */
export function isCompositionAction(value: unknown): value is CompositionAction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return 'insert' in value || 'modify' in value || 'remove' in value
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompositionError(`${where} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CompositionError(`${where} 必须是非空字符串`)
  }
  return value
}

function normalizeEntry(value: unknown, where: string): CompositionEntry {
  const record = asRecord(value, where)
  const id = asString(record['id'], `${where}.id`)
  if (!ID_PATTERN.test(id)) {
    throw new CompositionError(`${where}.id "${id}" 不合法，需匹配 ${String(ID_PATTERN)}`)
  }
  const name = asString(record['name'], `${where}.name`)
  const config = record['config'] === undefined ? undefined : asRecord(record['config'], `${where}.config`)
  const disabled = record['disabled'] === undefined ? undefined : Boolean(record['disabled'])
  const order = record['order'] === undefined ? undefined : Number(record['order'])
  const group = record['group'] === undefined ? undefined : Boolean(record['group'])
  const isolate = record['isolate'] === undefined ? undefined : asRecord(record['isolate'], `${where}.isolate`)
  const permissions = record['permissions'] === undefined ? undefined : normalizePolicy(record['permissions'], `${where}.permissions`)
  if (order !== undefined && (!Number.isFinite(order) || !Number.isInteger(order))) {
    throw new CompositionError(`${where}.order 必须是整数`)
  }
  return { id, name, config, disabled, order, group, isolate, permissions }
}

function normalizePolicy(value: unknown, where: string): PermissionPolicy {
  const record = asRecord(value, where)
  const normalizeList = (list: unknown): string[] | undefined => {
    if (list === undefined) return undefined
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      throw new CompositionError(`${where} 必须是字符串数组`)
    }
    return [...new Set(list as string[])]
  }
  return {
    allow: normalizeList(record['allow']),
    deny: normalizeList(record['deny']),
  }
}

/** 将一层装配输入规范化为动作列表。 */
export function normalizeLayer(layer: CompositionLayer): CompositionAction[] {
  const values = Array.isArray(layer) ? layer : [layer]
  const actions: CompositionAction[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (isCompositionAction(value)) {
      actions.push(normalizeAction(value, `layer[${index}]`))
    } else {
      actions.push({
        insert: [normalizeEntry(value, `layer[${index}]`)],
      })
    }
  }
  return actions
}

function normalizeAction(value: CompositionAction, where: string): CompositionAction {
  if ('insert' in value) {
    const raw = value.insert
    if (!Array.isArray(raw)) throw new CompositionError(`${where}.insert 必须是数组`)
    return { insert: raw.map((entry, index) => normalizeEntry(entry, `${where}.insert[${index}]`)) }
  }
  if ('modify' in value) {
    const record = asRecord(value.modify, `${where}.modify`)
    const id = asString(record['id'], `${where}.modify.id`)
    return {
      modify: {
        id,
        config: record['config'] === undefined ? undefined : asRecord(record['config'], `${where}.modify.config`),
        disabled: record['disabled'] === undefined ? undefined : Boolean(record['disabled']),
        order: record['order'] === undefined ? undefined : Number(record['order']),
        permissions: record['permissions'] === undefined ? undefined : normalizePolicy(record['permissions'], `${where}.modify.permissions`),
      },
    }
  }
  const record = asRecord(value.remove, `${where}.remove`)
  return { remove: { id: asString(record['id'], `${where}.remove.id`) } }
}

function mergeConfig(base: Record<string, unknown> | undefined, patch: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (patch === undefined) return base
  if (base === undefined) return { ...patch }
  return { ...base, ...patch }
}

/**
 * 合并多个装配层（低优先级在前）。
 * - insert：写入/覆盖同 id 条目；
 * - modify：在现有条目上打补丁；
 * - remove：删除条目。
 */
export function resolveComposition(layers: CompositionLayer[]): CompositionEntry[] {
  const entries = new Map<string, CompositionEntry>()

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    for (const action of normalizeLayer(layers[layerIndex] ?? [])) {
      if ('insert' in action) {
        for (const entry of action.insert) {
          entries.set(entry.id, { ...entry })
        }
      } else if ('modify' in action) {
        const current = entries.get(action.modify.id)
        if (!current) {
          throw new CompositionError(`modify 找不到实例 "${action.modify.id}"`)
        }
        entries.set(action.modify.id, {
          ...current,
          config: mergeConfig(current.config, action.modify.config),
          disabled: action.modify.disabled ?? current.disabled,
          order: action.modify.order ?? current.order,
          permissions: action.modify.permissions ?? current.permissions,
        })
      } else {
        entries.delete(action.remove.id)
      }
    }
  }

  return [...entries.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

/** 解析 YAML 文本为装配层。 */
export function parseCompositionYaml(text: string): CompositionLayer {
  try {
    const value = load(text) as unknown
    if (value === null || value === undefined) return []
    if (typeof value === 'object') return value as CompositionLayer
    throw new CompositionError('顶层必须是数组或对象')
  } catch (error) {
    if (error instanceof CompositionError) throw error
    throw new CompositionError(`YAML 解析失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 过滤出启用条目。 */
export function enabledEntries(entries: CompositionEntry[]): CompositionEntry[] {
  return entries.filter((entry) => entry.disabled !== true)
}
