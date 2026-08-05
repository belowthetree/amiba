import { fileIo as fs } from '@kit.CoreFileKit'
import { util } from '@kit.ArkTS'
import { formBindingData, formProvider } from '@kit.FormKit'

const TAG = '[AmibaForm]'

// ============================================================
// 变形虫 (Amiba) — 鸿蒙系统桌面卡片共享数据层（FormKit）
//
// 对应 Android 侧 AmibaWidgetProvider.kt 的 SharedPreferences 存储 +
//   RemoteViews 渲染数据装配：
//   - cards.json    前端推送的全部启用卡片载荷数组（协议与
//                   desktop-widget-store.ts / android_widget_update 逐字段对齐）
//   - forms.json    formId → {cardKey, layout, size} 绑定映射
//                   （对应 Android instance_<appWidgetId> → cardKey）
//   - pending_tap   冷启动待消费跳转路径（对应 KEY_PENDING_TAP）
//
// 本模块同时被 EntryAbility（form_widget_* 命令）与 EntryFormAbility
// （onAddForm/onUpdateForm/onRemoveForm 生命周期）使用；两者同属应用主进程，
// filesDir 共享。各处分别 initFormDirs 初始化模块级路径。
// ============================================================

// ---- 前端载荷类型（与 src/config/desktop-widget-store.ts DesktopWidgetPayload 逐字段对齐）----
export interface FormCardPayload {
  key: string
  serviceId: string
  serviceName: string
  cardId: string
  label: string
  description: string
  layout: string          // lines | image | bigText
  size: string            // small | medium | large
  accentColor: string
  backgroundColor: string
  textColor: string
  hideTitleBar: boolean
  maxLines: number        // 0 = 未设置
  tapPath: string
  title: string
  icon: string
  lines: string[]
  image: string           // filesDir 内 PNG 绝对路径，空串 = 无图
  footer: string
  updatedAt: string
}

/** formId 绑定信息（forms.json 值） */
interface FormBinding {
  cardKey: string         // 空串 = 加卡时无启用卡可绑（待推送时自动补绑）
  layout: string
  size: string
}

/** buildBindingData 产出：bindingData + 图片 fd（调用方负责关闭；-1 = 无图） */
export interface BuiltFormData {
  bindingData: formBindingData.FormBindingData
  imageFd: number
}

const FORM_SUBDIR = 'amiba-form'
const CARDS_FILE = 'cards.json'
const FORMS_FILE = 'forms.json'
const PENDING_TAP_FILE = 'pending_tap'
/** formImages 图片键（卡片侧 Image('memory://card_image') 引用，名字固定） */
const IMAGE_KEY = 'card_image'
const MAX_LINES = 6

let formDir = ''

/** 由 EntryAbility.onCreate / EntryFormAbility.onAddForm 各自调用（幂等） */
export function initFormDirs(filesDir: string): void {
  formDir = `${filesDir}/${FORM_SUBDIR}`
  console.log(`${TAG} formDir=${formDir}`)
}

function ensureDir(): void {
  if (formDir.length === 0) {
    throw new Error('FormStore 未初始化（initFormDirs 未调用）')
  }
  if (!fs.accessSync(formDir)) {
    fs.mkdirSync(formDir)
  }
}

// ---- 同步小文件读写（卡片数据均为 KB 级）----
function readTextIfExists(path: string): string {
  if (!fs.accessSync(path)) {
    return ''
  }
  const st = fs.statSync(path)
  if (st.size <= 0) {
    return ''
  }
  const file = fs.openSync(path, fs.OpenMode.READ_ONLY)
  try {
    const buf = new ArrayBuffer(st.size)
    let total = 0
    while (total < st.size) {
      const n = fs.readSync(file.fd, buf, { offset: total })
      if (n <= 0) {
        break
      }
      total += n
    }
    return util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(buf, 0, total))
  } finally {
    fs.closeSync(file)
  }
}

function writeText(path: string, text: string): void {
  ensureDir()
  const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
  try {
    // writeSync 直接接受 string（内部 UTF-8 编码）
    fs.writeSync(file.fd, text)
  } finally {
    fs.closeSync(file)
  }
}

// ---- JSON 字段提取（ArkTS 严格模式：逐级类型收窄，禁 any）----
function asRecord(v: Object | null | undefined): Record<string, Object> | null {
  if (v === null || v === undefined || typeof v !== 'object') {
    return null
  }
  return v as Record<string, Object>
}

