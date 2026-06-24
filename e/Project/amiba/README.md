# 变形虫 (Amiba)

AI 驱动的跨平台即时应用平台 — 用户用自然语言描述需求，AI 自动生成迷你小程序并即刻运行。

## 技术栈

Vue 3 + TypeScript + Vite + Capacitor（Web / iOS / Android）

## 快速开始

```bash
npm install
npm run dev      # 开发 → http://localhost:5173
npm run build    # 生产构建
```

## 核心功能

| 功能 | 说明 |
|------|------|
| **AI 对话** | OpenAI 兼容流式对话，自动记忆 |
| **AI 生成** | 输入需求 → 生成完整小程序（HTML/CSS/JS） |
| **服务运行** | iframe 沙箱 + JSBridge 桥接原生能力 |
| **记忆系统** | MEMORY.md / USER.md 持久化 |
| **离线优先** | 配置、记忆、服务全部本地存储 |

## 项目结构

```
src/
├── ai/          AI 核心（对话、生成、记忆、Catalog）
├── host/        服务运行时（沙箱、JSBridge、注册表）
├── pages/       6 个内置页面
├── router/      路由
├── config/      配置
└── types/       类型定义
```
