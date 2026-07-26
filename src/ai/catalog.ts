// ============================================================
// 变形虫 (Amiba) — Catalog 管理 (加载/校验)
// ============================================================
import type { CatalogDefinition, CatalogComponent } from '../types/service'

let catalog: CatalogDefinition | null = null

export async function loadCatalog(): Promise<CatalogDefinition> {
  if (catalog) return catalog

  const resp = await fetch('/catalog/builtin_catalog.yaml')
  const yamlText = await resp.text()
  catalog = parseYaml(yamlText)
  return catalog!
}

function parseYaml(text: string): CatalogDefinition {
  // Minimal YAML parser for our catalog format
  const components: CatalogComponent[] = []
  let current: Partial<CatalogComponent> | null = null
  let currentProp: string | null = null
  let currentPropDef: Record<string, any> = {}

  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimEnd()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    const indent = line.length - line.trimStart().length

    if (indent === 0) {
      // top level
      continue
    }

    if (indent === 2 && trimmed.startsWith('- type:')) {
      // New component
      if (current && current.type) {
        components.push(current as CatalogComponent)
      }
      current = { type: trimmed.slice(7).trim(), props: {}, events: [], description: '' }
      currentProp = null
      currentPropDef = {}
    } else if (current && indent === 4) {
      const keyVal = parseKeyValue(trimmed)
      if (keyVal) {
        const [key, val] = keyVal
        if (key === 'description') {
          current.description = String(val)
        } else if (key === 'is_container') {
          current.is_container = val === true || val === 'true'
        } else if (key === 'events') {
          // events list
          current.events = parseYamlList(trimmed)
        }
      }
    } else if (current && indent === 6 && trimmed.startsWith('- type:')) {
      // Skip items in events list
    } else if (current && indent === 6) {
      // prop definition
      const keyVal = parseKeyValue(trimmed)
      if (keyVal) {
        const [key] = keyVal
        if (key === 'type') {
          currentProp = null
          // This is the start of a new prop: the key is actually the prop name
          // The line looks like "propName:"
          // We need to look at the raw line
          const rawTrimmed = line.trimStart()
          const colonIdx = rawTrimmed.indexOf(':')
          if (colonIdx > 0) {
            const propName = rawTrimmed.slice(0, colonIdx).trim()
            if (!['type', 'description', 'is_container', 'events', 'props'].includes(propName)) {
              currentProp = propName
              currentPropDef = {}
            }
          }
        }
      }
    } else if (current && currentProp && indent === 8) {
      const keyVal = parseKeyValue(trimmed)
      if (keyVal) {
        const [key, val] = keyVal
        currentPropDef[key] = val
      }
    }
  }

  // Push last component
  if (current && current.type) {
    // Flush the last prop
    if (currentProp) {
      if (!current.props) current.props = {}
      ;(current.props as Record<string, any>)[currentProp] = currentPropDef
    }
    components.push(current as CatalogComponent)
  }

  // The simple parser above isn't perfect. Let's hard-parse the known catalog format.
  return parseCatalogRobust(text)
}

function parseYamlList(line: string): string[] {
  // Parse array like "[onTap]" or list items
  const match = line.match(/\[(.*?)\]/)
  if (match) {
    return match[1].split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function parseKeyValue(line: string): [string, any] | null {
  const colonIdx = line.indexOf(':')
  if (colonIdx < 0) return null

  const key = line.slice(0, colonIdx).trim()
  let value: string = line.slice(colonIdx + 1).trim()

  if (value === 'true') return [key, true]
  if (value === 'false') return [key, false]

  // Remove quotes
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1)
  }

  // Try number
  const num = Number(value)
  if (!isNaN(num) && value !== '') return [key, num]

  return [key, value]
}

function parseCatalogRobust(text: string): CatalogDefinition {
  // Robust parser: read the YAML line by line with proper state machine
  const components: CatalogComponent[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const stripped = line.trim()

    if (stripped === '- type:' || stripped.startsWith('- type:')) {
      const comp: CatalogComponent = {
        type: '',
        description: '',
        props: {},
        events: [],
      }

      // Parse component type
      const typeMatch = stripped.match(/- type:\s*(.+)/)
      if (typeMatch) comp.type = typeMatch[1].trim()

      i++
      // Parse component body at indent=4
      while (i < lines.length) {
        const body = lines[i]
        const bodyTrim = body.trim()
        const indent = body.length - body.trimStart().length

        if (indent < 4 && bodyTrim.startsWith('- type:')) break
        if (indent < 4 && bodyTrim !== '') break

        if (indent === 4) {
          if (bodyTrim.startsWith('description:')) {
            comp.description = extractValue(bodyTrim)
          } else if (bodyTrim.startsWith('is_container:')) {
            comp.is_container = extractValue(bodyTrim) === 'true'
          } else if (bodyTrim.startsWith('props:')) {
            // Parse props at indent=6
            i++
            while (i < lines.length) {
              const propLine = lines[i]
              const propTrim = propLine.trim()
              const propIndent = propLine.length - propLine.trimStart().length

              if (propIndent < 6 && propTrim !== '') break

              if (propIndent === 6 && propTrim.endsWith(':')) {
                const propName = propTrim.slice(0, -1).trim()
                const propDef: Record<string, any> = {}

                i++
                while (i < lines.length) {
                  const defLine = lines[i]
                  const defTrim = defLine.trim()
                  const defIndent = defLine.length - defLine.trimStart().length

                  if (defIndent < 8 && defTrim !== '') {
                    i-- // backtrack
                    break
                  }

                  if (defIndent === 8) {
                    const kv = parseKeyValue(defTrim)
                    if (kv) {
                      const [k, v] = kv
                      if (k === 'enum') {
                        // Parse enum list
                        propDef[k] = parseYamlList(defTrim)
                      } else if (k === 'required') {
                        propDef[k] = v === true || v === 'true'
                      } else {
                        propDef[k] = v
                      }
                    }
                  }
                  i++
                }

                if (propName) {
                  comp.props[propName] = propDef as any
                }
              } else if (propIndent < 6) {
                i-- // let outer loop handle
                break
              }
              i++
            }
          } else if (bodyTrim.startsWith('events:')) {
            comp.events = parseYamlList(bodyTrim)
          }
        } else if (indent < 4) {
          break
        }
        i++
      }

      if (comp.type) {
        components.push(comp)
      }
    } else {
      i++
    }
  }

  return { components }
}

