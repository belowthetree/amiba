// ============================================================
// 变形虫 (Amiba) — 服务版本归档工具（service_archive / service_rollback）
// ============================================================
// 提供 Agent 归档和回退服务版本的能力。
// ============================================================
import { toolRegistry } from './tool-registry'
import { getService } from '../host/registry'
import {
  archiveService,
  rollbackService,
  listVersions,
  deleteVersion,
} from '../host/service-archive'

// ================================================================
// service_archive — 归档当前服务状态
// ================================================================

toolRegistry.register({
  name: 'service_archive',
  toolset: 'service',
  category: 'manage',
  emoji: '📦',
  description:
    '将指定服务的当前文件状态保存为一个归档版本（快照）。归档后可通过 service_rollback 恢复到该版本。用于版本管理、变更前备份、重要节点保存。',
  schema: {
    type: 'function',
    function: {
      name: 'service_archive',
      description:
        '归档用户服务的当前文件状态。生成一个带时间戳的版本快照，存储于 services/{id}/.versions/ 下。建议在重大修改前使用。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '要归档的用户服务 ID（如 user.xxx），系统内置服务不可归档。',
          },
        },
        required: ['service_id'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    if (!serviceId) return JSON.stringify({ error: '参数 service_id 不能为空' })
    if (serviceId.startsWith('system.')) return JSON.stringify({ error: '系统内置服务不支持归档' })

    const svc = getService(serviceId)
    if (!svc) return JSON.stringify({ error: `服务 "${serviceId}" 不存在` })

    try {
      const result = await archiveService(serviceId)
      const versions = await listVersions(serviceId)
      return JSON.stringify({
        success: true,
        service_id: serviceId,
        service_name: svc.manifest.name,
        version: result.label,
        files_archived: result.fileCount,
        total_versions: versions.length,
      })
    } catch (e: any) {
      return JSON.stringify({ error: `归档失败: ${e.message || String(e)}` })
    }
  },
})

// ================================================================
// service_rollback — 回退到指定版本
// ================================================================

toolRegistry.register({
  name: 'service_rollback',
  toolset: 'service',
  category: 'manage',
  emoji: '⏪',
  description:
    '将用户服务回退到之前归档的某个版本。如果不指定版本标签，则自动选择最新的归档版本。当前文件将被覆盖。',
  schema: {
    type: 'function',
    function: {
      name: 'service_rollback',
      description:
        '将服务回退到之前归档的版本。自动列出可用版本供选择。建议先执行 service_archive 保存当前状态后再回退。',
      parameters: {
        type: 'object',
        properties: {
          service_id: {
            type: 'string',
            description: '要回退的用户服务 ID（如 user.xxx）。',
          },
          version: {
            type: 'string',
            description: '要回退到的版本标签（如 v_2026-07-05T12-00-00-000Z）。不传则回退到最新归档版本。',
          },
        },
        required: ['service_id'],
      },
    },
  },
  handler: async (args) => {
    const serviceId = String(args.service_id || '').trim()
    if (!serviceId) return JSON.stringify({ error: '参数 service_id 不能为空' })
    if (serviceId.startsWith('system.')) return JSON.stringify({ error: '系统内置服务不支持回退' })

    const svc = getService(serviceId)
    if (!svc) return JSON.stringify({ error: `服务 "${serviceId}" 不存在` })

    // 先列出可用版本
    let versions: { label: string; timestamp: string; fileCount: number }[] = []
    try {
      versions = await listVersions(serviceId)
    } catch { /* ignore */ }

    if (!versions.length) {
      return JSON.stringify({
        error: `服务 "${serviceId}" 没有任何归档版本，无法回退。建议先用 service_archive 创建归档。`,
        hint: '请先创建归档版本',
      })
    }

    const versionLabel = args.version ? String(args.version).trim() : undefined

    // 如果用户指定了版本，验证是否存在
    if (versionLabel && !versions.find((v) => v.label === versionLabel)) {
      return JSON.stringify({
        error: `归档版本 "${versionLabel}" 不存在。`,
        available_versions: versions.map((v) => ({ label: v.label, timestamp: v.timestamp, files: v.fileCount })),
      })
    }

    try {
      const result = await rollbackService(serviceId, versionLabel || undefined)
      return JSON.stringify({
        success: true,
        service_id: serviceId,
        service_name: svc.manifest.name,
        restored_version: result.label,
        files_restored: result.fileCount,
        available_versions: versions.map((v) => ({ label: v.label, timestamp: v.timestamp, files: v.fileCount })),
      })
    } catch (e: any) {
      return JSON.stringify({ error: `回退失败: ${e.message || String(e)}` })
    }
  },
})
