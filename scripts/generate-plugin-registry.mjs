// ============================================================
// 生成 src/plugins/user-registry.generated.ts
// 读取根目录 amiba.plugins.yaml，把启用的本地插件编入装配表。
// 用法：
//   node scripts/generate-plugin-registry.mjs
//   npm run plugin:sync
// ============================================================
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(ROOT, 'amiba.plugins.yaml')
const OUTPUT_FILE = join(ROOT, 'src', 'plugins', 'user-registry.generated.ts')
const OUTPUT_DIR = dirname(OUTPUT_FILE)

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const KINDS = ['plugin', 'tool-pack', 'preset', 'skill', 'theme', 'locale', 'resource']

function fail(message) {
  throw new Error(`[plugin-registry] ${message}`)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function readManifest(pluginDir) {
  const manifestFile = join(pluginDir, 'amiba.plugin.json')
  try {
    return readJson(manifestFile)
  } catch {
    fail(`插件目录缺少可读的 amiba.plugin.json: ${pluginDir}`)
  }
}

export function validatePluginManifest(manifest, pluginDir) {
  if (!manifest || typeof manifest !== 'object') fail('manifest 必须是对象')
  if (manifest.apiVersion !== 1) fail(`${manifest.id ?? '(无 id)'} 的 apiVersion 必须是 1`)
  if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) fail('manifest.id 不合法')
  if (!KINDS.includes(manifest.kind)) fail(`${manifest.id} 的 kind 必须是 ${KINDS.join('/')}`)
  if (typeof manifest.entry !== 'string' || manifest.entry.trim() === '') fail(`${manifest.id} 的 entry 必须是非空字符串`)
  if (manifest.inject !== undefined && (!Array.isArray(manifest.inject) || manifest.inject.some((x) => typeof x !== 'string'))) fail(`${manifest.id} 的 inject 必须是字符串数组`)
  if (manifest.provides !== undefined) {
    for (const [key, value] of Object.entries(manifest.provides)) {
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) fail(`${manifest.id} 的 provides.${key} 必须是字符串数组`)
    }
  }
  if (readFileSync(join(pluginDir, manifest.entry), 'utf8').trim().length === 0) fail(`${manifest.id} 的 entry 文件为空`)
  return manifest
}

export function generatePluginRegistry() {
  let raw = '[]'
  try {
    raw = readFileSync(CONFIG_FILE, 'utf8')
  } catch {
    // 首次运行：生成空配置。
    writeFileSync(CONFIG_FILE, '[]\n', 'utf8')
  }

  const config = yaml.load(raw) ?? []
  if (!Array.isArray(config)) fail('amiba.plugins.yaml 顶层必须是数组')

  const imports = []
  const definitions = []

  for (const entry of config) {
    if (!entry || typeof entry !== 'object') fail('装配条目必须是对象')
    if (entry.disabled === true) continue
    if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) fail(`装配条目 id 不合法: ${String(entry.id)}`)
    if (typeof entry.name !== 'string' || entry.name.trim() === '') fail(`装配条目 ${entry.id} 缺少 name（插件目录路径）`)

    const pluginDir = resolve(ROOT, entry.name)
    const manifest = validatePluginManifest(readManifest(pluginDir), pluginDir)
    const entryFile = resolve(pluginDir, manifest.entry)
    const manifestFile = join(pluginDir, 'amiba.plugin.json')

    const safe = `plugin_${entry.id.replace(/[^a-zA-Z0-9_]/g, '_')}`
    const entryImport = relative(OUTPUT_DIR, entryFile).replace(/\\/g, '/').replace(/\.ts$/, '')
    const manifestImport = relative(OUTPUT_DIR, manifestFile).replace(/\\/g, '/')

    imports.push(`import * as ${safe} from '${entryImport}'`)
    imports.push(`import ${safe}_manifest from '${manifestImport}'`)

    const config = entry.config ?? manifest.config?.defaults ?? {}
    const order = Number.isInteger(entry.order) ? entry.order : 1000
    definitions.push(`  {
    instanceId: ${JSON.stringify(entry.id)},
    pluginId: ${JSON.stringify(manifest.id)},
    name: ${safe}.name,
    kind: ${JSON.stringify(manifest.kind)},
    manifest: ${safe}_manifest as PluginManifest,
    module: ${safe},
    config: ${JSON.stringify(config)},
    order: ${order},
  }`)
  }

  const text = `// ============================================================
// 本文件由 scripts/generate-plugin-registry.mjs 自动生成。
// 请勿手改；需要变更时运行: npm run plugin:sync
// ============================================================
import type { PluginDefinition, PluginManifest } from '../kernel'
${imports.join('\n')}

export const userPluginDefinitions: PluginDefinition[] = [
${definitions.join(',\n')}
]
`

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_FILE, text, 'utf8')
  console.log(`[plugin-registry] 已生成 ${relative(ROOT, OUTPUT_FILE)}（${definitions.length} 个本地插件）`)
  return definitions.length
}

// 直接运行
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generatePluginRegistry()
}
