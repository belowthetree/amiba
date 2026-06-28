# System Prompt 组装

## 概述

`src/ai/system-prompt.ts` 按两层结构组装 LLM system prompt：stable（缓存） + volatile（每次重建）。

## 两层结构

### Stable 层（缓存，仅在工具集变化或 force 时重建）

| 组件 | 来源 | 说明 |
|------|------|------|
| Identity | `soul.ts` → SOUL.md | AI 身份、行为规则 |
| Platform Capabilities | 硬编码 | 平台能力列表 |
| Behavior Guidance | 按可用工具条件注入 | MEMORY_GUIDANCE / GENERATE_GUIDANCE / SKILL_GUIDANCE / SKILL_MANAGE_GUIDANCE / REQUIREMENT_GUIDANCE |
| Skills Index | `skill-commands.ts` | 可用技能列表（异步补充） |

### Volatile 层（每次调用重建）

| 组件 | 来源 | 说明 |
|------|------|------|
| Memory Snapshot | `memory-store.ts`（实时缓存） | MEMORY.md + USER.md 内容 |
| Timestamp | `new Date()` | 当前日期 |
| Nudge | `turnCount` | 第 10/20/30... 轮注入记忆+需求检查指令 |

## 缓存策略

```
stable 层: toolsets 不变 → 复用缓存（避免重复构建 4000+ 字符）
volatile 层: 每次 streamChat 调用都重建（turnCount/时间/记忆实时变化）
```

`invalidateSystemPrompt()` 强制下次重建 stable 层（人格切换、/new 时调用）。

## Nudge 机制

第 N×10 轮时注入强制检查指令：

```
=== 记忆与需求保存检查（必须执行） ===
1. 回顾对话
2. 记忆检查 → memory 工具
3. 需求检查 → requirement_update 工具
4. 在回复用户之前完成
```

## 记忆检查点

`/new` 时捕获上一会话的最后片段，注入到新 session 首次 system prompt，提示 AI 保存重要信息。

## 日志

| 日志 | 含义 |
|------|------|
| `[SystemPrompt] stable 构建完成` | stable 层已重建 |
| `[SystemPrompt] stable 缓存命中` | 复用缓存 |
| `[SystemPrompt] 🧠 记忆 nudge 触发 — 第 N 轮` | nudge 已注入 |
