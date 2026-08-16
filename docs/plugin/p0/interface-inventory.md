# P0 接口盘点（Interface Inventory）

> 只记录“会被其他模块/页面/工具引用的公开面”。私有函数不进入插件契约。符号以当前源码为准（v0.10.4）。

## 1. 配置与设置

`src/config/config.ts`

| 导出 | 签名 | 当前消费者 | 插件化方向 |
| --- | --- | --- | --- |
| `settings` | `Reactive<AppSettings>` | 几乎所有模块/页面 | 禁止继续扩散；改为 `settings.get(ns)` + 订阅 |
| `initConfig()` | `() => Promise<void>` | `main.ts` | 装配阶段调用 |
| `getSettings()` | `() => AppSettings` | 部分页面 | 保留兼容，标记 deprecated |
| `updateSettings(patch)` | `void` | 页面/工具 | 改为命名空间写入 |
| `getApiKey()` / `setApiKey()` | deprecated | 兼容层 | 删除，走 providers/credentials |

`AppSettings` 当前是一个**全局单文件配置**，字段包括 AI 配置、主题、语言、设备、网络、日志、更新、远程仓库等 20+ 项。插件化后必须支持命名空间注册，不能每加一个插件就往全局对象加字段。

## 2. 存储层

`src/config/storage.ts`

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `initStorage()` | `Promise<void>` | 建 AppData/amiba 及 services/skills/theme 目录 |
| `storageGet/storageSet/storageRemove/storageKeys/storageClear` | 全局 JSON/文本 key-value | 低层原语，保留为内核服务 |
| `storageGetJSON/storageSetJSON` | JSON 便捷封装 | 保留 |
| `writeServiceFile/readServiceFile/removeServiceFile/listServiceFiles/removeServiceDir/listServiceDirs` | 服务目录文件操作 | 迁 `@amiba/service-storage` |
| `serviceDataGet/serviceDataSet/serviceDataRemove/serviceDataKeys` | 服务沙箱 data/ | 迁 `@amiba/service-storage` |
| `readSkillFile/writeSkillFile/removeSkillFile/listSkillFiles/readSkillJson/copySkillFolder` | Skill 文件 | 迁 `@amiba/skills` |
| `safePath()` | 内部防穿越 | 保留为安全原语 |

注意：当前业务模块大量直接调用这些函数，插件化后除 storage 服务外不得直接 import。

## 3. 平台能力桥

`src/config/platform-bridge.ts` / `native-fs.ts` / `types/native-bridge.ts`

| 导出 | 说明 |
| --- | --- |
| `detectHost()` | `tauri / harmony / browser` |
| `nativeInvoke(cmd, args)` | 统一原生命令通道 |
| `nativeListen(event, cb)` / `UnlistenFn` | 统一原生事件通道 |
| `readTextFile/writeTextFile/readDir/mkdir/exists/remove` 等 FS shim | 统一文件操作 |
| `isHarmonyRuntime` | 平台判断 |
| 命令协议注册表（`types/native-bridge.ts`） | 鸿蒙 ArkTS Dispatcher 按此实现 |

这是现有最接近“能力权限总线”的接口，P1 应原样升级为 `@amiba/platform`。

## 4. 用户服务注册表

`src/host/registry.ts`

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `BUILTIN_SERVICES` | `ServiceEntry[]` | 5 个硬编码 system 服务 |
| `initRegistry()` | `Promise<void>` | 扫描 `services/{id}/manifest.json` 重建内存表 |
| `getAllServices()` / `getUserServices()` / `getService(id)` | 查询 |
| `registerService(manifest, source)` | `Promise<ServiceEntry>` | 注册并落盘 manifest |
| `unregisterService(id)` / `toggleService(id, enabled)` | 管理 |
| `refreshServiceManifest(id)` | manifest 文件热刷新 |
| `storeServicePackage(id, pkg)` / `getServicePackage(id)` | 服务包读写 |
| `setServiceData/getServiceData/removeServiceData` | 服务沙箱数据 |
| `onServiceDataChanged(cb)` | 数据变更订阅 |
| `updateServiceAiConfig/updateServiceToolsConfig` | AI/工具配置 |
| `grantServicePermission(id, permission)` | 权限写回 manifest |
| `setServiceWidgetConfig/setServiceWidgetsVisible` | widget 元数据 |
| `destroyServiceRuntime(id)` | 统一资源销毁 |
| `cacheBackgroundConfig(id, files?)` | background.json 缓存 |

