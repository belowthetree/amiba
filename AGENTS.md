# 变形虫 (Amiba) — AI-driven instant-app platform

Vue 3 + TypeScript + Vite + Tauri desktop app. Users describe needs in natural language; AI generates mini-apps that run in iframe sandboxes with JSBridge.

## Project

- **Stack:** Vue 3 (Composition API, `<script setup>`), Pinia, Vue Router, Vite 8, TypeScript 6, Tauri 2
- **Entry:** `src/main.ts` → `config/polyfill.ts`（旧 Android WebView 兼容：Array/String `.at()`，须最先加载）→ `bootstrap()` inits storage/config/registry/memory/skills/soul, discovers tools, then mounts `App.vue`
- **Tauri:** `src-tauri/` — Rust glue (`lib.rs`) registers `tauri-plugin-log` + `tauri-plugin-fs`; `db.rs` — SQLite FTS5 session DB via `rusqlite`; `web.rs` — WebView 浏览器引擎（桌面 WebView + Android JNI/Kotlin + iOS WKWebView），提供 `web_fetch`（返回 `text` 可读文本 + `raw` 原始 HTML）/`web_browse` 等命令
- **Android 特定:** Kotlin 辅助类在 `MainActivity.kt`（`JsCallback` + `WebViewHelper` + `FolderPickerHelper`（已废弃））; edge-to-edge 下通过 `setupWindowInsets()` 把 systemBars/IME inset 作为内容区 padding（软键盘弹出时界面上移，adjustResize 在 targetSdk 35+ 无效）; 文件夹选取通过 `tauri-plugin-android-fs` SAF Picker; JVM 通过 `libloading` 动态查找 `JNI_GetCreatedJavaVMs`; App ClassLoader 用于 native 线程加载 app 类; `AndroidJvm` state 仍被 `read_tombstone` 使用

## Commands

```bash
npm run dev          # Vite dev server → http://localhost:8080
npm run build        # vue-tsc -b && vite build → dist/
npm run preview      # Vite preview of dist/
cargo tauri dev      # Tauri desktop dev (run from src-tauri/)
cargo tauri build    # Tauri production build (run from src-tauri/)
npx tauri android dev   # Tauri Android dev build (emulator/device)
```

## Architecture

