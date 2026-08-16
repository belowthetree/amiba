# P0 耦合与风险清单（Coupling Findings）

每个条目给出证据、影响、P1–P3 处理动作。严重度：🔴 阻断 / 🟠 高风险 / 🟡 中风险。

## C01 🟠 `main.ts` 是手工编排的 13 步 bootstrap

证据：`src/main.ts` 直接 `import` 并调用 `initStorage/initConfig/initLogger/initRegistry/memoryStore.init/loadUserSkills/initProviderStore/initCustomAgentStore/initThemeStore/installPrebuiltThemes/initCustomViewStore/initNetworkBridge/installPrebuiltServices/initPersistentWidgets/initDesktopWidgetStore/startDesktopWidgetRunner/discoverTools/soulManager.init/maybeRunCurator/syncI18nWithSettings`，顺序固定，且嵌入了 curator 配置读取。

影响：任何插件都没有独立初始化/卸载点；`main.ts` 不可测试；移除一个功能要改入口。

处理：P1 建立 `@amiba/kernel` 的插件装配循环，所有 init 迁移为 `apply(ctx)`；`main.ts` 只保留 polyfill + createApp + `kernel.start()`。

## C02 🔴 全局单例对象被跨模块直接 import

证据：
- `config.ts` 导出 `settings = reactive(...)`
- `tool-registry.ts` 导出 `toolRegistry = new ToolRegistry()`
- `memory-store.ts` 导出 `memoryStore` 单例
- `soul.ts` 导出 `soulManager` 单例
- `provider-store.ts` 导出 `providers = reactive([])`
- `agent-runner.ts` 导出模块级单例状态
- `theme-store.ts` 导出 `themeState`

影响：无法多实例/多 profile、无法隔离测试、无法按插件卸载。

处理：P1 内核服务容器先包一层注册这些单例（兼容期），P2 起逐步改为 `ctx.get('settings')`、`ctx.get('toolRegistry')` 等注入。新增代码禁止直接 import 单例。

## C03 🔴 页面与导航全部硬编码，无页面注册表

证据：`src/router/index.ts` 写死 7 条路由；`PAGE_ORDER` 写死 `['/registry','/services','/','/settings','/memory']`；`App.vue` 的 `PAGE_COMPONENTS`、`routePath()`、`getPageIndex()`、`keep-alive include="ChatPage"`、手势目标 `sideTarget()` 全部基于写死页面集合。

影响：第三方无法新增页面、无法调整导航顺序、无法替换内置页面；快捷页和系统页被特殊分支处理。

处理：P3 建立 `pageRegistry`：页面插件声明 `{ path, name, component, title, order, keepAlive, inMainNav }`；router、PAGE_ORDER、预览表、手势全部从注册表生成。

## C04 🟠 系统内置服务与用户服务注册表不是同一模型

证据：`registry.ts` 的 `BUILTIN_SERVICES` 写死 5 个 `system.*`；`getService()` 对 builtin 走静态数组，用户服务走 reactive map；系统页面实际由 vue-router 渲染，并不走 `service-container`。

影响：“一切皆服务”的既有哲学没有贯彻到系统页面；禁用系统服务也不影响路由。

处理：P3 页面插件化后，`system.*` 服务条目改为页面/功能插件在 registry 中的投影；registry 只保留元数据，不再作为 UI 的真相源。

## C05 🟠 Slot 系统是 HTML 字符串 + `innerHTML`，无生命周期

证据：`SlotRenderer.vue` 用 `el.innerHTML = content` 并手动重放 `<script>`；`theme-store.ts` 从 `theme/slots/*.html` 读字符串；`ui-slot.tool.ts` 允许 AI 写任意 HTML/script。

影响：无法类型检查、无法 dispose、脚本重放有安全与泄漏风险；与“Vue 组件 Slot”不是一回事。

处理：ADR-0004 分层：`service.slot.*`（HTML 字符串，继续服务沙箱能力）与 `ui.slot.*`（Vue 组件注册）分开。现有 4 个 HTML slot 冻结为兼容面。

## C06 🟠 `import.meta.glob('./*.tool.ts')` 只能发现构建期工具

证据：`discover.ts` 使用 Vite 静态 glob；服务工具只能通过 `service-tools.ts` 运行时注册。

影响：npm 安装的第三方宿主插件无法通过该通道发现；插件热装载需要另外的构建注入或运行时 loader。

处理：P1 保留 `defineTool()` + 构建期 glob 作为官方内置工具装配；P2 由插件装配器生成工具模块清单；P4 再评估本地插件运行时 loader（Vite dev 与 Tauri prod 双路径）。

## C07 🟠 存储层职责过重，业务模块绕过它直接访问原生 FS

证据：`storage.ts` 同时承担全局 KV、服务文件、服务数据、Skill 文件；`session.ts` 直接动态 import `native-fs` 删除文件；`theme-store.ts` 直接操作 `amiba/theme/*`；多处手拼路径（`svcRelPath` 等）。

影响：插件权限无法按路径/域控制；未来改数据目录/云同步困难。

处理：P1 拆 `storage` 原语与 domain repository；P2 所有 FS 访问经 `filesystem` 服务并声明能力。保留 `safePath` 防穿越。

## C08 🟠 API Key 以明文放在全局 `settings` 与 provider 列表中