该接口已经是“用户内容服务”的事实注册表，P0 决定**保留其形态**，不把它拆散。

## 5. 工具窄腰

`src/tools/tool-registry.ts`

| 导出/成员 | 签名 | 说明 |
| --- | --- | --- |
| `ToolEntry` | `{ name, toolset, category?, schema, handler, checkFn?, description, emoji?, maxResultSizeChars? }` | 工具契约 |
| `toolRegistry` | 全局单例 | 改为内核服务注入 |
| `register(entry, override?)` | 支持 deferred queue | 保留语义 |
| `deregister(name)` | 同步清理队列/正式表 | 保留 |
| `flush()` | 启动阶段批量提交 | 改为插件装配阶段 |
| `getDefinitions(names)` | 门控后返回 schema | 保留 |
| `getAllToolNames()` / `getEntry(name)` / `getToolsetForTool(name)` | 查询 | 保留 |
| `dispatch(name, args, ctx?)` | 统一调度 + 截断 + 错误隔离 | 保留 |
| `generationNumber` / `size` | 诊断 | 保留 |

`src/tools/toolsets.ts`

| 导出 | 说明 |
| --- | --- |
| `TOOLSETS` | 静态工具集定义（core/service/docs/svc/chat/review/ui） |
| `resolveToolset(name)` | 递归 includes + dynamic |
| `getToolDefinitions(enabledToolsets)` | schema 列表 |
| `toAISdkTools(enabledToolsets, allowedTools?)` | AI SDK 桥 |

`src/tools/discover.ts`

| 导出 | 说明 |
| --- | --- |
| `discoverTools()` | `import.meta.glob('./*.tool.ts')` 触发副作用 + flush |

P0 结论：工具文件的顶层 `toolRegistry.register()` 副作用必须改为 `defineTool()` 导出或插件 `apply()` 注册；`import.meta.glob` 只作为官方内置工具发现方式。

## 6. AI / 会话 / Prompt

`src/ai/agent-runner.ts`

| 导出 | 说明 |
| --- | --- |
| `running / streamingReasoning / showStepLimit / stepLimitCount` | 响应式状态（ChatPage 观察） |
| `sendMessage(text)` / `stopGeneration()` / `continueGeneration()` | 生命周期 |

`src/ai/agent.ts`

| 导出 | 说明 |
| --- | --- |
| `streamChat(chatMsgs, options)` | 流式多工具循环 |
| `buildMessages(history)` | 历史组装 |
| `ChatMessage` 等类型 | 消息类型 |

`src/ai/session.ts`

| 导出 | 说明 |
| --- | --- |
| `getSession()` / `getCurrentSessionId()` | 当前会话状态 |
| `createSession(title?)` / `switchToSession(id)` / `deleteSession(id)` / `listSessions()` | 生命周期 |
| `addUserMessage/addAssistantMessage/addToolMessage/saveHistory` | 消息写入 |
| `Message / SessionMeta / SessionState` 类型 | |

`src/ai/system-prompt.ts`

| 导出 | 说明 |
| --- | --- |
| `buildSystemPrompt(options)` | stable/volatile 组装 |
| `invalidateSystemPrompt()` | 缓存失效 |
| `consumeMemoryCheckpointPrompt()` / `setMemoryCheckpointFromCache()` | 记忆检查点 |

`src/ai/provider-store.ts` / `provider-factory.ts` / `api-check.ts`

| 导出 | 说明 |
| --- | --- |
| `providers` reactive + CRUD | 供应商数据 |
| `getProvider(id)` / `getActiveProviders()` | 查询 |
| `createModel(provider, ...)`（provider-factory） | chat/responses 客户端 |
| `testApiConnection(...)` | API 检查 |

`src/ai/memory-store.ts`

| 导出 | 说明 |
| --- | --- |
| `memoryStore` 单例 | `init()`、读写 MEMORY/USER、`formatForSystemPrompt()`、threat scan、context fencing |

`src/ai/soul.ts`

| 导出 | 说明 |
| --- | --- |
| `soulManager` 单例 | `init()`、`getCurrentContent()`、`isUsingDefaultFallback()`、`getOnboardingDirective()` |

