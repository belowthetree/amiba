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
├── config/session-db.ts # SQLite FTS5 数据库封装
├── config/web-bridge.ts  # Tauri web_* invoke 封装（fetchPage/clickGetContent/close + captureScreenshot）
├── config/logger.ts      # 前端日志系统：monkey-patch console → JSON Lines 文件持久化 + 轮转
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
  │   ├── skill-commands.ts # Skill 扫描 + 斜杠命令检测 + 缓存失效
  │   ├── skill-packager.ts # SkillPackage 打包/安装引擎
  │   ├── skill-zip.ts      # Skill ZIP 导入/导出 + URL 导入
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
│   ├── service-archive.tool.ts  # service_archive / service_rollback
│   └── web-browser.tool.ts
  ├── host/
  │   ├── service-container.vue  # iframe 沙箱外壳
  │   ├── bridge.ts        # postMessage JSBridge
  │   ├── registry.ts      # 服务注册表
  │   ├── network-bridge.ts # 网络中枢 + 全局门控
  │   ├── network-session.ts
  │   ├── service-share.ts  # 局域网服务分享引擎
  │   ├── skill-share.ts    # 局域网技能分享引擎
  │   ├── service-archive.ts # 服务版本归档引擎
  │   ├── floating-widget-manager.ts
  │   ├── floating-widget-container.vue
  │   ├── widget-lifecycle.ts
  │   ├── background-manager.ts  # 后台服务运行时管理
  │   └── webview-overlay-state.ts  # WebView 截图预览状态 + Tauri 事件监听
├── components/
│   └── WebviewOverlay.vue  # 可拖拽 WebView 预览悬浮面板
  └── pages/
      ├── HomePage.vue         # 功能入口
      ├── ChatPage.vue         # 流式 AI 对话
      ├── SettingsPage.vue     # 标签页：通用 / 技能 & Agent / 数据
      ├── ServiceBrowsePage.vue # 服务浏览与管理
      ├── ShareDialog.vue      # 局域网服务分享弹窗
      ├── SkillShareDialog.vue # 局域网技能分享弹窗
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

## Skill 分发（ZIP / LAN / URL）

### ZIP 导出

```ts
import { exportAndSaveZip } from '../ai/skill-zip'
await exportAndSaveZip('skill-slug')
// 桌面端弹出保存对话框，移动端/浏览器触发下载
```

### ZIP 导入

```ts
import { pickAndImportZip } from '../ai/skill-zip'
const slug = await pickAndImportZip()
// 桌面端弹出文件选择器，浏览器通过 <input type="file">
// ZIP 全程在内存中解析，不落盘
```

### URL 导入

```ts
import { importSkillFromUrl } from '../ai/skill-zip'
const slug = await importSkillFromUrl('https://example.com/skill.zip')
// fetch → ArrayBuffer → JSZip 解析 → 安装写入
```

### 局域网技能分享

```ts
import { sendSkill, startReceivingSkills, stopReceivingSkills, acceptSkillShare, onSkillShareEvent } from '../host/skill-share'

// 发送技能到指定节点
await sendSkill('skill-slug', peerId)

// 监听接收（复用 service-share 的网络基础设施，service key: "amiba.skill-share"）
await startReceivingSkills()
onSkillShareEvent((evt) => {
  if (evt.event === 'request') { /* 显示确认对话框 */ }
  if (evt.event === 'chunk-progress') { /* 显示进度 evt.percent */ }
  if (evt.event === 'complete') { /* 安装完成 */ }
})

// 停止监听
await stopReceivingSkills()
```

协议与局域网服务分享一致：64KB 分块传输，逐块 ACK 确认。接收端自动调用 `installSkillPackage(pkg, 'overwrite')` 安装。

### SkillPackage 格式

```typescript
interface SkillPackage {
  formatVersion: 1
  slug: string
  manifest: SkillFrontmatter    // name, description, version, keywords, platforms
  body: string                  // SKILL.md Markdown 正文
  files: Record<string, string> // 支持文件（相对路径 → 内容）
  exportedAt: string
  exportedFrom?: string
}
```

ZIP 文件和局域网传输均使用此格式。导入时同名覆盖，不保留旧版本。

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

## 服务版本归档

### 归档（创建快照）

