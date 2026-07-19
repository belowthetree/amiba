// ============================================================
// 变形虫 (Amiba) — 文件夹选取统一入口
// ============================================================
// 自动适配三个平台：
//   - Android: invoke('pick_folder') → Rust JNI → Kotlin FolderPickerHelper
//   - 桌面 (Tauri): invoke 失败 (command not found) → plugin-dialog
//   - 浏览器: invoke 失败 → prompt 手动输入
// ============================================================

/**
 * 弹出系统文件夹选择器，返回所选文件夹路径。
 * 用户取消时返回 null；失败时回退到 prompt 手动输入。
 */
export async function pickFolder(title: string = '选择文件夹'): Promise<string | null> {
  let isTauri = false
  try { await import('@tauri-apps/api/core'); isTauri = true } catch { /* web */ }

  if (!isTauri) {
    console.warn('[FolderPicker] 非 Tauri 环境，回退到手动输入')
    const manual = prompt('请输入文件夹路径:', '/storage/emulated/0/')
    return manual || null
  }

  const { invoke } = await import('@tauri-apps/api/core')

  // 尝试 Android 专用 pick_folder command（仅 Android 平台注册）
  try {
    const path = await invoke<string>('pick_folder', { title })
    if (path) {
      console.log('[FolderPicker] ✓ Android 原生选取:', path)
      return path
    }
    console.log('[FolderPicker] 用户取消选取')
    return null
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    console.log('[FolderPicker] pick_folder 不可用:', errMsg)

    // command not found → 桌面端，使用 plugin-dialog
    if (errMsg.includes('command not found')) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const selected = await open({ directory: true, multiple: false, title })
        if (!selected || typeof selected !== 'string') {
          console.log('[FolderPicker] 用户取消桌面选取')
          return null
        }
        console.log('[FolderPicker] ✓ 桌面 plugin-dialog 选取:', selected)
        return selected
      } catch (dialogErr: any) {
        console.warn('[FolderPicker] plugin-dialog 失败:', dialogErr?.message || String(dialogErr))
        const manual = prompt('请输入文件夹路径:', '')
        return manual || null
      }
    }

    // Android 上 JVM 不可用 / Activity 异常等 → 回退到 prompt
    console.warn('[FolderPicker] 回退到手动输入')
    const manual = prompt(
      `无法打开系统文件选择器\n请手动输入文件夹路径:`,
      '/storage/emulated/0/'
    )
    return manual || null
  }
}
