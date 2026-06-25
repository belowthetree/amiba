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

每次 AI 对话时，记忆内容以以下格式注入 System Prompt：

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
| Web | localStorage (`amiba_memory_md`, `amiba_user_md`) |
| 桌面端 | Tauri FS Plugin（`@tauri-apps/plugin-fs`） |

## 实现代码

```ts
// memory.ts
getMemory(target: 'memory' | 'user'): string
setMemory(target, content): void
executeMemoryOperation(params: MemoryToolParams): string
getMemoryContextForPrompt(): string
```

Agent 在流式对话中检测到 `memory` 工具调用时，自动执行本地记忆操作并返回结果，无需后端。