```ts
import { archiveService, rollbackService, listVersions } from '../host/service-archive'

// 归档当前服务状态
const result = await archiveService('user.my_service')
// → { label: 'v_2026-07-05T12-00-00-000Z', fileCount: 4 }

// 存储位置：services/{id}/.versions/{label}/
```

### 回退

```ts
// 回退到最新版本
const result = await rollbackService('user.my_service')
// 或指定版本
const result = await rollbackService('user.my_service', 'v_2026-07-01T08-00-00-000Z')
// → { label: 'v_...', fileCount: 4 }
```

### 可用归档列表

```ts
const versions = await listVersions('user.my_service')
// → [{ label, timestamp, fileCount }, ...]
```

AI 通过 `service_archive` / `service_rollback` 工具自动调用上述引擎。

## 局域网服务分享

### 发送服务

```ts
import { sendService } from '../host/service-share'

// 主动发送
await sendService('user.my_service', peerId)
```

### 等待接收

```ts
import { startReceiving, stopReceiving, acceptShare, declineShare, onShareEvent } from '../host/service-share'

// 开始监听（指定 serviceKey = "amiba.service-share"）
await startReceiving()

// 订阅事件
onShareEvent((evt) => {
  if (evt.event === 'request') {
    // 弹出确认框，用户选择后调用 acceptShare() 或 declineShare()
  }
  if (evt.event === 'chunk-progress') {
    // 显示进度 evt.percent
  }
  if (evt.event === 'complete') {
    // 安装完成
  }
})

// 停止监听
await stopReceiving()
```

### 协议

通过 `NetworkSession` 发送 JSON 消息，固定 serviceKey `"amiba.service-share"`，大文件按 64KB 分块传输并逐块 ACK 确认。接收端自动调用 `registerService` + `storeServicePackage` 安装。

### 弹窗

`ShareDialog.vue` 提供 UI，挂载于 `ServiceBrowsePage.vue` 头部 📡 按钮。包含"发送"和"等待接收"两个标签页。

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