| Module | Path | Role |
|--------|------|------|
| **AI Core** | `src/ai/` | LLM agent (multi-tool loop), system prompt assembler (system-prompt.ts: stable/volatile split cache + nudge), personality system (soul.ts), session manager v2 (session.ts: multi-session with create/switch/delete), memory store (memory-store.ts: real-time cache + frozen snapshot + threat scanning + context fencing), skill system (skills.ts + skill-parser + skill-commands + skill-usage + skill-curator + skill-consolidation-prompt + skill-reviewer + skill-packager + skill-zip), requirement store (requirement-store.ts: per-service + global REQUIREMENT.md), service validator (service-validator.ts: storage API check, sandbox API check, permission consistency), document index (doc-index.ts: builtin + user doc search/read), service packager (packager.ts: inline multi-file package into single HTML), catalog |
| **Tools** | `src/tools/` | ToolRegistry (deferred-queue), auto-discovery, 5 toolsets (core/service/docs/ui), 30+ tool impls: memory, catalog_search, skill_view/list, skill_manage_*(5 tools), service_list/view/create, service_file_*(4 tools), service_validate, service_archive, service_rollback, doc_list/read/search, soul_save, requirement_*(3 tools), session_search, web_fetch, web_browse, ui_theme_*(6 tools), ui_slot_*(4 tools) |
| **Host Runtime** | `src/host/` | iframe sandbox (`service-container.vue`), postMessage JSBridge (`bridge.ts`), service registry (`registry.ts`), service-provided tools narrow waist (`service-tools.ts`: 服务经 tools 模块注册工具 → 校验/命名 svc_* → 同步进 ToolRegistry 动态工具集 svc → AI 调用经 tool-call/tool-result 路由回 iframe), LAN network bridge (`network-bridge.ts` + `network-session.ts`), LAN room manager (`room-manager.ts`: 房主-成员星型房间，createRoom/joinRoom/广播/成员管理，房间服务键 `room:<serviceId>` 路由入站会话), service sharing (`service-share.ts`), skill sharing (`skill-share.ts`), version archive (`service-archive.ts`), floating widget manager, background service manager + widget global API handler (`background-manager.ts`), file access grants (`file-access-grants.ts`), 安卓桌面卡片逻辑运行器 (`desktop-widget-runner.ts`: 隐藏 iframe 执行服务 logic.js → publish 数据 → 推送原生；沙箱内注 `renderHtml` 辅助，HTML/SVG 离屏渲染成 PNG 经 `imageData` 回传落盘 `cache/img/`) |
| **Web Bridge** | `src/config/web-bridge.ts` | 封装 Tauri `web_fetch`/`web_click`/`web_input_text`/`web_get_content`/`web_close` 命令，含超时和日志。`FetchResult` 含 `text`（提取文本）、`raw`（原始 HTML）、`title`、`content_type` |
| **Updater** | `src/config/updater.ts` | 纯前端更新检查：调 GitHub Releases API，semver 比较，Rust reqwest 下载（绕过浏览器 CORS），全平台统一 |
| **Pages** | `src/pages/` | 7 routes: Chat（`/`）、ServiceBrowse（`/services`）、Quick（`/quick`）、RemoteServices 仓库（`/registry`）、Settings、Memory + service 容器页（`/service/:id`）; ShareDialog (局域网服务分享弹窗), SkillShareDialog (局域网技能分享弹窗) |
| **Config** | `src/config/` | Reactive settings persisted via Tauri FS plugin (`config.ts`), storage abstraction (`storage.ts`: auto-mkdir + pretty-print JSON), theme store (`theme-store.ts`: multi-theme management + prebuilt theme install), session-db wrapper (`session-db.ts`: Tauri invoke → Rust SQLite FTS5), folder-picker (`folder-picker.ts`: 统一文件夹选取 → Android tauri-plugin-android-fs SAF Picker / 桌面 plugin-dialog / 浏览器 prompt), 安卓桌面卡片存储 (`desktop-widget-store.ts`: 扫描服务 `desktop-widgets/` 卡片定义 → registry.json 启用状态 → cache 载荷 → 仅 Android 推送原生) |
| **Theme** | `src/config/theme-store.ts` + `public/themes/` | 多主题系统：3 套内置主题（default/dark/ocean）从 public/themes/ 安装到 AppData；用户可创建/删除/切换主题；CSS 变量体系（30 个 :root 变量）驱动全局外观；所有页面已迁移到 var() 体系；内置主题只读，修改时自动创建用户主题副本 |
| **i18n** | `src/i18n/` | vue-i18n based internationalization: `locales/zh-CN.ts` + `locales/en.ts`, type-safe via `LocalesSchema`, synced with `settings.language` via `watch()` |
| **Router** | `src/router/` | `createWebHistory` with lazy-loaded page components；导出 `PAGE_ORDER` 主导航页面序列（从左到右：仓库/服务/聊天/快捷/设置/记忆）；`router.onError` 检测 chunk 加载失败自动刷新自愈 |
| **Types** | `src/types/` | `ServiceManifest`, `ServicePackage`, `ServiceRequest/Response`, `AppSettings`, `MemoryToolParams`, `SkillPackage`, etc. |

## AI Core modules

