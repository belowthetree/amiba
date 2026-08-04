// ============================================================
// 变形虫 (Amiba) — 安卓系统桌面卡片存储层
//
// 卡片定义在各服务目录内：services/{id}/desktop-widgets/{cardId}/
//   widget.json（界面+行为配置）+ logic.js（数据逻辑）+ assets/（图片）
// 全局配置集中在 {AppData}/amiba/desktop-widgets/：
//   registry.json（启用状态）+ cache/*.json（最近渲染载荷）
//
// 渲染载荷推送到 Android 原生侧（RemoteViews），仅 Android 生效，
// 其他平台 pushToNative 静默跳过。
// ============================================================
import { ref } from 'vue'
import { storageGet, storageSet, storageRemove, storageGetJSON, storageSetJSON, readServiceFile, listServiceFiles } from './storage'
import { getUserServices } from '../host/registry'
import { detectPlatform } from './updater'

const REGISTRY_KEY = 'desktop-widgets/registry.json'
const CACHE_PREFIX = 'desktop-widgets/cache/'
/** renderHtml 产出的 PNG 落盘目录（相对 amiba 根，运行时产物与载荷 JSON 同级） */
const CACHE_IMG_DIR = 'desktop-widgets/cache/img'
/** 全局卡片定义目录（相对 amiba 根）：desktop-widgets/cards/{cardId}/ */
const GLOBAL_CARDS_DIR = 'desktop-widgets/cards'

// ================================================================
// 类型
// ================================================================

/** 卡片定义（服务 desktop-widgets/{cardId}/widget.json 或全局 cards/{cardId}/widget.json） */
export interface DesktopWidgetDef {
  /** 服务卡片: `${serviceId}/${cardId}`；全局卡片: `global/${cardId}` */
  key: string
  /** 卡片来源：服务自带 | 全局目录（不依附服务） */
  scope: 'service' | 'global'
  serviceId: string
  serviceName: string
  cardId: string
  label: string
  description?: string
  /** lines | image | bigText —— 对应原生三种 RemoteViews 骨架 */
  layout: 'lines' | 'image' | 'bigText'
  /** 尺寸档位：small(2x2) | medium(4x2，默认) | large(4x4) —— 对应原生三个 Provider 入口 */
  size: 'small' | 'medium' | 'large'
  accentColor?: string
  /** 背景色 #RRGGBB / #AARRGGBB（可半透明），原生画圆角位图铺底，缺省用预置 drawable */
  backgroundColor?: string
  /** 正文文本行颜色（lines/bigText 布局） */
  textColor?: string
  /** 隐藏标题栏（icon+标题行），配合 renderHtml 整卡自定义卡面 */
  hideTitleBar?: boolean
  maxLines?: number
  /** 点击卡片后的应用内跳转路径 */
  tapPath?: string
  /** App 存活期间逻辑重跑间隔（分钟），0 = 仅启动/手动刷新 */
  updateIntervalMin?: number
  /** widget.json 中的默认启用状态（首次扫描写入 registry） */
  defaultEnabled: boolean
}

/** logic.js 经 __amiba__.desktopWidget.publish() 产出的数据 */
export interface DesktopWidgetData {
  title?: string
  icon?: string
  lines?: string[]
  /** 相对卡片目录的图片路径，如 "assets/chart.png" */
  image?: string
  /** PNG dataURL（renderHtml 产出），优先于 image；宿主解码写入 cache/img/ 后推送绝对路径 */
  imageData?: string
  footer?: string
  // ---- 样式覆盖（优先于 widget.json 同名字段，用于按状态动态变色）----
  accentColor?: string
  backgroundColor?: string
  textColor?: string
  hideTitleBar?: boolean
}

/** 推送原生侧的完整载荷（def + data 合并，图片转绝对路径） */
export interface DesktopWidgetPayload extends DesktopWidgetData {
  key: string
  serviceId: string
  serviceName: string
  cardId: string
  label: string
  description?: string
  layout: string
  /** 尺寸档位 small|medium|large（Kotlin 选卡页按此过滤） */
  size: string
  maxLines?: number
  tapPath?: string
  /** 图片绝对路径（Kotlin 直接解码） */
  image?: string
  updatedAt: string
}