- **2026-07-07**: `scanSkills()` 在第一次扫描后将结果缓存到模块级变量 `skillCommands`，后续所有调用直接返回缓存而不重新扫描磁盘。导入新技能后调用 `scanSkills()` 会静默返回旧结果，导致 UI 不显示新技能。解决方案：导出 `invalidateSkillCache()` 函数（设置 `skillCommands = null; scanPromise = null`），在 `installSkillPackage()` 和 `loadUserSkills()` 中写入/读取前调用。
- **2026-07-07**: SettingsPage 的 IIFE 初始化块无条件调用 `setVisibility({ lan: true })`——每次进入设置页都会触发 UDP 广播重启。`initNetworkBridge()` 已在应用启动时处理好 LAN 可见性初始化，设置页只需同步 UI 开关值，不应调 `setVisibility`。
- **2026-07-05**: 更新下载功能中的路径拼接使用了 `${tempDir}amiba-update` 模板字符串，缺少路径分隔符。`@tauri-apps/api/path` 的 `tempDir()` 返回不含尾部斜杠的路径，导致 Windows 上生成 `C:\Users\...\Tempamiba-update` 而非 `C:\Users\...\Temp\amiba-update`。应始终使用 `join()` 函数进行跨平台路径拼接，切勿手动字符串拼接。同时 Rust `download_file` 缺少 HTTP 状态码检查，下载 404/403 错误页会导致假成功——需在流式下载前检查 `response.status().is_success()`。
- **2026-07-05**: vue-i18n v11 语言切换不生效——`i18n.global.locale` 是 `WritableComputedRef<string>`，必须用 `.value = lang` 赋值，直接对整个 ref 赋值 (`= lang`) 会丢弃 ref 对象，Vue 响应式无法感知变化。
- **2026-07-05**: `getServicePackage` 会列出服务目录下所有文件（含隐藏目录），归档版本存储在当前服务目录的 `.versions/` 子目录下，需在 `getServicePackage` 的文件过滤中加入 `name.startsWith('.versions')` 避免把历史快照塞入服务包。
- **2026-07-05**: ChatPage 输入框 `width: 100%` 配合 `margin` 在 flex column 布局中会导致 `overflow: hidden` 裁切右侧边距。使用 `width: calc(100% - Npx)` 配合 `margin: auto` 同时实现居中+间距。
- **2026-07-05**: 分享弹窗启动设备发现后，关闭弹窗时必须调用 `stopDiscovery('lan')` 并清除定时器。仅清定时器不会停止 Rust 端 UDP 监听，日志将持续输出。
- **2026-07-07**: 后台服务运行时采用隐藏 iframe 模式，复用已有 JSBridge 基础设施。隐藏 iframe 的 `postMessage` 目标为 `window.parent`（即主 window），而非 service-container。为防止后台 iframe 的 API 消息被前台 service-container 错误处理，`bridge.ts` 的 `createBridge()` 中增加了 `event.source !== iframe.contentWindow` 检查。后台 iframe 的所有 API 调用（storage/notification/network/background）均由 `BackgroundServiceManager` 统一处理，使用 `worker.serviceId` 而非当前路由的 `serviceId` 确定调用上下文。
- **2026-07-08**: 悬浮块 (widget) 与后台服务通信需要特殊处理。widget 通过 `window.parent.postMessage()` 发送的消息直接到主 window，不受 service-container 的 `event.source` 过滤。解决方案：widget 注入 `window.__amiba_service_id__`，background-manager 添加全局 listener 按 `serviceId` 路由。widget ← 后台方向：后台将状态写入 `storage`，widget 通过 `setInterval` 轮询读取（`postMessage` 无法直达 widget iframe）。
- **2026-07-08**: 悬浮块尺寸应由服务通过 `widget.json` 声明（`width`/`height` 字段），而非自动检测。自动检测（ResizeObserver + postMessage）存在 body 未就绪、template literal 语法错误、多次注入点维护困难等问题。声明式尺寸更简单可控，宿主只做默认值兜底（width=280, height=200）。
- **2026-07-08**: 预置服务统一使用 `manifest.json` 与可导入包保持一致。`index.json` 只做文件清单索引（`id` + `files` 数组），不再承载元数据。`installPrebuiltServices()` 从 `manifest.json` 解析 ServiceManifest。服务目录结构完全统一，不再有两种格式之分。
- **2026-07-08**: `fileAccess` 授权模型：内存 Map 存储 grant（token → serviceId + path + pattern），不落盘，应用重启即失效。`confirm()` 原生弹框确认，token 绑定 serviceId 实现多服务隔离。Tauri fs 插件权限名称为 `fs:allow-read`（涵盖 read_file/read_dir）、`fs:allow-read-file`、`fs:allow-read-text-file`，带连字符的 `fs:allow-read-dir`，注意与直觉的 `fs:allow-readdir` 区别。
- **2026-07-09**: Android 平台播放器扫描音乐改为直接扫描根目录（`/storage/emulated/0/`），无需用户手动选文件夹。实现要点：(1) `FileAccessRequest` 新增 `silent` 字段，跳过 `confirm()` 弹窗（仅 path 已指定时生效）；(2) 前端 `app.js` 通过 `navigator.userAgent` 检测 Android，自动调用 `requestAccess({ path, silent: true })`；(3) `_matchesPattern` 支持 `**/` 前缀剥离，使 `**/{*.mp3,*.flac}` 可同时触发递归扫描 + 多扩展名匹配；(4) Tauri `fs:scope` 扩展 `/storage/emulated/0/**` 和 `/sdcard/**`；(5) AndroidManifest 添加 `READ_EXTERNAL_STORAGE` + `READ_MEDIA_AUDIO` 权限。
- **2026-07-09**: 多主题系统实现后发现所有页面 CSS 均为硬编码颜色（0 个 `var()` 引用），切换暗色主题只改得了 `body` 背景。迁移策略：先在 App.vue `:root` 定义 30 个 CSS 变量（含颜色/圆角/阴影/字体/间距的全集），再逐页将 ~260 处硬编码替换为 `var(--*)` 引用。迁移后的关键收益：暗色主题只需一份 `variables.json` 覆盖变量值即可全局生效。迁移注意点：shadow 变量要保持语义一致，tint 背景（如 `#E3F2FD`）用 `--color-*-light` 系列变量替代而非直接用表面色变量，`white` 在 primary 背景上保留不变但所有卡片/面板的 `white` 需迁移为 `--color-surface`。
