# 架构设计

## 设计哲学

```
简单 > 完备。    标准 > 自创。     调试友好 > 性能极致。
```

| 原则 | 含义 |
|------|------|
| **一切皆服务** | 系统功能（对话/设置/记忆）和用户小程序，都是"服务"。统一注册、统一切换 |
| **Web 原生** | 服务就是 HTML/CSS/JS，不发明中间协议。AI 直接生成标准 Web 页面 |
| **宿主 thin** | 宿主只负责导航壳 + 桥接原生能力，不参与服务 UI 渲染 |
| **离线优先** | 配置和记忆本地存储，AI 生成不依赖后端服务器 |
| **安全边界清晰** | 服务跑在沙箱 iframe 里，只能通过 postMessage 获取宿主能力 |

## 整体架构

```
┌──────────────────────────────────────────────────┐
│  Vue 3 SPA (宿主壳)                               │
│  ┌────────────┬────────────────────────────────┐ │
│  │  TopBar    │  设置 ｜ 当前服务名              │ │
│  ├────────────┴────────────────────────────────┤ │
│  │                                              │ │
│  │  <router-view> 或 <iframe>                   │ │
│  │                                              │ │
│  │  内置服务:   Home | Chat                       │ │
│  │             Settings | MyServices | Memory    │ │
│  │                                              │ │
│  ├──────────────────────────────────────────────┤ │
│  │  Rust + Tauri 插件                               │ │
│  │  (存储 / 通知 / 后台任务 / 文件)              │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
         │ postMessage          │ Tauri IPC
         ▼                      ▼
   ┌──────────┐    ┌──────────────────────┐
   │ iframe   │    │  Rust Backend         │
   │ (服务)   │    │  (文件系统/通知/...)   │
   └──────────┘    └──────────────────────┘
```

**核心规则**：
- 宿主负责：导航、配置、记忆、AI 调用、原生桥接
- 服务负责：UI 渲染、业务逻辑、用户交互
- 服务不感知宿主细节，只通过 postMessage 请求能力

## 技术选型

| 环节 | 选择 | 原因 |
|------|------|------|
| 宿主框架 | Vue 3 + TypeScript | Web 原生，生态最大 |
| 打包 | Vite | 极快热更新 |
| 状态管理 | Pinia | Vue 官方推荐 |
| 路由 | vue-router | 标准方案 |
| 原生桥接 | Tauri | Rust 原生，轻量高效 |
| LLM | openai npm | 兼容 DeepSeek/OpenAI 及所有兼容接口 |
| UI 组件库 | 无 / Tailwind | 减少依赖，轻量优先 |
| 测试 | Vitest + Playwright | 单元 + 端到端 |
| 服务渲染 | iframe | 浏览器原生，安全隔离 |

## 目录结构

