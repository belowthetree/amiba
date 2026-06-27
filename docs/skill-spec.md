# SKILL.md 规范

## 概述

SKILL.md 是变形虫平台技能的标准格式文件。每个技能是一个独立目录，目录下必须包含一个 `SKILL.md` 文件。

## 目录结构

```
skills/<skill-name>/
├── SKILL.md          # 必须：含 YAML frontmatter + Markdown body
├── scripts/           # 可选：可执行辅助脚本
├── references/        # 可选：参考文档
└── templates/         # 可选：输出模板
```

## Frontmatter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 技能名称（中文，≤30 字） |
| `description` | ✅ | 简短描述（≤60 字） |
| `version` | ✅ | 语义版本号 |
| `keywords` | ✅ | 匹配关键词数组 |
| `platforms` | ✅ | 适用平台: `[web, desktop]` 或其中之一 |
| `metadata.amiba.category` | ❌ | 分类: productivity / tutorial / utility |
| `metadata.amiba.tags` | ❌ | 标签数组 |

## Body Section 顺序（HARDLINE 规范）

1. **When to Use** — 何时使用此技能
2. **Prerequisites** — 前置条件
3. **How to Run** — 如何运行
4. **Quick Reference** — 快速参考
5. **Procedure** — 操作步骤
6. **Pitfalls** — 常见陷阱
7. **Verification** — 验证方法

目标 100-200 行，精简无冗余。

## 命名规范

技能目录名使用 hyphens slug（如 `service-dev`、`todo-list`），与 `/skill-name` 命令匹配。
