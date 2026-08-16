# P0 模块盘点（Module Inventory）

> 快照：Amiba v0.10.4。分类：K=内核候选，S=宿主服务插件，UI=界面插件，F=功能插件，N=原生能力（Tauri/Rust/鸿蒙）。

## 1. 入口与装配（当前无插件装配，全是硬编码 bootstrap）

| 文件 | 当前职责 | 分类 | 目标插件/内核位置 | 备注 |
| --- | --- | --- | --- | --- |
| `src/main.ts` | 串行初始化 storage/config/logger/registry/memory/skills/providers/agents/theme/network/widgets/desktop/tools/soul/curator/i18n，再挂载 Vue | K（必须缩小） | `@amiba/kernel` 只保留装配循环；所有 init 项变成插件 `apply()` | P0 最大耦合点 |
| `src/app-lifecycle.ts` | visibilitychange 生命周期 | K/S | `@amiba/app-lifecycle` 内核服务 | 语义简单，可先作 kernel 服务 |
| `src/config/polyfill.ts` | 旧 WebView `Array/String.at()` polyfill | K | `@amiba/kernel/polyfill` | 必须先加载，保持第一行导入 |
| `src/router/index.ts` | 7 条硬编码路由 + `PAGE_ORDER` | UI/S | `@amiba/ui-shell` + 路由注册服务 | 页面必须改为插件注册 |
| `src/App.vue` | 根布局、手势翻页、更新横幅、API 门控、预览页、全局浮层 | UI | `@amiba/ui-shell` | 747 行，壳不薄，需拆为 shell + 多个 UI 插件 |

## 2. 配置、存储与平台桥

| 文件 | 当前职责 | 分类 | 目标插件/内核位置 | 备注 |
| --- | --- | --- | --- | --- |
| `src/config/config.ts` | `amiba_settings` reactive + 防抖持久化 + 旧 key 迁移 | S | `@amiba/settings` | 需从“全量全局对象”改为命名空间注册 |
| `src/config/storage.ts` | Tauri FS 抽象；全局 JSON；服务文件/数据；Skill 文件 | K/S | `@amiba/storage` 内核服务 + `@amiba/service-storage` | 文件职责过重，应拆出 domain storage |
| `src/config/native-fs.ts` | Tauri plugin-fs 兼容 shim | K | `@amiba/platform` 内核服务 | 其他模块只能经它访问 FS |
| `src/config/platform-bridge.ts` | detectHost + nativeInvoke/nativeListen 分发 | K | `@amiba/platform` 内核服务 | 已接近“能力总线” |
| `src/types/native-bridge.ts` | 原生命令协议注册表 | K | `@amiba/platform` 类型包 | 与鸿蒙 Dispatcher 对应 |
| `src/config/folder-picker.ts` | 统一文件夹选择 | S/N | `@amiba/fs-picker` | 封装 3 平台差异 |
| `src/config/logger.ts` | console monkey-patch → JSONL 文件 + 轮转 | K/S | `@amiba/logger` 内核服务 | monkey-patch 方式需重构为显式 logger |
| `src/config/session-db.ts` | Rust SQLite FTS5 前端封装 | S/N | `@amiba/session-db` | 会话插件使用 |
| `src/config/theme-store.ts` | 多主题 + 主题 slots 存储 + 预置主题安装 | S | `@amiba/theme` | 主题 slot 与新版 UI slot 需分开 |
| `src/config/custom-view-store.ts` | 自定义视图存储 | F | `@amiba/custom-view` | 与 `custom-view.tool.ts` 配套 |
| `src/config/updater.ts` | GitHub release 检查 + Rust 下载 | F | `@amiba/updater` | 硬编码仓库地址，应 config 化 |
| `src/config/web-bridge.ts` | Tauri web_* 命令封装 | S/N | `@amiba/web-browser` | 浏览器能力插件 |
| `src/config/desktop-widget-store.ts` | Android 桌面卡片存储/registry | F/N | `@amiba/desktop-widgets` | 与 runner 配套 |

## 3. AI 核心（当前互引最多的功能群）