`src/ai/commands.ts`

| 导出 | 说明 |
| --- | --- |
| `registerCommand()` / `matchCommand()` | 当前仅 `/new` |

## 7. Skill 群

| 模块 | 关键导出 | 说明 |
| --- | --- | --- |
| `skills.ts` | `loadUserSkills()`、`builtinSkills`、用户 skill CRUD | 当前与 storage 强耦合 |
| `skill-parser.ts` | `parseSkill()` 等纯函数 | 最适合先抽成无依赖包 |
| `skill-commands.ts` | `scanSkills()`、`detectSlashCommand()`、`buildSkillInvocationMessage()`、`invalidateSkillCache()` | |
| `skill-packager.ts` | `buildSkillPackage()`、`installSkillPackage()` | |
| `skill-zip.ts` | `exportAndSaveZip()`、`pickAndImportZip()`、`importSkillFromUrl()` | |
| `skill-usage.ts` | usage/pin/archive 状态 | |
| `skill-curator.ts` | `maybeRunCurator(config)` | 后台生命周期 |
| `skill-reviewer.ts` | review engine + `isReviewing/lastReviewResult` | |
| `experience-store.ts` | `recordExperience()` 等 | |

## 8. 用户服务运行时接口

`src/host/bridge.ts`

| 模块 | 主要 method（服务侧 `__amiba__.*`） | 权限 |
| --- | --- | --- |
| `storage` | `get/set/remove/keys` | `storage` |
| `notification` | `showToast` | `notification` |
| `ui` | `navigateTo` 等页面导航 | 基础 |
| `widgets` | `register/show/hide/remove` | `widgets` |
| `network` | 发现、session、room | `network` |
| `background` | `start/stop/getState/on/postMessage/onMessage` | `background` |
| `fileAccess` | `request/list/read` | `fileAccess` |
| `fetch` | `fetch/get/post` | `fetch` |
| `ai` | `createConversation/send/abort/close/on` | `ai` |
| `tools` | `register` | `tools` |
| `desktopWidget` | 桌面卡片 | `desktopWidgets` |
| 事件 | `page-show/page-hide/task-trigger/peer-*/session-*/room-event/ai-event` | 按权限 |

`ServiceRequest/ServiceResponse/ToolCallMessage/ToolResultMessage` 类型在 `src/types/service.ts`，是沙箱 ABI，P0 后不能破坏。

`src/host/service-tools.ts`

| 导出 | 说明 |
| --- | --- |
| `registerServiceTools(serviceId, decls, call)` | 校验 + 命名 `svc_<sid>__<tool>` + 注册到 ToolRegistry |
| `unregisterServiceTools(serviceId, names?, caller?)` | 按桥实例注销 |
| `getRuntimeServiceTools(serviceId)` / `getKnownServiceTools(serviceId)` | 查询 |
| `isServiceToolsEnabled` / `isServiceToolEnabled` | 门控 |

`src/host/service-context.ts`

| 成员 | 说明 |
| --- | --- |
| `registerBridge(destroy, sendEvent, callServiceTool?)` | 挂载桥资源 |
| `sendEvent(name, data)` | 推送事件 |
| `addSession/removeSession/addNetworkUnsub` | 资源登记 |
| `destroy()` | 逆序统一清理（未来直接映射 `ctx.effect`） |

## 9. 网络 / 分享 / Widget / 后台

| 模块 | 关键导出 | 说明 |
| --- | --- | --- |
| `network-bridge.ts` | `initNetworkBridge()`、`sessions`、可见性门控 | 全局网络中枢 |
| `network-session.ts` | `NetworkSession`（send/on/close） | |
| `room-manager.ts` | `createRoom/joinRoom/broadcast/...` | |
| `service-share.ts` | `sendService/startReceiving/acceptShare/onShareEvent` | 64KB 分块 |
| `skill-share.ts` | `sendSkill/startReceivingSkills/...` | 同协议 |
| `service-archive.ts` | `archiveService/rollbackService/listVersions` | |
| `floating-widget-manager.ts` | `registerServiceWidgets/unregisterServiceWidgets` | |
| `widget-lifecycle.ts` | `initPersistentWidgets()` | |
| `background-manager.ts` | 后台 worker 管理 + 全局 widget API 路由 | |
| `file-access-grants.ts` | 授权 token `_grants` | |
| `desktop-widget-runner.ts` | `startDesktopWidgetRunner()` | |

