// ============================================================
// 变形虫 (Amiba) — 前端日志系统
// ============================================================
// Monkey-patch console.* → 缓冲批量写入 {AppData}/amiba/logs/
// JSON Lines 格式，按大小轮转，UI 可按级别过滤
// ============================================================

import type { AppSettings } from '../types/service'

export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const

export const LOG_LEVEL_NAMES: Record<number, string> = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
}

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

export interface LogEntry {
  time: string   // ISO 8601
  level: string  // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  module: string // 从 [ModuleName] 前缀提取
  message: string
}

export interface LogFileInfo {
  name: string
  size: number
  date: string
}

const LOGS_DIR = 'amiba/logs'
const FLUSH_INTERVAL_MS = 2000
const BUFFER_MAX = 100

let _settings: AppSettings | null = null
let buffer: LogEntry[] = []
let initialized = false
let flushTimer: ReturnType<typeof setInterval> | null = null
let currentFileName = ''
let currentFileBytes = 0

let origLog: (...args: any[]) => void
let origWarn: (...args: any[]) => void
let origError: (...args: any[]) => void
let origDebug: (...args: any[]) => void
let origInfo: (...args: any[]) => void

// ============================================================
// Helpers
// ============================================================

function levelName(l: number): string {
  return LOG_LEVEL_NAMES[l] || 'INFO'
}

function levelValue(name: string): number {
  const key = name.toUpperCase() as keyof typeof LogLevel
  return LogLevel[key] ?? LogLevel.INFO
}

function extractModule(args: any[]): string {
  if (args.length > 0 && typeof args[0] === 'string') {
    const m = args[0].match(/^\[([^\]]+)\]/)
    if (m) return m[1]
  }
  return 'app'
}

function serializeArg(a: any): string {
  if (a === null || a === undefined) return String(a)
  if (typeof a === 'string') return a
  if (typeof a === 'number' || typeof a === 'boolean' || typeof a === 'bigint') return String(a)
  if (a instanceof Error) return `${a.name}: ${a.message}`
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

function buildMessage(args: any[]): string {
  return args.map(serializeArg).join(' ')
}

function buildEntry(level: LogLevel, args: any[]): LogEntry {
  return {
    time: new Date().toISOString(),
    level: levelName(level),
    module: extractModule(args),
    message: buildMessage(args),
  }
}

// ============================================================
// File I/O (Tauri FS)
// ============================================================

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeLogPath(name: string): string {
  return `${LOGS_DIR}/${name}`
}

async function ensureLogsDir() {
  try {
    const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir(LOGS_DIR, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
  } catch { /* non-Tauri env */ }
}

async function appendToFile(name: string, content: string): Promise<void> {
  try {
    const { readTextFile, writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const fullPath = makeLogPath(name)
    let existing = ''
    try {
      existing = await readTextFile(fullPath, { baseDir: BaseDirectory.AppData })
    } catch { /* file not exist yet */ }
    await writeTextFile(fullPath, existing + content, { baseDir: BaseDirectory.AppData })
  } catch { /* ignore write errors */ }
}

async function getFileSize(name: string): Promise<number> {
  try {
    const { stat, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const info = await stat(makeLogPath(name), { baseDir: BaseDirectory.AppData })
    return info.size
  } catch { return 0 }
}

async function listLogDir(prefix: string): Promise<string[]> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(LOGS_DIR, { baseDir: BaseDirectory.AppData })
    return (entries as any[])
      .filter((e: any) => !e.isDirectory && e.name && e.name.startsWith(prefix))
      .map((e: any) => e.name)
  } catch { return [] }
}

// ============================================================
// File rotation
// ============================================================

async function pickCurrentFile(): Promise<string> {
  const prefix = `amiba-${todayStr()}-`
  const existing = (await listLogDir(prefix)).sort()
  const maxIdx = existing.length > 0
    ? Math.max(...existing.map(n => {
        const m = n.match(/-(\d{3})\.log$/)
        return m ? parseInt(m[1], 10) : 0
      }))
    : 0

  let candidate = ''
  let targetIdx: number

  if (maxIdx > 0) {
    candidate = `${prefix}${String(maxIdx).padStart(3, '0')}.log`
    const sz = await getFileSize(candidate)
    const maxBytes = (_settings?.log_max_size_mb ?? 10) * 1024 * 1024
    if (sz < maxBytes) {
      targetIdx = maxIdx
    } else {
      targetIdx = maxIdx + 1
    }
  } else {
    targetIdx = 1
  }

  const name = `${prefix}${String(targetIdx).padStart(3, '0')}.log`
  const sz = targetIdx === maxIdx ? await getFileSize(name) : 0
  currentFileBytes = sz
  return name
}

async function rotateIfNeeded(): Promise<void> {
  const maxBytes = (_settings?.log_max_size_mb ?? 10) * 1024 * 1024
  if (currentFileBytes < maxBytes) return

  const prefix = `amiba-${todayStr()}-`
  const existing = (await listLogDir(prefix)).sort()
  const currentIdx = existing.length > 0
    ? Math.max(...existing.map(n => {
        const m = n.match(/-(\d{3})\.log$/)
        return m ? parseInt(m[1], 10) : 0
      }))
    : 0

  currentFileName = `${prefix}${String(currentIdx + 1).padStart(3, '0')}.log`
  currentFileBytes = 0

  await pruneOldFiles()
}

async function pruneOldFiles(): Promise<void> {
  const maxFiles = _settings?.log_max_files ?? 5
  try {
    const { readDir, remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(LOGS_DIR, { baseDir: BaseDirectory.AppData })
    const files = (entries as any[])
      .filter((e: any) => !e.isDirectory && e.name && e.name.startsWith('amiba-') && e.name.endsWith('.log'))
      .map((e: any) => e.name)
      .sort()
    while (files.length > maxFiles) {
      const oldest = files.shift()!
      await remove(makeLogPath(oldest), { baseDir: BaseDirectory.AppData }).catch(() => {})
      console.log(`[Logger] 轮转: 删除旧日志 ${oldest}`)
    }
  } catch { /* ignore */ }
}

// ============================================================
// Flush
// ============================================================

async function doFlush() {
  if (!buffer.length) return
  const entries = buffer.splice(0) // drain

  const minLevel = _settings?.log_level ?? LogLevel.INFO
  const filtered = entries.filter(e => levelValue(e.level) >= minLevel)
  if (!filtered.length) return

  const lines = filtered.map(e => JSON.stringify(e)).join('\n') + '\n'
  if (!currentFileName) {
    await ensureLogsDir()
    currentFileName = await pickCurrentFile()
  }

  await appendToFile(currentFileName, lines)
  currentFileBytes += new Blob([lines]).size
  await rotateIfNeeded()
}

async function flush() {
  try {
    await doFlush()
  } catch { /* silent */ }
}

// ============================================================
// Monkey-patch console
// ============================================================

function patchConsole() {
  origLog = console.log.bind(console)
  origWarn = console.warn.bind(console)
  origError = console.error.bind(console)
  origDebug = console.debug.bind(console)
  origInfo = console.info.bind(console)

  console.log = function (...args: any[]) {
    origLog(...args)
    enqueue(LogLevel.INFO, args)
  }
  console.warn = function (...args: any[]) {
    origWarn(...args)
    enqueue(LogLevel.WARN, args)
  }
  console.error = function (...args: any[]) {
    origError(...args)
    enqueue(LogLevel.ERROR, args)
  }
  console.debug = function (...args: any[]) {
    origDebug(...args)
    enqueue(LogLevel.DEBUG, args)
  }
  console.info = function (...args: any[]) {
    origInfo(...args)
    enqueue(LogLevel.INFO, args)
  }
}

function unpatchConsole() {
  if (origLog) console.log = origLog
  if (origWarn) console.warn = origWarn
  if (origError) console.error = origError
  if (origDebug) console.debug = origDebug
  if (origInfo) console.info = origInfo
}

function enqueue(level: LogLevel, args: any[]) {
  if (!initialized) return
  buffer.push(buildEntry(level, args))
  if (buffer.length >= BUFFER_MAX) {
    flush()
  }
}

// ============================================================
// Public API
// ============================================================

let _initialized = false

export async function initLogger(settings: AppSettings): Promise<void> {
  if (_initialized) return
  _initialized = true
  _settings = settings

  if (!settings.log_enabled) {
    console.log('[Logger] 日志记录已禁用（log_enabled = false）')
    return
  }

  console.log('[Logger] 启用日志记录，级别:', LOG_LEVEL_NAMES[settings.log_level] || 'INFO')

  patchConsole()
  await ensureLogsDir()
  currentFileName = await pickCurrentFile()
  initialized = true

  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS)

  // 强制 flush 于页面关闭时
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      if (flushTimer) clearInterval(flushTimer)
      doFlush()
    })
  }
}