| 文件 | 当前职责 | 分类 | 目标插件/内核位置 | 备注 |
| --- | --- | --- | --- | --- |
| `src/ai/agent.ts` | OpenAI 兼容流式对话 + 多工具循环 | F | `@amiba/agent-loop` | 核心循环应可被 preset 替换 |
| `src/ai/agent-runner.ts` | 全局单例 Agent 执行器 | F | `@amiba/agent-runner` | 页面不得直接依赖单例，改服务 |
| `src/ai/system-prompt.ts` | stable/volatile 双层 prompt 组装 | F/S | `@amiba/system-prompt` | 已有“分节组装”雏形，适合 waterfall |
| `src/ai/provider-store.ts` | 多供应商 CRUD | S | `@amiba/model-providers` | 当前 provider 是数据而非扩展点 |
| `src/ai/provider-factory.ts` | chat/responses 协议客户端工厂 | F | `@amiba/model-providers` | 未来每种协议可注册 |
| `src/ai/api-check.ts` | API 连通性门控 | F | `@amiba/model-providers` | 启动门与设置页复用 |
| `src/ai/session.ts` | 多会话 JSON + FTS5 索引 | S | `@amiba/session` | 已较独立，适合首批插件化 |
| `src/ai/memory-store.ts` | MEMORY.md/USER.md 引擎 | S | `@amiba/memory` | 已被 system-prompt/tool/UI 依赖 |
| `src/ai/memory.ts` | 旧 memory handler | F(废弃) | 并入 `@amiba/memory` | 标记 deprecated |
| `src/ai/soul.ts` | 人格文件管理 | S | `@amiba/soul` | |
| `src/ai/commands.ts` | 内置斜杠命令 | S | `@amiba/commands` | 命令注册表服务 |
| `src/ai/catalog.ts` | 组件目录 YAML 解析 | S | `@amiba/catalog` | |
| `src/ai/packager.ts` | 多文件服务包内联为单 HTML | S | `@amiba/service-packager` | |
| `src/ai/service-validator.ts` | 服务代码/权限校验 | S | `@amiba/service-validator` | |
| `src/ai/doc-index.ts` | 内置/用户文档索引 | S | `@amiba/docs` | |
| `src/ai/requirement-store.ts` | per-service + global REQUIREMENT | S | `@amiba/requirements` | |
| `src/ai/service-ai.ts` | 服务内嵌 AI 对话 | F | `@amiba/service-ai` | 依赖 agent/provider 服务 |
| `src/ai/custom-agent-store.ts` | 自定义 Agent CRUD | S | `@amiba/custom-agents` | |
| `src/ai/task-recovery.ts` | 后台保存中断快照/恢复 | F | `@amiba/task-recovery` | 依赖 agent/session |
| `src/ai/experience-store.ts` | 经验库暂存/固化 | S | `@amiba/skill-experience` | 与 skill 群合并 |
| `src/ai/skills.ts` | 用户 Skill CRUD + 内置 Skill | S | `@amiba/skills` | |
| `src/ai/skill-parser.ts` | YAML frontmatter + Markdown | S | `@amiba/skills` | 纯函数，易测 |
| `src/ai/skill-commands.ts` | skill 扫描 + 斜杠命令展开 | S | `@amiba/skills` | 依赖 ToolRegistry 与 settings |
| `src/ai/skill-packager.ts` | SkillPackage 打包/安装 | S | `@amiba/skills` | |
| `src/ai/skill-zip.ts` | ZIP/URL 导入导出 | S | `@amiba/skills` | |
| `src/ai/skill-usage.ts` | usage/pin/archive 状态 | S | `@amiba/skills` | |
| `src/ai/skill-curator.ts` | 后台技能生命周期 | F | `@amiba/skill-curator` | 插件化后按需装配 |
| `src/ai/skill-consolidation-prompt.ts` | 合并 prompt | F | `@amiba/skill-curator` | |
| `src/ai/skill-reviewer.ts` | 会话后技能自动审查 | F | `@amiba/skill-reviewer` | 依赖 agent 服务 |

## 4. 工具系统（已具备注册窄腰，最接近目标）

| 文件 | 当前职责 | 分类 | 目标插件/内核位置 | 备注 |
| --- | --- | --- | --- | --- |
| `src/tools/tool-registry.ts` | 工具注册/注销/调度/门控 | K/S | `@amiba/tool-registry` 内核服务 | 直接复用为插件服务 |
| `src/tools/discover.ts` | `import.meta.glob('./*.tool.ts')` 自发现 | K/S | `@amiba/tool-registry` + 插件装配 | 静态 glob 只能发现构建内工具，需扩展 |
| `src/tools/toolsets.ts` | 工具集定义与解析 | S | `@amiba/toolsets` | 建议工具集也注册化 |
| `src/tools/*.tool.ts`（23 个） | 具体工具 | F | 每个工具文件迁为工具插件 | 保持 handler 签名，改动量最小 |
| `src/tools/ui-toolset.ts` | UI 工具集入口 | F | `@amiba/ui-tools` | |