| File | Role |
|------|------|
| `agent.ts` | OpenAI-compatible streaming chat loop with multi-tool dispatch, memory checkpoint injection |
| `agent-runner.ts` | **Global singleton**: owns Agent lifecycle — `sendMessage`/`stopGeneration`/`continueGeneration`; survives page navigation; ChatPage observes reactive state (`running`/`streamingReasoning`/`showStepLimit`) |
| `system-prompt.ts` | Two-layer assembler: stable (identity+rules+skills, cached) + volatile (memory snapshot+time+nudge, rebuilt each call) |
| `soul.ts` | Personality system: `souls/<name>.md` files, `soul_save` tool integration, onboarding directive |
| `session.ts` | **v2 multi-session**: `createSession`/`switchToSession`/`deleteSession`/`listSessions`, per-session `sessions/<id>.json` storage, legacy migration, 300ms debounced save |
| `memory-store.ts` | MEMORY.md / USER.md read/write, live cache for system prompt, §-delimited entries, FIFO eviction |
| `skills.ts` | User skill CRUD (Settings UI), import from folder |
| `skill-parser.ts` | YAML frontmatter + Markdown parser, slug generator, validation |
| `skill-commands.ts` | Skill scanning (builtin + Tauri), slash-command detection, skill invocation message builder, cache invalidation |
| `skill-packager.ts` | SkillPackage builder/installer: package skill dir into transferable format, install from package (overwrite) |
| `skill-zip.ts` | ZIP import/export via JSZip (Tauri dialog + browser `<input>` dual-mode), URL import |
| `skill-usage.ts` | `.usage.json` telemetry: use/view/patch counters, agent-created marking, pin/archive/restore state management |
| `skill-curator.ts` | Background lifecycle: deterministic active→stale→archived transitions, archive/restore, LLM consolidation (Phase 4), run reports |
| `skill-consolidation-prompt.ts` | Consolidation agent system prompt: prefix clustering, 3 merge strategies, YAML decision output |
| `skill-reviewer.ts` | Skill review engine: forks independent LLM calls at 4 trigger points (session_end/manual/mid_session/curator) to auto-maintain skill library; exposes `isReviewing`/`lastReviewResult` refs for UI feedback |
| `requirement-store.ts` | Per-service `REQUIREMENT.md` + global `REQUIREMENTS.md` engine: parse/build, add/done/feedback, auto-sync |
| `commands.ts` | Built-in slash commands (`/new` → multi-session create) |
| `memory.ts` | Memory tool handler (deprecated, use memory-store) |
| `catalog.ts` | Component catalog YAML parser |
| `packager.ts` | Inline multi-file ServicePackage into single HTML for iframe rendering |
| `service-validator.ts` | Service code validation: storage API, sandbox APIs, permission consistency |
| `doc-index.ts` | Document index/search/read for builtin (`public/docs/`) and user (`{AppData}/docs/`) docs |
| `provider-store.ts` | Multi-provider AI vendor management: reactive list, CRUD, auto-persist to `amiba_providers` |
| `api-check.ts` | API 可用性检测：最小化 chat 请求验证 baseUrl/Key/模型（启动门 + 设置引导共用） |
| `custom-agent-store.ts` | Custom agent management: reactive list + settings.active_agent_id, CRUD, auto-persist to `amiba_custom_agents` |
| `service-ai.ts` | 服务内嵌 AI 对话：工具双层白名单（SERVICE_AI_TOOLS，默认只读）、ServiceAiRunner（每服务≤3会话/10轮上限/30min空闲回收）、绕开 agent-runner 复用 streamChat |

## Tools inventory

| Tool | Toolset | Role |
|------|---------|------|
| `memory` | core | Write to MEMORY.md / USER.md |
| `catalog_search` | core | Search component catalog |
| `skill_view` / `skills_list` | core | Read skill contents / list available skills |
| `skill_manage_create` | core | Create new SKILL.md |
| `skill_manage_patch` | core | Targeted find-replace in SKILL.md (preferred edit) |
| `skill_manage_edit` | core | Full rewrite SKILL.md (major refactor only) |
| `skill_manage_delete` | core | Archive skill to `.archive/` |
| `skill_manage_write_file` | core | Add supporting files to skill dir |
| `service_list` | service | List all installed user services (view category) |
| `service_view` | service | View full service info: manifest, files, status (view category) |
| `service_create` | service | Create new service skeleton: register manifest + dir (manage category) |
| `service_file_list/read/write` | service | File-level editing on generated services (edit category) |
| `service_file_edit` | service | Targeted find-replace in service files (edit category, preferred) |
| `service_validate` | service | Validate service code: localStorage, sandbox APIs, permissions (view category) |
| `service_archive` | service | Save current service state as a versioned snapshot in `.versions/` (manage category) |
| `service_rollback` | service | Roll back a service to a previous archived version (manage category) |
| `session_search` | core | Search past sessions via SQLite FTS5 (4 modes: discover/scroll/read/browse) |
| `doc_list` | docs | List all available documentation (view category) |
| `doc_read` | docs | Read full content of a documentation file (view category) |
| `doc_search` | docs | Search documentation by keyword, returns snippets (view category) |
| `soul_save` | core | Create/update personality file (`souls/<name>.md`) |
| `requirement_view` | core | Read per-service REQUIREMENT.md |
| `requirement_update` | core | Add requirement/optimization/feedback/done entries |
| `requirements_summary` | core | Read global REQUIREMENTS.md |
| `web_fetch` | core | 获取网页内容。返回 `text`（可读纯文本）和 `raw`（原始 HTML，仅 Rust HTTP 路径）。全平台 WebView，Android 走 Kotlin helper |
| `web_browse` | core | 浏览器交互：navigate / click / input_text / get_content / close |
| `ui_theme_view` | ui | 查看当前主题状态（CSS 变量、自定义 CSS、可用主题列表） |
| `ui_theme_list` | ui | 列出所有主题（内置/用户，标记激活状态） |
| `ui_theme_set_variable` | ui | 设置单个 CSS 变量（内置主题自动另存） |
| `ui_theme_set_variables` | ui | 批量设置 CSS 变量 |
| `ui_theme_set_css` | ui | 注入全局自定义 CSS（内置主题自动另存） |
| `ui_theme_reset` | ui | 重置当前用户主题为默认 |
| `ui_theme_create` | ui | 从当前主题创建新用户主题 |
| `ui_theme_delete` | ui | 删除用户自建主题（内置/当前激活不可删） |
| `ui_theme_switch` | ui | 切换到指定主题（立即生效） |
| `ui_slot_list` | ui | 列出所有可用插槽（含位置描述和使用建议） |
| `ui_slot_get` | ui | 读取插槽 HTML 内容 |
| `ui_slot_set` | ui | 设置插槽 HTML 内容（可含 `<style>`/`<script>`） |
| `ui_slot_remove` | ui | 清除指定插槽内容 |
| `android_widget_list` | ui | 列出全部安卓系统桌面卡片（服务 `desktop-widgets/` 目录 + 全局卡片，含启用状态） |
| `android_widget_enable` | ui | 启用/停用桌面卡片（改 registry.json 并推送原生） |
| `android_widget_refresh` | ui | 立即重跑卡片 logic.js 并推送原生刷新显示 |
| `android_widget_create` | ui | 创建全局桌面卡片（不依附服务，写入 `desktop-widgets/cards/{cardId}/`，可选 size 尺寸档位 small/medium/large） |
| `android_widget_delete` | ui | 删除桌面卡片（文件 + 启用状态 + 缓存 + 推送原生） |

