# 人格系统（SOUL）

## 概述

Amiba 的人格系统允许用户定义 AI 的身份、行为规则和语气风格。
每个人格是一个独立的 Markdown 文件，存储在 `souls/` 目录下。

## 文件格式

```yaml
---
name: default        # 文件名（不含扩展名）
label: 默认人格       # 显示名称
version: 1.0.0
---

## Identity
你是谁，由谁创建，扮演什么角色。

## Behavior
行为规则和约束。例如：用中文回复、使用工具前说明意图。

## Tone
语气风格（可选）。例如：友好、专业、直接。

## Rules
硬性规定。例如：不要编造信息、不执行危险操作。

## Background
平台背景知识（可选）。
```

YAML frontmatter 用于元数据解析，Markdown body 部分注入 System Prompt 的 Stable 层第一条。

## 存储位置

```
{AppData}/amiba/souls/
├── default.md      # 默认人格（首次引导时创建）
└── custom.md       # 用户自定义人格
{AppData}/amiba/amiba_active_soul  # 记录当前激活人格名
```

## SoulManager API

`src/ai/soul.ts` — 全局单例 `soulManager`

| 方法 | 说明 |
|------|------|
| `init()` | 加载上次使用的人格，浏览器模式用内存默认 |
| `loadSoul(name)` | 切换人格 → 读文件 → invalidateSystemPrompt() |
| `getCurrentContent()` | 返回当前人格的 body 文本（供 system prompt 使用） |
| `listSouls()` | 列出所有可用的 `souls/*.md` |
| `saveSoul(name, content)` | 保存编辑，若为当前人格则触发重建 |
| `isFirstLaunch()` | 检测是否需要首次引导（`default.md` 不存在） |
| `getOnboardingDirective()` | 返回首次引导系统指令 |

## 人格切换流程

```
用户切换人格 → soulManager.loadSoul('custom')
  → 读 souls/custom.md
  → 设置 currentSoul
  → 写 amiba_active_soul
  → invalidateSystemPrompt()
    → cachedSystemPrompt = null

下次对话 → buildSystemPrompt() 检测缓存为空
  → Stable 层第一条 = soulManager.getCurrentContent()
  → 新人格生效
```

## 首次引导

首次启动时检测 `default.md` 不存在 → ChatPage 以系统消息注入引导指令 → AI 逐步询问：
1. 用户称呼 → 保存到 USER.md
2. AI 人格名称 → 创建 `souls/{name}.md`
3. 确认职责和工作方式

用户跳过时使用默认值。完成后可在设置页编辑。

## 与 System Prompt 的关系

人格内容（Markdown body）作为 System Prompt Stable 层**第一条**注入。
平台能力描述（工具、API、沙箱规则）紧随其后作为独立章节，与人格解耦。