function strField(o: Record<string, Object>, name: string): string {
  const v = o[name]
  return typeof v === 'string' ? v : ''
}

function numField(o: Record<string, Object>, name: string): number {
  const v = o[name]
  return typeof v === 'number' ? v : 0
}

function boolField(o: Record<string, Object>, name: string): boolean {
  return o[name] === true
}

function linesField(o: Record<string, Object>): string[] {
  const v = o['lines']
  const out: string[] = []
  if (v instanceof Array) {
    const arr = v as Array<Object>
    for (const item of arr) {
      if (typeof item === 'string') {
        out.push(item)
      }
    }
  }
  return out
}

function parseCard(v: Object | null | undefined): FormCardPayload | null {
  const o = asRecord(v)
  if (!o) {
    return null
  }
  const card: FormCardPayload = {
    key: strField(o, 'key'),
    serviceId: strField(o, 'serviceId'),
    serviceName: strField(o, 'serviceName'),
    cardId: strField(o, 'cardId'),
    label: strField(o, 'label'),
    description: strField(o, 'description'),
    layout: strField(o, 'layout') || 'lines',
    size: strField(o, 'size') || 'medium',
    accentColor: strField(o, 'accentColor'),
    backgroundColor: strField(o, 'backgroundColor'),
    textColor: strField(o, 'textColor'),
    hideTitleBar: boolField(o, 'hideTitleBar'),
    maxLines: numField(o, 'maxLines'),
    tapPath: strField(o, 'tapPath'),
    title: strField(o, 'title'),
    icon: strField(o, 'icon'),
    lines: linesField(o),
    image: strField(o, 'image'),
    footer: strField(o, 'footer'),
    updatedAt: strField(o, 'updatedAt')
  }
  return card
}

// ---- 卡片数组持久化 ----

/** 校验并落盘前端推送的启用卡片数组 JSON（非法 JSON / 非数组直接抛错，不写盘） */
export function saveCards(json: string): void {
  const parsed: Object | null = JSON.parse(json)
  if (!(parsed instanceof Array)) {
    throw new Error('卡片载荷非数组')
  }
  writeText(`${formDir}/${CARDS_FILE}`, json)
}

export function loadCards(): FormCardPayload[] {
  const raw = readTextIfExists(`${formDir}/${CARDS_FILE}`)
  if (raw.length === 0) {
    return []
  }
  try {
    const parsed: Object | null = JSON.parse(raw)
    if (!(parsed instanceof Array)) {
      return []
    }
    const arr = parsed as Array<Object>
    const out: FormCardPayload[] = []
    for (const item of arr) {
      const card = parseCard(item)
      if (card && card.key.length > 0) {
        out.push(card)
      }
    }
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ cards.json 解析失败: ${msg}`)
    return []
  }
}

export function findCard(cards: FormCardPayload[], key: string): FormCardPayload | null {
  for (const c of cards) {
    if (c.key === key) {
      return c
    }
  }
  return null
}

// ---- formId ↔ cardKey 映射持久化（顺序写：文件极小，无并发竞争面）----

export function loadForms(): Record<string, FormBinding> {
  const raw = readTextIfExists(`${formDir}/${FORMS_FILE}`)
  const out: Record<string, FormBinding> = {}
  if (raw.length === 0) {
    return out
  }
  try {
    const parsedRaw: Object | null = JSON.parse(raw)
    const parsed = asRecord(parsedRaw)
    if (!parsed) {
      return out
    }
    const keys = Object.keys(parsed)
    for (const formId of keys) {
      const b = asRecord(parsed[formId])
      if (b) {
        const binding: FormBinding = {
          cardKey: strField(b, 'cardKey'),
          layout: strField(b, 'layout') || 'lines',
          size: strField(b, 'size') || 'medium'
        }
        out[formId] = binding
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ forms.json 解析失败: ${msg}`)
  }
  return out
}

export function saveForms(forms: Record<string, FormBinding>): void {
  writeText(`${formDir}/${FORMS_FILE}`, JSON.stringify(forms))
}

export function removeForm(formId: string): void {
  const forms = loadForms()
  if (Object.keys(forms).indexOf(formId) >= 0) {
    // ArkTS 无 delete 运算符之外的删键方式；重建对象
    const next: Record<string, FormBinding> = {}
    const keys = Object.keys(forms)
    for (const k of keys) {
      if (k !== formId) {
        next[k] = forms[k]
      }
    }
    saveForms(next)
    console.log(`${TAG} ✓ 卡片实例移除: formId=${formId}`)
  }
}