## Theme System

- **Theme directory:** `{AppData}/amiba/theme/{name}/` — 每个主题一个目录，包含 `variables.json` + `custom.css`
- **Built-in themes:** `default`（玉石玻璃风：玉青主色 + 半透明白表面）、`dark`（黑色玉石：墨玉底色 + 玉青主色 + 深色玻璃表面）、`ocean`（蓝色系）— 从 `public/themes/` 安装，不可修改
- **User themes:** 从内置主题另存创建，可自由修改删除
- **Active theme:** 存储在 `settings.active_theme`，切换时立即重新加载并注入到 document.head；主题名同步到 `<html data-theme>`
- **Slot directory:** `{AppData}/amiba/theme/slots/` — 插槽 HTML（不随主题切换）；可用插槽：`chat.above-messages` / `chat.below-input` / `settings.extra` / `services.above-list`
- **CSS variables:** 30 个变量定义在 `:root` 中，所有页面样式通过 `var(--*)` 引用
- **Doc:** `public/docs/ui-customization.md` — CSS 选择器速查表 + 变量参考 + 插槽列表
- **Prebuilt themes:** `public/themes/{name}/variables.json` + `custom.css` → `installPrebuiltThemes()` 每次启动覆盖刷新到 AppData（内置主题只读，刷新安全），激活的内置主题会立即重载
- **Migration:** 无旧格式迁移需求（全新功能）

## UI Structure

