// ============================================================
// 变形虫 (Amiba) — 文件夹选取统一入口
// ============================================================
// Android: tauri-plugin-android-fs SAF Picker
// 桌面: @tauri-apps/plugin-dialog
// 浏览器: prompt 手动输入
// ============================================================

export async function pickFolder(title: string = '选择文件夹'): Promise<string | null> {
  // 1) Android: 直接尝试 tauri-plugin-android-fs（不依赖 isAndroid()）
  try {
    const mod = await import('tauri-plugin-android-fs-api')
    const { AndroidFs } = mod
    const uri = await AndroidFs.showOpenDirPicker()
    if (uri) {
      console.log('[FolderPicker] ✓ Android SAF:', uri.uri)
      return uri.uri
    }
    console.log('[FolderPicker] 用户取消 Android 选取')
    return null
  } catch (e: any) {
    // 不是 Android 或插件不可用 → 继续尝试桌面
    console.log('[FolderPicker] Android FS 不可用:', e?.message || String(e))
  }

  // 2) 桌面 Tauri: plugin-dialog
  let isTauri = false
  try { await import('@tauri-apps/api/core'); isTauri = true } catch { /* web */ }
  if (isTauri) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, multiple: false, title })
      if (selected && typeof selected === 'string') {
        console.log('[FolderPicker] ✓ 桌面:', selected)
        return selected
      }
      console.log('[FolderPicker] 用户取消桌面选取')
      return null
    } catch (e: any) {
      console.warn('[FolderPicker] plugin-dialog 失败:', e?.message || String(e))
    }
  }

  // 3) 浏览器 fallback
  const manual = prompt('请输入文件夹路径:', '/storage/emulated/0/')
  return manual || null
}