// ---- 加卡自动分配（平移 WidgetConfigActivity「按尺寸过滤选卡」语义）----
// 鸿蒙无法在加卡时弹配置 UI：映射表里有该模板(layout)+该尺寸唯一/首个启用卡 → 直接绑定；
// 无同 layout 卡片时兜底首张启用卡并记日志；无任何启用卡 → cardKey 置空（占位显示），
// 之后首次 form_widget_update 推送时按同规则自动补绑（见 pushForm）。
export function pickCard(cards: FormCardPayload[], layout: string, size: string): FormCardPayload | null {
  for (const c of cards) {
    if (c.layout === layout && c.size === size) {
      return c
    }
  }
  for (const c of cards) {
    if (c.layout === layout) {
      return c
    }
  }
  return cards.length > 0 ? cards[0] : null
}

/** onAddForm：登记 formId 绑定并返回所选卡片（可能为 null） */
export function assignOnAdd(formId: string, layout: string, size: string): FormCardPayload | null {
  const cards = loadCards()
  const chosen = pickCard(cards, layout, size)
  const forms = loadForms()
  const binding: FormBinding = {
    cardKey: chosen ? chosen.key : '',
    layout: layout,
    size: size
  }
  forms[formId] = binding
  saveForms(forms)
  if (chosen) {
    console.log(`${TAG} === 绑定卡片实例: formId=${formId} → ${chosen.key} (layout=${layout} size=${size}) ===`)
  } else {
    console.log(`${TAG} 绑定卡片实例: formId=${formId} 暂无启用卡片（layout=${layout} size=${size}），占位显示待补绑`)
  }
  return chosen
}

/** form_widget_update 的 assign 扩展参数：重绑已放置实例到指定卡片（Android 无此参数） */
export function reassign(formId: string, key: string): boolean {
  const forms = loadForms()
  const binding = forms[formId]
  if (!binding) {
    console.warn(`${TAG} assign 失败: 未知 formId=${formId}`)
    return false
  }
  const next: FormBinding = {
    cardKey: key,
    layout: binding.layout,
    size: binding.size
  }
  forms[formId] = next
  saveForms(forms)
  console.log(`${TAG} === 重绑卡片实例: formId=${formId} → ${key} ===`)
  return true
}

// ---- 尺寸/模板名映射 ----
// FormDimension: Dimension_2_2=2 / Dimension_2_4=3 / Dimension_4_4=4（见 formInfo.d.ts）
// 对应前端 size 档位 small(2x2) / medium(4x2) / large(4x4)
export function dimensionToSize(dimension: number): string {
  if (dimension === 2) {
    return 'small'
  }
  if (dimension === 4) {
    return 'large'
  }
  return 'medium' // 3 (2*4) 及未知值按中尺寸兜底
}

/** form_config.json 的卡片模板 name → 载荷 layout 字段 */
export function layoutFromFormName(name: string): string {
  if (name === 'amiba_image') {
    return 'image'
  }
  if (name === 'amiba_bigtext') {
    return 'bigText'
  }
  return 'lines'
}

