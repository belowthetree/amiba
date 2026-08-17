// ============================================================
// @amiba/page-registry — 单元测试
// ============================================================
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import { PageRegistry } from './registry'

const PageA = defineComponent({ name: 'PageA', render: () => null })
const PageB = defineComponent({ name: 'PageB', render: () => null })

describe('PageRegistry', () => {
  it('注册、排序、注销', () => {
    const registry = new PageRegistry()
    const b = registry.register({
      id: 'page-b',
      path: '/page-b',
      name: 'B',
      component: PageB,
      title: () => 'B',
      order: 20,
    })
    registry.register({
      id: 'page-a',
      path: '/page-a',
      name: 'A',
      component: PageA,
      title: () => 'A',
      order: 10,
      mainNav: true,
      keepAlive: true,
    })

    expect(registry.list().map((entry) => entry.id)).toEqual(['page-a', 'page-b'])
    expect(registry.get('page-a')?.mainNav).toBe(true)

    b.dispose()
    expect(registry.has('page-b')).toBe(false)
  })

  it('拒绝重复 id、重复 path 与非法 path', () => {
    const registry = new PageRegistry()
    registry.register({
      id: 'only',
      path: '/only',
      name: 'Only',
      component: PageA,
      title: () => 'Only',
    })
    expect(() => registry.register({
      id: 'only',
      path: '/other',
      name: 'Other',
      component: PageA,
      title: () => 'Other',
    })).toThrow(/已注册/)
    expect(() => registry.register({
      id: 'other',
      path: '/only',
      name: 'Other',
      component: PageA,
      title: () => 'Other',
    })).toThrow(/已被其他页面占用/)
    expect(() => registry.register({
      id: 'bad-path',
      path: 'no-slash',
      name: 'Bad',
      component: PageA,
      title: () => 'Bad',
    })).toThrow(/以 \/ 开头/)
  })
})
