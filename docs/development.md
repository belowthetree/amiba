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
   - 对话模型: `deepseek-v4-flash`

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
├── main.ts              # Vue 入口，挂载 Router
├── App.vue              # 根组件：TopBar + router-view
├── router/index.ts      # 6 条路由（含动态服务路由）
├── types/service.ts     # 全部 TypeScript 类型
├── config/config.ts     # 统一配置（amiba_settings，reactive + 自动持久化）
├── config/storage.ts    # 存储抽象层
├── config/updater.ts    # 更新检查 + Rust reqwest 下载
├── i18n/                 # 多语言 (zh-CN / en)
│   ├── index.ts          # createI18n + settings.language 同步
│   ├── types.ts          # LocalesSchema 类型
│   └── locales/
│       ├── zh-CN.ts      # 中文语言包
│       └── en.ts         # 英文语言包
├── ai/
│   ├── agent.ts         # LLM 流式对话 + 多工具循环
│   ├── system-prompt.ts # System Prompt 两层组装器（stable/volatile）
│   ├── soul.ts          # 人格系统
│   ├── session.ts       # 多会话管理（创建/切换/删除）
│   ├── memory-store.ts  # MEMORY.md / USER.md 记忆引擎
│   ├── packager.ts      # 多文件 ServicePackage → 单 HTML 内联
│   ├── catalog.ts       # YAML 组件目录
│   ├── skills.ts        # Skill 管理 + 导入
│   ├── skill-parser.ts  # SKILL.md frontmatter 解析
│   ├── skill-commands.ts # Skill 扫描 + 斜杠命令检测
│   ├── skill-usage.ts   # Skill 使用统计
│   ├── skill-curator.ts # Skill 生命周期管理
│   ├── service-validator.ts  # 服务代码校验（localStorage/BroadcastChannel/权限一致性）
│   ├── doc-index.ts     # 文档索引/搜索/读取（内置 + 用户）
│   ├── requirement-store.ts  # 需求追踪引擎
│   ├── provider-store.ts   # AI 供应商管理
│   └── custom-agent-store.ts # 自定义 Agent 管理
├── tools/               # 工具系统（auto-discover via import.meta.glob）
│   ├── tool-registry.ts # ToolRegistry 核心
│   ├── toolsets.ts      # 工具集定义（core/service/docs）
│   ├── memory.tool.ts
│   ├── catalog.tool.ts
│   ├── skill.tool.ts / skill-manage.tool.ts
│   ├── service.tool.ts / service-file.tool.ts / service-validate.tool.ts
│   ├── doc.tool.ts
│   ├── requirement.tool.ts
│   ├── session-search.tool.ts
│   ├── soul.tool.ts
│   └── web-browser.tool.ts
├── host/
│   ├── service-container.vue  # iframe 沙箱外壳
│   ├── bridge.ts        # postMessage JSBridge
│   ├── registry.ts      # 服务注册表
│   ├── network-bridge.ts # 网络中枢 + 全局门控
│   ├── network-session.ts
│   └── floating-widget-manager.ts
└── pages/
    ├── HomePage.vue         # 功能入口
    ├── ChatPage.vue         # 流式 AI 对话
    ├── SettingsPage.vue     # 标签页：通用 / 技能 & Agent / 数据
    ├── ServiceBrowsePage.vue # 服务浏览与管理
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

## 多语言 (i18n)

### 使用方式

**模板中**使用 `$t()` 函数：

```vue
<template>
  <p>{{ $t('app.title') }}</p>
  <p>{{ $t('chat.stats.roundsLeft', { n: 5 }) }}</p>
</template>
```

**脚本中**使用 `useI18n()` composable：

```ts
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
alert(t('settings.confirm.deleteProvider', { name: 'example' }))
```

### 添加新文本

1. 在 `src/i18n/types.ts` 的 `LocalesSchema` 中添加新 key
2. 在 `src/i18n/locales/zh-CN.ts` 中添加中文值
3. 在 `src/i18n/locales/en.ts` 中添加英文值
4. 两个文件的结构和 key 必须一致

### 语言切换

`settings.language` (`zh-CN` / `en`) 变更会自动同步到 `i18n.global.locale`，无需手动干预。`syncI18nWithSettings()` 在 `main.ts` bootstrap 阶段通过 `watch()` 监听。

## 命名规范

- **服务 ID**: 内置 `system.xxx`，用户 `user.yyy`
- **配置键**: 全小写下划线 `ai_base_url`
- **API 方法**: camelCase `setStorage`
- **Vue 组件**: PascalCase
- **TS 模块**: kebab-case
- **Git 提交**: 中文，`feat:` `fix:` `docs:` `refactor:`

## 更新机制

应用通过设置页「🔍 检查更新」按钮触发更新检查：

- **实现方式**：纯前端检查 + Rust reqwest 下载，绕过浏览器 CORS
- **仓库地址**：硬编码在 `src/config/updater.ts` 的 `GITHUB_API` 常量中（当前：`belowthetree/amiba`）
- **版本比较**：`tag_name` 去 `v` 前缀后做 semver 三段式比较
- **版本来源**：Tauri 运行时走 `@tauri-apps/api/app.getVersion()`（读 `tauri.conf.json` version），非 Tauri 环境降级到 Vite 注入的 `__APP_VERSION__`（读 `package.json` version）
- **平台资产匹配**：按当前平台匹配 GitHub Release Assets（Windows → `.exe`/`.msi`，macOS → `.dmg`，Linux → `.AppImage`/`.deb`，Android → `.apk`）
- **下载**：调用 Rust `download_file` 命令（基于 reqwest），走流式下载 + `download-progress` 事件，前端展示进度条
- **安装**：下载到临时目录后通过 `@tauri-apps/plugin-opener.openPath()` 拉起系统默认安装程序
- **全平台统一**：桌面 / Android / Web 同一套逻辑

### 版本号维护

- `tauri.conf.json` 的 `version` 字段为 Tauri 构建版本，`getVersion()` 返回此值
- `package.json` 的 `version` 为前端兜底版本，Vite 构建时注入 `__APP_VERSION__`
- 发布前应确保两处版本一致

## 不做的事情（明确边界）

- ❌ 不做 Flutter 原生 UI 渲染
- ❌ 不发明自定义 UI 协议
- ❌ 不做 Python 后端 AI 服务
- ❌ 不做第三方登录/支付（后续可加）
- ❌ 不做实时协作/多人
- ❌ 不做离线 AI（端侧模型，后续探索）

## 经验教训

- **2026-07-05**: 更新下载功能中的路径拼接使用了 `${tempDir}amiba-update` 模板字符串，缺少路径分隔符。`@tauri-apps/api/path` 的 `tempDir()` 返回不含尾部斜杠的路径，导致 Windows 上生成 `C:\Users\...\Tempamiba-update` 而非 `C:\Users\...\Temp\amiba-update`。应始终使用 `join()` 函数进行跨平台路径拼接，切勿手动字符串拼接。同时 Rust `download_file` 缺少 HTTP 状态码检查，下载 404/403 错误页会导致假成功——需在流式下载前检查 `response.status().is_success()`。