证据：`AppSettings.api_key`；`AiProvider.apiKey`；`provider-store.ts` 将 providers 整体 JSON 持久化到 `amiba_providers`。

影响：任何 UI/工具/插件只要 import `settings` 或 `providers` 就能读到密钥；日志/导出可能泄漏；与目标权限模型冲突。

处理：P2 建 `credentials` 服务，密钥按引用存储与解析；设置页写穿不回显。兼容期可保持存储格式，但读取收口。

## C09 🟠 系统提示词组装器直接 import 多个业务模块

证据：`system-prompt.ts` 顶层 import `memoryStore`、`getSkillCommands`、`resolveToolset`、`soulManager`；stable/volatile 分节在单个文件内。

影响：记忆/技能/人格无法独立卸载；第三方无法插入 section。

处理：P2 将 prompt 组装改为 `prompt/assemble` waterfall，各插件注册 section；`system-prompt.ts` 只做缓存与编排。

## C10 🟠 AgentRunner 是全局单例且 ChatPage 直连其状态

证据：`agent-runner.ts` 模块级 `_abortController` 与 refs；`ChatPage.vue` 直接 import `running` 等。

影响：无法多 Agent 并行、无法以插件替换循环、服务内嵌 AI 被迫另写 `ServiceAiRunner`。

处理：P2 `agentRegistry` 服务 + `AgentHandle`；页面经 `useAgent()` 订阅；`agent-runner` 退化为默认实现插件。

## C11 🟠 i18n 只支持编译期两个语言包，无插件注册

证据：`i18n/index.ts` 直接 import zh-CN/en 全量文件；`LocalesSchema` 全量类型约束。

影响：插件无法自带文案；每加文案要改全局类型。

处理：P2 `locale` 服务：`locale.register(ns, dict)`；全局 schema 拆为命名空间。兼容期保留全局字典。

## C12 🟠 App.vue 是壳 + 业务混合体（747 行）

证据：同时包含手势引擎、预览页表、更新横幅、API 门控、主题注入、Webview 浮层等。

影响：壳无法独立演进；新增全局 UI 必须改 App.vue。

处理：P3 `@amiba/ui-shell` 只保留 root layout + router-view + 全局 UI Slot 宿主；手势引擎保留为 shell 内部服务，但页面集合来自注册表；更新横幅/API 门/浮层迁为各自 UI 插件。

## C13 🟡 原生命令集中在 `lib.rs` 单个 `generate_handler!`

证据：`src-tauri/src/lib.rs` 集中注册 30+ 命令。

影响：插件化后无法按插件授权/审计；新增原生能力要改 lib.rs。

处理：P2 `capabilities` 清单 + `nativeInvoke` 路由表；Rust 侧仍集中注册但前端按 capability 门控。远期可评估 Tauri plugin 拆包。

## C14 🟡 模块顶层副作用与延迟初始化并存

证据：`agent-runner.ts` 顶层 `console.log`；`tools/*.tool.ts` 顶层注册；`session.ts` 懒初始化 `_session`；`provider-store.ts` 模块加载不初始化、bootstrap 手动初始化。

影响：import 顺序影响行为；测试/插件装配难以推理。

处理：P1 起规则：模块顶层只允许导出定义，副作用只允许在 `apply()` 或显式 `register*` 调用中发生。现有顶层工具注册迁移为 `defineTool()` 声明。

## C15 🟡 测试基线薄弱且无 e2e 脚本

证据：`vitest.config.ts` 仅 include `src/**/*.test.ts`，现有测试文件 6 个（memory-store、experience-store、service-tools、session-search、web-browser 等）；`package.json` 无 e2e/test:e2e 脚本；docs/development.md 仍写 Playwright。

影响：重构期间无法防回归，尤其是 bootstrap、页面与手势。

处理：P0 补基线冒烟清单；P1 每阶段补 `kernel`、`pageRegistry`、`slotRegistry` 单测；P3 前补 Playwright e2e 最小集（启动、设置、聊天、服务浏览、记忆）。

## C16 🟡 历史残留与文档漂移

证据：`src/pages/MyServicesPage.vue.bak`、`HelloWorld.vue`、`src/ai/memory.ts`（deprecated）、`docs/development.md` 中提到的 `generator.ts`/`generate.tool.ts`/`HomePage.vue` 在当前源码中不存在或已改。

影响：盘点与迁移容易误判；新开发者按旧文档开发。

处理：P0 清理（删除 .bak/HelloWorld 需先确认无引用）；P1 同步文档索引；P0 的模块清单作为最新真相源。

## C17 🟡 服务运行时生命周期已经很好，但宿主功能没有等价物

证据：`ServiceContext.destroy()` 统一清理网络订阅、session、widget、工具、bridge；而宿主功能（如 theme/network/updater）没有统一 dispose。

影响：宿主插件化后无法卸载。

处理：这正是 P1 内核 `ctx.effect` 要提供的通用能力。把 `ServiceContext` 视为第一个“非正式 effect 容器”，后续由其桥插件迁移。

## 处理优先级

| 优先级 | 条目 | 阶段 |
| --- | --- | --- |
| P0 | C16 清理确认、基线建立 | P0 |
| P1 | C01、C02、C06、C07、C14 | P1 |
| P2 | C08、C09、C10、C11、C13 | P2 |
| P3 | C03、C04、C05、C12 | P3 |
| 持续 | C15、C17 | 持续 |