interface WidgetRegistry {
  enabled: string[]
  /** 已见过的卡片 key：区分"新发现"（按默认值并入）与"用户显式停用"（不再自动启用） */
  seen?: string[]
}

// ================================================================
// 状态
// ================================================================

/** 当前扫描到的全部卡片定义（响应式，供工具/UI 查询） */
export const desktopWidgetDefs = ref<DesktopWidgetDef[]>([])
/** 启用的卡片 key 列表（响应式） */
export const enabledWidgetKeys = ref<string[]>([])

let _initialized = false
let _registry: WidgetRegistry = { enabled: [] }

// ================================================================
// 初始化
// ================================================================

export async function initDesktopWidgetStore(): Promise<void> {
  if (_initialized) return
  _initialized = true
  try {
    _registry = (await storageGetJSON<WidgetRegistry>(REGISTRY_KEY)) ?? { enabled: [] }
    enabledWidgetKeys.value = [..._registry.enabled]

    const defs = await scanDesktopWidgets()
    desktopWidgetDefs.value = defs

    // 新发现的卡片按 widget.json 的 enabled 默认值并入 registry；
    // 已见过但被用户停用的卡片不再自动启用（seen 集合区分）
    const seen = new Set(_registry.seen ?? [])
    let changed = false
    for (const def of defs) {
      if (!seen.has(def.key)) {
        seen.add(def.key)
        changed = true
        if (def.defaultEnabled && !_registry.enabled.includes(def.key)) {
          _registry.enabled.push(def.key)
        }
      }
    }
    // 清理 registry 中已不存在的卡片
    const validKeys = new Set(defs.map((d) => d.key))
    const pruned = _registry.enabled.filter((k) => validKeys.has(k))
    if (pruned.length !== _registry.enabled.length) {
      _registry.enabled = pruned
      changed = true
    }
    if (changed) {
      _registry.seen = [...seen]
      await saveRegistry()
      enabledWidgetKeys.value = [..._registry.enabled]
    }
    console.log(`[DesktopWidget] 初始化完成: ${defs.length} 张卡片, ${enabledWidgetKeys.value.length} 张启用`)

    // 启动时推送一次缓存（App 更新/重启后保证原生侧数据新鲜）
    await pushToNative()
  } catch (e) {
    console.warn('[DesktopWidget] 初始化失败（非 Tauri 环境?）:', e)
  }
}

// ================================================================
// 扫描服务目录中的卡片定义
// ================================================================

