// ============================================================
// 变形虫 (Amiba) — 主题定制工具（ui_theme_*）
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  themeState,
  saveThemeVariables,
  saveCustomCSS,
  resetTheme,
  listThemes,
  createTheme,
  deleteTheme,
  switchTheme,
  isBuiltinTheme,
} from '../config/theme-store'

// ================================================================
// ui_theme_view — 查看当前主题
// ================================================================

toolRegistry.register({
  name: 'ui_theme_view',
  toolset: 'ui',
  category: 'view',
  emoji: '🎨',
  description:
    '查看当前界面主题状态。CSS 变量效果说明和选择器速查表见 doc_read("ui-customization.md")。修改主题前先读文档了解各变量/选择器用途，再用此工具查看当前值。',
  maxResultSizeChars: 8000,
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_view',
      description:
        '查看当前激活主题的 CSS 变量值、自定义 CSS、以及所有可用主题列表。完整参考文档用 doc_read("ui-customization.md")。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    const themes = listThemes().map((name) => ({
      name,
      is_builtin: isBuiltinTheme(name),
      is_active: name === themeState.activeTheme,
    }))
    return JSON.stringify({
      active_theme: themeState.activeTheme,
      is_builtin: isBuiltinTheme(themeState.activeTheme),
      css_variables: themeState.variables,
      custom_css: themeState.customCSS,
      variable_count: Object.keys(themeState.variables).length,
      custom_css_length: themeState.customCSS.length,
      available_themes: themes,
      hint: '各 CSS 变量影响区域和宿主 CSS 选择器速查表，请用 doc_read("ui-customization.md") 查看。内置主题不可修改，修改时会自动创建用户主题。',
    })
  },
})

// ================================================================
// ui_theme_list — 列出所有主题
// ================================================================

toolRegistry.register({
  name: 'ui_theme_list',
  toolset: 'ui',
  category: 'view',
  emoji: '📋',
  description:
    '列出所有可用主题，包括内置主题和用户自建主题。标记当前激活的是哪个，以及哪些是内置不可修改的。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_list',
      description: '列出所有可用主题及其状态。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    const themes = listThemes().map((name) => ({
      name,
      is_builtin: isBuiltinTheme(name),
      is_active: name === themeState.activeTheme,
    }))
    return JSON.stringify({
      themes,
      active: themeState.activeTheme,
      builtin_count: themes.filter((t) => t.is_builtin).length,
      user_count: themes.filter((t) => !t.is_builtin).length,
    })
  },
})

// ================================================================
// ui_theme_set_variable — 设置单个 CSS 变量
// ================================================================

toolRegistry.register({
  name: 'ui_theme_set_variable',
  toolset: 'ui',
  category: 'edit',
  emoji: '✏️',
  description:
    '设置单个 CSS 变量值，用于修改界面外观。如修改主色、圆角、字体大小等。如果当前主题是内置的不可修改，会自动创建用户主题。常用变量及影响区域见 doc_read("ui-customization.md")。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_set_variable',
      description:
        '设置单个 CSS 变量。如果当前是内置主题（default/dark/ocean），会自动创建用户主题并切换。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'CSS 变量名。常用：--color-primary（主色/按钮/链接）、--color-bg（页面背景）、--color-surface（卡片/顶栏背景）、--color-text（正文）、--radius-md（卡片圆角）、--font-size-md（正文大小）、--font-size-xl（主标题）。完整列表见 ui-customization.md。',
          },
          value: {
            type: 'string',
            description: 'CSS 变量值，如 #FF5722、20px、1.2em',
          },
        },
        required: ['name', 'value'],
      },
    },
  },
  handler: async (args) => {
    const vars = { ...themeState.variables, [args.name]: args.value }
    const meta = await saveThemeVariables(vars)
    const result: any = { ok: true, name: args.name, value: args.value, active_theme: themeState.activeTheme }
    if (meta?.autoCreated) {
      result.auto_created_theme = meta.autoCreated
      result.message = `当前主题为内置主题不可修改，已自动创建用户主题 "${meta.autoCreated}" 并写入。`
    }
    return JSON.stringify(result)
  },
})

// ================================================================
// ui_theme_set_variables — 批量设置 CSS 变量
// ================================================================

toolRegistry.register({
  name: 'ui_theme_set_variables',
  toolset: 'ui',
  category: 'edit',
  emoji: '🎨',
  description:
    '批量设置多个 CSS 变量，用于一次性调整整体外观（如切换到完整的配色方案）。传入键值对对象。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_set_variables',
      description: '批量设置多个 CSS 变量。比逐个调用更高效，适合整体换肤。内置主题会自动创建用户主题。',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            description: 'CSS 变量名到值的映射，如 { "--color-primary": "#FF5722", "--radius-md": "20px" }',
          },
        },
        required: ['variables'],
      },
    },
  },
  handler: async (args) => {
    const vars = { ...themeState.variables, ...args.variables }
    const meta = await saveThemeVariables(vars)
    const result: any = { ok: true, count: Object.keys(args.variables).length, active_theme: themeState.activeTheme }
    if (meta?.autoCreated) {
      result.auto_created_theme = meta.autoCreated
      result.message = `当前主题为内置主题不可修改，已自动创建用户主题 "${meta.autoCreated}" 并写入。`
    }
    return JSON.stringify(result)
  },
})

