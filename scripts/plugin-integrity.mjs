// ============================================================
// 本地插件完整性：生成/校验 amiba.plugin.lock.json
// 用法：
//   node scripts/plugin-integrity.mjs write <pluginDir>
//   node scripts/plugin-integrity.mjs verify <pluginDir>
//   node scripts/plugin-integrity.mjs verify-all
// ============================================================
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_PLUGIN_ROOT = join(ROOT, 'src', 'plugins-local')
const LOCK_FILE = 'amiba.plugin.lock.json'
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.versions', '.backup'])

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function listPluginFiles(pluginDir) {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        walk(full)
      } else {
        if (name === LOCK_FILE) continue
        files.push(full)
      }
    }
  }
  walk(pluginDir)
  return files.sort()
}

export function writePluginLock(pluginDir) {
  const files = listPluginFiles(pluginDir)
  const entries = {}
  for (const file of files) {
    const rel = relative(pluginDir, file).replace(/\\/g, '/')
    entries[rel] = sha256(readFileSync(file))
  }
  const lock = {
    generatedAt: new Date().toISOString(),
    files: entries,
  }
  writeFileSync(join(pluginDir, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  return lock
}

export function verifyPluginLock(pluginDir) {
  const lockFile = join(pluginDir, LOCK_FILE)
  if (!existsSync(lockFile)) {
    return { ok: false, missing: true, errors: [`缺少 ${LOCK_FILE}`], files: {} }
  }
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'))
  const errors = []
  const current = listPluginFiles(pluginDir).map((file) => {
    const rel = relative(pluginDir, file).replace(/\\/g, '/')
    return { rel, hash: sha256(readFileSync(file)) }
  })

  const currentNames = new Set(current.map((entry) => entry.rel))
  for (const [rel, expected] of Object.entries(lock.files ?? {})) {
    if (!currentNames.has(rel)) {
      errors.push(`文件缺失: ${rel}`)
      continue
    }
    const actual = current.find((entry) => entry.rel === rel)?.hash
    if (actual !== expected) errors.push(`哈希不一致: ${rel}`)
  }
  for (const entry of current) {
    if (!(entry.rel in (lock.files ?? {}))) errors.push(`新增未记录文件: ${entry.rel}`)
  }

  return { ok: errors.length === 0, missing: false, errors, files: lock.files ?? {} }
}

export function verifyAllInstalled() {
  if (!existsSync(LOCAL_PLUGIN_ROOT)) return { ok: true, results: [] }
  const results = []
  for (const name of readdirSync(LOCAL_PLUGIN_ROOT)) {
    const dir = join(LOCAL_PLUGIN_ROOT, name)
    if (!statSync(dir).isDirectory() || SKIP_DIRS.has(name)) continue
    const result = verifyPluginLock(dir)
    results.push({ id: name, ...result })
  }
  // 无锁文件的目录视为“未管理”，只警告；有锁但哈希失败才阻断。
  return { ok: results.every((result) => result.ok || result.missing), results }
}

// 直接运行
const command = process.argv[2]
try {
  if (command === 'write') {
    if (!process.argv[3]) throw new Error('缺少插件目录')
    const lock = writePluginLock(resolve(process.argv[3]))
    console.log(`[plugin-integrity] 已写入 ${Object.keys(lock.files).length} 个文件哈希`)
  } else if (command === 'verify') {
    if (!process.argv[3]) throw new Error('缺少插件目录')
    const result = verifyPluginLock(resolve(process.argv[3]))
    if (result.ok) console.log('[plugin-integrity] ✅ 完整性校验通过')
    else {
      console.error('[plugin-integrity] ❌ 完整性校验失败')
      for (const error of result.errors) console.error(`  - ${error}`)
      process.exitCode = 1
    }
  } else if (command === 'verify-all') {
    const summary = verifyAllInstalled()
    for (const result of summary.results) {
      console.log(`- ${result.id}: ${result.ok ? '✅' : result.missing ? '⚠️ 无锁文件' : '❌'}`)
      for (const error of result.errors) console.log(`    - ${error}`)
    }
    if (!summary.ok) process.exitCode = 1
  } else {
    console.log('用法: node scripts/plugin-integrity.mjs <write|verify|verify-all> [pluginDir]')
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
