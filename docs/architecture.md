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
│  │  内置服务:   Home | Chat | Generate           │ │
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
│   ├── pages/               # 6 个内置服务页面
│   │   ├── HomePage.vue
│   │   ├── ChatPage.vue
│   │   ├── GeneratePage.vue
│   │   ├── SettingsPage.vue
│   │   ├── MyServicesPage.vue
│   │   └── MemoryPage.vue
│   ├── ai/                  # AI 核心
│   │   ├── agent.ts           # LLM 对话（多工具循环）
│   │   ├── system-prompt.ts   # System Prompt 组装器（缓存+分层）
│   │   ├── soul.ts            # 人格系统（SOUL.md 管理）
│   │   ├── session.ts         # 会话管理（状态+持久化）
│   │   ├── commands.ts        # 内置命令（/new 等）
│   │   ├── memory-store.ts    # 记忆存储引擎
│   │   ├── memory.ts          # 记忆导出重封装
│   │   ├── generator.ts       # 服务生成
│   │   ├── catalog.ts         # Catalog 管理
│   │   ├── skills.ts          # Skill 管理
│   │   ├── skill-parser.ts    # SKILL.md 解析器
│   │   ├── skill-commands.ts  # /skill 命令+扫描
│   │   ├── skill-curator.ts   # Skill 生命周期管理
│   │   ├── skill-consolidation-prompt.ts  # Skill 合并 Prompt
│   │   ├── skill-usage.ts     # Skill 使用统计
│   │   ├── provider-store.ts  # AI 供应商管理（多供应商）
│   │   └── custom-agent-store.ts  # 自定义 Agent 管理
│   ├── tools/                # 工具系统
│   │   ├── tool-registry.ts   # ToolRegistry 核心
│   │   ├── discover.ts        # 工具自动发现
│   │   ├── toolsets.ts        # 工具集定义
│   │   ├── memory.tool.ts     # 记忆工具
│   │   ├── generate.tool.ts   # 服务生成工具
│   │   ├── catalog.tool.ts    # Catalog 查询工具
│   │   ├── skill.tool.ts      # 技能查询工具
│   │   └── service-file.tool.ts  # 服务文件编辑工具
│   ├── host/                # 服务运行时
│   │   ├── service-container.vue  # iframe 外壳
│   │   ├── bridge.ts        # postMessage 通信
│   │   └── registry.ts      # 服务注册表
│   ├── config/
│   │   └── config.ts        # 统一配置
│   └── types/
│       └── service.ts       # 服务类型定义
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