```
amiba/
├── src/
│   ├── main.ts              # Vue 入口
│   ├── App.vue              # 根组件 (TopBar + router-view)
│   ├── router/
│   │   └── index.ts         # 路由定义
│   ├── pages/               # 5 个内置页面 + 分享弹窗
│   │   ├── HomePage.vue
│   │   ├── ChatPage.vue
│   │   ├── SettingsPage.vue
│   │   ├── ServiceBrowsePage.vue
│   │   ├── MemoryPage.vue
│   │   └── ShareDialog.vue      # 局域网服务分享弹窗
│   ├── ai/                  # AI 核心
│   │   ├── agent.ts           # LLM 对话（多工具循环）
│   │   ├── system-prompt.ts   # System Prompt 组装器（缓存+分层）
│   │   ├── soul.ts            # 人格系统（SOUL.md 管理）
│   │   ├── session.ts         # 会话管理（状态+持久化）
│   │   ├── commands.ts        # 内置命令（/new 等）
│   │   ├── memory-store.ts    # 记忆存储引擎
│   │   ├── memory.ts          # 记忆导出重封装
│   │   ├── packager.ts        # 服务打包（多文件→单 HTML）
│   │   ├── catalog.ts         # Catalog 管理
│   │   ├── skills.ts          # Skill 管理
│   │   ├── skill-parser.ts    # SKILL.md 解析器
│   │   ├── skill-commands.ts  # /skill 命令+扫描
│   │   ├── skill-curator.ts   # Skill 生命周期管理
│   │   ├── skill-consolidation-prompt.ts  # Skill 合并 Prompt
│   │   ├── skill-usage.ts     # Skill 使用统计
│   │   ├── service-validator.ts  # 服务代码校验
│   │   ├── doc-index.ts       # 文档索引/搜索
│   │   ├── requirement-store.ts  # 需求追踪引擎
│   │   ├── provider-store.ts  # AI 供应商管理
│   │   └── custom-agent-store.ts  # 自定义 Agent 管理
│   ├── tools/                # 工具系统
│   │   ├── tool-registry.ts   # ToolRegistry 核心
│   │   ├── discover.ts        # 工具自动发现
│   │   ├── toolsets.ts        # 工具集定义
│   │   ├── memory.tool.ts
│   │   ├── catalog.tool.ts
│   │   ├── skill.tool.ts
│   │   ├── skill-manage.tool.ts
│   │   ├── service.tool.ts
│   │   ├── service-file.tool.ts
│   │   ├── service-validate.tool.ts
│   │   ├── service-archive.tool.ts  # service_archive / service_rollback
│   │   ├── doc.tool.ts
│   │   ├── requirement.tool.ts
│   │   ├── session-search.tool.ts
│   │   ├── soul.tool.ts
│   │   └── web-browser.tool.ts
│   ├── host/                # 服务运行时
│   │   ├── service-container.vue  # iframe 外壳 + session 生命周期
│   │   ├── bridge.ts        # postMessage 通信 + BRIDGE_SCRIPT 注入
│   │   ├── registry.ts      # 服务注册表
│   │   ├── network-bridge.ts # UDP 发现 + session 管理中枢 + 全局网络门控
│   │   ├── network-session.ts  # NetworkSession 类（send/on/close）
│   │   ├── service-share.ts    # 局域网服务分享引擎（分块传输+安装）
│   │   ├── service-archive.ts  # 服务版本归档引擎（archive/rollback/list）
│   │   └── floating-widget-manager.ts # 悬浮块管理
│   ├── config/
│   │   ├── config.ts        # 统一配置（amiba_settings，合并所有普通设置项）
│   │   ├── storage.ts       # 存储抽象
│   │   └── updater.ts       # 更新检查 + Rust reqwest 下载
│   ├── types/
│   │   └── service.ts       # 服务类型定义
│   ├── i18n/                 # 多语言 (vue-i18n)
│   │   ├── index.ts          # createI18n + settings.language 同步
│   │   ├── types.ts          # LocalesSchema 类型约束
│   │   └── locales/
│   │       ├── zh-CN.ts      # 中文语言包
│   │       └── en.ts         # 英文语言包
├── public/
│   └── catalog/
│       └── builtin_catalog.yaml
├── tests/
│   ├── unit/
│   └── e2e/
├── src-tauri/
│   └── ...                  # Tauri Rust 后端
└── package.json
```

## 安全模型

| 层级 | 措施 |
|------|------|
| 服务沙箱 | `<iframe sandbox="allow-scripts">` 禁止访问父窗口 DOM、禁止弹窗、禁止重定向 |
| 能力白名单 | Catalog 限制 AI 可生成的组件和 API |
| API 鉴权 | 服务 manifest 声明权限，宿主检查后放行 |
| 输入校验 | 所有 postMessage 消息验证来源 origin |
| CSP | Content-Security-Policy 限制外部资源加载 |

## Android WebView 浏览器引擎

`src-tauri/src/web.rs` — 三平台 WebView 引擎（桌面 WebView / Android JNI+Kotlin / iOS WKWebView）。

### WebView 预览系统

当 AI 使用 `web_browse` 时，隐藏 WebView（480x360）渲染目标页面。前端 `WebviewOverlay.vue`（可拖拽悬浮面板）通过 html2canvas 截图实时预览页面内容。

**截图流程：**
```
web_browse action 完成 → captureScreenshot() fire-and-forget
  → Rust: wv.eval() 注入 CAPTURE_TRIGGER_JS（CDN 加载 html2canvas → 截图 → 写 window._amiba_screenshot）
  → Rust: 轮询 wv.eval_with_callback("window._amiba_screenshot||''") 每500ms，直到非空
  → emit("webview-screenshot", base64 JPEG)
  → 前端 listen → WebviewOverlay.vue <img :src="screenshot">
```

| 模块 | 文件 | 角色 |
|------|------|------|
| 状态管理 | `src/host/webview-overlay-state.ts` | 响应式共享状态 + 监听 `webview-screenshot` Tauri 事件 |
| 控制栏组件 | `src/components/WebviewOverlay.vue` | 可拖拽悬浮面板：标题栏（拖动把手+✕关闭+确认弹窗）+ `<img>` 截图渲染 |
| 截图触发 | `src/tools/web-browser.tool.ts` | navigate/click/input_text/get_content 后 `captureScreenshot()` |
| 截图命令 | `src-tauri/src/web.rs` | `web_capture_screenshot`：eval 注入截图逻辑 → spawn_blocking 轮询全局变量 → emit event |
| 截图库 | CDN: `cdn.jsdelivr.net/npm/html2canvas@1.4.1` | 通过 `<script src>` 动态加载，避免内嵌 198KB 源码的字符串转义问题 |