export async function scanDesktopWidgets(): Promise<DesktopWidgetDef[]> {
  const defs: DesktopWidgetDef[] = []
  for (const svc of getUserServices()) {
    const serviceId = svc.manifest.id
    const files = await listServiceFiles(serviceId, 'desktop-widgets')
    // 返回值相对于 desktop-widgets/ 目录，形如 "todo-card/widget.json"
    const manifestPaths = files.filter((f) => /^[^/]+\/widget\.json$/.test(f))
    for (const mp of manifestPaths) {
      const cardId = mp.split('/')[0]!
      try {
        const raw = await readServiceFile(serviceId, `desktop-widgets/${mp}`)
        if (!raw) continue
        const json = JSON.parse(raw)

        // 权限强制：服务未声明 desktopWidgets 权限的卡片不注册
        if (!svc.manifest.permissions.includes('desktopWidgets')) {
          console.warn(`[DesktopWidget] 跳过未声明 desktopWidgets 权限的卡片: ${serviceId}/${cardId}`)
          continue
        }

        defs.push({
          key: `${serviceId}/${cardId}`,
          scope: 'service',
          serviceId,
          serviceName: svc.manifest.name,
          cardId,
          label: String(json.label || cardId),
          description: json.description ? String(json.description) : undefined,
          layout: (['lines', 'image', 'bigText'].includes(json.layout) ? json.layout : 'lines') as DesktopWidgetDef['layout'],
          size: (['small', 'medium', 'large'].includes(json.size) ? json.size : 'medium') as DesktopWidgetDef['size'],
          accentColor: json.accentColor ? String(json.accentColor) : undefined,
          backgroundColor: json.backgroundColor ? String(json.backgroundColor) : undefined,
          textColor: json.textColor ? String(json.textColor) : undefined,
          hideTitleBar: json.hideTitleBar === true ? true : undefined,
          maxLines: typeof json.maxLines === 'number' ? json.maxLines : undefined,
          tapPath: json.tapPath ? String(json.tapPath) : undefined,
          updateIntervalMin: typeof json.updateIntervalMin === 'number' ? json.updateIntervalMin : 0,
          defaultEnabled: json.enabled !== false,
        })
      } catch (e) {
        console.warn(`[DesktopWidget] widget.json 解析失败: ${serviceId}/${cardId}`, e)
      }
    }
  }

  // ---- 全局卡片（{AppData}/amiba/desktop-widgets/cards/{cardId}/，不依附服务） ----
  for (const cardId of await listGlobalCardDirs()) {
    try {
      const raw = await storageGet(`${GLOBAL_CARDS_DIR}/${cardId}/widget.json`)
      if (!raw) continue
      const json = JSON.parse(raw)
      defs.push({
        key: `global/${cardId}`,
        scope: 'global',
        serviceId: 'global',
        serviceName: '全局卡片',
        cardId,
        label: String(json.label || cardId),
        description: json.description ? String(json.description) : undefined,
        layout: (['lines', 'image', 'bigText'].includes(json.layout) ? json.layout : 'lines') as DesktopWidgetDef['layout'],
        size: (['small', 'medium', 'large'].includes(json.size) ? json.size : 'medium') as DesktopWidgetDef['size'],
        accentColor: json.accentColor ? String(json.accentColor) : undefined,
        backgroundColor: json.backgroundColor ? String(json.backgroundColor) : undefined,
        textColor: json.textColor ? String(json.textColor) : undefined,
        hideTitleBar: json.hideTitleBar === true ? true : undefined,
        maxLines: typeof json.maxLines === 'number' ? json.maxLines : undefined,
        tapPath: json.tapPath ? String(json.tapPath) : undefined,
        updateIntervalMin: typeof json.updateIntervalMin === 'number' ? json.updateIntervalMin : 0,
        defaultEnabled: json.enabled !== false,
      })
    } catch (e) {
      console.warn(`[DesktopWidget] 全局卡片 widget.json 解析失败: ${cardId}`, e)
    }
  }
  return defs
}

// ================================================================
// 全局卡片目录与文件读写（desktop-widgets/cards/）
// ================================================================

/** 列出全局卡片目录名（desktop-widgets/cards/ 下的子目录） */
async function listGlobalCardDirs(): Promise<string[]> {
  try {
    const { readDir, BaseDirectory } = await import('./native-fs')
    const entries = await readDir(`amiba/${GLOBAL_CARDS_DIR}`, { baseDir: BaseDirectory.AppData })
    return entries.filter((e: any) => e.isDirectory).map((e: any) => e.name as string)
  } catch {
    return [] // 目录不存在 = 无全局卡片
  }
}

/** 读取卡片文件（logic.js / 资源描述等），按 scope 路由到服务目录或全局目录 */
export async function readCardFile(def: DesktopWidgetDef, relPath: string): Promise<string | null> {
  if (def.scope === 'global') {
    return await storageGet(`${GLOBAL_CARDS_DIR}/${def.cardId}/${relPath}`)
  }
  return await readServiceFile(def.serviceId, `desktop-widgets/${def.cardId}/${relPath}`)
}

/** 写入全局卡片文件（仅全局卡片可写；服务卡片走 service_file_* 工具） */
export async function writeGlobalCardFile(cardId: string, relPath: string, content: string): Promise<void> {
  await storageSet(`${GLOBAL_CARDS_DIR}/${cardId}/${relPath}`, content)
}

