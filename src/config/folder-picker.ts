// ============================================================
// 变形虫 (Amiba) — 文件夹选取统一入口
// ============================================================
// 自动适配三个平台：
//   - Android: invoke('pick_folder') → Rust JNI → Kotlin FolderPickerHelper
//   - 桌面 (Tauri): @tauri-apps/plugin-dialog open({ directory: true })
//   - 浏览器: <input webkitdirectory> fallback（如有需要）
// ============================================================

/**
 * 弹出系统文件夹选择器，返回所选文件夹路径。
 * 用户取消时返回 null；失败时抛出异常。
 */
export async function pickFolder(title: string = '选择文件夹'): Promise<string | null> {
  // 使用 try/catch 动态 import 检测 Tauri（Android WebView 中 __TAURI__ 可能不存在）
  let isTauri = false
  try { await import('@tauri-apps/api/core'); isTauri = true } catch { /* web */ }

  if (!isTauri) {
    // 浏览器环境：使用 prompt 手动输入路径
    console.warn('[FolderPicker] 非 Tauri 环境，回退到手动输入')
    const manual = prompt(
      '请输入文件夹路径（例如 /storage/emulated/0/Documents）:',
      '/storage/emulated/0/'
    )
    return manual || null
  }

  const { invoke } = await import('@tauri-apps/api/core')

  // 先尝试 Android 专用 Rust command
  try {
    const path = await invoke<string>('pick_folder', { title })
    if (path) {
      console.log('[FolderPicker] Android 原生选取:', path)
      return path
    }
    return null
  } catch (e: any) {
    // Command 不存在 → 桌面端，使用 plugin-dialog
    if (e?.message?.includes('command not found') || e?.toString?.().includes('not found')) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      })
      if (!selected || typeof selected !== 'string') {
        return null
      }
      console.log('[FolderPicker] 桌面 plugin-dialog 选取:', selected)
      return selected
    }
    // 用户取消
    if (e?.message === '用户取消') {
      return null
    }
    // 其他错误（JVM 未就绪等）→ 回退到 prompt
    console.warn('[FolderPicker] pick_folder 失败，回退到手动输入:', e?.message || e)
    const manual = prompt(
      '请输入文件夹路径（例如 /storage/emulated/0/Music）:',
      '/storage/emulated/0/'
    )
    return manual || null
  }
}
