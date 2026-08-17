// ============================================================
// @amiba/page-registry — 页面注册表
// ============================================================
import { ref, type Component, type Ref } from 'vue'

export interface PageRegistration {
  id: string
  path: string
  name: string
  component: Component
  title: () => string
  icon?: string
  order?: number
  keepAlive?: boolean
  /** keep-alive include 匹配名；缺省时即使 keepAlive 也不缓存。 */
  keepAliveName?: string
  /** 是否进入 PAGE_ORDER 主导航序列。 */
  mainNav?: boolean
  /** 手势预览组件；缺省复用 component。 */
  preview?: Component
}

export interface PageEntry {
  id: string
  path: string
  name: string
  component: Component
  title: () => string
  icon?: string
  order: number
  keepAlive: boolean
  keepAliveName?: string
  mainNav: boolean
  preview?: Component
}

export interface PageHandle {
  id: string
  dispose(): void
  update(patch: Partial<Omit<PageRegistration, 'id'>>): void
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export class PageRegistry {
  readonly version: Ref<number> = ref(0)

  private readonly pages = new Map<string, PageEntry>()

  register(registration: PageRegistration): PageHandle {
    if (!ID_PATTERN.test(registration.id)) {
      throw new Error(`[page-registry] 页面 id "${registration.id}" 不合法`)
    }
    if (!registration.path.startsWith('/')) {
      throw new Error(`[page-registry] 页面 "${registration.id}" 的 path 必须以 / 开头`)
    }
    if (this.pages.has(registration.id)) {
      throw new Error(`[page-registry] 页面 "${registration.id}" 已注册`)
    }
    const duplicatePath = [...this.pages.values()].some((entry) => entry.path === registration.path)
    if (duplicatePath) {
      throw new Error(`[page-registry] 路径 "${registration.path}" 已被其他页面占用`)
    }

    this.pages.set(registration.id, {
      id: registration.id,
      path: registration.path,
      name: registration.name,
      component: registration.component,
      title: registration.title,
      icon: registration.icon,
      order: registration.order ?? 100,
      keepAlive: registration.keepAlive ?? false,
      keepAliveName: registration.keepAliveName,
      mainNav: registration.mainNav ?? false,
      preview: registration.preview,
    })
    this.bump()

    return {
      id: registration.id,
      dispose: () => {
        this.pages.delete(registration.id)
        this.bump()
      },
      update: (patch) => {
        const current = this.pages.get(registration.id)
        if (!current) return
        if (patch.path !== undefined) {
          if (!patch.path.startsWith('/')) throw new Error(`[page-registry] path 必须以 / 开头`)
          current.path = patch.path
        }
        if (patch.name !== undefined) current.name = patch.name
        if (patch.component !== undefined) current.component = patch.component
        if (patch.title !== undefined) current.title = patch.title
        if (patch.icon !== undefined) current.icon = patch.icon
        if (patch.order !== undefined) current.order = patch.order
        if (patch.keepAlive !== undefined) current.keepAlive = patch.keepAlive
        if (patch.keepAliveName !== undefined) current.keepAliveName = patch.keepAliveName
        if (patch.mainNav !== undefined) current.mainNav = patch.mainNav
        if (patch.preview !== undefined) current.preview = patch.preview
        this.bump()
      },
    }
  }

  list(): PageEntry[] {
    return [...this.pages.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  get(id: string): PageEntry | undefined {
    return this.pages.get(id)
  }

  has(id: string): boolean {
    return this.pages.has(id)
  }

  disposeAll(): void {
    this.pages.clear()
    this.bump()
  }

  private bump(): void {
    this.version.value += 1
  }
}
