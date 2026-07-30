// ============================================================
// 变形虫 (Amiba) — 主题存储引擎（theme/ 目录 · 多主题版）
// ============================================================
// {AppData}/amiba/theme/{name}/variables.json + custom.css
// slots/ 目录全局共享，不随主题切换。
// 内置主题从 public/themes/ 安装（不可修改）。
// ============================================================

import { reactive } from 'vue'
import { settings } from './config'

const THEME_ROOT = 'amiba/theme'
const SLOTS_DIR = 'amiba/theme/slots'

/** 内置主题清单（与 public/themes/ 目录保持一致） */
export const BUILTIN_THEMES = ['default', 'dark', 'ocean'] as const

export interface ThemeState {
  activeTheme: string
  themes: string[]
  variables: Record<string, string>
  customCSS: string
  slots: Record<string, string>
  loading: boolean
}

export const themeState = reactive<ThemeState>({
  activeTheme: 'default',
  themes: [],
  variables: {},
  customCSS: '',
  slots: {},
  loading: true,
})

// ---- Init ----

export async function initThemeStore(): Promise<void> {
  try {
    const { readTextFile, readDir, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')

    await mkdir(THEME_ROOT, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
    await mkdir(SLOTS_DIR, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})

    // 扫描主题目录
    await scanThemes()

    // 加载激活主题
    await loadActiveTheme()

    // 加载插槽
    await loadSlots()

    console.log('[ThemeStore] 加载完成 — 激活:', themeState.activeTheme,
      '| 主题:', themeState.themes.join(', '),
      '| 变量:', Object.keys(themeState.variables).length,
      '| 插槽:', Object.keys(themeState.slots).length)
  } catch (e) {
    console.warn('[ThemeStore] 非 Tauri 环境，初始化为空')
  }
  themeState.loading = false
}

async function scanThemes() {
  try {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(THEME_ROOT, { baseDir: BaseDirectory.AppData })
    themeState.themes = []
    for (const entry of entries as any[]) {
      if (entry.isDirectory && entry.name !== 'slots') {
        themeState.themes.push(entry.name)
      }
    }
    console.log('[ThemeStore] 扫描到主题:', themeState.themes)
  } catch { themeState.themes = []; return }
}

async function loadActiveTheme() {
  const active = settings.active_theme || 'default'
  themeState.activeTheme = active

  const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')

  try {
    const raw = await readTextFile(`amiba/theme/${active}/variables.json`, { baseDir: BaseDirectory.AppData })
    themeState.variables = JSON.parse(raw)
  } catch { themeState.variables = {} }

  try {
    themeState.customCSS = await readTextFile(`amiba/theme/${active}/custom.css`, { baseDir: BaseDirectory.AppData })
  } catch { themeState.customCSS = '' }
}

async function loadSlots() {
  try {
    const { readTextFile, readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(SLOTS_DIR, { baseDir: BaseDirectory.AppData })
    themeState.slots = {}
    for (const entry of entries as any[]) {
      if (entry.isDirectory) continue
      const slotName = entry.name.replace(/\.html$/, '')
      try {
        themeState.slots[slotName] = await readTextFile(`amiba/theme/slots/${entry.name}`, { baseDir: BaseDirectory.AppData })
      } catch { /* skip */ }
    }
  } catch { themeState.slots = {} }
}

// ---- 预置主题安装 ----

export async function installPrebuiltThemes(): Promise<number> {
  let installed = 0
  try {
    const { exists, mkdir, writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    for (const name of BUILTIN_THEMES) {
      const themeDir = `amiba/theme/${name}`
      const alreadyExists = await exists(themeDir, { baseDir: BaseDirectory.AppData }).catch(() => false)
      // 内置主题只读，每次启动都用 public/themes/ 的最新文件覆盖刷新，
      // 保证内置主题更新能下发到已有安装
      await mkdir(themeDir, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
      try {
        const varsResp = await fetch(`/themes/${name}/variables.json`)
        const varsText = varsResp.ok ? await varsResp.text() : '{}'
        await writeTextFile(`${themeDir}/variables.json`, varsText, { baseDir: BaseDirectory.AppData })
      } catch {
        await writeTextFile(`${themeDir}/variables.json`, '{}', { baseDir: BaseDirectory.AppData })
      }
      try {
        const cssResp = await fetch(`/themes/${name}/custom.css`)
        const cssText = cssResp.ok ? await cssResp.text() : ''
        await writeTextFile(`${themeDir}/custom.css`, cssText, { baseDir: BaseDirectory.AppData })
      } catch {
        await writeTextFile(`${themeDir}/custom.css`, '', { baseDir: BaseDirectory.AppData })
      }
      if (alreadyExists) {
        console.log(`[ThemeStore] 内置主题已刷新: ${name}`)
      } else {
        installed++
        console.log(`[ThemeStore] 已安装内置主题: ${name}`)
      }
    }
    if (installed > 0) {
      await scanThemes()
      // 如果 active 已存在就用它，否则用 default
      if (!themeState.themes.includes(themeState.activeTheme)) {
        themeState.activeTheme = 'default'
        settings.active_theme = 'default'
      }
    }
    // 激活的是内置主题时重新加载，让本次刷新立即生效
    if (isBuiltinTheme(themeState.activeTheme)) {
      await loadActiveTheme()
    }
  } catch (e) {
    console.error('[ThemeStore] 安装内置主题失败:', e)
  }
  return installed
}

// ---- 只读检测 ----

export function isBuiltinTheme(name: string): boolean {
  return (BUILTIN_THEMES as readonly string[]).includes(name)
}

function ensureWritableTheme(): string | null {
  if (!isBuiltinTheme(themeState.activeTheme)) return null
  // 自动创建用户主题
  const base = themeState.activeTheme === 'default' ? '我的主题' : `我的${themeState.activeTheme}`
  let name = base
  let i = 1
  while (themeState.themes.includes(name)) {
    name = `${base}${i}`
    i++
  }
  createTheme(name)
  switchTheme(name)
  console.log('[ThemeStore] 自动创建用户主题:', name)
  return name
}

// ---- 持久化 ----

export async function saveThemeVariables(vars: Record<string, string>): Promise<{ autoCreated?: string } | null> {
  const autoCreated = ensureWritableTheme()
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(`amiba/theme/${themeState.activeTheme}/variables.json`, JSON.stringify(vars, null, 2), { baseDir: BaseDirectory.AppData })
    themeState.variables = { ...vars }
    console.log('[ThemeStore] 变量已保存:', Object.keys(vars).length, '个 →', themeState.activeTheme)
    return autoCreated ? { autoCreated } : null
  } catch (e) {
    console.error('[ThemeStore] 保存变量失败:', e)
    throw e
  }
}

export async function saveCustomCSS(css: string): Promise<{ autoCreated?: string } | null> {
  const autoCreated = ensureWritableTheme()
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(`amiba/theme/${themeState.activeTheme}/custom.css`, css, { baseDir: BaseDirectory.AppData })
    themeState.customCSS = css
    console.log('[ThemeStore] CSS已保存:', css.length, '字节 →', themeState.activeTheme)
    return autoCreated ? { autoCreated } : null
  } catch (e) {
    console.error('[ThemeStore] 保存CSS失败:', e)
    throw e
  }
}

export async function resetTheme(): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(`amiba/theme/${themeState.activeTheme}/variables.json`, '{}', { baseDir: BaseDirectory.AppData })
    await writeTextFile(`amiba/theme/${themeState.activeTheme}/custom.css`, '', { baseDir: BaseDirectory.AppData })
    themeState.variables = {}
    themeState.customCSS = ''
    console.log('[ThemeStore] 主题已重置:', themeState.activeTheme)
  } catch (e) {
    console.error('[ThemeStore] 重置失败:', e)
    throw e
  }
}