export function disableLogger(): void {
  if (!_initialized) return
  initialized = false
  unpatchConsole()
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  flush()
  console.log('[Logger] 日志记录已停止')
}

export function updateLogConfig(settings: AppSettings): void {
  _settings = settings
}

export async function getLogFiles(): Promise<LogFileInfo[]> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(LOGS_DIR, { baseDir: BaseDirectory.AppData })
    const files: LogFileInfo[] = []
    for (const e of entries as any[]) {
      if (e.isDirectory || !e.name) continue
      if (!e.name.startsWith('amiba-') || !e.name.endsWith('.log')) continue
      files.push({
        name: e.name,
        size: e.size ?? await getFileSize(e.name),
        date: e.modified ? new Date(e.modified).toISOString() : '',
      })
    }
    files.sort((a, b) => b.name.localeCompare(a.name))
    return files
  } catch { return [] }
}

export async function readLogFile(name: string): Promise<LogEntry[]> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(makeLogPath(name), { baseDir: BaseDirectory.AppData })
    const entries: LogEntry[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        entries.push(JSON.parse(trimmed) as LogEntry)
      } catch { /* skip malformed lines */ }
    }
    return entries
  } catch { return [] }
}

export async function deleteLogFile(name: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(makeLogPath(name), { baseDir: BaseDirectory.AppData })
    if (name === currentFileName) {
      currentFileName = ''
      currentFileBytes = 0
    }
  } catch {}
}

export async function clearAllLogs(): Promise<void> {
  try {
    const files = await getLogFiles()
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    for (const f of files) {
      await remove(makeLogPath(f.name), { baseDir: BaseDirectory.AppData }).catch(() => {})
    }
    currentFileName = ''
    currentFileBytes = 0
  } catch {}
}

export async function exportLogFile(name: string): Promise<Blob> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const raw = await readTextFile(makeLogPath(name), { baseDir: BaseDirectory.AppData })
    return new Blob([raw], { type: 'text/plain' })
  } catch {
    return new Blob([], { type: 'text/plain' })
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
