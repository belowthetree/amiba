// ============================================================
// 插件签名/认证（开发期 sha256 证明文件）
// 说明：当前无密钥体系，.sig.json 提供“构建/安装时证明”，
// 用于本地防篡改检测；生产签名体系接入后再升级算法。
// ============================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listPluginFiles, sha256 } from './plugin-integrity.mjs'

const SIG_FILE = 'amiba.plugin.sig.json'

export function writePluginSignature(pluginDir) {
  const manifestFile = join(pluginDir, 'amiba.plugin.json')
  if (!existsSync(manifestFile)) throw new Error(`缺少 manifest: ${manifestFile}`)

  const files = listPluginFiles(pluginDir)
  const fileHashes = {}
  for (const file of files) {
    const rel = resolve(pluginDir).length === file.length ? '' : file.slice(resolve(pluginDir).length + 1).replace(/\\/g, '/')
    fileHashes[rel] = sha256(readFileSync(file))
  }

  const signature = {
    algorithm: 'sha256-attestation',
    generatedAt: new Date().toISOString(),
    manifestHash: sha256(readFileSync(manifestFile)),
    filesDigest: sha256(JSON.stringify(fileHashes)),
  }
  writeFileSync(join(pluginDir, SIG_FILE), `${JSON.stringify(signature, null, 2)}\n`, 'utf8')
  return signature
}

export function verifyPluginSignature(pluginDir) {
  const sigFile = join(pluginDir, SIG_FILE)
  if (!existsSync(sigFile)) return { ok: false, missing: true, errors: [`缺少 ${SIG_FILE}`] }

  const signature = JSON.parse(readFileSync(sigFile, 'utf8'))
  if (signature.algorithm !== 'sha256-attestation') {
    return { ok: false, missing: false, errors: ['未知签名算法'] }
  }

  const errors = []
  const manifestFile = join(pluginDir, 'amiba.plugin.json')
  const actualManifestHash = existsSync(manifestFile) ? sha256(readFileSync(manifestFile)) : ''
  if (actualManifestHash !== signature.manifestHash) errors.push('manifest 哈希不一致')

  const fileHashes = {}
  for (const file of listPluginFiles(pluginDir)) {
    const rel = file.slice(resolve(pluginDir).length + 1).replace(/\\/g, '/')
    fileHashes[rel] = sha256(readFileSync(file))
  }
  const actualFilesDigest = sha256(JSON.stringify(fileHashes))
  if (actualFilesDigest !== signature.filesDigest) errors.push('文件摘要不一致')

  return { ok: errors.length === 0, missing: false, errors }
}

const command = process.argv[2]
try {
  if (command === 'sign') {
    if (!process.argv[3]) throw new Error('缺少插件目录')
    writePluginSignature(resolve(process.argv[3]))
    console.log('[plugin-sign] 已写入 amiba.plugin.sig.json')
  } else if (command === 'verify') {
    if (!process.argv[3]) throw new Error('缺少插件目录')
    const result = verifyPluginSignature(resolve(process.argv[3]))
    if (result.ok) console.log('[plugin-sign] ✅ 签名认证通过')
    else {
      console.error('[plugin-sign] ❌ 签名认证失败')
      for (const error of result.errors) console.error(`  - ${error}`)
      process.exitCode = 1
    }
  } else {
    console.log('用法: node scripts/plugin-sign.mjs <sign|verify> <pluginDir>')
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
