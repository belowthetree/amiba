// ============================================================
// 构建预编译 .amiba-plugin 包（宿主插件 + 可选沙箱服务）
// 用法：node scripts/build-plugin-package.mjs <pluginDir> [outDir]
// ============================================================
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import JSZip from 'jszip'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TMP_ROOT = join(ROOT, 'node_modules', '.tmp', 'amiba-plugin-build')

const EXTERNALS = ['vue', 'vue-router', 'pinia', '@amiba/sdk', '@amiba/kernel']

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function listFiles(dir) {
  const files = []
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name)
      if (statSync(full).isDirectory()) walk(full)
      else files.push(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return files
}

export async function buildPluginPackage(pluginDir, outDir = join(ROOT, 'dist-plugins')) {
  const source = resolve(pluginDir)
  const manifestFile = join(source, 'amiba.plugin.json')
  if (!existsSync(manifestFile)) throw new Error(`缺少 amiba.plugin.json: ${source}`)
  const manifest = readJson(manifestFile)
  const id = manifest.id
  const version = manifest.version ?? '0.0.0'
  const entry = manifest.entry ?? 'src/index.ts'
  const entryFile = join(source, entry)
  if (!existsSync(entryFile)) throw new Error(`缺少插件入口: ${entryFile}`)

  const buildDir = join(TMP_ROOT, id, String(Date.now()))
  mkdirSync(buildDir, { recursive: true })

  try {
    await build({
      configFile: false,
      logLevel: 'warn',
      plugins: [vue()],
      build: {
        lib: {
          entry: entryFile,
          formats: ['cjs'],
          fileName: () => 'plugin.cjs',
        },
        outDir: buildDir,
        emptyOutDir: true,
        rollupOptions: {
          external: EXTERNALS,
          output: {
            banner: `window.__AMIBA_MODULE_LOADER__.load({ id: ${JSON.stringify(id)}, factory: function(require) { var module = { exports: {} }; var exports = module.exports;`,
            footer: 'return module.exports; } });',
          },
        },
      },
    })
  } catch (error) {
    rmSync(buildDir, { recursive: true, force: true })
    throw new Error(`Vite 构建失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  const bundleFile = join(buildDir, 'plugin.cjs')
  if (!existsSync(bundleFile)) {
    rmSync(buildDir, { recursive: true, force: true })
    throw new Error('未生成 plugin.cjs')
  }
  const bundle = readFileSync(bundleFile, 'utf8')

  const zip = new JSZip()
  const checksums = {}

  const put = (path, content) => {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    zip.file(path, data)
    checksums[path] = sha256(data)
  }

  const packageManifest = {
    apiVersion: 1,
    sdkVersion: 1,
    id,
    kind: manifest.kind ?? 'plugin',
    version,
    description: manifest.description ?? '',
    inject: manifest.inject ?? [],
    provides: manifest.provides ?? {},
    permissions: manifest.permissions ?? { allow: [], deny: [] },
    pluginEntry: 'plugin.js',
    service: manifest.service ?? { enabled: false },
  }

  put('manifest.json', `${JSON.stringify(packageManifest, null, 2)}\n`)
  put('plugin.js', bundle)

  // 库模式可能抽出 CSS
  const cssFile = join(buildDir, 'style.css')
  if (existsSync(cssFile)) {
    put('plugin.css', readFileSync(cssFile, 'utf8'))
  }

  // 沙箱服务文件
  const serviceDir = join(source, 'service')
  if (manifest.service?.enabled && existsSync(serviceDir)) {
    for (const file of listFiles(serviceDir)) {
      const rel = file.slice(serviceDir.length + 1).replace(/\\/g, '/')
      put(`service/${rel}`, readFileSync(file))
    }
  }

  put('checksums.json', `${JSON.stringify({ files: checksums }, null, 2)}\n`)

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  mkdirSync(outDir, { recursive: true })
  const packageFile = join(outDir, `${id}-${version}.amiba-plugin.zip`)
  writeFileSync(packageFile, zipBuffer)
  rmSync(buildDir, { recursive: true, force: true })
  console.log(`[build-plugin-package] ✅ ${packageFile}`)
  return packageFile
}

// 直接运行
const source = process.argv[2]
if (!source) {
  console.error('用法: node scripts/build-plugin-package.mjs <pluginDir> [outDir]')
  process.exit(1)
}
try {
  await buildPluginPackage(resolve(source), process.argv[3] ? resolve(process.argv[3]) : undefined)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