- **无顶栏设计：** 页面切换靠左右滑动手势（App.vue iPhone 风格跟手手势，`transitionend` 驱动路由切换避免回弹）+ 两侧 `EdgeNavHint` 玻璃竖条（点击也可切换，tooltip 显示目标页名）；页面序列 `PAGE_ORDER` 定义在 `src/router/index.ts`，从左到右：服务仓库 / 服务列表 / 聊天 / 快捷 / 设置 / 记忆。快捷页内容运行在 iframe 沙箱中，触摸事件不冒泡到宿主文档，由 `QuickPage.vue` 垫片脚本把触摸坐标 postMessage 转发给 App.vue 驱动同一套手势（`amiba-quick-touch` 消息）
- **页面过渡:** 手势切换用空过渡（JS 已驱动位移）；箭头/编程导航用同步横滑（新页滑入 + 旧页滑出，过渡期间两页 absolute 叠放，`left/right: 0` 保持 max-width 页面居中）；复位由 `@after-enter` 触发避免旧页闪回
- **全局背景:** `src/components/GlassBackground.vue` — 玉色辉光 + 流光动画，fixed 铺满全局，随 `data-theme` 自适应，`prefers-reduced-motion` 时关闭动画
- **服务页返回:** `service-container.vue` 左上角浮动玻璃返回按钮（无顶栏后的唯一返回入口）
- **API 启动门:** `App.vue` onMounted 检查 `settings.api_key`，缺失时直接弹出全屏 `ApiSetupOverlay.vue`；已配置则经 `src/ai/api-check.ts` 发最小化 chat 请求验证连通性，失败同样弹出。遮罩不可关闭，用户填写供应商/BaseURL/Key/模型并「验证并继续」通过后才进入应用
- **聊天页输入区:** 无聊天记录时输入框垂直居中（`.chat-page.empty`），有消息后沉底；输入条左侧 › 开关展开功能面板（新建会话/统计/会话列表），会话列表为输入条上方弹出层；消息列表用 `<TransitionGroup>`，入场动画仅对新增消息触发（切页/历史不重放）
- **服务风格指南:** `public/docs/service-style.md` + `public/libs/jade.css`（可复用基础样式表：设计令牌 + 玻璃辉光背景 + 卡片/按钮/输入框/模态类，服务 `<link href="/libs/jade.css">` 引入）— service-dev skill、系统提示 DOCS/SERVICE 指引均已引用，AI 生成服务必须遵循

