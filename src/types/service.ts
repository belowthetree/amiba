// ============================================================
// 变形虫 (Amiba) — 服务类型定义
// ============================================================

// --- Manifest ---
export interface ServiceManifest {
  id: string // system.xxx | user.yyy
  name: string
  version: string
  description: string
  permissions: Permission[]
}

export type Permission = 'storage' | 'notification'

// --- Service Registry Entry ---
export interface ServiceEntry {
  manifest: ServiceManifest
  enabled: boolean
  installedAt: string // ISO datetime
  source: 'builtin' | 'ai-generated' | 'downloaded'
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
  module: 'storage' | 'notification' | 'ui' | 'task'
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
  name: 'page-show' | 'page-hide' | 'task-trigger'
  data?: any
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
  ai_generation_model: string
  theme_mode: 'light' | 'dark' | 'system'
  language: string
  /** Curator 技能生命周期管理配置 */
  curator_enabled?: boolean
  curator_interval_hours?: number
  curator_stale_after_days?: number
  curator_archive_after_days?: number
  /** Phase 4: LLM 智能合并（默认关闭，需手动开启） */
  curator_consolidate_enabled?: boolean
}

// --- AI Provider ---

export interface AiProvider {
  id: string          // 唯一标识，如 "deepseek"、"openai"、"ollama-local"
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
