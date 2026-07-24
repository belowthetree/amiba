# 会话管理（Session）v2

## 概述

`src/ai/session.ts` v2 支持多 session 管理。每个 session 独立存储，可在 ChatPage 输入区功能面板的会话列表（🗂️）切换。

## 数据模型

```ts
interface SessionMeta {
  id: string          // 短 ID（时间戳+随机）
  title: string       // 取自第一条用户消息
  createdAt: string   // ISO 8601
  updatedAt: string
  messageCount: number
}

interface SessionState {
  messages: Ref<Message[]>
  turnCount: Ref<number>
  sending: Ref<boolean>
  streaming: Ref<boolean>
  streamingContent: Ref<string>
  errorMessage: Ref<string>
}
```

## 存储结构

```
{AppData}/amiba/sessions/
  ├── _index          → SessionMeta[] （JSON，按 updatedAt 倒序）
  └── {id}.json       → Message[] （最近 100 条）
```

## API

| 方法 | 说明 |
|------|------|
| `getSession()` | 获取当前响应式会话状态 |
| `getCurrentSessionId()` | 获取当前 session ID |
| `listSessions()` | 列出所有 session 元数据 |
| `createSession(title?)` | 创建新 session 并切换 |
| `switchToSession(id)` | 切换到指定 session |
| `deleteSession(id)` | 删除 session（自动切换到最新） |
| `renameSession(id, title)` | 重命名 session |
| `newSession()` | `/new` 命令：保存当前 → 创建新 session → 注入记忆检查点 |
| `loadHistory()` | 启动时加载最新 session（自动迁移旧版 `amiba_chat_history`） |
| `saveHistory()` | 防抖保存（300ms）+ 同步更新 meta |
| `flushHistory()` | 立即刷新（切换 session 前使用） |
| `addUserMessage(content)` | 追加用户消息 + turnCount++ |
| `addAssistantMessage(content)` | 追加 AI 回复 |
| `addSystemMessage(content)` | 追加隐藏系统消息 |
| `flashError(msg)` | 显示错误，3 秒清除 |
| `getVisibleMessages()` | 获取非隐藏消息列表 |

## 实时保存

- 用户消息发送后立即 `saveHistory()`
- AI 回复完成后立即 `saveHistory()`
- 每次保存同步更新 session meta（title/messageCount/updatedAt）
- 300ms 防抖避免频繁 I/O

## 记忆检查点

`/new` 时捕获最后 12 条消息 → 注入到新 session 的首次 system prompt → AI 在新对话开始时检查并保存记忆。

## 旧版迁移

启动时如无 session 索引但存在 `amiba_chat_history`，自动创建首个 session 并导入旧数据，清除旧 key。
