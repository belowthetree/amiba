# 变形虫 (Amiba) — 记忆写入时机设计

> 基于 Hermes Agent 的记忆系统分析，为 Amiba 设计记忆写入时机的简化方案。

---

## 一、Hermes 的记忆写入路径（参考来源）

| # | 写入时机 | 触发者 | 写入内容 | 持久化方式 |
|---|---|---|---|---|
| 1 | Agent 主动调用 memory 工具 | LLM 在对话中返回 tool_calls | 结构化记忆操作 (add/replace/remove) | 即时写入 MEMORY.md / USER.md 文件 + 镜像到外部 provider |
| 2 | 每轮结束自动 sync | turn_finalizer 在每轮收尾时调用 | 本轮对话摘要 (user/assistant pair) | 后台线程调用外部 provider.sync_turn()，不影响内置文件 |
| 3 | Session 结束 / 旋转 | 退出 CLI、gateway 过期、/new 命令 | 累积会话信息 | 调用 provider.on_session_end() |
| 4 | Nudge 背景回顾 | 每 N 轮 fork 一个背景 agent | 由背景 agent 的 memory tool 调用决定 | 同路径 1 |

**关键结论**：内置 MEMORY.md / USER.md 只通过路径 1（Agent 主动调 memory 工具）写入。
路径 2-4 仅影响外部 provider（mem0、honcho 等），不碰内置文件。

---

## 二、Amiba 的记忆写入设计方案

Amiba 作为 Tauri 桌面应用，初期不需要外部 provider，采用**简化版**记忆系统。

### 2.1 架构

```
agent 调用 memory 工具 (tool_call)
  -> registry.dispatch('memory', args)
    -> memory.tool.ts handler
      -> MemoryStore  (src/ai/memory-store.ts)
        -> Tauri FS write  (即时持久化)    ← 唯一的写入路径
```

### 2.2 写入时机

#### 时机 A：Agent 主动调用 memory 工具（唯一写入路径）

大模型在对话过程中，认为需要保存重要信息时，调用 memory 工具。

```typescript
// 工具 schema（OpenAI function-calling 格式）
registry.register({
  name: 'memory',
  toolset: 'core',
  schema: {
    type: 'function',
    function: {
      name: 'memory',
      description: '保存跨会话的持久记忆。用于记住用户偏好、重要事实、项目进度等。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'replace', 'remove'] },
          target: { type: 'string', enum: ['memory', 'user'] },
          content: { type: 'string', description: 'add/replace 时的内容' },
          old_text: { type: 'string', description: 'replace/remove 时的匹配文本' },
          operations: {
            type: 'array',
            description: '批量操作，原子执行',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['add', 'replace', 'remove'] },
                content: { type: 'string' },
                old_text: { type: 'string' },
              },
              required: ['action'],
            },
          },
        },
        required: ['target'],
      },
    },
  },
  handler: async (args) => {
    // 调用 MemoryStore 操作
    return await executeMemoryOperation(args);
  },
  emoji: '🧠',
})
```

**触发条件**（通过 system prompt 指导 LLM）：

- 用户提供了个人偏好、背景信息时 -> 保存到 USER.md
- 用户提出重要目标或约束时 -> 保存到 MEMORY.md
- 项目进展到关键节点时 -> 更新 MEMORY.md
- 用户明确说"记住这个"时 -> 保存

#### 时机 B：Session 结束时清理（可选，Phase 3）

```typescript
// 在 ChatPage 的 onUnmounted 或路由离开时调用
export async function flushMemoryOnSessionEnd(messages: ChatMessage[]) {
  // 目前：不做任何事情，因为 memory 工具已是即时写入
  // 未来：如果有外部 provider，调用 provider.on_session_end()
}
```

**Amiba 初期不需要**，因为每次 memory tool 调用后已即时持久化。

#### 时机 C：Nudge 提示（可选，Phase 3）

```typescript
// 在 system prompt 中动态注入提示
const NUDGE_INTERVAL = 10;  // 可配置

export function maybeInjectMemoryNudge(turnCount: number): string {
  if (turnCount > 0 && turnCount % NUDGE_INTERVAL === 0) {
    return '\n[提示：如果对话中出现了值得长期保存的信息，可以用 memory 工具保存。]';
  }
  return '';
}
```

---

## 三、MemoryStore 设计

### 存储结构

```
MEMORY.md  — AI 笔记（agent 需要长期记住的信息）
             字符限额: 2200
             条目分隔: §
USER.md    — 用户画像（用户的偏好、背景、个人信息）
             字符限额: 1375
             条目分隔: §
```

文件路径：通过 Tauri FS plugin (`@tauri-apps/plugin-fs`) 的 appDataDir 读写。

### MemoryStore API

```typescript
// src/ai/memory-store.ts

export class MemoryStore {
  private memory: string = '';
  private user: string = '';

  async init(): Promise<void>      // 从 Tauri FS 加载
  async add(target, content): Promise<string>   // 追加条目
  async replace(target, oldText, content): Promise<string>  // 替换匹配条目
  async remove(target, oldText): Promise<string> // 删除匹配条目
  async get(target): Promise<string> // 读取全文
  private async persist(target): Promise<void>  // 写入 Tauri FS（即时持久化）
}
```

**为什么是即时持久化**：因为是本地桌面应用，FS 写入很快（毫秒级），
不需要延迟写入或批量提交。每次 memory tool 调用完成时，立刻写入磁盘。

---

## 四、写入门控

支持可选的审批机制（从 Hermes 的 write_approval 简化而来）：

```typescript
// 配置项（位于 config.yaml 或 settings 页面）
const MEMORY_CONFIG = {
  write_approval: false,       // 写入前是否需要用户确认
  max_chars: { memory: 2200, user: 1375 },
}

async function executeMemoryOp(args): Promise<string> {
  if (MEMORY_CONFIG.write_approval && isMutation(args.action)) {
    // 暂存写入，返回审批提示给用户
    return { success: true, staged: true, message: '等待确认...' }
  }
  // 直接执行并持久化
  const result = await memoryStore.execute(args)
  return { success: true, data: result }
}
```

---

## 五、与迁移计划的关系

| 阶段 | 记忆相关任务 |
|---|---|
| Phase 1 | 将现有 memory.ts 重构为注册式 memory.tool.ts，引入 MemoryStore 类 |
| Phase 2 | 无（技能目录化不涉及记忆） |
| Phase 3 | 可选添加 nudge 提示和写入门控 |

**核心原则**：记忆写入的语义（什么时候、存什么）由 system prompt 引导 LLM 决策，
代码层只提供调用的能力，不做自动推断。
