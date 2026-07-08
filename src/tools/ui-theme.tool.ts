// ============================================================
// 变形虫 (Amiba) — 主题定制工具（ui_theme_*）
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  themeState,
  saveThemeVariables,
  saveCustomCSS,
  resetTheme,
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
        '查看当前已修改的 CSS 变量值和自定义 CSS。完整参考文档请用 doc_read("ui-customization.md")。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    return JSON.stringify({
      css_variables: themeState.variables,
      custom_css: themeState.customCSS,
      variable_count: Object.keys(themeState.variables).length,
      custom_css_length: themeState.customCSS.length,
      hint: '各 CSS 变量的影响区域和宿主 CSS 选择器速查表，请用 doc_read("ui-customization.md") 查看。',
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
    '设置单个 CSS 变量值，用于修改界面外观。如修改主色、圆角、字体大小等。常用变量：--color-primary, --color-bg, --color-surface, --color-text, --radius-md, --font-size-md 等。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_set_variable',
      description:
        '设置单个 CSS 变量（如 --color-primary: #FF5722）。视图生效后立即可见。如需批量修改请用 ui_theme_set_variables。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'CSS 变量名。常用变量及影响区域：\n' +
              '--color-primary（主色：按钮/链接/欢迎卡片）、--color-bg（页面背景）、--color-surface（卡片/顶栏背景）、--color-text（正文颜色）、\n' +
              '--radius-md（卡片圆角）、--radius-sm（按钮/输入框圆角）、--font-size-md（正文大小）、--font-size-xl（主标题大小）、\n' +
              '--spacing-md（页面内边距）、--topbar-bg（顶栏背景）、--card-bg（卡片背景）、--input-border（输入框边框）。\n' +
              '完整列表用 ui_theme_view 查看。',
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
    await saveThemeVariables(vars)
    return JSON.stringify({ ok: true, name: args.name, value: args.value })
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
    '批量设置多个 CSS 变量，用于一次性调整整体外观（如切换到完整的配色方案）。传入键值对对象，键为 CSS 变量名。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_set_variables',
      description:
        '批量设置多个 CSS 变量。比逐个调用 ui_theme_set_variable 更高效，适合整体换肤。',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            description:
              'CSS 变量名到值的映射，如 { "--color-primary": "#FF5722", "--radius-md": "20px" }',
          },
        },
        required: ['variables'],
      },
    },
  },
  handler: async (args) => {
    const vars = { ...themeState.variables, ...args.variables }
    await saveThemeVariables(vars)
    return JSON.stringify({
      ok: true,
      count: Object.keys(args.variables).length,
    })
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
    '设置原始自定义 CSS 注入到全局。用于实现 CSS 变量无法覆盖的样式调整（如复杂选择器、动画、responsive 规则等）。传入完整的 CSS 字符串。',
  maxResultSizeChars: 4000,
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_set_css',
      description:
        '注入全局自定义 CSS 样式。适用于 CSS 变量无法满足的复杂样式调整。传入的 CSS 会追加到已有自定义 CSS 末尾。',
      parameters: {
        type: 'object',
        properties: {
          css: {
            type: 'string',
            description: 'CSS 样式代码，如 ".topbar { background: linear-gradient(...); }"',
          },
        },
        required: ['css'],
      },
    },
  },
  handler: async (args) => {
    await saveCustomCSS(args.css)
    return JSON.stringify({ ok: true, length: args.css.length })
  },
})

// ================================================================
// ui_theme_reset — 重置所有主题设置
// ================================================================

toolRegistry.register({
  name: 'ui_theme_reset',
  toolset: 'ui',
  category: 'manage',
  emoji: '🔄',
  description:
    '重置所有主题自定义设置，恢复到默认外观。清除所有 CSS 变量覆盖和自定义 CSS（不影响插槽内容）。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_theme_reset',
      description: '重置所有界面主题定制，恢复到变形虫默认外观。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    await resetTheme()
    return JSON.stringify({ ok: true, message: '主题已恢复到默认设置' })
  },
})
