// ============================================================
// 插件静态校验（manifest / 文件 / 扩展点契约）
// 用法：
//   node scripts/plugin-validate.mjs <pluginDir>
// ============================================================
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validatePluginManifest } from './generate-plugin-registry.mjs'

const SLOT_NAMES = [
  'ui.slot.app.global',
  'ui.slot.chat.above-messages',
  'ui.slot.chat.below-input',
  'ui.slot.settings.section',
  'ui.slot.services.above-list',
  'ui.slot.memory.tab',
]

function fail(message) {
  throw new Error(`[plugin-validate] ${message}`)
}

export function validatePlugin(pluginDir) {
  const root = resolve(pluginDir)
  const manifestFile = join(root, 'amiba.plugin.json')
  if (!existsSync(manifestFile)) fail(`缺少 amiba.plugin.json: ${root}`)

  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  validatePluginManifest(manifest, root)

  const entryFile = join(root, manifest.entry)
  if (!existsSync(entryFile)) fail(`entry 文件不存在: ${entryFile}`)

  // 扩展点静态契约：manifest 声明的 Slot 必须是已声明 Slot。
  const slots = manifest.provides?.slots ?? []
  for (const slot of slots) {
    if (!SLOT_NAMES.includes(slot)) fail(`${manifest.id} 声明了未注册 Slot: ${slot}`)
  }

  // 页面声明只检查命名；路径由插件运行时 PageRegistry 校验。
  const pages = manifest.provides?.pages ?? []
  for (const page of pages) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(page)) fail(`${manifest.id} 声明了非法页面 id: ${page}`)
  }

  const tools = manifest.provides?.tools ?? []
  for (const tool of tools) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(tool)) fail(`${manifest.id} 声明了非法工具名: ${tool}`)
  }

  return { ok: true, manifest, entryFile }
}

// 直接运行
const arg = process.argv[2]
if (!arg) fail('缺少插件目录参数')
const result = validatePlugin(arg)
console.log(`[plugin-validate] ✅ ${result.manifest.id} (${result.entryFile})`)
