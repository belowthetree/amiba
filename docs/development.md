# 开发指南

## 环境要求

- Node.js >= 18
- npm >= 9
- Rust >= 1.77 (安装: https://rustup.rs)

## 快速开始

```bash
cd amiba
npm install
npm run dev          # 启动开发服务器 → http://localhost:5173
```

## 命令

```bash
npm run dev          # 启动开发服务器 (localhost:5173)
npm run build        # 生产构建 (vue-tsc + vite)
npm run preview      # 预览生产构建
npx tauri dev        # 启动 Tauri 桌面应用（开发模式）
npx tauri build      # 打包 Tauri 桌面应用
```

## 配置 AI

1. 启动应用，进入 **设置** 页面
2. 填入 API Key
3. 默认使用 DeepSeek API，可改为任何 OpenAI 兼容接口：
   - Base URL: `https://api.deepseek.com/v1`
   - 对话模型: `deepseek-chat`
   - 生成模型: `deepseek-chat`

## 项目结构

```
src/
├── main.ts              # Vue 入口，挂载 Pinia + Router
├── App.vue              # 根组件：TopBar + router-view + 汉堡菜单
├── router/index.ts      # 7 条路由（含动态服务路由）
├── types/service.ts     # 全部 TypeScript 类型
├── config/config.ts     # 统一配置（reactive + localStorage）
├── ai/
│   ├── agent.ts         # LLM 流式对话，含 memory tool calling
│   ├── generator.ts     # 服务生成：prompt → JSON → HTML 打包
│   ├── memory.ts        # MEMORY.md / USER.md 读写
│   ├── catalog.ts       # YAML 加载、校验、Prompt 注入
│   └── skills.ts        # 3 个内置 Skill 模板 + 匹配
├── host/
│   ├── service-container.vue  # iframe 沙箱外壳
│   ├── bridge.ts        # postMessage 通信 + __amiba__ 注入
│   └── registry.ts      # 服务注册表（CRUD + 存储）
└── pages/
    ├── HomePage.vue         # 功能入口 + 最近使用
    ├── ChatPage.vue         # 流式 AI 对话
    ├── GeneratePage.vue     # AI 生成服务界面
    ├── SettingsPage.vue     # API Key / 模型 / 主题
    ├── MyServicesPage.vue   # 服务管理 + Demo 安装
    └── MemoryPage.vue       # MEMORY.md / USER.md 编辑器
src-tauri/
├── Cargo.toml          # Rust 依赖配置
├── tauri.conf.json     # Tauri 窗口/打包配置
├── capabilities/       # 权限声明
└── src/
    ├── main.rs         # Rust 入口
    └── lib.rs          # 插件注册
```

## 添加新页面

1. 在 `src/pages/` 创建 Vue 组件
2. 在 `src/router/index.ts` 添加路由
3. 在 `App.vue` 的 `navItems` 添加入口

## 添加新 Skill

在 `src/ai/skills.ts` 的 `builtinSkills` 数组中添加：

```ts
{
  name: '技能名',
  description: '简要描述',
  keywords: ['关键词1', '关键词2'],
  template: `{ "manifest": {...}, "ui": {...}, "logic": "..." }`
}
```

## 添加新 Catalog 组件

编辑 `public/catalog/builtin_catalog.yaml`，按现有格式添加。同时在 `src/ai/generator.ts` 的 `renderNodeTree` 和 `generateStyles` 中添加对应的 HTML/CSS 渲染逻辑。

## 测试

```bash
npm test             # 单元测试（Vitest）
npm run test:e2e     # 端到端测试（Playwright）
```

## 命名规范

- **服务 ID**: 内置 `system.xxx`，用户 `user.yyy`
- **配置键**: 全小写下划线 `ai_base_url`
- **API 方法**: camelCase `setStorage`
- **Vue 组件**: PascalCase
- **TS 模块**: kebab-case
- **Git 提交**: 中文，`feat:` `fix:` `docs:` `refactor:`

## 不做的事情（明确边界）

- ❌ 不做 Flutter 原生 UI 渲染
- ❌ 不发明自定义 UI 协议
- ❌ 不做 Python 后端 AI 服务
- ❌ 不做第三方登录/支付（后续可加）
- ❌ 不做实时协作/多人
- ❌ 不做离线 AI（端侧模型，后续探索）
