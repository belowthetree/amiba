# 变形虫 (Amiba)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri)](https://tauri.app)
[![Build Desktop](https://github.com/belowthetree/amiba/actions/workflows/build-desktop.yml/badge.svg)](https://github.com/belowthetree/amiba/actions/workflows/build-desktop.yml)
[![Build APK](https://github.com/belowthetree/amiba/actions/workflows/build-apk.yml/badge.svg)](https://github.com/belowthetree/amiba/actions/workflows/build-apk.yml)

AI 驱动的跨平台即时应用平台。用户用自然语言描述需求，AI 自动生成迷你小程序并即刻运行在 iframe 沙箱中。

[English](./README.en.md)

## 技术栈

Vue 3 + TypeScript + Vite + Tauri 2（Windows / macOS / Linux / Android）

## 快速开始

```bash
npm install
npm run dev           # 开发模式 → http://localhost:8080
npm run build         # 生产构建
cargo tauri dev       # Tauri 桌面应用（开发）
cargo tauri build     # Tauri 桌面应用（打包 EXE/DMG/deb）
```

## 核心功能

### AI 对话
- OpenAI 兼容的多轮流式对话，支持 DeepSeek / Qwen / 智谱等 API
- **记忆系统**：AI 自动保存用户偏好和重要信息到 MEMORY.md / USER.md
- **人格系统**：首次引导创建 AI 人格（名称、风格），可通过 `soul_save` 工具调整
- **多 Session**：顶栏下拉切换历史会话，每个 session 独立存储
- **需求追踪**：AI 自动记录服务功能需求和优化建议

### AI 服务生成
- 自然语言描述 → 生成完整 HTML/CSS/JS 小程序
- 生成的服务运行在 iframe 沙箱中，通过 JSBridge (`window.__amiba__`) 调用存储、通知等宿主能力
- 支持 Chart.js v4 图表
- 生成后可继续用 AI 编辑服务文件（`service_file_*` 工具）

### 技能系统（Skill Evolution）
- Agent 可**自主创建/修补技能**：当复杂任务成功或错误被克服后，AI 会记录为 SKILL.md
- **使用遥测**：每个技能记录使用次数、查看次数、修补次数
- **Curator 后台**：自动将长期未使用的技能标记为 stale → archived
- **LLM 智能合并**（可选）：定期对技能按前缀聚类，合并为 umbrella skill

### 离线优先
- 所有数据本地存储在 `{AppData}/amiba/`
- 配置、记忆、对话历史、服务文件、技能、人格文件全部本地化

## 架构

```
┌──────────────────────────────────────────────┐
│                   ChatPage                    │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ AI 对话      │  │ iframe 沙箱（服务运行）│   │
│  │ · 多 session │  │ · JSBridge           │   │
│  │ · 流式输出   │  │ · __amiba__ API       │   │
│  │ · 技能/记忆  │  │ · Chart.js            │   │
│  └──────┬───────┘  └──────────────────────┘   │
│         │                                      │
│  ┌──────▼──────────────────────────────────┐   │
│  │            AI Core (src/ai/)             │   │
│  │  agent.ts    → 多工具循环 + 流式对话      │   │
│  │  system-prompt.ts → 两层缓存 + nudge     │   │
│  │  soul.ts     → 人格管理 + 引导           │   │
│  │  session.ts  → 多 session 管理           │   │
│  │  memory-store.ts → 实时记忆缓存          │   │
│  │  skill-curator.ts → 技能生命周期         │   │
│  │  requirement-store.ts → 需求追踪         │   │
│  └──────┬──────────────────────────────────┘   │
│         │                                      │
│  ┌──────▼──────────────────────────────────┐   │
│  │       ToolRegistry (src/tools/)          │   │
│  │  20+ 工具: memory, generate_service,     │   │
│  │  skill_manage_*, requirement_*,          │   │
│  │  service_file_*, soul_save, ...          │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

## 工具清单

| 类别 | 工具 | 说明 |
|------|------|------|
| **记忆** | `memory` | 写入 MEMORY.md / USER.md |
| **人格** | `soul_save` | 创建/更新 AI 人格文件 |
| **生成** | `generate_service` | 自然语言生成小程序 |
| **编辑** | `service_file_list/read/write` | 直接编辑已生成服务的文件 |
| **技能** | `skill_view` `skills_list` | 查看/列出技能 |
| **技能管理** | `skill_manage_create/patch/edit/delete/write_file` | AI 自主创建和修改技能 |
| **需求** | `requirement_view` `requirement_update` `requirements_summary` | 需求追踪 |

## 记忆与需求机制

每 10 轮对话，系统自动注入检查指令，要求 AI 在回复之前：
1. **记忆检查**：用户偏好、重要决策 → memory 工具
2. **需求检查**：服务功能需求、优化建议 → requirement_update 工具

`/new` 命令会在清空对话前捕获上下文，下一会话开始时提示 AI 保存重要信息。

## 项目结构

```
src/
├── ai/               AI 核心（agent, system-prompt, soul, session, memory, skill, requirement, curator）
├── tools/            20+ AI 工具（自动发现）
├── host/             服务运行时（沙箱、JSBridge、注册表）
├── pages/            7 个页面（Chat, Generate, Memory, MyServices, ServiceBrowse, Settings, Home）
├── config/           配置与存储抽象
├── router/           路由
└── types/            类型定义
docs/                 详细设计文档
skills/               技能文件目录
```

## 详细文档

| 文档 | 内容 |
|------|------|
| [架构](./docs/architecture.md) | 系统总体设计 |
| [Session](./docs/session.md) | 多 session 管理 |
| [System Prompt](./docs/system-prompt.md) | 两层缓存结构 |
| [记忆系统](./docs/memory.md) | 持久记忆机制 |
| [人格系统](./docs/soul.md) | SOUL.md 管理 |
| [技能进化](./docs/skill-evolution.md) | 四阶段技能演化 |
| [需求追踪](./docs/requirement-tracking.md) | 双层需求体系 |
| [工具系统](./docs/tools.md) | 工具清单 |
| [JSBridge](./docs/jsbridge.md) | 沙箱通信协议 |
| [服务生成](./docs/services.md) | 服务生成与运行 |
| [开发指南](./docs/development.md) | 开发规范 |

## CI/CD

GitHub Actions 自动构建：
- **Windows**: EXE + MSI
- **macOS**: DMG
- **Linux**: deb + AppImage
- **Android**: APK

## License

[MIT](./LICENSE) © 2026 belowthetree