// ================================================================
// ui_theme_set_css — 设置自定义 CSS
// ================================================================

toolRegistry.register({
  name: 'ui_theme_set_css',
  toolset: 'ui',
  category: 'edit',
  emoji: '📝',
  description:
    '设置原始自定义 CSS 注入到全局。用于实现 CSS 变量无法覆盖的样式调整（如复杂选择器、动画、responsive 规则等）。选择器速查表见 doc_read("ui-customization.md")。',
  maxResultSizeChars: 4000,
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_set_css',
      description: '注入全局自定义 CSS 样式。CSS 选择器参考 ui-customization.md。内置主题会自动创建用户主题。',
      parameters: {
        type: 'object',
        properties: {
          css: {
            type: 'string',
            description: 'CSS 样式代码，如 ".chat-page { background: #e8f5e9; }"。选择器名参考 ui-customization.md。',
          },
        },
        required: ['css'],
      },
    },
  },
  handler: async (args) => {
    const meta = await saveCustomCSS(args.css)
    const result: any = { ok: true, length: args.css.length, active_theme: themeState.activeTheme }
    if (meta?.autoCreated) {
      result.auto_created_theme = meta.autoCreated
      result.message = `当前主题为内置主题不可修改，已自动创建用户主题 "${meta.autoCreated}" 并写入。`
    }
    return JSON.stringify(result)
  },
})

// ================================================================
// ui_theme_reset — 重置当前主题
// ================================================================

toolRegistry.register({
  name: 'ui_theme_reset',
  toolset: 'ui',
  category: 'manage',
  emoji: '🔄',
  description:
    '重置当前激活主题的 CSS 变量和自定义 CSS 为空白（内置主题不支持重置，请先切换到用户主题）。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_reset',
      description: '重置当前激活主题的样式为空白。内置主题不可重置，需切换到用户主题后操作。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    if (isBuiltinTheme(themeState.activeTheme)) {
      return JSON.stringify({
        error: `当前主题 "${themeState.activeTheme}" 是内置主题，不可重置。请切换到用户主题后再重置，或用 ui_theme_create 从当前主题创建一个新的用户主题。`,
      })
    }
    await resetTheme()
    return JSON.stringify({ ok: true, message: '主题已重置为空白', active_theme: themeState.activeTheme })
  },
})

// ================================================================
// ui_theme_create — 创建新主题
// ================================================================

toolRegistry.register({
  name: 'ui_theme_create',
  toolset: 'ui',
  category: 'manage',
  emoji: '➕',
  description:
    '从当前激活主题复制创建一个新的用户主题。新主题可以自由修改和删除。创建后不会自动切换，需要调用 ui_theme_switch。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_create',
      description: '复制当前主题为一个新的用户主题。内置主题不可修改，修改前需先创建用户主题。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '新主题名称，如 "暗夜模式"、"ocean-blue"',
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (args) => {
    try {
      await createTheme(args.name, true)
      return JSON.stringify({ ok: true, name: args.name, message: `主题 "${args.name}" 已创建（复制自 ${themeState.activeTheme}）` })
    } catch (e: any) {
      return JSON.stringify({ error: e.message })
    }
  },
})

// ================================================================
// ui_theme_delete — 删除用户主题
// ================================================================

toolRegistry.register({
  name: 'ui_theme_delete',
  toolset: 'ui',
  category: 'manage',
  emoji: '🗑',
  description:
    '删除一个用户自建主题。内置主题不可删除，当前激活的主题不可删除（先切换到其他主题）。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_delete',
      description: '删除指定的用户自建主题。内置主题和当前激活主题不可删除。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '要删除的主题名称',
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (args) => {
    try {
      await deleteTheme(args.name)
      return JSON.stringify({ ok: true, name: args.name, message: `主题 "${args.name}" 已删除` })
    } catch (e: any) {
      return JSON.stringify({ error: e.message })
    }
  },
})

// ================================================================
// ui_theme_switch — 切换激活主题
// ================================================================

toolRegistry.register({
  name: 'ui_theme_switch',
  toolset: 'ui',
  category: 'manage',
  emoji: '🔄',
  description:
    '切换到指定主题。切换后界面样式立即更新。切换到内置主题（default/dark/ocean）后，修改样式会自动创建用户主题。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_switch',
      description: '切换激活的主题。切换后样式立即生效。可用 ui_theme_list 查看所有可选主题。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '主题名称，如 "default"、"dark"、"ocean" 或用户创建的主题名',
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (args) => {
    try {
      await switchTheme(args.name)
      return JSON.stringify({ ok: true, active_theme: themeState.activeTheme, message: `已切换到主题 "${args.name}"` })
    } catch (e: any) {
      return JSON.stringify({ error: e.message })
    }
  },
})
