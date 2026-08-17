// ============================================================
// @amiba/plugin-manager — 统一插件包安装器
// ============================================================
// 输入：.amiba-plugin zip（ArrayBuffer/Uint8Array）
// 行为：
//   1. 解析 manifest.json + checksums.json
//   2. sha256 校验
//   3. 安装宿主部分到 amiba/plugins/<id>/
//   4. 如声明 service，同步安装到 services/<id>/
//   5. 记录 installed.json，并通过 runtime loader 装配
// ============================================================
import JSZip from 'jszip'
import * as fs from '../../config/native-fs'
import type { AmibaPackageManifest, InstalledPluginRecord, ServicePermission } from './package-types'
import {
  createRuntimePluginDefinition,
  evaluatePluginBundle,
  hasRuntimeModule,
} from './runtime-loader'
import { kernelState } from '../../kernel/state'

const PLUGIN_ROOT = 'amiba/plugins'
const SERVICE_ROOT = 'services'
const INSTALLED_FILE = `${PLUGIN_ROOT}/installed.json`

export interface InstallResult {
  ok: boolean
  id: string
  version: string
  pluginInstalled: boolean
  serviceInstalled: boolean
  files: Record<string, string>
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // 复制为 ArrayBuffer-backed 视图，兼容 TS 对 SharedArrayBuffer 的 BufferSource 约束。
  const copy = new Uint8Array(data.length)
  copy.set(data)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readJsonFile(zip: JSZip, path: string): Promise<unknown> {
  const file = zip.file(path)
  if (!file) throw new Error(`包内缺少 ${path}`)
  return JSON.parse(await file.async('string'))
}

async function writeText(path: string, content: string): Promise<void> {
  await fs.mkdir(dirOf(path), { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => {})
  await fs.writeTextFile(path, content, { baseDir: fs.BaseDirectory.AppData })
}

function dirOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? path : path.slice(0, index)
}

function injectPluginStyle(id: string, css: string): void {
  removePluginStyle(id)
  if (!css.trim()) return
  const tag = document.createElement('style')
  tag.dataset.pluginId = id
  tag.textContent = css
  document.head.append(tag)
}

function removePluginStyle(id: string): void {
  document.head.querySelectorAll(`style[data-plugin-id="${id}"]`).forEach((node) => node.remove())
}

async function loadInstalledRecords(): Promise<Record<string, InstalledPluginRecord>> {
  try {
    const raw = await fs.readTextFile(INSTALLED_FILE, { baseDir: fs.BaseDirectory.AppData })
    return JSON.parse(raw) as Record<string, InstalledPluginRecord>
  } catch {
    return {}
  }
}

async function saveInstalledRecords(records: Record<string, InstalledPluginRecord>): Promise<void> {
  await writeText(INSTALLED_FILE, `${JSON.stringify(records, null, 2)}\n`)
}

export async function installPluginPackage(data: ArrayBuffer | Uint8Array): Promise<InstallResult> {
  const zip = await JSZip.loadAsync(data)
  const manifest = (await readJsonFile(zip, 'manifest.json')) as AmibaPackageManifest
  if (manifest.apiVersion !== 1) throw new Error(`不支持 apiVersion: ${manifest.apiVersion}`)
  if (!manifest.id || !manifest.version) throw new Error('manifest 缺少 id/version')

  const checksums = (await readJsonFile(zip, 'checksums.json')) as { files?: Record<string, string> }
  const expectedFiles = checksums.files ?? {}

  const pluginEntry = manifest.pluginEntry ?? 'plugin.js'
  const pluginFile = zip.file(pluginEntry)
  if (!pluginFile) throw new Error(`包内缺少预编译插件 ${pluginEntry}`)

  const files: Record<string, string> = {}
  const writePackageFile = async (path: string, content: string | Uint8Array, expectedHash?: string) => {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    if (expectedHash) {
      const actual = await sha256Hex(bytes)
      if (actual !== expectedHash) throw new Error(`文件哈希不一致: ${path}`)
    }
    const target = `${PLUGIN_ROOT}/${manifest.id}/${path}`
    await writeText(target, typeof content === 'string' ? content : new TextDecoder().decode(bytes))
    files[path] = expectedHash ?? (await sha256Hex(bytes))
  }

  const pluginCode = await pluginFile.async('string')
  await writePackageFile(pluginEntry, pluginCode, expectedFiles[pluginEntry])
  await writePackageFile('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, expectedFiles['manifest.json'])

  const cssFile = zip.file('plugin.css')
  if (cssFile) {
    const css = await cssFile.async('string')
    await writePackageFile('plugin.css', css, expectedFiles['plugin.css'])
    injectPluginStyle(manifest.id, css)
  } else {
    removePluginStyle(manifest.id)
  }

  let serviceInstalled = false
  if (manifest.service?.enabled) {
    const servicePermissions: ServicePermission[] = manifest.service.permissions ?? []
    const serviceManifest = {
      id: manifest.id,
      name: manifest.service.name ?? manifest.id,
      version: manifest.version,
      description: manifest.description ?? '',
      permissions: servicePermissions,
    }
    await writeText(
      `${SERVICE_ROOT}/${manifest.id}/manifest.json`,
      `${JSON.stringify(serviceManifest, null, 2)}\n`,
    )

    const prefix = 'service/'
    const serviceFiles = Object.values(zip.files).filter((file) => file.name.startsWith(prefix) && !file.dir)
    if (serviceFiles.length === 0) throw new Error('service.enabled=true 但包内没有 service/ 文件')
    for (const file of serviceFiles) {
      const rel = file.name.slice(prefix.length)
      const bytes = await file.async('uint8array')
      const hash = expectedFiles[`service/${rel}`]
      if (hash) {
        const actual = await sha256Hex(bytes)
        if (actual !== hash) throw new Error(`文件哈希不一致: service/${rel}`)
      }
      await writeText(`${SERVICE_ROOT}/${manifest.id}/${rel}`, new TextDecoder().decode(bytes))
      files[`service/${rel}`] = hash ?? (await sha256Hex(bytes))
    }
    serviceInstalled = true
  }

  // 记录安装
  const records = await loadInstalledRecords()
  records[manifest.id] = {
    id: manifest.id,
    version: manifest.version,
    installedAt: new Date().toISOString(),
    files,
    permissions: manifest.permissions,
  }
  await saveInstalledRecords(records)

  // 运行时装配宿主插件
  const runtimeLoader = (await import('./runtime-loader')).ensureRuntimeLoader()
  evaluatePluginBundle(pluginCode, `${manifest.id}/plugin.js`)
  const module = runtimeLoader.getModule(manifest.id)
  if (!module) throw new Error('bundle 未注册插件模块')
  const definition = createRuntimePluginDefinition(manifest.id, module, manifest)
  if (!kernelState.loader) throw new Error('内核尚未就绪')
  await kernelState.loader.load([definition])

  return {
    ok: true,
    id: manifest.id,
    version: manifest.version,
    pluginInstalled: true,
    serviceInstalled,
    files,
  }
}

export async function uninstallPluginPackage(id: string): Promise<void> {
  const records = await loadInstalledRecords()
  delete records[id]
  await saveInstalledRecords(records)
  await fs.remove(`${PLUGIN_ROOT}/${id}`, { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => {})
  await fs.remove(`${SERVICE_ROOT}/${id}`, { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => {})
  removePluginStyle(id)
  await kernelState.loader?.unload(id)
}

export async function restoreInstalledPlugins(): Promise<void> {
  const records = await loadInstalledRecords()
  for (const record of Object.values(records)) {
    try {
      const pluginPath = `${PLUGIN_ROOT}/${record.id}/plugin.js`
      const code = await fs.readTextFile(pluginPath, { baseDir: fs.BaseDirectory.AppData })
      const manifestRaw = await fs.readTextFile(`${PLUGIN_ROOT}/${record.id}/manifest.json`, { baseDir: fs.BaseDirectory.AppData })
      const manifest = JSON.parse(manifestRaw) as AmibaPackageManifest
      try {
        const css = await fs.readTextFile(`${PLUGIN_ROOT}/${record.id}/plugin.css`, { baseDir: fs.BaseDirectory.AppData })
        injectPluginStyle(record.id, css)
      } catch {
        removePluginStyle(record.id)
      }
      const runtimeLoader = (await import('./runtime-loader')).ensureRuntimeLoader()
      evaluatePluginBundle(code, `${record.id}/plugin.js`)
      const module = runtimeLoader.getModule(record.id)
      if (!module) throw new Error('bundle 未注册插件模块')
      if (!kernelState.loader) return
      await kernelState.loader.load([createRuntimePluginDefinition(record.id, module, manifest)])
    } catch (error) {
      console.warn(`[plugin-manager] 恢复插件失败: ${record.id}`, error)
    }
  }
}

export function getRuntimeModule(id: string) {
  return hasRuntimeModule(id)
}
