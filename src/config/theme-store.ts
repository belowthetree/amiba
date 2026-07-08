// ============================================================
// 变形虫 (Amiba) — 主题存储引擎（theme/ 目录）
// ============================================================
// 管理 {AppData}/amiba/theme/ 目录下的界面定制数据：
// - variables.json  — CSS 变量覆盖
// - custom.css      — 自定义 CSS
// - slots/          — 插槽 HTML 文件（每文件对应一个插槽）
// ============================================================

import { reactive } from 'vue'

const THEME_ROOT = 'amiba/theme'
const SLOTS_DIR = 'amiba/theme/slots'

export interface ThemeState {
  variables: Record<string, string>
  customCSS: string
  slots: Record<string, string>
  loading: boolean
}

export const themeState = reactive<ThemeState>({
  variables: {},
  customCSS: '',
  slots: {},
  loading: true,
})

export async function initThemeStore(): Promise<void> {
  try {
    const { readTextFile, readDir, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')

    await mkdir(THEME_ROOT, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
    await mkdir(SLOTS_DIR, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})

    // 加载 variables.json
    try {
      const raw = await readTextFile('amiba/theme/variables.json', { baseDir: BaseDirectory.AppData })
      themeState.variables = JSON.parse(raw)
    } catch { /* 文件不存在 */ }

    // 加载 custom.css
    try {
      themeState.customCSS = await readTextFile('amiba/theme/custom.css', { baseDir: BaseDirectory.AppData })
    } catch { /* 文件不存在 */ }

    // 加载所有插槽
    try {
      const entries = await readDir(SLOTS_DIR, { baseDir: BaseDirectory.AppData })
      for (const entry of entries as any[]) {
        if (entry.isDirectory) continue
        const slotName = entry.name.replace(/\.html$/, '')
        try {
          const content = await readTextFile(`amiba/theme/slots/${entry.name}`, { baseDir: BaseDirectory.AppData })
          themeState.slots[slotName] = content
        } catch { /* 跳过不可读文件 */ }
      }
    } catch { /* 目录不存在 */ }

    console.log('[ThemeStore] 加载完成 —',
      Object.keys(themeState.variables).length, '个变量,',
      themeState.customCSS.length, '字节CSS,',
      Object.keys(themeState.slots).length, '个插槽')
  } catch (e) {
    console.warn('[ThemeStore] 非 Tauri 环境，初始化为空')
  }
  themeState.loading = false
}

// ---- 持久化 ----

export async function saveThemeVariables(vars: Record<string, string>): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeTextFile('amiba/theme/variables.json', JSON.stringify(vars, null, 2), { baseDir: BaseDirectory.AppData })
    themeState.variables = { ...vars }
    console.log('[ThemeStore] 变量已保存:', Object.keys(vars).length, '个')
  } catch (e) {
    console.error('[ThemeStore] 保存变量失败:', e)
    throw e
  }
}

export async function saveCustomCSS(css: string): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeTextFile('amiba/theme/custom.css', css, { baseDir: BaseDirectory.AppData })
    themeState.customCSS = css
    console.log('[ThemeStore] CSS已保存:', css.length, '字节')
  } catch (e) {
    console.error('[ThemeStore] 保存CSS失败:', e)
    throw e
  }
}

export async function resetTheme(): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove('amiba/theme/variables.json', { baseDir: BaseDirectory.AppData }).catch(() => {})
    await remove('amiba/theme/custom.css', { baseDir: BaseDirectory.AppData }).catch(() => {})
    themeState.variables = {}
    themeState.customCSS = ''
    console.log('[ThemeStore] 主题已重置')
  } catch (e) {
    console.error('[ThemeStore] 重置失败:', e)
    throw e
  }
}

// ---- 插槽操作 ----

export async function saveSlot(slotName: string, html: string): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(`amiba/theme/slots/${slotName}.html`, html, { baseDir: BaseDirectory.AppData })
    themeState.slots[slotName] = html
    console.log('[ThemeStore] 插槽已保存:', slotName, html.length, '字节')
  } catch (e) {
    console.error('[ThemeStore] 保存插槽失败:', e)
    throw e
  }
}

export async function removeSlot(slotName: string): Promise<void> {
  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`amiba/theme/slots/${slotName}.html`, { baseDir: BaseDirectory.AppData }).catch(() => {})
    delete themeState.slots[slotName]
    console.log('[ThemeStore] 插槽已删除:', slotName)
  } catch (e) {
    console.error('[ThemeStore] 删除插槽失败:', e)
    throw e
  }
}
