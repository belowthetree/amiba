// ============================================================
// 变形虫 (Amiba) — 系统桌面卡片工具（desktop_widget_*）
//
// 卡片定义由服务自身目录维护：services/{id}/desktop-widgets/{cardId}/
// （widget.json + logic.js + assets/，用 service_file_* 工具创建/修改）。
// 本组工具负责：查看卡片、启用/停用、立即刷新、创建/删除全局卡片。
// Android（AppWidget）与鸿蒙（FormKit）生效；用户需在系统桌面添加"变形虫"小组件并选择卡片。
// ============================================================
import { toolRegistry } from './tool-registry'
import {
  desktopWidgetDefs,
  enabledWidgetKeys,
  rescanDesktopWidgets,
  setCardEnabled,
  loadCardPayload,
  writeGlobalCardFile,
  deleteWidgetCard,
} from '../config/desktop-widget-store'
import { refreshWidgetCard, refreshAllWidgetCards } from '../host/desktop-widget-runner'
import { detectPlatform } from '../config/updater'
import { isHarmonyRuntime } from '../config/platform-bridge'

// 系统桌面卡片仅 Android / 鸿蒙（FormKit）可用，桌面与浏览器不暴露本组工具
const widgetSupported = () => detectPlatform() === 'android' || isHarmonyRuntime()

// ================================================================
// desktop_widget_create — 创建全局桌面卡片（不依附服务）
// ================================================================

toolRegistry.register({
  name: 'desktop_widget_create',
  toolset: 'ui',
  checkFn: widgetSupported,
  category: 'manage',
  emoji: '✨',
  description:
    '创建全局系统桌面卡片（不依附任何服务，写入 {AppData}/amiba/desktop-widgets/cards/{cardId}/；Android AppWidget 与鸿蒙 FormKit 通用）。默认路径：用户要桌面卡片一律先用此工具。仅当用户明确要求"服务卡片"、卡片需读写某服务自身数据（共享 storage）、或需随服务分发时，才改用 service_file_write 写 services/{id}/desktop-widgets/（规范见 desktop-widget-dev 技能）。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'desktop_widget_create',
      description:
        '创建全局桌面卡片：widget.json（界面配置）+ logic.js（数据逻辑，恰好调用一次 __amiba__.desktopWidget.publish()，仅可用 desktopWidget + storage 模块）。创建后自动启用并刷新。规范详见 desktop-widget-dev 技能。',
      parameters: {
        type: 'object',
        properties: {
          cardId: {
            type: 'string',
            description: '卡片标识，kebab-case，如 "daily-quote"、"clock"',
          },
          label: {
            type: 'string',
            description: '显示名称（2-8 字），如 "每日一句"',
          },
          description: { type: 'string', description: '可选。选卡页副标题说明' },
          layout: {
            type: 'string',
            enum: ['lines', 'bigText', 'image'],
            description: '布局骨架：lines=文本行列表（默认），bigText=大字单值，image=图片为主',
          },
          size: {
            type: 'string',
            enum: ['small', 'medium', 'large'],
            description:
              '尺寸档位：small=2x2 格，medium=4x2 格（默认），large=4x4 格。决定用户在桌面添加哪个"变形虫卡片·小/中/大"入口时能选到此卡片。小尺寸建议 bigText 或 maxLines≤2。',
          },
          accentColor: { type: 'string', description: '可选。标题颜色，如 "#5f8f7b"' },
          backgroundColor: { type: 'string', description: '可选。卡片背景色 #RRGGBB 或 #AARRGGBB（可半透明），如 "#CC1a2f27"' },
          textColor: { type: 'string', description: '可选。正文文本行颜色（lines/bigText 布局）' },
          hideTitleBar: { type: 'boolean', description: '可选。true=隐藏标题栏（icon+标题行），配合 renderHtml 整卡自定义卡面' },
          maxLines: { type: 'number', description: '可选。lines 布局行数上限 1-6，默认 6' },
          tapPath: { type: 'string', description: '可选。点击卡片的应用内跳转路径，必须 "/" 开头' },
          updateIntervalMin: { type: 'number', description: '可选。逻辑重跑间隔（分钟），0=仅启动/手动刷新' },
          logicJs: {
            type: 'string',
            description:
              'logic.js 内容。恰好调用一次 __amiba__.desktopWidget.publish({title?, icon?, lines?≤6条×60字, image?, footer?})；可用 __amiba__.storage 读写卡片自身数据。禁止 DOM/HTML 操作与其他模块。',
          },
          files: {
            type: 'array',
            description: '可选。额外资源文件（如 assets 图片的 base64 不适用——仅文本文件；二进制图片请用服务卡片）。每项 {path, content}，path 相对卡片目录。',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['cardId', 'label', 'logicJs'],
      },
    },
  },
  handler: async (args) => {
    const cardId = String(args.cardId || '').trim()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(cardId)) {
      return `错误：cardId 必须为小写 kebab-case（字母/数字/连字符）: ${cardId}`
    }
    const key = `global/${cardId}`
    if (desktopWidgetDefs.value.some((d) => d.key === key)) {
      return `错误：全局卡片已存在: ${key}。用 service_file 思路修改文件后 desktop_widget_refresh，或换 cardId。`
    }
    const logicJs = String(args.logicJs || '')
    if (!logicJs.includes('desktopWidget.publish')) {
      return '错误：logicJs 必须调用 __amiba__.desktopWidget.publish() 发布数据'
    }

    const widgetJson: Record<string, any> = { label: String(args.label || cardId) }
    if (args.description) widgetJson.description = String(args.description)
    if (args.layout) widgetJson.layout = String(args.layout)
    if (args.size) widgetJson.size = String(args.size)
    if (args.accentColor) widgetJson.accentColor = String(args.accentColor)
    if (args.backgroundColor) widgetJson.backgroundColor = String(args.backgroundColor)
    if (args.textColor) widgetJson.textColor = String(args.textColor)
    if (args.hideTitleBar === true) widgetJson.hideTitleBar = true
    if (typeof args.maxLines === 'number') widgetJson.maxLines = args.maxLines
    if (args.tapPath) widgetJson.tapPath = String(args.tapPath)
    if (typeof args.updateIntervalMin === 'number') widgetJson.updateIntervalMin = args.updateIntervalMin
    widgetJson.enabled = true

    await writeGlobalCardFile(cardId, 'widget.json', JSON.stringify(widgetJson, null, 2))
    await writeGlobalCardFile(cardId, 'logic.js', logicJs)
    if (Array.isArray(args.files)) {
      for (const f of args.files) {
        const p = String(f?.path || '')
        if (!p || p.includes('..') || p.startsWith('/')) continue
        await writeGlobalCardFile(cardId, p, String(f?.content ?? ''))
      }
    }
    console.log('[DesktopWidget] ✓ 全局卡片已创建:', key)

    await rescanDesktopWidgets()
    await setCardEnabled(key, true)
    const ok = await refreshWidgetCard(key)
    const sizeEntry = widgetJson.size === 'small' ? '·小' : widgetJson.size === 'large' ? '·大' : '·中'
    return `✓ 全局桌面卡片已创建并${ok ? '推送' : '等待推送'}: ${widgetJson.label} (${key})。请提示用户在系统桌面长按添加"变形虫卡片${sizeEntry}"小组件并选择该卡片。`
  },
})

