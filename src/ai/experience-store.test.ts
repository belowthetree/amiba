// ============================================================
// 变形虫 (Amiba) — 经验库单元测试
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listExperiences,
  recordExperience,
  removeExperience,
  __resetExperienceCache,
  SKILL_THRESHOLD,
} from './experience-store'

describe('Experience Store', () => {
  beforeEach(() => {
    __resetExperienceCache()
  })

  it('should create a new experience with count 1', async () => {
    const r = await recordExperience({ title: 'DeepSeek Responses 接入', content: '步骤…' })
    expect(r.action).toBe('created')
    expect(r.entry.count).toBe(1)
    expect(r.thresholdReached).toBe(false)
    expect(r.entry.id).toBe('exp-1')
  })

  it('should increment count on same title (fuzzy match)', async () => {
    await recordExperience({ title: 'Vue 3 初始化', content: 'v1' })
    const r = await recordExperience({ title: 'vue 3  初始化 ', content: 'v2' })
    expect(r.action).toBe('incremented')
    expect(r.entry.count).toBe(2)
    expect(r.entry.content).toBe('v2') // 新内容覆盖补充
    const list = await listExperiences()
    expect(list.length).toBe(1)
  })

  it('should increment by explicit id', async () => {
    const first = await recordExperience({ title: 'A', content: 'x' })
    const r = await recordExperience({ id: first.entry.id, title: '完全不同的标题', content: 'y' })
    expect(r.entry.id).toBe(first.entry.id)
    expect(r.entry.count).toBe(2)
  })

  it(`should reach threshold at ${SKILL_THRESHOLD} records`, async () => {
    let last
    for (let i = 0; i < SKILL_THRESHOLD; i++) {
      last = await recordExperience({ title: 'B', content: `v${i}` })
    }
    expect(last!.entry.count).toBe(SKILL_THRESHOLD)
    expect(last!.thresholdReached).toBe(true)
  })

  it('should remove an experience', async () => {
    const r = await recordExperience({ title: 'C', content: 'x' })
    expect(await removeExperience(r.entry.id)).toBe(true)
    expect(await removeExperience(r.entry.id)).toBe(false) // 已删
    expect((await listExperiences()).length).toBe(0)
  })

  it('should allocate increasing ids', async () => {
    const a = await recordExperience({ title: 'A1', content: '' })
    const b = await recordExperience({ title: 'A2', content: '' })
    expect(a.entry.id).toBe('exp-1')
    expect(b.entry.id).toBe('exp-2')
    // 删除最高 id 后新建会复用空出的 id（取当前列表最大值+1，无持久化计数器）
    await removeExperience(b.entry.id)
    const c = await recordExperience({ title: 'A3', content: '' })
    expect(c.entry.id).toBe('exp-2')
  })

  it('should reject empty title', async () => {
    await expect(recordExperience({ title: '  ', content: 'x' })).rejects.toThrow()
  })
})