## 5. 用户服务运行时（沙箱 iframe 子系统）

| 文件 | 当前职责 | 分类 | 目标插件/内核位置 | 备注 |
| --- | --- | --- | --- | --- |
| `src/host/registry.ts` | ServiceRegistry + 服务包/数据存储 | S | `@amiba/service-registry` | 已接近“配置即目录 manifest”，保留 |
| `src/host/service-container.vue` | iframe 沙箱容器 + session 生命周期 | UI/S | `@amiba/service-runtime` | 路由宿主迁为页面插件 |
| `src/host/bridge.ts` | postMessage JSBridge + 注入脚本 | S | `@amiba/service-bridge` | API handler 表应注册化 |
| `src/host/service-tools.ts` | 服务提供工具窄腰 | S | `@amiba/service-tools` | 已非常干净，保留语义 |
| `src/host/service-context.ts` | 服务运行时资源统一销毁 | S | `@amiba/service-runtime` | 就是插件 effect 语义 |
| `src/host/service-archive.ts` | 服务版本归档/回滚 | S | `@amiba/service-archive` | |
| `src/host/service-share.ts` | 局域网服务分享 | F | `@amiba/share` | |
| `src/host/skill-share.ts` | 局域网技能分享 | F | `@amiba/share` | |
| `src/host/file-access-grants.ts` | 文件授权 token 管理 | S/N | `@amiba/file-access` | |
| `src/host/network-bridge.ts` | UDP 发现 + session 中枢 + 门控 | S/N | `@amiba/network` | 启动初始化依赖 Tauri |
| `src/host/network-session.ts` | NetworkSession 类 | S/N | `@amiba/network` | |
| `src/host/room-manager.ts` | LAN 房间管理 | F | `@amiba/network-rooms` | |
| `src/host/background-manager.ts` | 隐藏 iframe 后台服务 + widget 全局 API | S | `@amiba/background-service` | 资源清理已有经验 |
| `src/host/floating-widget-manager.ts` | 悬浮块注册/生命周期 | S | `@amiba/widgets` | |
| `src/host/widget-lifecycle.ts` | persistent widget 恢复 | S | `@amiba/widgets` | |
| `src/host/floating-widget-container.vue` | 悬浮块 UI 容器 | UI | `@amiba/widgets` | |
| `src/host/desktop-widget-runner.ts` | Android 桌面卡片逻辑 runner | F/N | `@amiba/desktop-widgets` | |
| `src/host/webview-overlay-state.ts` | WebView 截图状态 | F/N | `@amiba/web-browser` | |

## 6. 页面与组件（UI 全插件化对象）

| 文件 | 当前职责 | 分类 | 目标插件 | 备注 |
| --- | --- | --- | --- | --- |
| `src/pages/ChatPage.vue` | AI 聊天页 | UI | `@amiba/ui-chat` | 页面级黑盒插件 |
| `src/pages/ServiceBrowsePage.vue` | 已装服务列表 | UI | `@amiba/ui-services` | |
| `src/pages/RemoteServicesPage.vue` | 远程仓库 | UI | `@amiba/ui-registry` | |
| `src/pages/QuickPage.vue` | 快捷页 | UI | `@amiba/ui-quick` | |
| `src/pages/SettingsPage.vue` | 设置页 | UI | `@amiba/ui-settings` | 设置页签应 Slot 化 |
| `src/pages/MemoryPage.vue` | 记忆管理 | UI | `@amiba/ui-memory` | |
| `src/pages/ShareDialog.vue` | 服务分享弹窗 | UI | `@amiba/share` | |
| `src/pages/SkillShareDialog.vue` | 技能分享弹窗 | UI | `@amiba/share` | |
| `src/pages/demo-html.ts` / `demo-package.ts` | 演示数据 | F | `@amiba/demo` 或删除 | 确认是否仍被引用 |
| `src/pages/MyServicesPage.vue.bak` | 备份 | 清理 | 删除 | 不进入插件 |
| `src/components/GlassBackground.vue` | 全局玻璃背景 | UI | `@amiba/ui-shell` | |
| `src/components/EdgeNavHint.vue` | 边缘翻页提示 | UI | `@amiba/ui-shell` | 依赖 PAGE_ORDER |
| `src/components/QuickFab.vue` | 快捷页入口 | UI | `@amiba/ui-shell` | |
| `src/components/ApiSetupOverlay.vue` | API 设置门 | UI | `@amiba/model-providers` UI | |
| `src/components/SelectDropdown.vue` | 通用下拉 | UI | `@amiba/ui-primitives` | |
| `src/components/ServiceAiSettingsDialog.vue` | 服务内 AI 设置 | UI | `@amiba/service-ai` UI | |
| `src/components/SlotRenderer.vue` | HTML 字符串 slot 渲染 | UI/S | `@amiba/service-slots` | 仅服务 HTML slot 保留 |
| `src/components/WebviewOverlay.vue` | WebView 预览浮层 | UI | `@amiba/web-browser` | |
| `src/components/HelloWorld.vue` | 脚手架残留 | 清理 | 删除 | |

