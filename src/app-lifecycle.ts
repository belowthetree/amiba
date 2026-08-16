// ============================================================
// 变形虫 (Amiba) — App 生命周期事件封装
// ============================================================
// 使用 visibilitychange 覆盖所有平台：
// - 移动端（Android/iOS）：切后台 JS 暂停 → visibilitychange 触发 ✓
// - 桌面端：最小化时 JS 继续执行，无需快照；标签切换时触发 ✓
// ============================================================

export interface LifecycleHandlers {
  /** 页面隐藏（模拟进入后台） */
  onBackground: () => void | Promise<void>
  /** 页面可见（模拟回到前台） */
  onForeground: () => void | Promise<void>
}

export function initAppLifecycle(handlers: LifecycleHandlers): () => void {
  console.log('[AppLifecycle] 生命周期监听已注册 (visibilitychange)')
  const listener = () => {
    if (document.hidden) {
      console.log('[AppLifecycle] === 页面隐藏（模拟后台）===')
      try { handlers.onBackground() } catch (e) { console.error('[AppLifecycle] onBackground error:', e) }
    } else {
      console.log('[AppLifecycle] === 页面可见（模拟前台）===')
      try { handlers.onForeground() } catch (e) { console.error('[AppLifecycle] onForeground error:', e) }
    }
  }
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
