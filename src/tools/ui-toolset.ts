// ============================================================
// 变形虫 (Amiba) — UI Toolset 定义
// ============================================================
import type { ToolsetDef } from './toolsets'

export const UI_TOOLSET: Record<string, ToolsetDef> = {
  ui: {
    tools: [
      'ui_theme_view',
      'ui_theme_set_variable',
      'ui_theme_set_variables',
      'ui_theme_set_css',
      'ui_theme_reset',
      'ui_slot_list',
      'ui_slot_get',
      'ui_slot_set',
      'ui_slot_remove',
      'custom_view_list',
      'custom_view_read',
      'custom_view_edit',
      'custom_view_write',
    ],
  },
}
