// ============================================================
// 变形虫 (Amiba) — Network Worker 初始化
// ============================================================

export const networkWorker: Worker = new Worker(
  new URL('./network-worker.ts', import.meta.url),
  { type: 'module' }
)