// ================================================================
// desktop_widget_list — 列出全部桌面卡片
// ================================================================

toolRegistry.register({
  name: 'desktop_widget_list',
  toolset: 'ui',
  checkFn: widgetSupported,
  category: 'view',
  emoji: '📱',
  description:
    '列出所有服务定义的系统桌面卡片（服务 desktop-widgets/ 目录），含启用状态与最近推送时间。创建卡片用 service_file_write 在服务目录下写 desktop-widgets/{cardId}/widget.json + logic.js。',
  maxResultSizeChars: 4000,
  schema: {
    type: 'function',
    function: {
      name: 'desktop_widget_list',
      description:
        '列出全部系统桌面卡片（Android AppWidget / 鸿蒙 FormKit，同一套卡片定义）。卡片定义来自各服务的 desktop-widgets/{cardId}/ 目录或全局卡片目录。用户需在系统桌面添加"变形虫"小组件并选择卡片。',
      parameters: { type: 'object', properties: {} },
    },
  },
  handler: async () => {
    // 列表前重扫一次，保证服务文件变更已反映
    await rescanDesktopWidgets()
    const cards = []
    for (const def of desktopWidgetDefs.value) {
      const cached = await loadCardPayload(def.key)
      cards.push({
        key: def.key,
        label: def.label,
        service: def.serviceName,
        layout: def.layout,
        size: def.size,
        enabled: enabledWidgetKeys.value.includes(def.key),
        updateIntervalMin: def.updateIntervalMin ?? 0,
        lastPush: cached?.updatedAt ?? null,
        hasCache: !!cached,
      })
    }
    return JSON.stringify({ count: cards.length, cards })
  },
})

