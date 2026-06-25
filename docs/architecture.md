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
│   │   ├── agent.ts         # LLM 对话
│   │   ├── generator.ts     # 服务生成
│   │   ├── memory.ts        # 记忆存储
│   │   ├── catalog.ts       # Catalog 管理
│   │   └── skills.ts        # Skill 匹配
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
