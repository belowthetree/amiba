# 人格系统（SOUL）

## 概述

Amiba 的人格系统允许用户定义 AI 的身份、行为规则和语气风格。
每个人格是一个独立的 Markdown 文件，存储在 `souls/` 目录下。

## 文件格式

```yaml
---
name: default
label: 默认人格
version: 1.0.0
---

## Identity
你是谁，由谁创建，扮演什么角色。

## Behavior
行为规则和约束。

## Rules
硬性规定。
```

## 存储位置

```
{AppData}/amiba/souls/
├── default.md      # 默认人格（首次引导时通过 soul_save 工具创建）
└── custom.md       # 用户自定义人格
{AppData}/amiba/amiba_active_soul  # 当前激活人格名
```

## SoulManager API

`src/ai/soul.ts` — 全局单例；`src/tools/soul.tool.ts` — AI 可调用 `soul_save` 工具。

| 方法 | 说明 |
|------|------|
| `init()` | 加载上次使用的人格 |
| `loadSoul(name)` | 切换人格 → invalidateSystemPrompt() |
| `getCurrentContent()` | 返回当前人格文本（注入 system prompt） |
| `listSouls()` | 列出所有 `souls/*.md` |
| `saveSoul(name, content)` | 保存编辑 |
| `isFirstLaunch()` | 检测 `default.md` 是否存在 |
| `getOnboardingDirective()` | 返回引导指令（含 soul_save 调用步骤） |

## soul_save 工具

AI 可调用此工具创建/更新人格文件：

| 参数 | 说明 |
|------|------|
| `name` | 文件名（不含 .md） |
| `label` | 显示名称 |
| `user_name` | 用户称呼 |
| `ai_name` | AI 名称 |
| `style` | 职责风格 |

## 首次引导

`isFirstLaunch()` → 注入引导指令 → AI 3 步询问 → 调用 `soul_save` 生成 `souls/default.md`。
