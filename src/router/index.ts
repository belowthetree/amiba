// ============================================================
// 变形虫 (Amiba) — 路由定义（页面由 pageRegistry 动态注册）
// ============================================================
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [],
})

// ==== 动态导入失败自愈 ====
// dev 模式 HMR 未到达（如 Android WebView）或生产发版后旧会话引用失效 chunk 时，
// 懒加载页面会报 "Failed to fetch dynamically imported module"，刷新一次即可恢复
let lastChunkReloadAt = 0
router.onError((error) => {
  console.error('[Router] 导航错误:', error)
  const isChunkLoadError = /dynamically imported module|Loading chunk .* failed/i.test(error.message)
  if (isChunkLoadError && Date.now() - lastChunkReloadAt > 10_000) {
    lastChunkReloadAt = Date.now()
    console.warn('[Router] 检测到页面 chunk 加载失败，刷新页面以恢复')
    window.location.reload()
  }
})

export default router
