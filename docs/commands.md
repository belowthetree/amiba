# 内置命令（Commands）

## 概述

`src/ai/commands.ts` 管理平台内置的 `/` 命令。与 skills（用户安装）不同，
commands 是平台级功能。

## 已注册命令

| 命令 | 说明 |
|------|------|
| `/new` | 开始新会话：清空消息/轮次/历史 → invalidateSystemPrompt() → 重建 |

## 添加新命令

```ts
import { registerCommand } from '../ai/commands'

registerCommand({
  name: 'mycmd',
  description: '命令说明',
  handler: async () => {
    // 执行逻辑
    return '执行结果消息'
  },
})
```

## 检测优先级

ChatPage 在 `send()` 中先检测 commands，再检测 skills：

```
输入 → matchCommand() → 命中则执行，return
     → matchCommand() → 未命中 → 检查 slash skills
                        → 未命中 → 正常 AI 对话
```
