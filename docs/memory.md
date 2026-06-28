# 记忆系统（Memory）

## 概述

`src/ai/memory-store.ts` 提供持久记忆能力。AI 通过 `memory` 工具写入，MemoryStore 即时持久化到 Tauri FS。

## 存储

| 文件 | Key | 限额 |
|------|-----|------|
| MEMORY.md | `amiba_memory_md` | 2200 字符 |
| USER.md | `amiba_user_md` | 1375 字符 |

## 条目格式

```
§ 条目1
§ 条目2
§ 条目3
```

§ 分隔，FIFO 淘汰：超出限额时挤掉最早条目。

## 实时缓存

`memoryStore` 维护 `memoryCache` / `userCache` 实时缓存：

- `executeOperation()` 写入后立即更新缓存
- `formatForSystemPrompt()` 直接使用实时缓存（不再使用冻结快照）
- System prompt volatile 层每次重建都获取最新记忆

## API

| 方法 | 说明 |
|------|------|
| `init()` | 从 storage 加载到缓存 |
| `get(target)` | 读取缓存 |
| `executeOperation(params)` | 执行 memory 工具操作（add/replace/remove） |
| `formatForSystemPrompt()` | 构建注入 system prompt 的记忆上下文 |
| `getMemorySize()` / `getUserSize()` | 获取字节数 |

## 操作类型

| action | 说明 |
|--------|------|
| `add` | 追加条目到末尾 |
| `replace` | 查找替换已有条目 |
| `remove` | 删除匹配条目 |

## 触发方式

- AI 主动判断（MEMORY_GUIDANCE 指引）
- 10 轮 nudge 强制检查
- `/new` 记忆检查点
- 用户说"记住这个"

## 日志

`[MemoryStore] 写入操作: target=memory, action=add, content=...`