// ================================================================
// desktop_widget_enable — 启用/停用卡片
// ================================================================

toolRegistry.register({
  name: 'desktop_widget_enable',
  toolset: 'ui',
  checkFn: widgetSupported,
  category: 'manage',
  emoji: '🔛',
  description:
    '启用或停用一张系统桌面卡片（改全局 registry.json 并推送原生）。key 格式 "serviceId/cardId"，用 desktop_widget_list 查看。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'desktop_widget_enable',
      description: '启用/停用指定桌面卡片。启用后用户在系统桌面添加小组件时可选到该卡片。',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '卡片 key，格式 "serviceId/cardId"，如 "user.note-service/todo-card"',
          },
          enabled: {
            type: 'boolean',
            description: 'true=启用，false=停用',
          },
        },
        required: ['key', 'enabled'],
      },
    },
  },
  handler: async (args) => {
    const key = String(args.key || '')
    let def = desktopWidgetDefs.value.find((d) => d.key === key)
    if (!def) {
      // 可能是会话中途刚创建的卡片，重扫一次再判
      await rescanDesktopWidgets()
      def = desktopWidgetDefs.value.find((d) => d.key === key)
    }
    if (!def) return `错误：卡片不存在: ${key}。用 desktop_widget_list 查看可用卡片。`
    await setCardEnabled(key, !!args.enabled)
    return `✓ 已${args.enabled ? '启用' : '停用'}桌面卡片: ${def.label} (${key})`
  },
})

// ================================================================
// desktop_widget_refresh — 立即刷新卡片数据
// ================================================================

toolRegistry.register({
  name: 'desktop_widget_refresh',
  toolset: 'ui',
  checkFn: widgetSupported,
  category: 'manage',
  emoji: '🔄',
  description:
    '立即重跑桌面卡片的 logic.js 并推送原生侧刷新显示。可指定单张卡片或刷新全部启用卡片。服务数据变更后调用此工具让桌面卡片同步。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'desktop_widget_refresh',
      description: '重跑桌面卡片逻辑并推送到系统桌面。不传 key 时刷新全部启用卡片。',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '可选。卡片 key（"serviceId/cardId"）。不传则刷新全部启用卡片。',
          },
        },
      },
    },
  },
  handler: async (args) => {
    const key = args.key ? String(args.key) : ''
    if (key) {
      const ok = await refreshWidgetCard(key)
      return ok ? `✓ 卡片已刷新: ${key}` : `✗ 卡片刷新失败: ${key}（不存在/超时/逻辑报错，见日志）`
    }
    if (enabledWidgetKeys.value.length === 0) {
      return '没有启用的桌面卡片。先用 desktop_widget_enable 启用。'
    }
    await refreshAllWidgetCards()
    return `✓ 已刷新全部 ${enabledWidgetKeys.value.length} 张启用卡片`
  },
})

// ================================================================
// desktop_widget_delete — 删除卡片
// ================================================================

toolRegistry.register({
  name: 'desktop_widget_delete',
  toolset: 'ui',
  checkFn: widgetSupported,
  category: 'manage',
  emoji: '🗑️',
  description:
    '删除一张系统桌面卡片：删定义文件（全局卡片整个目录 / 服务卡片 desktop-widgets/{cardId}/ 目录）+ 清启用状态与缓存 + 推送原生。不可恢复，删除前先与用户确认。已放置在桌面的 widget 实例无法远程移除（会显示占位文本），需提示用户手动移除。',
  maxResultSizeChars: 2000,
  schema: {
    type: 'function',
    function: {
      name: 'desktop_widget_delete',
      description: '删除指定桌面卡片（key 格式 "serviceId/cardId" 或 "global/{cardId}"，用 desktop_widget_list 查看）。删除后选卡页不再列出；桌面已放置的实例需用户手动移除。',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '要删除的卡片 key',
          },
        },
        required: ['key'],
      },
    },
  },
  handler: async (args) => {
    const key = String(args.key || '')
    try {
      await deleteWidgetCard(key)
      return `✓ 桌面卡片已删除: ${key}。若用户已在桌面放置该卡片，请提示其长按移除残留实例。`
    } catch (e: any) {
      return `✗ 删除失败: ${e.message}。用 desktop_widget_list 查看可用卡片。`
    }
  },
})
