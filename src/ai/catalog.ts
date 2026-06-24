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

export function validateGeneratedUI(
  ui: { version: string; root: string; nodes: Record<string, any> },
  catalogDef: CatalogDefinition
): ValidationError[] {
  const errors: ValidationError[] = []
  const compMap = new Map<string, CatalogComponent>()
  for (const c of catalogDef.components) {
    compMap.set(c.type, c)
  }

  for (const [nodeId, node] of Object.entries(ui.nodes)) {
    // 1. Check type exists
    if (!compMap.has(node.type)) {
      errors.push({
        node: nodeId,
        message: `Unknown component type "${node.type}". Available: ${[...compMap.keys()].join(', ')}`,
      })
      continue
    }

    const comp = compMap.get(node.type)!

    // 2. Check props keys
    if (node.props) {
      const allowedProps = new Set(Object.keys(comp.props))
      // events are also allowed in props (onTap, onChange, onSubmit)
      const eventProps = (comp.events || []).map((e) => e)
      for (const e of eventProps) allowedProps.add(e)
      // children is implicit
      allowedProps.add('children')

      for (const propKey of Object.keys(node.props)) {
        if (!allowedProps.has(propKey)) {
          errors.push({
            node: nodeId,
            message: `Unknown prop "${propKey}" for component "${node.type}". Allowed: ${[...allowedProps].join(', ')}`,
          })
        }
      }

      // 3. Check required props
      for (const [pname, pdef] of Object.entries(comp.props)) {
        if ((pdef as any).required && !(pname in node.props)) {
          errors.push({
            node: nodeId,
            message: `Missing required prop "${pname}" for component "${node.type}"`,
          })
        }
      }
    }
  }

  // 4. Check root exists
  if (!ui.nodes[ui.root]) {
    errors.push({
      node: ui.root,
      message: `Root node "${ui.root}" not found in nodes`,
    })
  }

  return errors
}

const KNOWN_PERMISSIONS = ['storage', 'notification']

export function validatePermissions(permissions: string[]): ValidationError[] {
  const errors: ValidationError[] = []
  for (const p of permissions) {
    if (!KNOWN_PERMISSIONS.includes(p)) {
      errors.push({ node: 'manifest', message: `Unknown permission: "${p}"` })
    }
  }
  return errors
}

export function getCatalogYamlText(): string {
  // Return the built-in catalog as string for prompt injection
  return `components:
  - type: container
    description: 通用容器
    is_container: true
    props:
      direction:    { type: enum, enum: [vertical, horizontal], default: vertical }
      padding:      { type: size }
      margin:       { type: size }
      backgroundColor: { type: color }
      borderRadius: { type: number }
      alignment:    { type: enum, enum: [start, center, end, stretch] }
      spacing:      { type: size }

  - type: scroll
    description: 可滚动容器
    is_container: true
    props:
      direction:   { type: enum, enum: [vertical, horizontal] }
      scrollbars:  { type: boolean, default: false }

  - type: card
    description: 卡片容器
    is_container: true
    props:
      elevation:   { type: number, default: 2 }
      borderRadius: { type: number, default: 12 }
      padding:     { type: size }

  - type: text
    description: 文本
    props:
      content: { type: string, required: true }
      size:    { type: number, default: 16 }
      color:   { type: color }
      weight:  { type: enum, enum: [normal, bold, light] }
      align:   { type: enum, enum: [left, center, right] }
      maxLines: { type: number }

  - type: button
    description: 按钮
    props:
      label:    { type: string, required: true }
      variant:  { type: enum, enum: [primary, secondary, outline, ghost], default: primary }
      size:     { type: enum, enum: [small, medium, large], default: medium }
      disabled: { type: boolean, default: false }
    events: [onTap]

  - type: input
    description: 输入框
    props:
      type:        { type: enum, enum: [text, password, number, email, multiline] }
      placeholder: { type: string }
      value:       { type: string }
      maxLength:   { type: number }
    events: [onChange, onSubmit]

  - type: image
    description: 图片
    props:
      src:   { type: string, required: true }
      fit:   { type: enum, enum: [cover, contain, fill, none], default: cover }
      width:  { type: size }
      height: { type: size }
    events: [onTap]

  - type: list
    description: 列表容器
    is_container: true
    props:
      direction: { type: enum, enum: [vertical, horizontal] }
      itemSpacing: { type: size }

  - type: spacer
    description: 弹性占位
    props:
      flex: { type: number, default: 1 }

  - type: divider
    description: 分隔线
    props:
      thickness: { type: number, default: 1 }
      color:     { type: color }

  - type: webview
    description: 内嵌网页
    props:
      src: { type: string }
      javascriptEnabled: { type: boolean, default: true }
      allowFileAccess: { type: boolean, default: false }
      scalesPageToFit: { type: boolean, default: true }
    events: [onPageStarted, onPageFinished, onWebResourceError]
`
}
