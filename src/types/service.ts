// ============================================================
// 变形虫 (Amiba) — 服务类型定义
// ============================================================

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null

// --- Manifest ---
export interface ServiceManifest {
  id: string // system.xxx | user.yyy
  name: string
  version: string
  description: string
  permissions: Permission[]
}

export type Permission = 'storage' | 'notification' | 'widgets' | 'network' | 'background' | 'fileAccess'

// --- Background Service Config ---

export type ScheduleType = 'interval' | 'cron' | 'none'

export interface BackgroundConfig {
  entry: string                   // 后台入口文件，如 "background.js"
  schedule?: {
    type: ScheduleType
    intervalMs?: number           // interval 类型时的毫秒数
    cron?: string                 // cron 类型时的表达式
  }
  onEvents?: string[]             // 监听的主机事件名
}

// --- Service Registry Entry ---
export interface ServiceEntry {
  manifest: ServiceManifest
  enabled: boolean
  installedAt: string // ISO datetime
  source: 'builtin' | 'ai-generated' | 'downloaded'
  hasWidgets?: boolean      // 是否有悬浮块配置（首次注册 widget 时标记）
  widgetsVisible?: boolean   // 悬浮块可见性开关
  backgroundEnabled?: boolean    // 用户是否启用了后台运行
  backgroundConfig?: BackgroundConfig | null  // 来自 background.json 的配置
  backgroundState?: 'running' | 'stopped' | 'error'  // 当前后台运行状态
}

// --- Catalog Types ---

export interface CatalogComponent {
  type: string
  description: string
  is_container?: boolean
  props: Record<string, CatalogProp>
  events?: string[]
}

export interface CatalogProp {
  type: 'string' | 'number' | 'boolean' | 'color' | 'size' | 'enum'
  enum?: string[]
  default?: any
  required?: boolean
}

export interface CatalogDefinition {
  components: CatalogComponent[]
}

// --- Task Types ---

export interface TaskSchedule {
  type: 'interval' | 'cron' | 'once'
  interval?: number // ms
  cron?: string // "0 8 * * *"
  at?: string // ISO datetime
}

export interface TaskAction {
  type: 'api'
  module: string
  method: string
  params: Record<string, any>
}

export interface GeneratedTask {
  id: string
  schedule: TaskSchedule
  action: TaskAction
}

// --- AI Generation Output (multi-file package) ---

export interface ServiceFile {
  path: string       // e.g. "index.html", "style.css", "app.js"
  content: string    // file content
}

export interface ServicePackage {
  manifest: ServiceManifest
  files: ServiceFile[]   // must include "index.html"
  tasks?: GeneratedTask[]
}

// --- JSBridge v2 ---

export interface ServiceRequest {
  type: 'api'
  module: 'storage' | 'notification' | 'ui' | 'task' | 'widgets' | 'network' | 'background' | 'fileAccess'
  method: string
  params: Record<string, any>
  requestId: string
}

export interface ServiceResponse {
  type: 'api-response'
  requestId: string
  result?: any
  error?: string
}

export interface HostEvent {
  type: 'event'
  name: 'page-show' | 'page-hide' | 'task-trigger' | 'peer-discovered' | 'peer-lost' | 'session-created' | 'session-event'
  data?: any
}

// --- Session (v4 新网络架构) ---

export interface SessionInfo {
  sessionId: string
  peerId: string
  peerName: string
}

// --- Validation ---
export interface ValidationError {
  node: string
  message: string
}

// --- Settings ---

export interface AppSettings {
  ai_base_url: string
  ai_model: string
  api_key: string
  reasoning_effort?: ReasoningEffort
  theme_mode: 'light' | 'dark' | 'system'
  language: string
  device_id: string
  network_lan_visible: boolean
  active_agent_id: string
  /** Curator 技能生命周期管理配置 */
  curator_enabled?: boolean
  curator_interval_hours?: number
  curator_stale_after_days?: number
  curator_archive_after_days?: number
  /** Phase 4: LLM 智能合并（默认关闭，需手动开启） */
  curator_consolidate_enabled?: boolean
  /** Skill 自动审查（会话结束时后台 fork 审查 Agent） */
  skill_auto_review_enabled?: boolean
  /** 后台服务全局开关 */
  background_services_enabled?: boolean
  /** 后台服务最大并发数 */
  max_background_services?: number
}

