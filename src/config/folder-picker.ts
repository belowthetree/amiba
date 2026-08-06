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

// ---- 鸿蒙 picker URI 工具 ----
// picker URI 形态 file://docs/storage/Users/currentUser/...（沙箱外授权目录，
// native-fs 的 resolveSafe 会拒绝，枚举/读取须走壳层 file_access_* 命令族）

export function isHarmonyPickerUri(path: string): boolean {
  return path.startsWith('file://docs/')
}

// 子项 URI 按段编码拼接（与壳层 PickerCommands.joinUri 拼法一致）
export function harmonyPickerChildUri(rootUri: string, relativePath: string): string {
  const segs = relativePath.split('/').filter(s => s.length > 0).map(encodeURIComponent)
  return segs.length > 0 ? `${rootUri}/${segs.join('/')}` : rootUri
}

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

  // 2) 鸿蒙: DocumentViewPicker（picker URI 授权目录；取消返回 null）
  if (isHarmonyRuntime()) {
    try {
      // 无 FolderSelection syscap 的设备（手机）壳层自动降级 FILE 多选返回 {files}——
      // 通用 pickFolder 的调用方要的是文件夹（服务/技能导入），此时抛「设备不支持」；
      // 能用文件清单授权的场景（fileAccess）不经此函数，直调桥命令处理 {files}
      const r = await nativeInvoke<{ uri?: string; files?: unknown[] } | null>(PICKER_COMMANDS.pickFolder)
      if (r?.uri) {
        console.log('[FolderPicker] ✓ 鸿蒙 picker:', r.uri)
        return r.uri
      }
      if (r?.files) {
        throw new Error('当前设备不支持选择文件夹（鸿蒙手机端限制，仅 PC/2in1 等设备支持）')
      }
      console.log('[FolderPicker] 用户取消鸿蒙选取')
      return null
    } catch (e: any) {
      // 鸿蒙无可用回退（桌面 plugin-dialog 不存在；prompt() 手输路径必被沙箱拒绝），
      // 直接抛出让调用方 alert 出失败原因——静默落 prompt() 在 ArkWeb 上不渲染，表现为「按钮没反应」
      console.warn('[FolderPicker] 鸿蒙 picker 失败:', e?.message || String(e))
      throw new Error(`文件夹选取失败: ${e?.message || String(e)}`)
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