## 10. 原生 command（Tauri invoke）

来自 `src-tauri/src/lib.rs` 的 `generate_handler!`：

| 域 | 命令 |
| --- | --- |
| 更新 | `download_file`、`cancel_download` |
| 服务 HTTP | `service_http_request` |
| 会话 DB | `search_sessions`、`index_message`、`index_message_batch`、`get_session`、`list_sessions_cmd`、`delete_session_cmd`、`scroll_session`、`read_session_cmd` |
| WebView | `web_fetch`、`web_eval`、`web_click`、`web_input_text`、`web_get_content`、`web_close`、`web_capture_screenshot` |
| LAN 可见性 | `network_set_visibility`、`network_get_visibility`、`network_start_discovery`、`network_stop_discovery`、`network_get_visible_devices`、`network_get_device_id`、`network_get_device_name` |
| LAN 会话 | `network_connect`、`network_send`、`network_disconnect`、`network_get_ws_port`、`network_start_listener`、`network_stop_listener` |
| 诊断/Widget | `read_tombstone`、`android_widget_update`、`android_widget_consume_tap` |

这些命令应映射为 `capabilities` 清单中的原生能力，前端插件不得直接 `invoke`。

## 11. 路由与 UI 注册点

| 注册点 | 现状 | 插件化方向 |
| --- | --- | --- |
| `router/index.ts` routes | 7 条硬编码 | `router.registerPage()` 动态注册 |
| `App.vue PAGE_COMPONENTS` | 预览组件硬编码 5 条 | 页面注册表统一读取 |
| `App.vue routePath()` | name→path 硬编码 | 页面元数据驱动 |
| `PAGE_ORDER` | 硬编码 5 条 | 页面插件声明 `order` 后排序 |
| `keep-alive include="ChatPage"` | 硬编码 | 页面插件声明 `keepAlive` |
| 更新横幅 | App.vue 内置 | `@amiba/updater` UI 扩展点 |
| API Setup 门 | App.vue 内置 | model-provider 插件注册启动门 |
| 主题 slot 目录 | `theme/slots/{name}.html` 4 个 | 保留给沙箱服务；新增类型化 Vue Slot |
| `SlotRenderer.vue` | 单文件 HTML slot 渲染 | 只用于 service slots |

现有 4 个 HTML slot：

| Slot | 位置 |
| --- | --- |
| `chat.above-messages` | 聊天页消息列表上方 |
| `chat.below-input` | 聊天页输入框下方 |
| `settings.extra` | 设置页所有 Tab 内容末尾 |
| `services.above-list` | 服务列表页网格上方 |

## 12. 事件与响应式状态（非正式总线）

| 状态/事件 | 来源 | 消费者 | 问题 |
| --- | --- | --- | --- |
| `themeState` | `theme-store.ts` | App.vue、设置页、ui_theme_* 工具 | 直接 import reactive |
| `providers` | `provider-store.ts` | 设置页、agent、api-check | 直接 import |
| `running` 等 | `agent-runner.ts` | ChatPage | 页面直连单例 |
| `session` refs | `session.ts` | ChatPage、commands | 单例 |
| `onServiceDataChanged` | `registry.ts` | 桌面卡片 runner | 已有订阅模式 |
| `download-progress` | Rust emit | updater | nativeListen |
| `webview-screenshot` | Rust emit | overlay-state | nativeListen |
| `credentials/updated` 类事件 | 无 | 无 | 插件化需新增 |

## 13. 接口盘点结论

1. **工具、用户服务、原生命令三层 ABI 已经存在且较清晰**，是插件化的地基。
2. **最大的接口债是全局单例 + 响应式对象直接 import**：`settings`、`toolRegistry`、`memoryStore`、`soulManager`、`providers`、`agent-runner`、`themeState`。P1 必须先建立内核服务容器，把这些单例注册为服务。
3. **页面、路由、导航顺序没有注册表**，UI 插件化第一步就是建页面注册表。
4. **事件总线是隐式的**：有的用 vue watch，有的用 `onServiceDataChanged`，有的用 `nativeListen`，需要统一。
5. **原生命令有清晰清单**，可直接生成第一版权限目录。
