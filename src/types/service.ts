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
  /** 静态工具声明（发现层：设置页展示 + 校验）；执行以运行时 __amiba__.tools.register 为准 */
  aiTools?: ServiceToolDecl[]
}

export type Permission = 'storage' | 'notification' | 'widgets' | 'network' | 'background' | 'fileAccess' | 'fetch' | 'ai' | 'tools'

// --- Service AI Config ---

/** 服务的 AI 对话配置（manifest 声明 ai 权限后生效） */
export interface ServiceAiConfig {
  enabled: boolean
  /** 启用的工具名列表；undefined = 默认（全部只读工具） */
  tools?: string[]
}

// --- Service-Provided Tools（服务向 AI 提供工具） ---

/** 服务工具声明（manifest.aiTools 静态声明 / 运行时 register 元数据，均不含 handler） */
export interface ServiceToolDecl {
  name: string                    // ^[a-zA-Z0-9_-]{1,32}$
  description: string             // ≤ 512 字符
  parameters?: Record<string, any> // JSON Schema object；缺省 = 无参空 schema
  level?: 'readonly' | 'sensitive' // 缺省 readonly；sensitive 默认关闭，需用户逐项开启
}

/** 服务工具用户配置（manifest 声明 tools 权限后生效，缺省 = 启用且仅 readonly 工具） */
export interface ServiceToolsConfig {
  enabled: boolean
  /** 显式启用的工具名列表；undefined = 默认（全部 readonly 工具） */
  enabledTools?: string[]
}

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
  aiConfig?: ServiceAiConfig      // AI 对话配置（声明 ai 权限后生效，缺省 = 启用且仅只读工具）
  toolsConfig?: ServiceToolsConfig // 服务工具配置（声明 tools 权限后生效，缺省 = 启用且仅 readonly 工具）
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
  module: 'storage' | 'notification' | 'ui' | 'task' | 'widgets' | 'network' | 'background' | 'fileAccess' | 'fetch' | 'ai' | 'tools'
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

// --- 服务工具调用（host → service 请求/响应，不走 event，因为需要响应） ---

export interface ToolCallMessage {
  type: 'tool-call'
  requestId: string
  tool: string                 // 服务内本地工具名（非 svc_ 前缀的 AI 可见名）
  args: Record<string, any>
}

export interface ToolResultMessage {
  type: 'tool-result'
  requestId: string
  result?: any
  error?: string
}

export interface HostEvent {
  type: 'event'
  name: 'page-show' | 'page-hide' | 'task-trigger' | 'peer-discovered' | 'peer-lost' | 'session-created' | 'session-event' | 'room-event' | 'ai-event'
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
  active_theme: string
  language: string
  device_id: string
  network_lan_visible: boolean
  active_agent_id: string
  /** 当前默认供应商 ID（用于通用设置页签模型选择） */
  default_provider_id?: string
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
  /** 日志记录总开关 */
  log_enabled: boolean
  /** 最低记录级别 0=DEBUG 1=INFO 2=WARN 3=ERROR */
  log_level: number
  /** 最大保留日志文件数 */
  log_max_files: number
  /** 单文件最大大小 (MB) */
  log_max_size_mb: number
  /** 内置服务安装记录（serviceId → version），用于避免误删后重启自动重装 */
  prebuilt_services_installed?: Record<string, string>
  /** 已忽略的更新版本号（不再提示直到检测到更新的版本） */
  dismissed_update_version?: string
  /** 远程服务仓库地址 */
  service_registry_url?: string
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
  silent?: boolean  // 静默模式：跳过 confirm 弹窗（仅在 path 已指定时生效）
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

// --- LAN Room (局域网房间，基于 NetworkSession 的星型通信抽象) ---

export interface RoomMember {
  id: string                    // 成员设备 ID（peerId）
  name: string                  // 显示名称
  isHost: boolean               // 是否房主
}

export interface RoomInfo {
  roomId: string                // 房间唯一标识
  name: string                  // 房间名称
  isHost: boolean               // 本端是否房主
  selfId: string                // 本端成员 ID
  hostId: string                // 房主成员 ID
  members: RoomMember[]         // 全部成员（含房主与自己）
}

export interface RoomOptions {
  name?: string                 // 房间名称（默认 "<房主名> 的房间"）
  hostName?: string             // 房主显示名（默认设备主机名）
  maxMembers?: number           // 最大成员数（含房主，默认 8）
}

export interface JoinRoomOptions {
  name?: string                 // 加入者显示名（默认设备主机名）
}

// --- Remote Service Registry ---

export interface RemoteServiceEntry {
  id: string          // 服务唯一标识
  files: string[]     // 文件列表（相对路径）
}

export interface RemoteFolderEntry {
  name: string        // 文件夹显示名称
  path: string        // 子目录路径（相对于当前 index.json）
  description?: string
}

export interface RemoteServiceIndex {
  name?: string              // 当前目录名称（可选，向后兼容）
  services?: RemoteServiceEntry[]
  folders?: RemoteFolderEntry[]
}

