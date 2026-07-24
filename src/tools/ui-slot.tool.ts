// ============================================================
// 变形虫 (Amiba) — 插槽管理工具（ui_slot_*）
// ============================================================
import { toolRegistry } from './tool-registry'
import { themeState, saveSlot, removeSlot } from '../config/theme-store'

// ================================================================
// 预定义插槽列表及描述
// ================================================================

const SLOT_DEFS: Array<{ name: string; description: string; tips: string }> = [
  {
    name: 'chat.above-messages',
    description: '聊天页消息列表上方',
    tips: '适合放快捷指令按钮、上下文提示。',
  },
  {
    name: 'chat.below-input',
    description: '聊天页输入框下方',
    tips: '适合放快捷按钮、状态提示、键盘快捷键说明。',
  },
  {
    name: 'settings.extra',
    description: '设置页所有 Tab 内容末尾',
    tips: '适合放自定义配置项、扩展功能入口。',
  },
  {
    name: 'services.above-list',
    description: '服务列表页服务网格上方',
    tips: '适合放搜索框、分类筛选、批量操作按钮。',
  },
]

// ================================================================
// ui_slot_list — 列出所有可用插槽
// ================================================================

toolRegistry.register({
  name: 'ui_slot_list',
  toolset: 'ui',
  category: 'view',
  emoji: '🧩',
  description:
    '列出所有可用的界面插槽及其位置描述。在向某个页面位置添加内容前，先用此工具了解有哪些插槽可用。',
  maxResultSizeChars: 4000,
  schema: {
    type: 'function',
    function: {
      name: 'ui_slot_list',
      description: '列出所有可用的界面插槽，包括名称、位置描述和使用建议。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    const list = SLOT_DEFS.map((s) => ({
      name: s.name,
      description: s.description,
      tips: s.tips,
      has_content: !!themeState.slots[s.name],
      content_length: themeState.slots[s.name]?.length || 0,
    }))
    return JSON.stringify({ count: list.length, slots: list })
  },
})

// ================================================================
// ui_slot_get — 读取插槽内容
// ================================================================

toolRegistry.register({
  name: 'ui_slot_get',
  toolset: 'ui',
  category: 'view',
  emoji: '👁',
  description:
    '读取指定插槽的当前 HTML 内容。在修改或移除插槽前，先用此工具查看当前内容。',
  maxResultSizeChars: 8000,
  schema: {
    type: 'function',
    function: {
      name: 'ui_slot_get',
      description: '读取指定插槽名称的当前 HTML 内容。',
      parameters: {
        type: 'object',
        properties: {
          slot: {
            type: 'string',
            description: '插槽名称，如 "chat.above-messages"、"chat.below-input"。用 ui_slot_list 查看所有可用名称。',
          },
        },
        required: ['slot'],
      },
    },
  },
  handler: async (args) => {
    const content = themeState.slots[args.slot] || ''
    return JSON.stringify({
      slot: args.slot,
      has_content: !!content,
      length: content.length,
      content: content || null,
    })
  },
})

// ================================================================
// ui_slot_set — 设置插槽内容
// ================================================================

toolRegistry.register({
  name: 'ui_slot_set',
  toolset: 'ui',
  category: 'edit',
  emoji: '✏️',
  description:
    '设置界面插槽的 HTML 内容。可在指定位置添加自定义组件、信息或功能。内容为完整 HTML 片段，可包含 <style> 和 <script>。<script> 中推荐使用 IIFE 避免全局变量污染。',
  maxResultSizeChars: 3000,
  schema: {
    type: 'function',
    function: {
      name: 'ui_slot_set',
      description:
        '设置指定插槽的 HTML 内容。传入完整 HTML 片段（可含 <style> 和 <script>），立即在界面中渲染。',
      parameters: {
        type: 'object',
        properties: {
          slot: {
            type: 'string',
            description: '插槽名称，如 "chat.below-input"、"settings.extra"。',
          },
          html: {
            type: 'string',
            description:
              '完整的 HTML 内容，可包含 <style> 内联样式和 <script> 内联脚本。脚本使用 IIFE: (function(){ ... })()。',
          },
        },
        required: ['slot', 'html'],
      },
    },
  },
  handler: async (args) => {
    await saveSlot(args.slot, args.html)
    return JSON.stringify({ ok: true, slot: args.slot, length: args.html.length })
  },
})

// ================================================================
// ui_slot_remove — 清除插槽内容
// ================================================================

toolRegistry.register({
  name: 'ui_slot_remove',
  toolset: 'ui',
  category: 'manage',
  emoji: '🗑',
  description:
    '清除指定插槽的内容，界面恢复到此插槽的默认空白状态。不影响其他插槽和主题设置。',
  schema: {
    type: 'function',
    function: {
      name: 'ui_slot_remove',
      description: '移除指定插槽的 HTML 内容，恢复该位置的默认空白状态。',
      parameters: {
        type: 'object',
        properties: {
          slot: {
            type: 'string',
            description: '插槽名称，如 "chat.below-input"、"services.above-list"',
          },
        },
        required: ['slot'],
      },
    },
  },
  handler: async (args) => {
    await removeSlot(args.slot)
    return JSON.stringify({ ok: true, slot: args.slot })
  },
})
