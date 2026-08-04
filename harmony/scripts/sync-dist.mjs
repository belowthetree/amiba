// 同步主仓 dist/ → 鸿蒙工程 rawfile（ArkWeb 以 resource://rawfile/dist/index.html 加载）
// 用法：npm run harmony:sync（需先 npm run build）
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = join(root, 'dist')
const dst = join(root, 'harmony/entry/src/main/resources/rawfile/dist')

if (!existsSync(src)) {
  console.error('[harmony:sync] dist/ 不存在，请先运行 npm run build')
  process.exit(1)
}

rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log(`[harmony:sync] ✓ ${src} → ${dst}`)
