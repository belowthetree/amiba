# AI 生成系统

## 概述

AI 生成系统是变形虫的核心能力。用户用自然语言描述需求，AI 生成完整的多文件 Web 应用包（index.html + style.css + app.js），经由校验后安装即可在 iframe 中运行。

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
│  Prompt 组装 │  系统指令 + Catalog 风格参考 + Skill Context + 用户需求
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  LLM 调用    │  OpenAI 兼容接口，流式接收
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  JSON 解析   │  提取 manifest / files[]
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  基础校验    │  检查 manifest、files 完整性、权限合法性
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  存储包      │  整个 ServicePackage 作为 JSON 原子存储
└──────┬──────┘
       │
       ▼
  安装并运行
```

## 生成器输出格式（多文件 Web 应用包）

LLM 返回严格 JSON：

```json
{
  "manifest": {
    "id": "user.<slug>",
    "name": "<服务名称>",
    "version": "1.0.0",
    "description": "<简短描述>",
    "permissions": ["storage", "notification"]
  },
  "files": [
    {
      "path": "index.html",
      "content": "<!DOCTYPE html>\n<html>...\n<link rel=\"stylesheet\" href=\"style.css\">\n...\n<script src=\"app.js\"></script>\n</html>"
    },
    {
      "path": "style.css",
      "content": "body { font-family: sans-serif; ... }"
    },
    {
      "path": "app.js",
      "content": "function handleClick() { window.__amiba__.showToast('你好', 'success') }"
    }
  ],
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

**要求：**
- 必须包含 `index.html` 作为入口文件
- CSS 写在 `style.css` 中，JS 写在 `app.js` 中（不要内联在 HTML 里）
- `index.html` 通过 `<link href="style.css">` 和 `<script src="app.js">` 引用

## Prompt 模板

```
你是变形虫平台的 AI 服务生成助手。根据用户需求生成一个完整的迷你 Web 应用。

输出格式：一个 JSON，包含 manifest 和 files 数组。files 中每个文件有 path 和 content 字段。

规则:
1. 必须包含 "index.html" 文件作为入口
2. CSS 写在 "style.css" 中，JS 写在 "app.js" 中（不要内联在 HTML 里）
3. app.js 中使用 window.__amiba__ 调用宿主 API
4. UI 完全自由设计 —— 直接用 HTML/CSS，参考 Catalog 中的组件风格（但不必严格拘泥）
5. 返回纯 JSON，不要 markdown 代码块包裹，不要解释文字
6. content 中的代码必须是合法可运行的

=== CATALOG (组件风格参考) ===
(注入 Catalog 风格参考)

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

## Catalog 角色

Catalog 从"严格组件约束"变为"风格参考"：

- **旧模式**: AI 只能使用 Catalog 中列出的组件拼 UI，属性严格校验
- **新模式**: AI 直接用 HTML/CSS 自由设计，Catalog 作为组件风格和颜色体系的参考

校验也不再检查 UI 树，只验证：
1. `manifest` 必填字段（id、name）
2. `files` 数组非空且包含 `index.html`
3. `permissions` 在已知权限列表中

## 运行时渲染

`inlinePackage()` 函数负责将多文件包编译为单个 HTML：

1. 以 `index.html` 为骨架
2. `<link href="style.css">` → 内联为 `<style>...</style>`
3. `<script src="app.js">` → 内联为 `<script>...</script>`
4. 注入 `__amiba__` shim（如未包含）
5. 输出完整 HTML → 设置到 iframe `srcdoc`

宿主随后通过 `injectBridge()` 覆写 `__amiba__` 为真实的 JSBridge。

## Widget 生成

AI 可在生成服务时附带悬浮块（widget）。widget 通过 `widget.json` 声明，AI 需同时生成 widget HTML 文件。

**生成提示**：

```
如果用户需求涉及"快捷入口"、"悬浮按钮"、"侧边栏小工具"、"快速查看"等场景，
请在 files 中额外包含：

1. widget.json — 声明 widget 配置（id/icon/page/edge/position/showOn/trigger）
2. widgets/<name>.html — widget 界面文件

widget HTML 规范：
- 第一行写 <!-- AMIBA_BRIDGE --> 占位符
- 不含 <html>/<body> 标签，直接用 <div class="widget-root"> 包裹
- 内嵌 <style> 和 <script>
- 可使用 window.__amiba__ 调用宿主 API（前提：服务 manifest 已声明 widgets 权限）
- 面板宽 280px，内容高度建议 200-400px
- widget 中访问 __amiba__.storage 实际读写的是所属服务的数据
```

**widget.json 示例**（放在 files[0]）：

```json
{
  "widgets": [
    {
      "id": "quick-calc",
      "icon": "🧮",
      "label": "快速计算",
      "page": "widgets/quick-calc.html",
      "edge": "right",
      "position": 200,
      "showOn": [],
      "trigger": "always"
    }
  ]
}
```

**注意**：服务 manifest.permissions 必须包含 `"widgets"` 才能使 widget 正常工作。
