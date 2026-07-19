// ============================================================
// 变形虫 (Amiba) — 文件夹选取统一入口
// ============================================================
// 自动适配三个平台：
//   - Android: invoke('pick_folder') → Rust JNI → Kotlin FolderPickerHelper
//   - 桌面 (Tauri): @tauri-apps/plugin-dialog open({ directory: true })
//   - 浏览器: prompt 手动输入路径
//
// 错误处理层级：
//   1. Rust 端 JVM 不可用 → 返回错误 → 回退到 prompt 手动输入
//   2. 用户取消 → 返回 null
//   3. 其他异常 → 提示用户后回退到 prompt
// ============================================================

/**
 * 弹出系统文件夹选择器，返回所选文件夹路径。
 * 用户取消时返回 null；失败时回退到 prompt 手动输入。
 */
export async function pickFolder(title: string = '选择文件夹'): Promise<string | null> {
  // 使用 try/catch 动态 import 检测 Tauri（Android WebView 中 __TAURI__ 可能不存在）
  let isTauri = false
  let osName = 'web'
  try {
    const { platform } = await import('@tauri-apps/api/core')
    osName = platform()
    isTauri = true
  } catch { /* web */ }

  if (!isTauri) {
    // 浏览器环境
    console.warn('[FolderPicker] 非 Tauri 环境，回退到手动输入')
    const manual = prompt('请输入文件夹路径:', '/storage/emulated/0/')
    return manual || null
  }

  // ==== Android：原生文件选择器 ====
  if (osName === 'android') {
    const { invoke } = await import('@tauri-apps/api/core')
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
      console.warn('[FolderPicker] pick_folder 失败:', errMsg)
      // JVM 未就绪 / Activity 异常等 → 回退到 prompt
      const manual = prompt(
        `无法打开系统文件选择器\n请手动输入文件夹路径:`,
        '/storage/emulated/0/'
      )
      return manual || null
    }
  }

  // ==== 桌面：plugin-dialog 原生目录选择器 ====
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    })
    if (!selected || typeof selected !== 'string') {
      console.log('[FolderPicker] 用户取消桌面选取')
      return null
    }
    console.log('[FolderPicker] ✓ 桌面 plugin-dialog 选取:', selected)
    return selected
  } catch (e: any) {
    console.warn('[FolderPicker] plugin-dialog 失败，回退到手动输入:', e?.message || String(e))
    const manual = prompt('请输入文件夹路径:', '')
    return manual || null
  }
}