- **Language:** Chinese comments with English identifiers. Section banners use `// ====...====` / `<!-- ====...==== -->`.
- **Vue:** `<script setup lang="ts">` everywhere; scoped styles below template+script; CSS custom properties for colors/spacing in `:root`.
- **Naming:** PascalCase for `.vue` components; kebab-case for directories; camelCase for functions/variables.
- **Async init:** Entry modules export `initXxx()` called from `bootstrap()` in `main.ts`; each guards with an `initialized` flag.
- **State:** Reactive config via `reactive()` + `watch()` with debounced persistence; Pinia stores for page-level state.
- **AI:** Multi-tool calling via ToolRegistry + toolsets. System prompt: stable layer (identity+rules+skills, cached) + volatile layer (memory+time+nudge, rebuilt each call). Personality via soul.ts (souls/*.md files, `soul_save` tool). Session: multi-session v2 (create/switch/delete, per-session `sessions/<id>.json`). Memory: real-time cache via memory-store.ts (MEMORY.md/USER.md, §-delimited). Skills: SKILL.md with /skill-name commands; skill evolution via skill-usage telemetry + skill-curator lifecycle + optional LLM consolidation. Requirements: per-service REQUIREMENT.md + global summary, 10-turn nudge triggers both memory and requirement checks. Onboarding: first launch → soul_save tool creates personality. Streaming: abortable via AbortController, stop button in ChatPage; 25-round tool call limit triggers confirm-to-continue dialog.
- **JSBridge:** iframe `postMessage` protocol — `ServiceRequest` (type: api, module, method, params, requestId) → `ServiceResponse` (type: api-response, requestId, result/error). Permission-checked by module name. Available modules/permissions: `storage`, `notification`, `ui`, `widgets`, `network`, `background`, `fileAccess`, `fetch`, `ai`, `tools`, `desktopWidget`（权限名 `desktopWidgets`）。安卓系统桌面卡片：服务在自身目录 `desktop-widgets/{cardId}/` 维护 `widget.json`（界面/行为配置，含 `size` 尺寸档位 small=2x2/medium=4x2 默认/large=4x4，样式字段 accentColor/backgroundColor/textColor/hideTitleBar，publish 可覆盖）+ `logic.js`（数据逻辑）+ `assets/`（图片），logic.js 在隐藏 iframe 中执行经 `desktopWidget.publish` 产出数据（`imageData` 支持 `desktopWidget.renderHtml` 沙箱内 HTML/SVG→PNG 的自定义卡面）→ 合并缓存推送 Android 原生 AppWidget（RemoteViews 渲染；三个尺寸档位注册为三个 Provider 入口「变形虫卡片·小/中/大」，选卡页只列同尺寸卡片，详见 docs/android-widget.md）。 `network` 模块含 P2P session API 与局域网房间 API（`createRoom`/`joinRoom` → room 代理，事件经 `room-event` 推送；`network:session-created` 载荷带 `service` 字段供前端按服务键路由入站会话）。服务 AI 对话经 `ai` 模块 + `ai-event` 推送，每服务工具在 `ServiceEntry.aiConfig` 配置（服务卡片 🤖 设置弹窗，默认只读工具）。服务向 AI 提供工具经 `tools` 模块（`__amiba__.tools.register`，详见 docs/service-tools.md）：host→service 新增 `tool-call`/`tool-result` 消息对，AI 可见名 `svc_<serviceId>__<tool>`，每服务开关与 sensitive 逐项授权在 `ServiceEntry.toolsConfig` 配置（同一 🤖 设置弹窗）；仅服务主页面与后台 worker 可用，仅服务运行时生效。
- **i18n:** `vue-i18n` with Composition API (`useI18n()`). All user-facing strings use `$t('key.path')` in templates or `t('key.path')` in scripts. Locale files in `src/i18n/locales/` with `LocalesSchema` type constraint. Language switching via `settings.language` (reactive, synced to `i18n.global.locale` via `syncI18nWithSettings()` in `main.ts` bootstrap). New translatable strings must be added to both `zh-CN.ts` and `en.ts` simultaneously under matching key paths.
- **流程日志规范**：
  - **每个模块必须输出关键流程日志**——状态变更（启动/停止）、事件收发、连接建立/断开等，便于问题定位。
  - Rust: `eprintln!("[模块前缀] 日志内容")`，前缀规范命名（如 `[net-session]`、`[net-vis]`）。
  - 前端: `console.log('[模块前缀] 日志内容')`，前缀如 `[NetBridge]`、`[JSBridge]`、`[SvcContainer]`、`[NetSession]`。
  - **禁止在循环内打印日志**（如 UDP 广播每 tick、消息轮询），避免刷屏。循环相关统计日志使用计数打印（如每 10 次一次）。
  - 流程边界用 `===` 标记（如 `=== 收到 hello: ... ===`），关键结果用 `✓`/`✗` 前缀。
- **日志文件持久化:** `src/config/logger.ts` 在 bootstrap 早期 monkey-patch `console.*`，将所有日志缓冲批量写入 `{AppData}/amiba/logs/` 目录。JSON Lines 格式，按大小自动轮转。设置页面「日志」Tab 提供查看、级别过滤、搜索、导出功能。

## Notes

- **Vue 预置库:** 服务可加载 `/libs/vue.global.prod.js`（Vue 3 全局构建），实现响应式 UI；支持多文件组件目录结构（`components/*.js`、`styles/*.css`），所有引用文件由 packager 自动内联
- **玉石玻璃风样式库:** 服务通过 `<link href="/libs/jade.css">` 引入 `public/libs/jade.css`（设计令牌 + 玻璃辉光背景 + 组件类），风格规范见 `public/docs/service-style.md`
- **Storage layout:** `{AppData}/amiba/` →
  - `amiba_settings` — 统一配置（api_key, network_lan_visible, active_agent_id, device_id 等已合并至此）
  - `state.db` — SQLite (WAL mode) with sessions/messages tables + messages_fts FTS5 virtual table
  - `services/{id}/` — generated app files + `REQUIREMENT.md` (per-service) + `.versions/` (version snapshots) + `desktop-widgets/{cardId}/` (服务自带的安卓桌面卡片：widget.json + logic.js + assets/)
  - `services/REQUIREMENTS.md` — global requirement summary
  - `sessions/_index` — session metadata index
  - `sessions/{id}.json` — per-session chat history
  - `skills/{slug}/SKILL.md` — skill files
  - `skills/.usage.json` — skill telemetry
  - `skills/.archive/` — archived skills
  - `skills/.curator_state` / `.curator-logs/` — curator lifecycle
  - `souls/{name}.md` — personality files
  - `docs/` — user custom document files (override builtin `public/docs/`)
  - `theme/{name}/` — 主题目录（variables.json + custom.css）；`theme/slots/` — 插槽 HTML
  - `desktop-widgets/registry.json` — 安卓桌面卡片启用状态；`desktop-widgets/cache/` — 卡片渲染载荷缓存（含图片绝对路径）+ `cache/img/` renderHtml 产出的 PNG；`desktop-widgets/cards/{cardId}/` — 全局卡片定义（不依附服务）；`desktop-widgets/data/{cardId}/` — 全局卡片 storage 数据
  - `logs/` — 前端日志文件（JSON Lines，按大小轮转，设置页可查看/过滤/导出）
- **Android 源码:** Kotlin 类在 `src-tauri/gen/android/app/src/main/java/com/amiba/desktop/MainActivity.kt`（`JsCallback` + `WebViewHelper` + `FolderPickerHelper`（已废弃，文件夹选取已迁移至 `tauri-plugin-android-fs`））；`setupWindowInsets()` 处理 edge-to-edge 下的状态栏/导航栏/软键盘遮挡；系统桌面卡片（AppWidget）相关类：`AmibaWidgetProvider.kt`（中尺寸 Provider + `WidgetHelper` JNI 入口，刷新时遍历三个 Provider）+ `AmibaWidgetProviderSmall.kt` / `AmibaWidgetProviderLarge.kt`（小/大尺寸档位纯标记子类）+ `WidgetConfigActivity.kt`（选卡配置页，按入口尺寸过滤）+ `res/layout/widget_card*.xml`、`widget_config.xml` + `res/drawable/widget_bg.xml` + `res/values/styles_widget.xml` + `res/xml/widget_card_info{,_small,_large}.xml`（三档 meta）+ `AndroidManifest.xml`（三个 receiver 各带「变形虫卡片·小/中/大」label + configure activity 注册）+ `app/proguard-rules.pro`（JNI 入口 keep 规则：`WidgetHelper`/`WebViewHelper`/`JsCallback`/`MainActivity`/widget 类只被 Rust 按名反射调用，不加 keep release 混淆会被 R8 裁掉导致 NoSuchMethodError 闪退）；`tauri android init` 会重置 `gen/android`，自定义代码需在重置后重新写入
- **Android 启动图标:** `tauri icon` 生成的自适应图标前景是满幅的，会被启动器圆形/圆角遮罩放大裁切；`src-tauri/scripts/gen_android_icons.py`（需 Python + PIL）把 `icons/icon.png` 缩到画布 60% 安全区居中，重新生成各密度 `ic_launcher_foreground.png`；`tauri android init` 重置后需重跑该脚本
- **Storage auto-mkdir:** `storageSet` creates parent directories automatically before writing
- **JSON pretty-print:** all `storageSetJSON` writes use 2-space indentation
- **Real-time save:** chat history saves on every message with 300ms debounce; `/new` flushes before switching
- **Memory nudge:** at turn 10/20/30... system prompt injects mandatory memory + requirement check directive
- **Tools:** add `src/tools/xxx.tool.ts` + `registry.register(...)` → auto-discovered via `import.meta.glob`. Each tool has a `category` field (`generate`/`view`/`edit`/`manage`) for type-based tool guidance.
- **Skills:** add `skills/{slug}/SKILL.md` → scanned by `scanSkills()`; agent can create via `skill_manage_create`
- **Skill distribution:** 三种导入方式 — (1) 📁 文件夹导入（Tauri 原生目录选择器），(2) 📦 ZIP 导入（JSZip，含 Tauri dialog / 浏览器 `<input>` 双模式），(3) 🔗 URL 导入（fetch 下载 ZIP 后内存解析）；导出为 ZIP 文件；局域网分享通过 `skill-share.ts`（复用 service-share 网络基础设施，64KB 分块传输）
- **Skill evolution:** usage telemetry (`.usage.json`) + curator (auto stale→archive, optional LLM consolidation)
- **Personality:** edit `souls/{name}.md` via Settings or use `soul_save` tool via AI; `invalidateSystemPrompt()` → next chat applies
- **Commands:** built-in `/new` creates new session (saves old, starts fresh). Add commands via `registerCommand()` in `src/ai/commands.ts`
- **Onboarding:** first launch → `isFirstLaunch()` → injects 3-step directive → AI uses `soul_save` tool to persist personality
- **Session management:** multi-session with dropdown selector in ChatPage; sessions persist independently; legacy `amiba_chat_history` auto-migrated
- **Documentation:** `AGENTS.md` is the concise index; `docs/*.md` holds detailed design docs. When project structure or features change, **both** must be updated in sync. New major features must have corresponding `docs/<feature>.md`.
- **Theme customization:** add `public/themes/{name}/` directory with `variables.json` + `custom.css`, then add name to `BUILTIN_THEMES` in `theme-store.ts`. AI can manage themes via `ui_theme_*` tools. Slots added via `ui_slot_*` tools stored in `theme/slots/`.
