// ============================================================
// 变形虫 (Amiba) — 安卓桌面卡片逻辑运行器
//
// 每张启用卡片的 logic.js 在一个隐藏沙箱 iframe 中执行：
//   注入 BRIDGE_SCRIPT + RENDER_HTML_SCRIPT + __amiba_service_id__，
//   logic.js 经 __amiba__.desktopWidget.publish(data) 产出渲染数据。
// 可用模块：desktopWidget.publish / desktopWidget.renderHtml（HTML/SVG →
//   PNG dataURL，沙箱内离屏渲染，不经桥接）+ storage（读写服务自身数据），
//   其余模块一律拒绝。10s 未 publish 视为超时跳过。
//
// 触发时机：App 启动（init 后）+ updateIntervalMin 周期 + 手动刷新 +
//   服务 storage 数据变更（onServiceDataChanged，防抖后自动重跑）。
// App 退出即全部停止，桌面卡片显示最后一次推送的缓存。
// ============================================================
import { createBridge, BRIDGE_SCRIPT } from './bridge'
import { getService, setServiceData, getServiceData, removeServiceData, onServiceDataChanged } from './registry'
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

/**
 * 沙箱内渲染辅助：给 __amiba__.desktopWidget 挂 renderHtml(html, opts)。
 * 在 iframe 内部执行（不经桥接 postMessage）：SVG foreignObject 离屏渲染
 * HTML/SVG 字符串 → PNG dataURL，零依赖。结果经 publish({ imageData }) 回传。
 * 纯 JS 字符串（BRIDGE_SCRIPT 同款注入方式），勿含 </script> 与模板占位符。
 */
const RENDER_HTML_SCRIPT = `
;(function () {
  var dw = window.__amiba__ && window.__amiba__.desktopWidget;
  if (!dw) return;
  // html: HTML 片段（样式须内联/内嵌）或完整 SVG 字符串
  // opts: { width=480, height=width/2, scale=2 }，宽高 16-1600，scale 1-3
  dw.renderHtml = function (html, opts) {
    var o = opts || {};
    var width = Math.min(Math.max(o.width || 480, 16), 1600);
    var height = Math.min(Math.max(o.height || Math.round(width / 2), 16), 1600);
    var scale = Math.min(Math.max(o.scale || 2, 1), 3);
    var src = String(html || '').trim();
    if (!src) return Promise.reject(new Error('renderHtml 需要非空 HTML/SVG 字符串'));
    var svg = src.indexOf('<svg') === 0
      ? src
      : '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
        '<foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + width + 'px;height:' + height +
        'px;overflow:hidden;font-family:sans-serif;">' + src + '</div></foreignObject></svg>';
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(new Error('renderHtml 导出失败（WebView 可能不支持 SVG 截图）: ' + e.message));
        }
      };
      img.onerror = function () { reject(new Error('renderHtml 渲染失败：HTML/SVG 无法解析')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  };
})();
`

/** 周期刷新定时器：cardKey → interval id */
const intervals = new Map<string, ReturnType<typeof setInterval>>()
/** 进行中的运行（同卡去重） */
const running = new Set<string>()

/** 数据变更防抖定时器：serviceId → timeout id */
const dataChangeTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 卡片最近一次 logic.js 开始运行的时间（抑制自身写入回流触发） */
const lastRunAt = new Map<string, number>()
/** 服务连写多个 key 的合并窗口 */
const DATA_CHANGE_DEBOUNCE_MS = 1_000
/** 卡片刚跑完的宽限期：期间的 storage 写入视为 logic.js 自身回流，不再触发 */
const SELF_WRITE_SUPPRESS_MS = 3_000

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

    // 组 srcdoc：bridge 垫片（必须包 <script> 标签才执行）→ renderHtml 辅助 → 服务身份 → logic.js
    // logic.js 自动包在 async 函数中执行：允许顶层 await（IIFE 写法同样兼容）
    iframe.srcdoc =
      '<script>' + BRIDGE_SCRIPT + '<\/script>' +
      '<script>' + RENDER_HTML_SCRIPT + '<\/script>' +
      `<script>window.__amiba_service_id__ = ${JSON.stringify(def.serviceId)};</script>` +
      `<script>(async function () {\n${logic}\n})()</script>`
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
  lastRunAt.set(key, Date.now())
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
// 服务数据变更自动刷新
// ================================================================

/**
 * 服务 storage 写入 → 该服务名下启用卡片防抖重跑。
 * 前提：服务确实有启用卡片，否则直接忽略；logic.js 自身写入在宽限期内抑制，
 * 避免"刷新 → 写 storage → 再触发刷新"的回流循环。
 */
function handleServiceDataChanged(serviceId: string) {
  const keys = desktopWidgetDefs.value
    .filter((d) => d.scope === 'service' && d.serviceId === serviceId && enabledWidgetKeys.value.includes(d.key))
    .map((d) => d.key)
  if (keys.length === 0) return
  const now = Date.now()
  const fresh = keys.filter((k) => now - (lastRunAt.get(k) ?? 0) > SELF_WRITE_SUPPRESS_MS)
  if (fresh.length === 0) return
  const prev = dataChangeTimers.get(serviceId)
  if (prev) clearTimeout(prev)
  dataChangeTimers.set(serviceId, setTimeout(() => {
    dataChangeTimers.delete(serviceId)
    console.log('[DesktopWidget] 服务数据变更，刷新卡片:', fresh.join(', '))
    for (const k of fresh) void refreshWidgetCard(k)
  }, DATA_CHANGE_DEBOUNCE_MS))
}

let dataListenerRegistered = false

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

/** 启动入口（bootstrap）：注册数据变更监听 + 全量刷新一次 + 挂周期 */
export async function startDesktopWidgetRunner(): Promise<void> {
  if (!dataListenerRegistered) {
    dataListenerRegistered = true
    onServiceDataChanged(handleServiceDataChanged)
  }
  if (enabledWidgetKeys.value.length === 0) {
    console.log('[DesktopWidget] 无启用卡片，runner 待命')
    return
  }
  console.log(`[DesktopWidget] runner 启动: ${enabledWidgetKeys.value.length} 张启用卡片`)
  await refreshAllWidgetCards()
  scheduleWidgetCards()
}
