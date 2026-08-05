import { HarmonyBridge } from './HarmonyBridge'
import {
  initFormDirs,
  saveCards,
  pushAllForms,
  pushForm,
  reassign,
  recordTap,
  consumeTap
} from './FormStore'

const TAG = '[AmibaForm]'

// ============================================================
// 变形虫 (Amiba) — 鸿蒙系统桌面卡片桥命令（FormKit）
//
// 对应 Tauri widget.rs + Android WidgetHelper JNI 的两条命令：
//   form_widget_update       ← android_widget_update
//     {json: string}  启用卡片载荷数组 JSON（协议逐字段对齐，见 FormStore.ets）
//     {assign?: {formId, key}}  鸿蒙扩展：重绑已放置实例到指定卡片并立即刷新
//       （Android 无此参数——其重绑走系统选卡配置页 WidgetConfigActivity；
//        鸿蒙加卡无配置 UI，重绑由前端设置/卡片管理发起）
//   form_widget_consume_tap  ← android_widget_consume_tap
//     {} → string  冷启动待跳转路径（读后清除，无则空串）
//
// 点击跳转热通道：EntryAbility.onNewWant → handleHotTap → emitToWeb
//   'amiba-widget-navigate'（事件名对齐 Android 热通道 DOM 事件）。
// ============================================================

export const FORM_COMMANDS: string[] = ['form_widget_update', 'form_widget_consume_tap']

let formBridge: HarmonyBridge | null = null

/** 由 Index.ets 注入桥实例（amiba-widget-navigate 热通道推送） */
export function initFormBridge(bridge: HarmonyBridge): void {
  formBridge = bridge
}

/**
 * 卡片点击热通道（EntryAbility.onNewWant 调用）：
 * Web 已挂载 → emitToWeb 推送事件；未挂载（进程活着但页面未就绪）→ 落冷通道暂存兜底
 */
export function handleHotTap(path: string): void {
  const bridge = formBridge
  if (bridge && bridge.isAttached()) {
    console.log(`${TAG} === 热通道推送 amiba-widget-navigate: ${path} ===`)
    bridge.emitToWeb('amiba-widget-navigate', path)
  } else {
    console.log(`${TAG} 热通道未就绪，降级冷通道暂存: ${path}`)
    recordTap(path)
  }
}

// ---- 命令入口（接 Dispatcher）----
export async function handleFormCommand(cmd: string, args: Record<string, Object>): Promise<Object | null> {
  switch (cmd) {
    case 'form_widget_update': {
      const json = args['json']
      if (typeof json !== 'string' || json.length === 0) {
        throw new Error('缺少参数: json')
      }
      // 校验 + 落盘 cards.json（非法载荷抛错，不刷实例）
      saveCards(json)

      // 重绑扩展：{assign: {formId, key}}
      const assign = args['assign']
      if (assign !== undefined && assign !== null && typeof assign === 'object') {
        const a = assign as Record<string, Object>
        const formId = typeof a['formId'] === 'string' ? a['formId'] as string : ''
        const key = typeof a['key'] === 'string' ? a['key'] as string : ''
        if (formId.length > 0 && key.length > 0) {
          if (reassign(formId, key)) {
            await pushForm(formId)
          }
        } else {
          console.warn(`${TAG} assign 参数不完整（需 formId + key），忽略`)
        }
      }

      const ok = await pushAllForms()
      if (ok === 0) {
        console.log(`${TAG} form_widget_update ✓ (${json.length}B)，无卡片实例，仅落盘`)
      } else {
        console.log(`${TAG} form_widget_update ✓ (${json.length}B)，已刷新 ${ok} 个实例`)
      }
      return null
    }
    case 'form_widget_consume_tap': {
      return await consumeTap()
    }
    default:
      throw new Error(`未知 form 命令: ${cmd}`)
  }
}

// initFormDirs 转导出：EntryAbility 只 import 本模块即可完成卡片目录初始化
export { initFormDirs }