// --- AI Provider ---

export interface AiProvider {
  id: string          // 唯一标识，如 "deepseek"、"ollama-local"
  name: string        // 显示名称，如 "DeepSeek"
  baseUrl: string     // API 地址
  apiKey: string      // API 密钥
  models: string[]    // 可用模型列表
}

// --- Custom Agent ---

export interface CustomAgent {
  id: string           // 唯一标识，如 "coder"、"writer"
  name: string         // 显示名称，如 "编码助手"
  providerId: string   // 关联的 AI 供应商 ID
  model: string        // 使用的模型名称
  skills: string[]     // 启用的 Skill 名称列表
  systemPrompt?: string // 自定义 System Prompt（可选）
  soul?: string        // 关联的人格文件（可选）
  reasoning_effort?: ReasoningEffort  // 思考努力程度
}

// --- Memory ---

export interface MemoryOperation {
  action: 'add' | 'replace' | 'remove'
  content?: string
  old_text?: string
}

export interface MemoryToolParams {
  target: 'memory' | 'user'
  action?: 'add' | 'replace' | 'remove'
  content?: string
  old_text?: string
  operations?: MemoryOperation[]
}

// --- File Access ---

export interface FileInfo {
  name: string
  path: string    // 相对于授权根目录的路径
  size: number
  isDir: boolean
  modified?: string
}

export interface FileAccessRequest {
  path?: string     // 不传则弹出系统文件夹选择器
  pattern?: string  // 文件过滤，如 "*.mp3" / "**/*.json"
  purpose?: string  // 用途说明，显示在 confirm 中
}

export interface FileAccessGrant {
  token: string
  path: string       // 授权的文件夹绝对路径
  pattern: string    // 文件过滤模式
  createdAt: string
}

// --- Floating Widget ---

export interface FloatingWidgetConfig {
  id: string                    // 唯一标识，如 "quick-note"
  serviceId: string             // 所属服务 ID
  icon: string                  // emoji 图标，如 "📝"
  label?: string                // 悬停提示文字
  page: string                  // widget HTML 文件路径，如 "widgets/quick-note.html"
  edge: 'left' | 'right'       // 吸附边缘
  position: number              // 初始 y 位置（px，距顶部）
  showOn: string[]              // 生命周期：在哪些路由名下存在，空数组 = 全局
  trigger: 'manual' | 'page'   // 触发方式：manual=API 调用 show(), page=进入 showOn 路由时自动显示
  lifecycle?: string  // 管道分隔的界面/服务 ID 列表，如 "chat|user.floating-demo"。匹配时 widget 可见。"" 或 "*" = 全局。空 = 仅服务加载时可见。
  width?: number                // 面板宽度 px，默认 280
  height?: number               // 面板内容高度 px，默认自适应但最小值 120
}

export interface FloatingWidgetManifest {
  widgets: FloatingWidgetConfig[]
}

export interface FloatingWidgetState {
  config: FloatingWidgetConfig
  visible: boolean              // 当前是否可见（路由匹配 + trigger）
  expanded: boolean             // 面板是否展开
  yPosition: number             // 当前 y 位置（可拖动改变）
  htmlContent: string           // 已处理（注入 bridge）的 widget HTML
}

// --- Network (局域网 / 蓝牙互联通信) ---

export type Transport = 'lan' | 'ble'

export interface TransportVisibility {
  lan: boolean
  ble: boolean
}

export interface DiscoveredPeer {
  id: string                    // 对等设备唯一标识
  name: string                  // 设备显示名称
  transport: Transport          // 发现方式
  address: string               // 传输地址（IP:port 或 BLE MAC）
  rssi?: number                 // 信号强度（BLE，dBm）
  lastSeen: string              // ISO datetime
}