// ---- 绑定数据装配（FormBindingData.data 键映射卡片 @LocalStorageProp）----
// 键名受限：仅字母/数字/下划线（@LocalStorageProp 编译约束），故全部 snake 展开。
// 图片经 formImages 机制（文档惯例，d.ts 未类型化）：data.formImages = {键: fd}，
// 卡片侧 Image('memory://card_image') 引用；fd 由调用方在 updateForm 完成后关闭
// （onAddForm 初始数据除外——框架渲染期仍需读取，沿用官方示例不 close，单次一个 fd）。
export function buildBindingData(card: FormCardPayload | null): BuiltFormData {
  const data: Record<string, Object> = {}
  let imageFd = -1

  if (!card) {
    // 占位（对齐 Android 无绑定分支）：提示先启用卡片
    data['title'] = '变形虫'
    data['icon'] = ''
    data['footer'] = ''
    data['big_text'] = ''
    for (let i = 0; i < MAX_LINES; i++) {
      data[`line${i}`] = i === 0 ? '请先在 App 中启用桌面卡片' : ''
    }
    data['accent'] = ''
    data['text_color'] = ''
    data['bg_color'] = ''
    data['hide_title'] = false
    data['image_name'] = ''
    data['tap_path'] = ''
    data['card_id'] = ''
    return { bindingData: formBindingData.createFormBindingData(data), imageFd: imageFd }
  }

  data['title'] = card.title.length > 0 ? card.title : card.label
  data['icon'] = card.icon
  data['footer'] = card.footer
  // maxLines 在装配侧生效（对齐 Android Provider：1..MAX_LINES 收敛）
  const max = card.maxLines >= 1 && card.maxLines <= MAX_LINES ? card.maxLines : MAX_LINES
  for (let i = 0; i < MAX_LINES; i++) {
    const text = i < card.lines.length ? card.lines[i] : ''
    data[`line${i}`] = i < max ? text : ''
  }
  data['big_text'] = card.lines.length > 0 ? card.lines[0] : ''
  data['accent'] = card.accentColor
  data['text_color'] = card.textColor
  data['bg_color'] = card.backgroundColor
  data['hide_title'] = card.hideTitleBar
  data['tap_path'] = card.tapPath
  data['card_id'] = card.cardId

  // 图片：filesDir 内 PNG 绝对路径 → fd 经 formImages 传入
  if (card.image.length > 0) {
    try {
      const file = fs.openSync(card.image, fs.OpenMode.READ_ONLY)
      imageFd = file.fd
      const images: Record<string, number> = {}
      images[IMAGE_KEY] = imageFd
      data['formImages'] = images
      data['image_name'] = IMAGE_KEY
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`${TAG} ✗ 卡片图片打开失败 ${card.image}: ${msg}`)
      data['image_name'] = ''
    }
  } else {
    data['image_name'] = ''
  }
  return { bindingData: formBindingData.createFormBindingData(data), imageFd: imageFd }
}

// ---- 推送（事件驱动，form_config.json updateDuration=0 不走系统定时刷新）----

/** 刷新单个卡片实例；cardKey 为空时尝试自动补绑。返回是否成功 */
export async function pushForm(formId: string): Promise<boolean> {
  const forms = loadForms()
  let binding = forms[formId]
  if (!binding) {
    console.warn(`${TAG} pushForm: 未知 formId=${formId}`)
    return false
  }
  const cards = loadCards()
  // 加卡时无启用卡可绑（cardKey=''）→ 推送时按同规则自动补绑并落盘
  if (binding.cardKey.length === 0 && cards.length > 0) {
    const chosen = pickCard(cards, binding.layout, binding.size)
    if (chosen) {
      const next: FormBinding = { cardKey: chosen.key, layout: binding.layout, size: binding.size }
      forms[formId] = next
      saveForms(forms)
      binding = next
      console.log(`${TAG} === 自动补绑: formId=${formId} → ${chosen.key} ===`)
    }
  }
  const card = binding.cardKey.length > 0 ? findCard(cards, binding.cardKey) : null
  const built = buildBindingData(card)
  try {
    await formProvider.updateForm(formId, built.bindingData)
    console.log(`${TAG} ✓ updateForm formId=${formId} card=${binding.cardKey || '(占位)'}`)
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ updateForm 失败 formId=${formId}: ${msg}`)
    return false
  } finally {
    // updateForm 已消费 fd（bind 到卡片渲染进程），关闭本进程句柄
    if (built.imageFd >= 0) {
      fs.closeSync(built.imageFd)
    }
  }
}

/** 刷新全部已放置实例（form_widget_update 主路径）。返回成功数 */
export async function pushAllForms(): Promise<number> {
  const forms = loadForms()
  const keys = Object.keys(forms)
  let ok = 0
  for (const formId of keys) {
    if (await pushForm(formId)) {
      ok++
    }
  }
  return ok
}

// ---- 点击跳转的冷通道暂存（对应 Android KEY_PENDING_TAP）----

export function recordTap(path: string): void {
  try {
    writeText(`${formDir}/${PENDING_TAP_FILE}`, path)
    console.log(`${TAG} 待跳转路径已暂存: ${path}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ✗ 暂存跳转路径失败: ${msg}`)
  }
}

/** 读取并清除待跳转路径（form_widget_consume_tap；无则返回空串，对齐 Android 语义） */
export async function consumeTap(): Promise<string> {
  const path = readTextIfExists(`${formDir}/${PENDING_TAP_FILE}`).trim()
  if (path.length > 0) {
    try {
      await fs.unlink(`${formDir}/${PENDING_TAP_FILE}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`${TAG} ✗ 清除待跳转路径失败: ${msg}`)
    }
    console.log(`${TAG} consumeTap: ${path}`)
  }
  return path
}
