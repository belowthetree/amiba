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

// --- AI Generation Output ---

export interface GeneratedNode {
  type: string
  props: Record<string, any>
  children?: string[] // node id references
}

export interface GeneratedUI {
  version: string
  root: string
  nodes: Record<string, GeneratedNode>
}

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

export interface GeneratedService {
  manifest: ServiceManifest
  ui: GeneratedUI
  logic: string // JavaScript code string
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
