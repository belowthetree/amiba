// 同步主仓 dist/ → 鸿蒙工程 rawfile 根（ArkWeb 以 resource://rawfile/index.html 加载）。
// 必须放在 rawfile 根：Vite 产物与服务沙箱内引用均为绝对路径（/assets/*、/libs/jade.css、/docs/*），
// 与 Tauri 自定义协议根布局保持一致。
// 用法：npm run harmony:sync（需先 npm run build）
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = join(root, 'dist')
const rawfile = join(root, 'harmony/entry/src/main/resources/rawfile')
const KEEP = new Set(['dist.README.txt']) // 入库的说明文件，同步时保留

if (!existsSync(src)) {
  console.error('[harmony:sync] dist/ 不存在，请先运行 npm run build')
  process.exit(1)
}

// 清空 rawfile 下旧产物（保留 KEEP）
for (const name of readdirSync(rawfile)) {
  if (!KEEP.has(name)) {
    rmSync(join(rawfile, name), { recursive: true, force: true })
  }
}
for (const name of readdirSync(src)) {
  cpSync(join(src, name), join(rawfile, name), { recursive: true })
}
console.log(`[harmony:sync] ✓ ${src}/* → ${rawfile}/`)
