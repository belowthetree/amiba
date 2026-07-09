// ============================================================
// 变形虫 (Amiba) — 自定义视图存储层
// ============================================================
import { ref } from 'vue'

const CUSTOM_VIEWS_DIR = 'amiba/custom-views'

export interface CustomViewInfo {
  name: string
  hasContent: boolean
  contentLength: number
}

/** 当前快捷页面内容缓存（响应式） */
export const quickViewContent = ref<string>('')

// ================================================================
// 初始化
// ================================================================

let _initialized = false

export async function initCustomViewStore(): Promise<void> {
  if (_initialized) return
  try {
    const { mkdir, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const ok = await exists(CUSTOM_VIEWS_DIR, { baseDir: BaseDirectory.AppData })
    if (!ok) {
      await mkdir(CUSTOM_VIEWS_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
      console.log('[CustomViewStore] 已创建目录:', CUSTOM_VIEWS_DIR)
    }
    _initialized = true
    console.log('[CustomViewStore] 初始化完成')
  } catch (e) {
    console.warn('[CustomViewStore] 初始化失败（非 Tauri 环境?）:', e)
    _initialized = true
  }
}

// ================================================================
// 读写操作
// ================================================================

export async function loadCustomView(name: string): Promise<string> {
  try {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const content = await readTextFile(`${CUSTOM_VIEWS_DIR}/${name}.html`, { baseDir: BaseDirectory.AppData })
    console.log('[CustomViewStore] 加载视图:', name, `(${content.length} 字节)`)
    if (name === 'quick') quickViewContent.value = content
    return content
  } catch {
    console.log('[CustomViewStore] 视图为空:', name)
    if (name === 'quick') quickViewContent.value = ''
    return ''
  }
}

export async function saveCustomView(name: string, html: string): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(`${CUSTOM_VIEWS_DIR}/${name}.html`, html, { baseDir: BaseDirectory.AppData })
    if (name === 'quick') quickViewContent.value = html
    console.log('[CustomViewStore] 已保存视图:', name, `(${html.length} 字节)`)
  } catch (e) {
    console.error('[CustomViewStore] 保存视图失败:', e)
    throw e
  }
}

export async function resetCustomView(name: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`${CUSTOM_VIEWS_DIR}/${name}.html`, { baseDir: BaseDirectory.AppData })
    if (name === 'quick') quickViewContent.value = ''
    console.log('[CustomViewStore] 已重置视图:', name)
  } catch {
    if (name === 'quick') quickViewContent.value = ''
  }
}

export async function listCustomViews(): Promise<CustomViewInfo[]> {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(CUSTOM_VIEWS_DIR, { baseDir: BaseDirectory.AppData })
    const result: CustomViewInfo[] = []
    for (const e of entries as any[]) {
      if (e.name.endsWith('.html')) {
        const viewName = e.name.replace(/\.html$/, '')
        try {
          const { readTextFile } = await import('@tauri-apps/plugin-fs')
          const content = await readTextFile(`${CUSTOM_VIEWS_DIR}/${e.name}`, { baseDir: BaseDirectory.AppData })
          result.push({ name: viewName, hasContent: true, contentLength: content.length })
        } catch {
          result.push({ name: viewName, hasContent: false, contentLength: 0 })
        }
      }
    }
    return result
  } catch {
    return []
  }
}