## 7. i18n / 类型 / 资源

| 文件/目录 | 当前职责 | 分类 | 目标插件/内核位置 | 备注 |
| --- | --- | --- | --- | --- |
| `src/i18n/index.ts` | vue-i18n 单例 | S | `@amiba/i18n` 内核服务 | 需支持插件注册语言包 |
| `src/i18n/locales/zh-CN.ts` / `en.ts` | 全量文案 | S | `@amiba/i18n` 默认语言包插件 | 后续按域拆包 |
| `src/i18n/types.ts` | LocalesSchema | S | `@amiba/i18n` | |
| `src/types/service.ts` | 全部领域类型 | K/S | 拆为 `@amiba/types` 多包 | 当前单一类型文件是重构障碍 |
| `src/types/skill-package.ts` | Skill 类型 | S | 并入 skill 插件类型 | |
| `src/env.d.ts` | 全局声明 | K | 保留 | |
| `public/catalog/` | 内置组件目录 | 资源 | `@amiba/catalog` 资源包 | |
| `public/services/` | 预置用户服务 | 资源 | `@amiba/prebuilt-services` | 已是内容插件雏形 |
| `public/themes/` | 预置主题 | 资源 | `@amiba/themes` | 已是资源插件雏形 |
| `public/docs/` | 内置文档 | 资源 | `@amiba/docs` 资源包 | |
| `public/libs/` | Vue/Chart 等沙箱库 | 资源 | 保留资源 | |
| `servicehub/` | 远程仓库示例 | 资源 | 仓库数据，不迁移 | |

## 8. 原生能力（Rust / Tauri / 鸿蒙）

| 文件 | 当前职责 | 分类 | 目标形态 | 备注 |
| --- | --- | --- | --- | --- |
| `src-tauri/src/lib.rs` | 插件注册 + 所有 command 集中注册 | N | native capability registry | 命令应改为声明式 capability 清单 |
| `src-tauri/src/db.rs` | SQLite FTS5 会话 | N | capability: `session:db` | |
| `src-tauri/src/web.rs` | 三平台 WebView 浏览器 | N | capability: `web:*` | |
| `src-tauri/src/network_visibility.rs` | UDP 发现 | N | capability: `network:lan` | |
| `src-tauri/src/network_session.rs` | WebSocket 会话 | N | capability: `network:session` | |
| `src-tauri/src/widget.rs` | Android 桌面卡片推送 | N | capability: `desktop-widget:*` | |
| `src-tauri/src/picker.rs` | tombstone/pick 兜底 | N | capability: `fs:diagnostics` | |
| `src-tauri/src/android_util.rs` | JNI 辅助 | N | 保留 | |
| `src-tauri/capabilities/default.json` | Tauri 权限 | N | 与插件 manifest 权限映射 | |
| `harmony/` | 鸿蒙壳 | N | 壳层，不在 P0 插件化范围 | 协议注册表要保持同步 |

## 9. 当前可立即复用为插件契约的“窄腰”总结

| 窄腰 | 现状 | P0 结论 |
| --- | --- | --- |
| ToolRegistry | 注册/注销/门控/调度完整，deferred queue | 保留为内核服务 `toolRegistry` |
| ServiceRegistry | manifest 以目录为准，元数据分离 | 保留为用户服务内容插件注册表 |
| JSBridge module/method 协议 | 模块化 handler + 权限检查 | 作为沙箱内容插件 API，保持稳定 |
| service-tools 命名 | `svc_<serviceId>__<tool>` + 校验 | 保持，与宿主工具插件并存 |
| ServiceContext.destroy | 统一资源清理 | 对应内核 `ctx.effect`，是最佳实践 |
| nativeInvoke/nativeListen | 平台命令注册表 | 升级为 `@amiba/platform` 能力总线 |
