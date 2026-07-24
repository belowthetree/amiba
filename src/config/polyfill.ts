// ============================================================
// 变形虫 (Amiba) — 兼容性 polyfill（须在入口最先加载）
// 目标环境：旧版 Android System WebView（Chrome < 92 无 Array.prototype.at，
// ai SDK 内部依赖 messages.at()，缺失会导致流式输出直接失败）
// ============================================================

const arrProto = Array.prototype as any
if (typeof arrProto.at !== 'function') {
  arrProto.at = function at(this: any[], index: number) {
    const len = this.length >>> 0
    let k = Math.trunc(index) || 0
    if (k < 0) k += len
    if (k < 0 || k >= len) return undefined
    return this[k]
  }
}

const strProto = String.prototype as any
if (typeof strProto.at !== 'function') {
  strProto.at = function at(this: string, index: number) {
    const s = String(this)
    let k = Math.trunc(index) || 0
    if (k < 0) k += s.length
    if (k < 0 || k >= s.length) return undefined
    return s.charAt(k)
  }
}
