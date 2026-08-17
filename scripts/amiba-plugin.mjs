// ============================================================
// Amiba 本地插件 CLI（开发期）
// 用法：
//   node scripts/amiba-plugin.mjs list
//   node scripts/amiba-plugin.mjs add <pluginDir> [id]
//   node scripts/amiba-plugin.mjs remove <id> [--purge]
//   node scripts/amiba-plugin.mjs validate <pluginDir>
//   node scripts/amiba-plugin.mjs sync
// ============================================================
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { generatePluginRegistry, validatePluginManifest } from './generate-plugin-registry.mjs'
import { validatePlugin } from './plugin-validate.mjs'
import { verifyAllInstalled, writePluginLock } from './plugin-integrity.mjs'
import { verifyPluginSignature, writePluginSignature } from './plugin-sign.mjs'
import { buildPluginPackage } from './build-plugin-package.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(ROOT, 'amiba.plugins.yaml')
const LOCAL_PLUGIN_ROOT = join(ROOT, 'src', 'plugins-local')
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function fail(message) {
  throw new Error(`[amiba-plugin] ${message}`)
}

function readConfig() {
  if (!existsSync(CONFIG_FILE)) return []
  const value = yaml.load(readFileSync(CONFIG_FILE, 'utf8')) ?? []
  if (!Array.isArray(value)) fail('amiba.plugins.yaml 顶层必须是数组')
  return value
}

function writeConfig(entries) {
  const text = yaml.dump(entries, { lineWidth: 120 })
  writeFileSync(CONFIG_FILE, text, 'utf8')
}

function readManifest(pluginDir) {
  const file = join(pluginDir, 'amiba.plugin.json')
  if (!existsSync(file)) fail(`缺少 amiba.plugin.json: ${pluginDir}`)
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  validatePluginManifest(manifest, pluginDir)
  return manifest
}

function copyPlugin(source, id) {
  const target = join(LOCAL_PLUGIN_ROOT, id)
  if (existsSync(target)) fail(`目标目录已存在: ${target}`)
  cpSync(source, target, {
    recursive: true,
    filter(src) {
      const base = basename(src)
      return !['node_modules', '.git', 'dist', '.versions'].includes(base)
    },
  })
  return target
}

function commandList() {
  const entries = readConfig()
  if (entries.length === 0) {
    console.log('没有本地插件。使用: node scripts/amiba-plugin.mjs add <pluginDir>')
    return
  }
  for (const entry of entries) {
    console.log(`- ${entry.id}\t${entry.disabled === true ? '[disabled]' : '[enabled]'}\t${entry.name ?? '(missing name)'}`)
  }
}

function commandAdd(source, explicitId) {
  if (!source) fail('缺少插件目录参数')
  const pluginDir = resolve(source)
  if (!existsSync(join(pluginDir, 'amiba.plugin.json'))) fail(`不是有效插件目录: ${pluginDir}`)

  const manifest = readManifest(pluginDir)
  const id = explicitId ?? manifest.id
  if (!ID_PATTERN.test(id)) fail(`插件 id 不合法: ${id}`)

  const target = copyPlugin(pluginDir, id)
  const entries = readConfig().filter((entry) => entry.id !== id)
  entries.push({
    id,
    name: relative(ROOT, target).replace(/\\/g, '/'),
    config: {},
    disabled: false,
  })
  writeConfig(entries)
  try {
    writePluginLock(target)
    generatePluginRegistry()
  } catch (error) {
    // 事务回滚：生成/校验失败则恢复旧配置并删除副本。
    writeConfig(readConfig().filter((entry) => entry.id !== id))
    rmSync(target, { recursive: true, force: true })
    throw error
  }
  console.log(`[amiba-plugin] 已添加 ${id}（${target}）。请重新启动 npm run dev。`)
}

function commandRemove(id, purge) {
  if (!id) fail('缺少插件 id')
  const entries = readConfig().filter((entry) => entry.id !== id)
  if (entries.length === readConfig().length) fail(`找不到插件 ${id}`)
  writeConfig(entries)

  const pluginDir = join(LOCAL_PLUGIN_ROOT, id)
  let backupDir = ''
  if (purge && existsSync(pluginDir)) {
    backupDir = join(LOCAL_PLUGIN_ROOT, '.backup', `${id}-${Date.now()}`)
    cpSync(pluginDir, backupDir, { recursive: true })
    rmSync(pluginDir, { recursive: true, force: true })
  }

  try {
    generatePluginRegistry()
  } catch (error) {
    if (purge && backupDir && existsSync(backupDir)) {
      cpSync(backupDir, pluginDir, { recursive: true })
      rmSync(backupDir, { recursive: true, force: true })
    }
    throw error
  }
  console.log(`[amiba-plugin] 已移除 ${id}${purge ? '（本地副本已备份到 .backup）' : ''}。请重新启动 npm run dev。`)
}

function commandValidate(source) {
  if (!source) fail('缺少插件目录参数')
  validatePlugin(resolve(source))
}

function commandVerify() {
  const summary = verifyAllInstalled()
  for (const result of summary.results) {
    console.log(`- ${result.id}: ${result.ok ? '✅' : result.missing ? '⚠️ 无锁文件' : '❌'}`)
    for (const error of result.errors) console.log(`    - ${error}`)
  }
  if (!summary.ok) process.exitCode = 1
}

function commandSign(source) {
  if (!source) fail('缺少插件目录参数')
  const dir = resolve(source)
  writePluginLock(dir)
  writePluginSignature(dir)
  console.log('[amiba-plugin] 已写入 lock + sig')
}

function commandVerifySignature(source) {
  if (!source) fail('缺少插件目录参数')
  const result = verifyPluginSignature(resolve(source))
  if (result.ok) console.log('[amiba-plugin] ✅ 签名认证通过')
  else {
    console.error('[amiba-plugin] ❌ 签名认证失败')
    for (const error of result.errors) console.error(`  - ${error}`)
    process.exitCode = 1
  }
}

async function commandPackage(source) {
  if (!source) fail('缺少插件目录参数')
  await buildPluginPackage(resolve(source))
}

const command = process.argv[2]
try {
  if (command === 'list') commandList()
  else if (command === 'add') commandAdd(process.argv[3], process.argv[4])
  else if (command === 'remove') commandRemove(process.argv[3], process.argv.includes('--purge'))
  else if (command === 'validate') commandValidate(process.argv[3])
  else if (command === 'verify') commandVerify()
  else if (command === 'sign') commandSign(process.argv[3])
  else if (command === 'verify-signature') commandVerifySignature(process.argv[3])
  else if (command === 'package') await commandPackage(process.argv[3])
  else if (command === 'sync') generatePluginRegistry()
  else {
    console.log(`用法:
  node scripts/amiba-plugin.mjs list
  node scripts/amiba-plugin.mjs add <pluginDir> [id]
  node scripts/amiba-plugin.mjs remove <id> [--purge]
  node scripts/amiba-plugin.mjs validate <pluginDir>
  node scripts/amiba-plugin.mjs verify
  node scripts/amiba-plugin.mjs sign <pluginDir>
  node scripts/amiba-plugin.mjs verify-signature <pluginDir>
  node scripts/amiba-plugin.mjs package <pluginDir>
  node scripts/amiba-plugin.mjs sync`)
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
