# System Prompt 系统

## 概述

`src/ai/system-prompt.ts` 负责组装 LLM 的 system prompt。采用两层结构 + 缓存机制，
会话期间复用，避免每轮重建（保护 prefix caching）。

## 两层结构

```
=== Stable 层（会话内不变）===
1. 人格内容     ← soulManager.getCurrentContent()（SOUL.md body）
2. 平台能力     ← 工具、API、沙箱规则
3. 行为指引     ← 按可用工具条件注入（memory/generate/skill 指引）
4. 技能索引     ← 可用技能列表

=== Volatile 层（可随每轮变化）===
5. 记忆快照     ← MemoryStore.formatForSystemPrompt()（构建时冻结）
6. 时间戳       ← 日期（%Y-%m-%d）
7. Nudge 提示   ← 每 10 轮提醒保存记忆
```

## API

| 函数 | 说明 |
|------|------|
| `buildSystemPrompt(opts?)` | 组装 prompt（优先返回缓存） |
| `invalidateSystemPrompt()` | 清空缓存（/new、切换人格时调用） |
| `buildSkillsIndex()` | 异步构建技能索引 |

## 缓存机制

- 首次调用 `buildSystemPrompt()` 时组装并缓存
- 后续调用直接返回缓存
- `/new`、切换人格 → `invalidateSystemPrompt()` → 下次重建
- `force: true` 参数强制重建