### Android 架构（v3）

```
Tauri Command (web_fetch / web_eval / web_click / web_input_text / web_close)
    │
    ├─ 获取 JVM: libloading → dlopen("libnativehelper.so") → dlsym("JNI_GetCreatedJavaVMs")
    │                    （不依赖 ndk_context，因其 OnceLock 在 setup 阶段尚未初始化）
    │
    ├─ 加载 Kotlin 类: ActivityThread.currentApplication()
    │                  → Context.getClassLoader()
    │                  → ClassLoader.loadClass("com.amiba.desktop.WebViewHelper")
    │                    （native 线程只有 system class loader，必须通过 App ClassLoader）
    │
    └─ Kotlin WebViewHelper (MainActivity.kt 内)
         ├─ Handler(Looper.getMainLooper()) ← 所有 WebView 操作必须在主线程
         ├─ WebViewClient.onPageFinished 等待页面加载
         ├─ JsCallback (ValueCallback<String>) 跨线程传 JS 结果
         │    └─ synchronized/wait/notifyAll: Rust 线程 wait(), 主线程 notify()
         └─ evaluateJavascript(script, callback) 执行 JS 并返回结果
```

### 关键踩坑

1. **`ndk_context` OnceLock 未初始化** — Tauri 的 `setup` 在 `wry` 初始化前运行，此时 `ndk_context::android_context()` panic。改用 `libloading` 动态查找 `JNI_GetCreatedJavaVMs`。

2. **`JNI_GetCreatedJavaVMs` 非导出符号** — Android NDK 将其实现为 `inline` 函数，不能通过 `extern "C"` 静态链接。必须 `dlopen/dlsym`。

3. **Native 线程的 ClassLoader** — `attach_current_thread()` 附加的线程只有 system class loader，`find_class` 找不到 app 类。必须通过 `Context.getClassLoader().loadClass()` 加载。

4. **`evaluateJavascript` 必须传 ValueCallback** — 方法签名 `(String, ValueCallback)V` 需要两个参数，缺一不可。旧代码只传了一个参数导致 JNI 调用失败。

5. **Android WebView 必须在主线程操作** — 通过 `Handler(Looper.getMainLooper()).post {}` + `CountDownLatch` 实现跨线程同步。

## 经验教训

- **2025-07-01**: Android `ndk_context::android_context()` 在 Tauri setup 阶段 panic 因 OnceLock 未初始化。换用 `libloading` 动态加载 `JNI_GetCreatedJavaVMs` 获取 JVM，通过 `ActivityThread.currentApplication().getClassLoader().loadClass()` 加载 Kotlin 类。`tauri android dev` 会重置 `gen/android` 目录，自定义 Kotlin 代码需放在可能被覆盖的文件（如 `MainActivity.kt`）中或构建后重新注入。
- **2026-07-05**: vue-i18n v11 的 `i18n.global.locale` 是 `WritableComputedRef<string>`，切换语言需用 `.value = lang` 赋值，直接对整个 ref 对象赋值不会触发 Vue 响应式更新，导致界面不刷新。
- **2026-07-05**: 服务分享（`service-share.ts`）使用 `NetworkSession.send()` 传输 JSON 消息，大文件需按 64KB 分块传输并逐块等待 ACK 确认。分享弹窗关闭时必须调用 `stopDiscovery('lan')` 停止 Rust 端 UDP 扫描，否则日志会持续输出。
- **2026-07-05**: AI SDK `streamText` 的 `stopWhen` 回调参数是 `{ steps: StepResult[] }`，用于实现自定义工具调用轮次限制。替换 `isStepCount` 的常用模式：`stopWhen: ({ steps }) => steps.length >= maxIterations`。
- **2026-07-06**: Tauri v2.11.3 中 `WebviewWindowBuilder::parent_window()` 未实现（跨平台兼容性问题），不能将浏览窗口设为子窗口。`decorations(false)` 可创建无边框窗口，但浏览器窗口始终是独立 OS 窗口。
- **2026-07-06**: `eval_with_callback` 不支持 Promise 返回值——当 JS 返回 Promise 时，回调收到的是 Promise 对象的 JSON 序列化结果 `{}`，而非 resolved value。Sync 表达式（如 `JSON.stringify(...)` 或 `window.myVar`）可正常返回。绕过方案：用 `wv.eval()` 注入异步逻辑将结果写全局变量，再轮询 `eval_with_callback("window.myVar||''")` 同步读取；轮询须放在 `tokio::task::spawn_blocking` 中因 eval 内部使用阻塞 `mpsc::channel`。html2canvas 源码通过 CDN `<script src>` 动态加载，避免 `include_str!` 嵌入 198KB 源码时 Rust 字符串转义破坏 JS 语法。
