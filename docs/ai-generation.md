# AI 生成系统

## 概述

AI 生成系统是变形虫的核心能力。用户用自然语言描述需求，AI 根据 Catalog 组件规范生成完整的迷你应用包（HTML + CSS + JS），经由校验后安装即可运行。

## 生成流程

```
用户输入需求
    │
    ▼
┌─────────────┐
│  Skill 匹配  │  关键词匹配 → 找到预制模板
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Prompt 组装 │  系统指令 + Catalog + Skill Context + 用户需求
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  LLM 调用    │  OpenAI 兼容接口，非流式（需要完整 JSON）
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  JSON 解析   │  提取 manifest / ui / logic / tasks
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Catalog 校验│  检查组件类型、属性、权限合法性
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  HTML 打包   │  UI Tree → HTML + CSS + JS → 单个文件
└──────┬──────┘
       │
       ▼
  安装并运行
```

## 生成器输出格式

LLM 必须返回严格 JSON：

```json
{
  "manifest": {
    "id": "user.<slug>",
    "name": "<服务名称>",
    "version": "1.0.0",
    "description": "<简短描述>",
    "permissions": ["storage"]
  },
  "ui": {
    "version": "1.0.0",
    "root": "page_root",
    "nodes": {
      "page_root": {
        "type": "container",
        "props": { "padding": 24 },
        "children": ["title", "btn"]
      },
      "title": {
        "type": "text",
        "props": { "content": "Hello World", "size": 24 }
      },
      "btn": {
        "type": "button",
        "props": { "label": "点击", "onTap": "handleClick" }
      }
    }
  },
  "logic": "function handleClick() { __amiba__.showToast('你好', 'success') }",
  "tasks": [
    {
      "id": "daily_reminder",
      "schedule": { "type": "cron", "cron": "0 8 * * *" },
      "action": {
        "type": "api",
        "module": "notification",
        "method": "showToast",
        "params": { "title": "早安！" }
      }
    }
  ]
}
```

## Prompt 模板

```
你是变形虫平台的 AI 服务生成助手。根据用户需求生成完整的迷你应用。

规则:
1. UI 只能使用 Catalog 中列出的组件和属性，禁止编造组件
2. 逻辑代码使用 __amiba__ 全局对象调用宿主 API
3. 定时任务的 action 只能调用 Catalog 中列出的 API
4. 返回纯 JSON，不要有任何解释文字，不要用 markdown 代码块包裹
5. logic 字段中的代码必须是合法的 JavaScript，使用 window.__amiba__ 调用宿主 API

=== CATALOG ===
(注入 Catalog YAML 完整内容)

=== SKILL CONTEXT ===
(如匹配到 Skill，注入其内容)

=== 用户需求 ===
{userPrompt}

返回纯 JSON，不要有任何解释文字。
```

## Skill 系统

Skill 是预制模板，当用户需求匹配到已知关键词时，将模板注入 Prompt 作为参考，提高生成质量。

| Skill | 关键词 | 说明 |
|-------|--------|------|
| 计数器 | 计数、统计、点击、counter | 带持久化存储的点击计数器 |
| 待办清单 | 待办、todo、任务、清单 | 增删改查的 TODO 列表 |
| 笔记 | 笔记、note、记事、便签 | 带时间戳的笔记管理 |

## Catalog 校验规则

生成后逐条检查：

1. 每个 `nodes[].type` 必须在 Catalog 中存在
2. 每个节点使用的 `props` key 必须属于该组件的 props 定义
3. 每个 `permissions` 条目必须在已知权限列表中
4. 每个 `tasks[].action.module/method` 必须在 Catalog APIs 中存在

## HTML 渲染

生成的 UI Tree（JSON 节点树）被编译为 HTML：

- 每个节点映射为对应的 HTML 元素（container→div, text→span, button→button 等）
- 节点属性映射为 CSS 样式
- 事件处理器（onTap、onChange 等）映射为 HTML 事件属性
- 用户逻辑代码内联为 `<script>` 标签
- 内建 `__amiba__` shim 确保离线可预览