// ---- 主题管理 ----

export function listThemes(): string[] {
  return themeState.themes
}

export async function createTheme(name: string, fromActive = true): Promise<void> {
  if (!name.trim()) throw new Error('主题名不能为空')
  if (themeState.themes.includes(name)) throw new Error(`主题 "${name}" 已存在`)

  try {
    const { mkdir, writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir(`amiba/theme/${name}`, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})

    if (fromActive) {
      await writeTextFile(`amiba/theme/${name}/variables.json`,
        JSON.stringify(themeState.variables, null, 2), { baseDir: BaseDirectory.AppData })
      await writeTextFile(`amiba/theme/${name}/custom.css`,
        themeState.customCSS, { baseDir: BaseDirectory.AppData })
    } else {
      await writeTextFile(`amiba/theme/${name}/variables.json`, '{}', { baseDir: BaseDirectory.AppData })
      await writeTextFile(`amiba/theme/${name}/custom.css`, '', { baseDir: BaseDirectory.AppData })
    }
    themeState.themes.push(name)
    console.log('[ThemeStore] 主题已创建:', name)
  } catch (e) {
    console.error('[ThemeStore] 创建主题失败:', e)
    throw e
  }
}

export async function deleteTheme(name: string): Promise<void> {
  if (isBuiltinTheme(name)) throw new Error(`内置主题 "${name}" 不可删除`)
  if (name === themeState.activeTheme) throw new Error(`不能删除当前激活的主题 "${name}"`)
  if (!themeState.themes.includes(name)) throw new Error(`主题 "${name}" 不存在`)

  try {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await remove(`amiba/theme/${name}`, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {})
    themeState.themes = themeState.themes.filter((t) => t !== name)
    console.log('[ThemeStore] 主题已删除:', name)
  } catch (e) {
    console.error('[ThemeStore] 删除主题失败:', e)
    throw e
  }
}

export async function switchTheme(name: string): Promise<void> {
  if (!themeState.themes.includes(name)) throw new Error(`主题 "${name}" 不存在`)
  if (name === themeState.activeTheme) return

  settings.active_theme = name
  themeState.activeTheme = name
  await loadActiveTheme()
  console.log('[ThemeStore] 已切换到:', name)
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
