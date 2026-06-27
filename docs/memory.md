# 记忆系统

## 概述

变形虫为 AI 提供跨会话的持久记忆能力。AI 可以在对话中自动读写记忆，让每次对话都有上下文连续性。

## 数据模型

```
MEMORY.md:  AI 自己的笔记，最多 2200 字符
USER.md:    用户画像，最多 1375 字符

条目分隔符: §
```

示例内容：

```
§ 用户使用 PostgreSQL 数据库
§ 项目使用 pnpm 而非 npm
§ 用户偏好中文交流
```

## System Prompt 注入格式

记忆通过 `MemoryStore.formatForSystemPrompt()` 注入 System Prompt 的 Volatile 层。
快照在构建时冻结，对话中途的写入不影响已发出的 prompt。

```
══════════════════════════════════════════════
MEMORY (your personal notes) [15% — 330/2200 chars]
══════════════════════════════════════════════
用户的数据库使用 PostgreSQL
项目使用 pnpm 而非 npm
══════════════════════════════════════════════
USER PROFILE (who the user is) [8% — 110/1375 chars]
══════════════════════════════════════════════
用户偏好中文交流
用户是全栈开发者
```

## LLM 工具定义

通过 OpenAI Function Calling 将记忆作为工具暴露给 AI：

```json
{
  "name": "memory",
  "description": "保存跨会话的持久记忆。MEMORY.md 存 AI 笔记，USER.md 存用户画像。条目用 § 分隔，字符有限额。",
  "parameters": {
    "target": "memory | user",
    "action": "add | replace | remove",
    "content": "...",
    "old_text": "...",
    "operations": [{ "action": "...", "content": "...", "old_text": "..." }]
  }
}
```

### 操作类型

| 操作 | 说明 | 必填参数 |
|------|------|----------|
| `add` | 添加新条目（§ 分隔） | content |
| `replace` | 替换匹配的旧文本 | old_text, content |
| `remove` | 删除匹配的条目 | old_text |

支持 `operations` 批量操作，原子执行。

## 字符限额管理

- **MEMORY.md**: 最大 2200 字符
- **USER.md**: 最大 1375 字符

超限时，从最早条目开始删除（FIFO）。AI 被提示"满时需分批删除旧条目再加新条目"。

## 存储

| 平台 | 存储方式 |
|------|----------|
| Tauri 桌面 | `@tauri-apps/plugin-fs` → `{AppData}/amiba/amiba_memory_md`、`amiba_user_md` |
| 浏览器 | 不可用（记忆仅在 Tauri 模式下持久化） |

## 实现架构

```
agent 调用 memory 工具
  → toolRegistry.dispatch('memory', args)
    → memory.tool.ts handler
      → MemoryStore.executeOperation()   (src/ai/memory-store.ts)
        → 即时 persist() 到 Tauri FS
        → 更新内存缓存
```

- `MemoryStore` — 写入引擎，即时持久化
- `memory.tool.ts` — 工具注册，转发到 MemoryStore
- `system-prompt.ts` — 调用 `memoryStore.formatForSystemPrompt()` 注入 Volatile 层快照