// ================================================================
// 卡片数据存储（logic.js 的 storage 模块）
// 服务卡片 → 服务自身 data/；全局卡片 → desktop-widgets/data/{cardId}/
// ================================================================

export async function cardDataSet(def: DesktopWidgetDef, key: string, data: any): Promise<void> {
  if (def.scope === 'global') {
    await storageSetJSON(`desktop-widgets/data/${def.cardId}/${key}`, data ?? null)
    return
  }
  const { setServiceData } = await import('../host/registry')
  await setServiceData(def.serviceId, key, data)
}

export async function cardDataGet(def: DesktopWidgetDef, key: string): Promise<any> {
  if (def.scope === 'global') {
    return await storageGetJSON(`desktop-widgets/data/${def.cardId}/${key}`)
  }
  const { getServiceData } = await import('../host/registry')
  return await getServiceData(def.serviceId, key)
}

export async function cardDataRemove(def: DesktopWidgetDef, key: string): Promise<void> {
  if (def.scope === 'global') {
    await storageRemove(`desktop-widgets/data/${def.cardId}/${key}`)
    return
  }
  const { removeServiceData } = await import('../host/registry')
  await removeServiceData(def.serviceId, key)
}

/** 重新扫描（服务文件变更后由工具/调用方触发）。
 *  新发现的卡片按默认值并入启用并推送——会话中途创建的卡片无需重启即可见 */
export async function rescanDesktopWidgets(): Promise<void> {
  const defs = await scanDesktopWidgets()
  desktopWidgetDefs.value = defs

  const seen = new Set(_registry.seen ?? [])
  let changed = false
  for (const def of defs) {
    if (!seen.has(def.key)) {
      seen.add(def.key)
      changed = true
      if (def.defaultEnabled && !_registry.enabled.includes(def.key)) {
        _registry.enabled.push(def.key)
        console.log(`[DesktopWidget] 新卡片自动启用: ${def.key}`)
      }
    }
  }
  // 清理 registry 中已不存在的卡片（文件被删除后不再推送）
  const validKeys = new Set(defs.map((d) => d.key))
  const pruned = _registry.enabled.filter((k) => validKeys.has(k))
  if (pruned.length !== _registry.enabled.length) {
    _registry.enabled = pruned
    changed = true
  }
  if (changed) {
    _registry.seen = [...seen]
    await saveRegistry()
    enabledWidgetKeys.value = [..._registry.enabled]
    await pushToNative()
  }
}

/** 删除一张卡片：删文件（全局卡片目录 / 服务卡片目录）+ 清 registry、数据与缓存 + 推送原生。
 *  已放置在桌面的 widget 实例无法远程移除，会显示占位文本，需用户手动移除。 */
export async function deleteWidgetCard(key: string): Promise<void> {
  const def = desktopWidgetDefs.value.find((d) => d.key === key)
  if (!def) throw new Error(`卡片不存在: ${key}`)

  // 1. 删除卡片定义文件
  if (def.scope === 'global') {
    try {
      const { remove, BaseDirectory } = await import('./native-fs')
      await remove(`amiba/${GLOBAL_CARDS_DIR}/${def.cardId}`, { baseDir: BaseDirectory.AppData, recursive: true })
    } catch { /* 目录可能已不存在 */ }
    // 全局卡片 storage 数据一并清理
    try {
      const { remove, BaseDirectory } = await import('./native-fs')
      await remove(`amiba/desktop-widgets/data/${def.cardId}`, { baseDir: BaseDirectory.AppData, recursive: true })
    } catch { /* 可能不存在 */ }
  } else {
    const files = await listServiceFiles(def.serviceId, `desktop-widgets/${def.cardId}`)
    const { removeServiceFile } = await import('./storage')
    for (const f of files) {
      await removeServiceFile(def.serviceId, `desktop-widgets/${def.cardId}/${f}`)
    }
  }

  // 2. 清 registry 与缓存
  const idx = _registry.enabled.indexOf(key)
  if (idx >= 0) {
    _registry.enabled.splice(idx, 1)
    await saveRegistry()
    enabledWidgetKeys.value = [..._registry.enabled]
  }
  await storageRemove(cacheKey(key))
  // renderHtml 产出的 PNG 一并清理
  try {
    const { remove, BaseDirectory } = await import('./native-fs')
    await remove(`amiba/${CACHE_IMG_DIR}/${key.replace(/\//g, '__')}.png`, { baseDir: BaseDirectory.AppData })
  } catch { /* 文件可能不存在 */ }
  console.log(`[DesktopWidget] ✓ 卡片已删除: ${key}`)

  // 3. 重扫 + 重排周期调度 + 推送原生（选卡页不再列出该卡片）
  await rescanDesktopWidgets()
  try {
    const { scheduleWidgetCards } = await import('../host/desktop-widget-runner')
    scheduleWidgetCards()
  } catch { /* runner 未启动时忽略 */ }
  await pushToNative()
}

