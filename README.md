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
- 生成的服务运行在 iframe 沙箱中，通过 JSBridge (`window.__amiba__`) 调用宿主能力（详见下方「服务 API」）
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

## 服务 API (JSBridge)

AI 生成的服务运行在 `<iframe sandbox>` 中，通过 `window.__amiba__` 全局对象调用宿主能力。所有 API 均需在服务 manifest 中声明对应权限。

| 模块 | 权限 | 说明 |
|------|------|------|
| `storage` | `storage` | 服务专属键值存储 |
| `notification` | `notification` | Toast 通知 |
| `ui` | — | 页面导航 |
| `widgets` | `widgets` | 悬浮块管理 |
| `network` | `network` | 局域网/蓝牙设备发现与对等通信 |

### storage — 键值存储

服务拥有独立的 key-value 存储空间，数据持久化到本地磁盘。

```js
await __amiba__.storage.set('count', 42)
const count = await __amiba__.storage.get('count')
await __amiba__.storage.remove('count')
```

| 方法 | 参数 | 返回 |
|------|------|------|
| `set(key, data)` | `key: string, data: any` | `Promise<void>` |
| `get(key)` | `key: string` | `Promise<any>` |
| `remove(key)` | `key: string` | `Promise<void>` |

### notification — 通知

```js
await __amiba__.showToast('保存成功', 'success')
```

| 方法 | 参数 | 返回 |
|------|------|------|
| `showToast(title, icon?)` | `title: string, icon?: 'success' \| 'error' \| 'loading' \| 'none'` | `Promise<void>` |

### ui — 页面导航

```js
await __amiba__.navigateTo('/chat')
await __amiba__.navigateBack()
```

| 方法 | 参数 | 返回 |
|------|------|------|
| `navigateTo(url)` | `url: string` | `Promise<void>` |
| `navigateBack(delta?)` | `delta?: number` | `Promise<void>` |

### widgets — 悬浮块

