# 会话管理（Session）

## 概述

`src/ai/session.ts` 统一管理聊天会话状态。ChatPage、commands、agent 均通过此模块读写会话。

## 全局单例

```ts
import { getSession } from '../ai/session'
const session = getSession()
// session.messages, session.turnCount, session.sending, ...
```

## 响应式状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages` | `Ref<Message[]>` | 消息列表（user/assistant） |
| `turnCount` | `Ref<number>` | 用户发送轮次（从历史恢复） |
| `sending` | `Ref<boolean>` | 是否正在发送 |
| `streaming` | `Ref<boolean>` | 是否正在流式接收 |
| `streamingContent` | `Ref<string>` | 流式接收内容 |
| `errorMessage` | `Ref<string>` | 错误信息 |

## API

| 方法 | 说明 |
|------|------|
| `loadHistory()` | 从 storage 恢复消息 + turnCount |
| `saveHistory()` | 写入 storage（最近 50 条） |
| `newSession()` | 清空消息/轮次/历史 → invalidateSystemPrompt() → 重建 |
| `addUserMessage(content)` | 追加用户消息 + turnCount++ |
| `addAssistantMessage(content)` | 追加 AI 回复 |
| `flashError(msg)` | 显示错误，3 秒自动消失 |

## 持久化

- Key: `amiba_chat_history`
- 格式: JSON 数组 `[{role, content}]`
- 保留最近 50 条
