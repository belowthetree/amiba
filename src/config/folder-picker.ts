// ============================================================
// 变形虫 (Amiba) — 文件夹选取统一入口
// ============================================================
// Android: tauri-plugin-android-fs SAF Picker
// 鸿蒙: DocumentViewPicker（javaScriptProxy 桥，返回 picker URI file://docs/...）
// 桌面: @tauri-apps/plugin-dialog
// 浏览器: prompt 手动输入
// ============================================================

import { isTauriRuntime, isHarmonyRuntime, nativeInvoke } from './platform-bridge'
import { PICKER_COMMANDS } from '../types/native-bridge'

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

  // 2) 鸿蒙: DocumentViewPicker（picker URI 授权目录；取消返回 null，失败落下一级）
  if (isHarmonyRuntime()) {
    try {
      const r = await nativeInvoke<{ uri: string } | null>(PICKER_COMMANDS.pickFolder)
      if (r?.uri) {
        console.log('[FolderPicker] ✓ 鸿蒙 picker:', r.uri)
        return r.uri
      }
      console.log('[FolderPicker] 用户取消鸿蒙选取')
      return null
    } catch (e: any) {
      console.warn('[FolderPicker] 鸿蒙 picker 失败:', e?.message || String(e))
    }
  }

  // 3) 桌面 Tauri: plugin-dialog
  const isTauri = isTauriRuntime()
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

  // 4) 浏览器 fallback
  const manual = prompt('请输入文件夹路径:', '/storage/emulated/0/')
  return manual || null
}