编程式注册和控制浮动面板。也支持通过服务目录下 `widget.json` 声明式配置（详见 [服务模型](docs/services.md#悬浮块widget)）。

```js
await __amiba__.widgets.register({
  id: 'my-widget',
  icon: '🔔',
  page: 'widgets/alert.html',
  edge: 'right',
  position: 200,
  showOn: [],
  trigger: 'manual'
})
await __amiba__.widgets.show('my-widget')
await __amiba__.widgets.hide('my-widget')
await __amiba__.widgets.remove('my-widget')
```

| 方法 | 参数 | 返回 |
|------|------|------|
| `register(config)` | `config: FloatingWidgetConfig` | `Promise<void>` |
| `remove(id)` | `id: string` | `Promise<void>` |
| `show(id)` | `id: string` | `Promise<void>` |
| `hide(id)` | `id: string` | `Promise<void>` |

`FloatingWidgetConfig` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | ✅ | 唯一标识，kebab-case |
| `icon` | `string` | ✅ | emoji 图标，如 `"📝"` |
| `label` | `string` | — | 悬停提示文字 |
| `page` | `string` | ✅ | Widget HTML 文件路径 |
| `edge` | `'left' \| 'right'` | ✅ | 吸附边缘 |
| `position` | `number` | ✅ | 初始 y 位置（px，距顶部） |
| `showOn` | `string[]` | ✅ | 生命周期路由名，空数组 = 全局 |
| `trigger` | `'manual' \| 'page'` | ✅ | `manual` = API 控制（默认），`page` = 进入 showOn 路由时自动显示 |

### network — 局域网/蓝牙通信

设备发现、对等连接和消息收发。详见 [网络互联通信](docs/network.md)。

```js
// 可见性与发现
await __amiba__.network.setVisibility({ lan: true, ble: false })
const vis = await __amiba__.network.getVisibility()
await __amiba__.network.startDiscovery('lan')
await __amiba__.network.stopDiscovery('lan')
const devices = await __amiba__.network.getVisibleDevices()
__amiba__.network.onPeerDiscovered((peer) => { /* { id, name, transport, address } */ })

// TCP 监听（按需启动，才能接收外来连接）
await __amiba__.network.startListening('my-service')
await __amiba__.network.stopListening('my-service')

// 主动连接（含服务匹配）
const session = await __amiba__.network.connect(peerId, 'my-service')
await session.send(JSON.stringify({ type: 'chat', text: 'hello' }))
session.on('message', (msg) => { const data = JSON.parse(msg); /* ... */ })
session.on('close', (reason) => { /* 对方断开 */ })
await session.close()

// 接受外来连接
__amiba__.network.onSession((session) => { /* 同上 */ })
```

**可见性与发现：**

| 方法 | 参数 | 返回 |
|------|------|------|
| `setVisibility(opts)` | `{ lan: boolean, ble: boolean }` | `Promise<void>` |
| `getVisibility()` | — | `Promise<{ lan: boolean, ble: boolean }>` |
| `startDiscovery(transport)` | `'lan' \| 'ble' \| 'all'` | `Promise<void>` |
| `stopDiscovery(transport)` | `'lan' \| 'ble' \| 'all'` | `Promise<void>` |
| `getVisibleDevices()` | — | `DiscoveredPeer[]` |
| `onPeerDiscovered(cb)` | `(peer: DiscoveredPeer) => void` | `void` |

**Session 管理：**

| 方法 | 参数 | 返回 |
|------|------|------|
| `connect(peerId, serviceKey)` | `peerId: string, serviceKey: string` | `Promise<Session>` |
| `onSession(cb)` | `(session: Session) => void` | `void` |
| `startListening(serviceKey)` | `serviceKey: string` | `Promise<void>` |
| `stopListening(serviceKey)` | `serviceKey: string` | `Promise<void>` |

**Session 对象属性/方法：**

| 属性/方法 | 说明 |
|-----------|------|
| `.id` | Session UUID |
| `.peerId` | 对端设备 ID |
| `.peerName` | 对端设备名称 |
| `.send(message)` | 发送 `string` 消息，返回 `Promise<void>` |
| `.close()` | 关闭会话，返回 `Promise<void>` |
| `.on('message', cb)` | 监听消息，`cb(message: string)` |
| `.on('close', cb)` | 监听关闭，`cb(reason?: string)` |

### 服务声明权限

| 权限 | 说明 |
|------|------|
| `storage` | 服务专属键值存储 |
| `notification` | Toast 通知 |
| `widgets` | 悬浮块功能 |
| `network` | 局域网/蓝牙互联通信（设备发现、消息收发） |

## Android 构建

### 本地构建 APK

```bash
# 1. 安装 Android SDK（Android Studio → SDK Manager → SDK 34 + NDK 27）
# 2. 设置环境变量
export ANDROID_HOME=~/Android/Sdk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.0.xxxx

# 3. 添加 Rust Android targets
rustup target add aarch64-linux-android armv7-linux-androideabi

# 4. 初始化 Android 项目（生成 src-tauri/gen/android/）
cargo tauri android init

# 5. 构建
cargo tauri android build     # release APK
cargo tauri android dev       # debug 到连接的设备
```

输出：`src-tauri/gen/android/app/build/outputs/apk/universal/release/`

**注意**：首次本地构建需要 `.cargo/config.toml` 指定 NDK 链接器（CI 自动生成，本地需手动添加）。

### 签名 APK

Release APK 需要签名才能安装到设备或上架 Google Play。

**本地签名（自用测试）：**

```bash
# 1. 生成 keystore（仅首次）
"C:\Program Files\Java\jdk-23.0.1\bin\keytool" -genkey -v \
  -keystore release.keystore -alias amiba \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=belowthetree, OU=Dev, O=Unknown, L=Unknown, ST=Unknown, C=CN" \
  -storepass 你的密码 -keypass 你的密码

# 2. 用 apksigner 签名 APK
%ANDROID_HOME%\build-tools\35.0.0\apksigner sign \
  --ks release.keystore --ks-key-alias amiba \
  --out app-release-signed.apk \
  app-universal-release-unsigned.apk

# 3. 安装到设备
adb install -r app-release-signed.apk
```

> ⚠️ **keystore 文件不要提交到 git**，它包含你的私钥。只需将 base64 编码后存入 GitHub Secrets。

### CI 自动签名

1. 在 GitHub 仓库 → **Settings → Secrets → Actions** 添加：

| Secret 名称 | 说明 |
|------------|------|
| `KEYSTORE_BASE64` | keystore 文件的 base64 编码 |
| `KEYSTORE_PASSWORD` | keystore 密码 |
| `KEY_PASSWORD` | key 密码 |

2. `package.json` 版本变更 push 到 main → CI 自动构建并签名 APK → 发布到 GitHub Releases。

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
| [网络互联通信](./docs/network.md) | 局域网/蓝牙设备发现与对等通信 |
| [服务生成](./docs/services.md) | 服务生成与运行 |
| [开发指南](./docs/development.md) | 开发规范 |

## CI/CD

修改 `package.json` 版本号并 push 到 main 自动：
1. 检测版本是否已发布（tag 是否存在）
2. 构建 Windows / macOS / Linux / Android
3. 创建 `v{version}` tag → 发布到 GitHub Releases

```bash
npm version patch      # 0.1.4 → 0.1.5
git push origin main   # 触发构建
```

也支持手动触发（Actions → workflow_dispatch）。

## License

[MIT](./LICENSE) © 2026 belowthetree
