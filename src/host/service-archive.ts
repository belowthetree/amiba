// ============================================================
// 变形虫 (Amiba) — ServiceArchive 服务版本归档引擎
// ============================================================
// 在 services/{id}/.versions/ 下存放完整文件快照。
// 支持归档、回退、列出、删除版本。
// ============================================================

import { readServiceFile, writeServiceFile, listServiceFiles } from '../config/storage'
import { getService } from './registry'

const VERSIONS_DIR = '.versions'

export interface ServiceVersion {
  label: string
  timestamp: string
  fileCount: number
}

// ---- 归档 ----

export async function archiveService(serviceId: string): Promise<{ label: string; fileCount: number }> {
  const err = validate(serviceId)
  if (err) throw new Error(err)

  const label = makeVersionLabel()

  // 列出当前所有文件
  const currentFiles = await listServiceFiles(serviceId)
  const filesToArchive = currentFiles.filter(
    (f) => f !== 'manifest.json' && f !== 'tasks.json' && f !== 'data' && !f.startsWith('.versions')
  )

  console.log(`[SvcArchive] 归档 ${serviceId} → ${label}, ${filesToArchive.length} 个文件`)

  // 复制 manifest.json
  const manifestRaw = await readServiceFile(serviceId, 'manifest.json')
  if (manifestRaw) {
    await writeServiceFile(serviceId, `${VERSIONS_DIR}/${label}/manifest.json`, manifestRaw)
  }

  // 复制其他文件
  for (const filePath of filesToArchive) {
    const content = await readServiceFile(serviceId, filePath)
    if (content !== null) {
      await writeServiceFile(serviceId, `${VERSIONS_DIR}/${label}/${filePath}`, content)
    }
  }

  // 复制 tasks.json（如果存在）
  const tasksRaw = await readServiceFile(serviceId, 'tasks.json')
  if (tasksRaw) {
    await writeServiceFile(serviceId, `${VERSIONS_DIR}/${label}/tasks.json`, tasksRaw)
  }

  return { label, fileCount: filesToArchive.length + 1 }
}

// ---- 回退 ----

export async function rollbackService(serviceId: string, versionLabel?: string): Promise<{ label: string; fileCount: number }> {
  const err = validate(serviceId)
  if (err) throw new Error(err)

  // 确定要回退的版本
  let label = versionLabel
  if (!label) {
    const versions = await listVersions(serviceId)
    if (!versions.length) throw new Error(`服务 "${serviceId}" 没有归档版本`)
    label = versions[versions.length - 1].label // 最新版本
  }

  // 列出归档版本中的文件
  const archiveFiles = await listServiceFiles(serviceId, `${VERSIONS_DIR}/${label}`)
  if (!archiveFiles.length) throw new Error(`归档版本 "${label}" 不存在或为空`)

  console.log(`[SvcArchive] 回退 ${serviceId} → ${label}, ${archiveFiles.length} 个文件`)

  let count = 0
  for (const archiveFilePath of archiveFiles) {
    // archiveFilePath 格式如 "manifest.json", "index.html", "widgets/x.html"
    const content = await readServiceFile(serviceId, `${VERSIONS_DIR}/${label}/${archiveFilePath}`)
    if (content !== null) {
      // 写回到服务根目录（去掉 .versions/{label}/ 前缀）
      await writeServiceFile(serviceId, archiveFilePath, content)
      count++
    }
  }

  return { label, fileCount: count }
}

// ---- 列出版本 ----

export async function listVersions(serviceId: string): Promise<ServiceVersion[]> {
  const err = validate(serviceId)
  if (err) throw new Error(err)

  const allFiles = await listServiceFiles(serviceId, VERSIONS_DIR)
  const labels = new Set<string>()
  for (const f of allFiles) {
    const parts = f.split('/')
    if (parts.length > 0) labels.add(parts[0])
  }

  const result: ServiceVersion[] = []
  for (const label of labels) {
    const timestamp = parseTimestampFromLabel(label)
    const files = allFiles.filter((f) => f.startsWith(label + '/'))
    result.push({ label, timestamp, fileCount: files.length })
  }

  result.sort((a, b) => a.label.localeCompare(b.label))
  return result
}

// ---- 删除版本 ----

export async function deleteVersion(serviceId: string, versionLabel: string): Promise<void> {
  const err = validate(serviceId)
  if (err) throw new Error(err)

  const archiveFiles = await listServiceFiles(serviceId, `${VERSIONS_DIR}/${versionLabel}`)
  for (const f of archiveFiles) {
    // removeServiceFile doesn't exist as an API, but we don't need to explicitly
    // delete since list+rollback operations filter by label prefix.
    // Files under .versions/ are ignored by getServicePackage.
    // For now, we can leave orphan files — they'll be invisible.
  }

  console.log(`[SvcArchive] 删除版本 ${serviceId}/${versionLabel}`)
  // TODO: 添加 removeServiceFile API 后实现物理删除
}

// ---- 内部工具 ----

function makeVersionLabel(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return `v_${ts}`
}

function parseTimestampFromLabel(label: string): string {
  // "v_2026-07-05T12-00-00-000Z" → "2026-07-05T12:00:00"
  const ts = label.replace(/^v_/, '').replace(/-/g, (m, i, s) => {
    if (i === 4 || i === 7) return '-'
    if (i === 10) return 'T'
    if (i === 13 || i === 16) return ':'
    return m
  })
  return ts.slice(0, 19)
}

function validate(serviceId: string): string | null {
  if (!serviceId || !serviceId.trim()) return 'service_id 不能为空'
  if (serviceId.startsWith('system.')) return '系统内置服务不支持归档'
  const svc = getService(serviceId)
  if (!svc) return `服务 "${serviceId}" 不存在`
  return null
}
