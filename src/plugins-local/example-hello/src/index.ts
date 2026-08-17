// ============================================================
// example-hello — Amiba 示例插件（默认不注册）
// 启用：node scripts/amiba-plugin.mjs add ./src/plugins-local/example-hello
// ============================================================
import { defineAmibaPlugin } from '../../../sdk'
import type { AmibaContext } from '../../../kernel'
import type { PageRegistry } from '../../../plugins/page-registry'
import type { UISlotRegistry } from '../../../plugins/ui-slots'
import type { AmibaToolRegistryService } from '../../../plugins/tool-registry'
import HelloPage from './HelloPage.vue'
import HelloSettings from './HelloSettings.vue'
import HelloDock from './HelloDock.vue'

const plugin = defineAmibaPlugin({
  name: '@amiba/example-hello',
  inject: ['pageRegistry', 'uiSlots', 'toolRegistry'],
  provides: ['exampleHello'],

  apply(ctx: AmibaContext): void {
    const pages = ctx.get<PageRegistry>('pageRegistry')
    const slots = ctx.get<UISlotRegistry>('uiSlots')
    const tools = ctx.get<AmibaToolRegistryService>('toolRegistry')
    if (!pages || !slots || !tools) {
      throw new Error('[example-hello] 缺少 pageRegistry / uiSlots / toolRegistry 服务')
    }

    // 1. 独立页面：/hello
    const page = pages.register({
      id: 'hello',
      path: '/hello',
      name: 'hello',
      component: HelloPage,
      title: () => 'Hello Plugin',
      order: 100,
      mainNav: false,
    })
    ctx.effect(() => page.dispose, 'example-hello: page')

    // 2. 设置页签
    const settingsSlot = slots.register({
      name: 'ui.slot.settings.section',
      id: 'example-hello:settings',
      order: 100,
      component: HelloSettings,
      label: () => 'Hello',
    })
    ctx.effect(() => settingsSlot.dispose, 'example-hello: settings slot')

    // 3. 聊天输入区下方挂件
    const dockSlot = slots.register({
      name: 'ui.slot.chat.below-input',
      id: 'example-hello:dock',
      order: 100,
      component: HelloDock,
      inject: () => ({ message: 'Hello from plugin' }),
    })
    ctx.effect(() => dockSlot.dispose, 'example-hello: dock slot')

    // 4. AI 工具
    tools.registry.register({
      name: 'hello',
      toolset: 'svc',
      category: 'view',
      emoji: '👋',
      description: '示例工具：返回问候语',
      schema: {
        type: 'function',
        function: {
          name: 'hello',
          description: '返回一句问候语',
          parameters: { type: 'object', properties: {} },
        },
      },
      handler: async () => JSON.stringify({ hello: 'world' }),
    })
    ctx.effect(() => tools.registry.deregister('hello'), 'example-hello: tool')
  },
})

export const name = plugin.name
export const inject = plugin.inject
export const provides = plugin.provides
export const apply = plugin.apply