// ================================================================
// 启用状态管理
// ================================================================

async function saveRegistry(): Promise<void> {
  await storageSetJSON(REGISTRY_KEY, _registry)
}

export async function setCardEnabled(key: string, enabled: boolean): Promise<void> {
  const idx = _registry.enabled.indexOf(key)
  if (enabled && idx < 0) {
    _registry.enabled.push(key)
  } else if (!enabled && idx >= 0) {
    _registry.enabled.splice(idx, 1)
  } else {
    return
  }
  await saveRegistry()
  enabledWidgetKeys.value = [..._registry.enabled]
  console.log(`[DesktopWidget] ${enabled ? '启用' : '停用'}: ${key}`)
  await pushToNative()
}

// ================================================================
// 载荷缓存（logic.js publish 后写入）
// ================================================================

function cacheKey(key: string): string {
  // key 为 "serviceId/cardId"，文件名中转成 __ 避免子目录
  return CACHE_PREFIX + key.replace(/\//g, '__') + '.json'
}

/** logic.js 产出数据后：合并 def + 图片绝对路径，写 cache 并推送原生 */
export async function updateCardPayload(def: DesktopWidgetDef, data: DesktopWidgetData): Promise<void> {
  const payload: DesktopWidgetPayload = {
    key: def.key,
    serviceId: def.serviceId,
    serviceName: def.serviceName,
    cardId: def.cardId,
    label: def.label,
    description: def.description,
    layout: def.layout,
    size: def.size,
    // 样式字段：publish 可覆盖 widget.json（按状态动态变色）
    accentColor: data.accentColor ?? def.accentColor,
    backgroundColor: data.backgroundColor ?? def.backgroundColor,
    textColor: data.textColor ?? def.textColor,
    hideTitleBar: data.hideTitleBar ?? def.hideTitleBar,
    maxLines: def.maxLines,
    tapPath: def.tapPath,
    title: data.title,
    icon: data.icon,
    lines: Array.isArray(data.lines) ? data.lines.slice(0, 6).map((s) => String(s).slice(0, 60)) : undefined,
    // imageData（renderHtml 产物）优先于静态 assets 图片
    image: (await writeCardImage(def.key, data.imageData)) ?? (await resolveImagePath(def, data.image)),
    footer: data.footer,
    updatedAt: new Date().toISOString(),
  }
  await storageSetJSON(cacheKey(def.key), payload)
  console.log(`[DesktopWidget] ✓ 载荷已更新: ${def.key}`)
  await pushToNative()
}

/**
 * publish 的 imageData（PNG dataURL）→ 二进制写入 cache/img/{key}.png，
 * 返回绝对路径供 Kotlin 解码。非法/超大输入返回 undefined（回退静态图片）。
 */
async function writeCardImage(key: string, dataUrl?: string): Promise<string | undefined> {
  if (!dataUrl) return undefined
  const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]+)$/.exec(dataUrl.trim())
  if (!m) {
    console.warn('[DesktopWidget] imageData 非 base64 dataURL（忽略）:', key)
    return undefined
  }
  if (m[1]!.length > 8 * 1024 * 1024) {
    console.warn('[DesktopWidget] imageData 过大（base64 > 8MB，忽略）:', key)
    return undefined
  }
  try {
    const bin = atob(m[1]!)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const { writeFile, mkdir, BaseDirectory, appDataDir, join } = await import('./native-fs')
    const dir = `amiba/${CACHE_IMG_DIR}`
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true })
    const file = key.replace(/\//g, '__') + '.png'
    await writeFile(`${dir}/${file}`, bytes, { baseDir: BaseDirectory.AppData })
    return await join(await appDataDir(), dir, file)
  } catch (e) {
    console.warn('[DesktopWidget] imageData 写盘失败:', key, e)
    return undefined
  }
}

