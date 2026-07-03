# 开发指南

## 环境要求

- Node.js >= 18
- npm >= 9
- Rust >= 1.77 (安装: https://rustup.rs)
- Android SDK + NDK 28 (仅 Android 构建需要)
- Android Studio（或 `sdkmanager`）用于模拟器管理

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
npx tauri android dev    # Tauri Android 开发构建（需模拟器/设备）
npx tauri android build  # Tauri Android 生产构建
```

### Android 构建

```bash
# 前置条件：Android SDK 28+, NDK 28, 模拟器运行中
# 检查设备连接
adb devices

# 开发构建（自动编译 Kotlin + Rust，安装并启动）
npx tauri android dev

# 生产构建
npx tauri android build
```

**注意**: `tauri android init` 会重置 `gen/android/` 目录。自定义 Kotlin 代码放在 `MainActivity.kt` 中（位于 `gen/android/app/src/main/java/com/amiba/desktop/`），该文件不会被 `tauri android dev` 覆盖。

### Rust 依赖（Android 新增）

```toml
# src-tauri/Cargo.toml
[target.'cfg(target_os = "android")'.dependencies]
jni = { version = "0.21", features = ["invocation"] }
ndk-context = "0.1"
libloading = "0.8"  # 用于动态加载 libnativehelper.so 获取 JVM
```

## 配置 AI

1. 启动应用，进入 **设置** 页面
2. 填入 API Key
3. 默认使用 DeepSeek API，可改为任何 OpenAI 兼容接口：
   - Base URL: `https://api.deepseek.com/v1`
   - 对话模型: `deepseek-chat`
   - 生成模型: `deepseek-chat`

### 多供应商配置

在「AI 供应商」设置卡片中可配置多个 AI 提供商：

- 每个供应商包含：名称、ID、Base URL、API Key、模型列表（每行一个模型名）
- 支持的供应商类型：DeepSeek / OpenAI / Ollama / 任何 OpenAI 兼容 API
- API Key 按供应商独立存储，优先于全局 API Key

### 自定义 Agent

在「自定义 Agent」设置卡片中可创建专属 AI 助手：

- 绑定供应商（下拉选择）→ 模型从供应商的模型列表中下拉选择
- Skill 通过勾选框从已导入的 Skill 列表中多选
- 可选自定义 System Prompt 或关联 Soul 人格文件
- 点击「启用」切换当前使用的 Agent
- 未选择 Agent 时使用默认 API 配置

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
│   ├── skills.ts        # 3 个内置 Skill 模板 + 匹配
│   ├── provider-store.ts    # AI 供应商管理（多供应商）
│   └── custom-agent-store.ts # 自定义 Agent 管理
├── host/
│   ├── service-container.vue  # iframe 沙箱外壳
│   ├── bridge.ts        # postMessage 通信 + __amiba__ 注入
│   └── registry.ts      # 服务注册表（CRUD + 存储）
└── pages/
    ├── HomePage.vue         # 功能入口 + 最近使用
    ├── ChatPage.vue         # 流式 AI 对话
    ├── GeneratePage.vue     # AI 生成服务界面
    ├── SettingsPage.vue     # API Key / 供应商 / Agent / 主题 / Skill
    ├── MyServicesPage.vue   # 服务管理 + Demo 安装
    └── MemoryPage.vue       # MEMORY.md / USER.md 编辑器
src-tauri/
├── Cargo.toml          # Rust 依赖配置
├── tauri.conf.json     # Tauri 窗口/打包配置
├── capabilities/       # 权限声明
├── src/
│   ├── main.rs         # Rust 入口
│   ├── lib.rs          # 插件注册 + AndroidJvm 状态缓存
│   ├── db.rs           # SQLite FTS5 会话
│   └── web.rs          # WebView 浏览器引擎（三平台）
└── gen/android/        # Android 项目（Gradle）
    └── app/src/main/java/com/amiba/desktop/
        └── MainActivity.kt  # Activity + JsCallback + WebViewHelper
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

## 更新机制

应用通过设置页「🔍 检查更新」按钮触发更新检查：

- **实现方式**：纯前端，调 GitHub Releases API (`GET /repos/{owner}/{repo}/releases/latest`)
- **仓库地址**：硬编码在 `src/config/updater.ts` 的 `GITHUB_API` 常量中（当前：`belowthetree/amiba`）
- **版本比较**：`tag_name` 去 `v` 前缀后做 semver 三段式比较
- **版本来源**：Tauri 运行时走 `@tauri-apps/api/app.getVersion()`（读 `tauri.conf.json` version），非 Tauri 环境降级到 Vite 注入的 `__APP_VERSION__`（读 `package.json` version）
- **全平台统一**：桌面 / Android / Web 同一套逻辑，无需 Rust 改动
- **行为**：发现新版本 → 显示版本号和发布说明 → 点击「📥 前往下载」→ `window.open` 在系统浏览器打开 GitHub Releases 页

### 版本号维护

- `tauri.conf.json` 的 `version` 字段为 Tauri 构建版本，`getVersion()` 返回此值
- `package.json` 的 `version` 为前端兜底版本，Vite 构建时注入 `__APP_VERSION__`
- 发布前应确保两处版本一致（当前不一致：`tauri.conf.json` = `0.1.4`，`package.json` = `0.3.4`）

## 不做的事情（明确边界）

- ❌ 不做 Flutter 原生 UI 渲染
- ❌ 不发明自定义 UI 协议
- ❌ 不做 Python 后端 AI 服务
- ❌ 不做第三方登录/支付（后续可加）
- ❌ 不做实时协作/多人
- ❌ 不做离线 AI（端侧模型，后续探索）
