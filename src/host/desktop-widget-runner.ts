// ============================================================
// 变形虫 (Amiba) — 安卓桌面卡片逻辑运行器
//
// 每张启用卡片的 logic.js 在一个隐藏沙箱 iframe 中执行：
//   注入 BRIDGE_SCRIPT + __amiba_service_id__，logic.js 经
//   __amiba__.desktopWidget.publish(data) 产出渲染数据。
// 可用模块：desktopWidget.publish + storage（读写服务自身数据），
// 其余模块一律拒绝。10s 未 publish 视为超时跳过。
//
// 触发时机：App 启动（init 后）+ updateIntervalMin 周期 + 手动刷新。
// App 退出即全部停止，桌面卡片显示最后一次推送的缓存。
// ============================================================
import { createBridge, BRIDGE_SCRIPT } from './bridge'
import { getService, setServiceData, getServiceData, removeServiceData } from './registry'
import {
  desktopWidgetDefs,
  enabledWidgetKeys,
  updateCardPayload,
  readCardFile,
  cardDataSet,
  cardDataGet,
  cardDataRemove,
  type DesktopWidgetDef,
} from '../config/desktop-widget-store'

const LOGIC_TIMEOUT_MS = 10_000

/** 周期刷新定时器：cardKey → interval id */
const intervals = new Map<string, ReturnType<typeof setInterval>>()
/** 进行中的运行（同卡去重） */
const running = new Set<string>()

// ================================================================
// 单卡执行
// ================================================================

/** 在隐藏沙箱 iframe 中执行卡片 logic.js，返回 publish 的数据 */
async function runCardLogic(def: DesktopWidgetDef): Promise<Record<string, any>> {
  const logic = await readCardFile(def, 'logic.js')
  if (!logic) throw new Error(`logic.js 不存在: ${def.key}`)

  // 服务卡片沿用服务 manifest 权限；全局卡片仅 storage + desktopWidgets
  const svc = def.scope === 'service' ? getService(def.serviceId) : undefined
  const permissions = svc?.manifest.permissions ?? []

  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.setAttribute('sandbox', 'allow-scripts')

  return await new Promise((resolve, reject) => {
    let settled = false

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`logic.js 超时未 publish (${LOGIC_TIMEOUT_MS / 1000}s): ${def.key}`)))
    }, LOGIC_TIMEOUT_MS)

    function finish(fn: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      bridge.destroy()
      iframe.remove()
      fn()
    }

    // 宿主侧 API 分发：只开放 desktopWidget.publish + storage
    async function handler(module: string, method: string, params: Record<string, any>): Promise<any> {
      if (module === 'desktopWidget' && method === 'publish') {
        const data = params?.payload
        if (!data || typeof data !== 'object') throw new Error('publish 需要对象参数')
        finish(() => resolve(data))
        return null
      }
      const serviceId = def.scope === 'service' ? String(params?.serviceId || def.serviceId) : def.serviceId
      if (module === 'storage') {
        if (def.scope === 'global') {
          // 全局卡片：storage 落到 desktop-widgets/data/{cardId}/（与服务数据隔离）
          if (method === 'setStorage') return await cardDataSet(def, params.key, params.data)
          if (method === 'getStorage') return await cardDataGet(def, params.key)
          if (method === 'removeStorage') return await cardDataRemove(def, params.key)
        } else {
          if (method === 'setStorage') return await setServiceData(serviceId, params.key, params.data)
          if (method === 'getStorage') return await getServiceData(serviceId, params.key)
          if (method === 'removeStorage') return await removeServiceData(serviceId, params.key)
        }
      }
      throw new Error(`桌面卡片逻辑不支持模块: ${module}.${method}`)
    }

    const bridge = createBridge(iframe, [...permissions, 'desktopWidgets'], handler)

    // 组 srcdoc：bridge 垫片 → 服务身份 → logic.js
    iframe.srcdoc =
      BRIDGE_SCRIPT +
      `<script>window.__amiba_service_id__ = ${JSON.stringify(def.serviceId)};</script>` +
      `<script>\n${logic}\n</script>`
    document.body.appendChild(iframe)
  })
}

// ================================================================
// 刷新入口
// ================================================================

/** 立即重跑一张卡片的逻辑并推送原生 */
export async function refreshWidgetCard(key: string): Promise<boolean> {
  const def = desktopWidgetDefs.value.find((d) => d.key === key)
  if (!def) {
    console.warn('[DesktopWidget] refresh: 卡片不存在:', key)
    return false
  }
  if (running.has(key)) {
    console.log('[DesktopWidget] refresh: 跳过（进行中）:', key)
    return false
  }
  running.add(key)
  try {
    const data = await runCardLogic(def)
    await updateCardPayload(def, data)
    return true
  } catch (e) {
    console.warn('[DesktopWidget] refresh 失败:', key, e)
    return false
  } finally {
    running.delete(key)
  }
}

/** 重跑全部启用卡片 */
export async function refreshAllWidgetCards(): Promise<void> {
  for (const key of enabledWidgetKeys.value) {
    await refreshWidgetCard(key)
  }
}

// ================================================================
// 周期调度
// ================================================================

function clearIntervals() {
  for (const [, id] of intervals) clearInterval(id)
  intervals.clear()
}

/** 按 widget.json 的 updateIntervalMin 为启用卡片挂周期刷新 */
export function scheduleWidgetCards(): void {
  clearIntervals()
  for (const def of desktopWidgetDefs.value) {
    if (!enabledWidgetKeys.value.includes(def.key)) continue
    const min = def.updateIntervalMin ?? 0
    if (min <= 0) continue
    const id = setInterval(() => {
      void refreshWidgetCard(def.key)
    }, min * 60_000)
    intervals.set(def.key, id)
    console.log(`[DesktopWidget] 周期刷新已挂: ${def.key} (每 ${min} 分钟)`)
  }
}

/** 服务删除/卸载时清理其卡片调度（registry.destroyServiceRuntime 调用） */
export function stopServiceWidgetCards(serviceId: string): void {
  for (const [key, id] of intervals) {
    if (key.startsWith(serviceId + '/')) {
      clearInterval(id)
      intervals.delete(key)
    }
  }
}

/** 启动入口（bootstrap）：全量刷新一次 + 挂周期 */
export async function startDesktopWidgetRunner(): Promise<void> {
  if (enabledWidgetKeys.value.length === 0) {
    console.log('[DesktopWidget] 无启用卡片，runner 待命')
    return
  }
  console.log(`[DesktopWidget] runner 启动: ${enabledWidgetKeys.value.length} 张启用卡片`)
  await refreshAllWidgetCards()
  scheduleWidgetCards()
}