/** 相对卡片目录的图片路径 → 绝对路径（Kotlin File 直接解码） */
async function resolveImagePath(def: DesktopWidgetDef, image?: string): Promise<string | undefined> {
  if (!image) return undefined
  try {
    const { appDataDir, join } = await import('./native-fs')
    // 防路径逃逸：不允许 .. 与绝对路径
    if (image.includes('..') || image.startsWith('/') || /^[a-zA-Z]:/.test(image)) {
      console.warn('[DesktopWidget] 非法图片路径（拒绝）:', image)
      return undefined
    }
    if (def.scope === 'global') {
      return await join(await appDataDir(), 'amiba', 'desktop-widgets', 'cards', def.cardId, image)
    }
    return await join(await appDataDir(), 'amiba', 'services', def.serviceId, 'desktop-widgets', def.cardId, image)
  } catch {
    return undefined
  }
}

/** 读取某卡片最近一次缓存载荷 */
export async function loadCardPayload(key: string): Promise<DesktopWidgetPayload | null> {
  return await storageGetJSON<DesktopWidgetPayload>(cacheKey(key))
}

// ================================================================
// 推送原生侧（仅 Android）
// ================================================================

export async function pushToNative(): Promise<void> {
  if (detectPlatform() !== 'android') return
  try {
    const payloads: DesktopWidgetPayload[] = []
    for (const key of _registry.enabled) {
      let cached = await loadCardPayload(key)
      if (!cached) {
        // 无缓存（logic.js 尚未成功运行过）：用 def 合成占位载荷，
        // 保证选卡页能列出该卡片，而不是"暂无可用卡片"
        const def = desktopWidgetDefs.value.find((d) => d.key === key)
        if (def) cached = placeholderPayload(def)
      }
      if (cached) payloads.push(cached)
    }
    const { nativeInvoke } = await import('./platform-bridge')
    await nativeInvoke('android_widget_update', { json: JSON.stringify(payloads) })
    console.log(`[DesktopWidget] 已推送原生: ${payloads.length} 张启用卡片`, payloads.map((p) => p.key).join(', '))
  } catch (e) {
    console.warn('[DesktopWidget] 推送原生失败:', e)
  }
}

/** 用卡片定义合成占位载荷（logic.js 首次成功运行前的兜底显示） */
function placeholderPayload(def: DesktopWidgetDef): DesktopWidgetPayload {
  return {
    key: def.key,
    serviceId: def.serviceId,
    serviceName: def.serviceName,
    cardId: def.cardId,
    label: def.label,
    description: def.description,
    layout: def.layout,
    size: def.size,
    accentColor: def.accentColor,
    backgroundColor: def.backgroundColor,
    textColor: def.textColor,
    hideTitleBar: def.hideTitleBar,
    maxLines: def.maxLines,
    tapPath: def.tapPath,
    title: def.label,
    lines: def.layout === 'image' ? undefined : ['加载中…'],
    updatedAt: '',
  }
}

/** 消费桌面卡片点击的跳转路径（冷启动兜底，App.vue 挂载后调用一次） */
export async function consumeWidgetTapPath(): Promise<string> {
  if (detectPlatform() !== 'android') return ''
  try {
    const { nativeInvoke } = await import('./platform-bridge')
    return (await nativeInvoke<string>('android_widget_consume_tap')) || ''
  } catch {
    return ''
  }
}