function extractValue(line: string): string {
  const colonIdx = line.indexOf(':')
  if (colonIdx < 0) return ''
  let val = line.slice(colonIdx + 1).trim()
  if (
    (val.startsWith("'") && val.endsWith("'")) ||
    (val.startsWith('"') && val.endsWith('"'))
  ) {
    val = val.slice(1, -1)
  }
  return val
}

// --- Validation ---

export interface ValidationError {
  node: string
  message: string
}

const KNOWN_PERMISSIONS = ['storage', 'notification', 'widgets', 'network', 'background', 'fileAccess', 'fetch', 'ai']

export function validatePermissions(permissions: string[]): ValidationError[] {
  const errors: ValidationError[] = []
  for (const p of permissions) {
    if (!KNOWN_PERMISSIONS.includes(p)) {
      errors.push({ node: 'manifest', message: `Unknown permission: "${p}"` })
    }
  }
  return errors
}

export function validatePackage(pkg: { manifest: any; files: any[] }): ValidationError[] {
  const errors: ValidationError[] = []

  if (!pkg.manifest || !pkg.manifest.id) {
    errors.push({ node: 'manifest', message: '缺少 manifest.id' })
  }
  if (!pkg.manifest?.name) {
    errors.push({ node: 'manifest', message: '缺少 manifest.name' })
  }

  if (!pkg.files || !Array.isArray(pkg.files) || pkg.files.length === 0) {
    errors.push({ node: 'files', message: '缺少 files 数组' })
  } else {
    const hasIndexHtml = pkg.files.some((f: any) => f.path === 'index.html')
    if (!hasIndexHtml) {
      errors.push({ node: 'files', message: '必须包含 index.html' })
    }
  }

  if (pkg.manifest?.permissions) {
    const permErrors = validatePermissions(pkg.manifest.permissions)
    errors.push(...permErrors)
  }

  return errors
}

export function getCatalogYamlText(): string {
  // Catalog is now a style reference for AI, not strict constraint
  return `以下组件风格可供参考（你可以直接用 HTML/CSS 自由设计，不必严格拘泥）:

常用组件参考:
  - container: 通用容器 (flex 布局, 支持 direction/padding/margin/background/borderRadius/alignment/spacing)
  - card: 卡片 (elevation/borderRadius/padding)
  - scroll: 滚动容器 (direction/scrollbars)
  - text: 文本 (content/size/color/weight/align/maxLines)
  - button: 按钮 (label/variant:primary|secondary|outline|ghost/size/disabled)
  - input: 输入框 (type:text|password|number|email|multiline/placeholder/value/maxLength)
  - image: 图片 (src/fit/width/height)
  - list: 列表容器 (direction/itemSpacing)
  - spacer: 弹性占位 (flex)
  - divider: 分隔线 (thickness/color)
  - webview: 内嵌网页 (src)

颜色建议: 主色 #1976D2, 次色 #9C27B0, 背景 #fafafa, 文字 #333
圆角: 8-12px, 间距: 4/8/16/24/32px 体系

宿主 API (app.js 中使用 window.__amiba__):
  - __amiba__.storage.set(key, data) / get(key) / remove(key)
  - __amiba__.showToast(title, icon)   // icon: 'success'|'error'|'loading'|'none'
  - __amiba__.navigateTo(url)
  - __amiba__.navigateBack(delta)

网络 P2P 通信 API（需要 manifest.permissions 包含 "network"）:
  - __amiba__.network.startListening(serviceKey)  // ★ 必须调用，启动 TCP 监听并注册服务标识
  - __amiba__.network.stopListening(serviceKey)    // 停止监听（服务卸载时自动调用）
  - __amiba__.network.setVisibility({lan:true})    // 使设备可见（UDP 发现，不启动 TCP）
  - __amiba__.network.startDiscovery('lan')        // 开始扫描局域网设备
  - __amiba__.network.getVisibleDevices()          // 获取已发现设备列表 → [{id,name,address}]
  - __amiba__.network.onPeerDiscovered(cb)         // 监听新设备发现
  - const session = await __amiba__.network.connect(peerId, serviceKey)  // ★ serviceKey 必须传
  - __amiba__.network.onSession((session) => {...}) // 监听外来会话（同服务匹配成功后自动触发）
  - session.send(JSON.stringify({type,payload}))    // 发送消息（字符串）
  - session.on('message', raw => {...})             // 接收消息
  - session.on('close', () => {...})                // 对方断开
  - session.close()                                 // 主动断开
`
}
