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
| **Host Runtime** | `src/host/` | iframe sandbox (`service-container.vue`), postMessage JSBridge (`bridge.ts`), service registry (`registry.ts`), LAN network bridge (`network-bridge.ts` + `network-session.ts`), service sharing (`service-share.ts`), skill sharing (`skill-share.ts`), version archive (`service-archive.ts`), floating widget manager, background service manager + widget global API handler (`background-manager.ts`), file access grants (`file-access-grants.ts`) |
| **Web Bridge** | `src/config/web-bridge.ts` | 封装 Tauri `web_fetch`/`web_click`/`web_input_text`/`web_get_content`/`web_close` 命令，含超时和日志。`FetchResult` 含 `text`（提取文本）、`raw`（原始 HTML）、`title`、`content_type` |
| **Updater** | `src/config/updater.ts` | 纯前端更新检查：调 GitHub Releases API，semver 比较，Rust reqwest 下载（绕过浏览器 CORS），全平台统一 |
| **Pages** | `src/pages/` | 7 routes: Chat（`/`）、ServiceBrowse（`/services`）、Quick（`/quick`）、RemoteServices 仓库（`/registry`）、Settings、Memory + service 容器页（`/service/:id`）; ShareDialog (局域网服务分享弹窗), SkillShareDialog (局域网技能分享弹窗) |
| **Config** | `src/config/` | Reactive settings persisted via Tauri FS plugin (`config.ts`), storage abstraction (`storage.ts`: auto-mkdir + pretty-print JSON), theme store (`theme-store.ts`: multi-theme management + prebuilt theme install), session-db wrapper (`session-db.ts`: Tauri invoke → Rust SQLite FTS5), folder-picker (`folder-picker.ts`: 统一文件夹选取 → Android tauri-plugin-android-fs SAF Picker / 桌面 plugin-dialog / 浏览器 prompt) |
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
| `custom-agent-store.ts` | Custom agent management: reactive list + settings.active_agent_id, CRUD, auto-persist to `amiba_custom_agents` |

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

## Theme System

- **Theme directory:** `{AppData}/amiba/theme/{name}/` — 每个主题一个目录，包含 `variables.json` + `custom.css`
- **Built-in themes:** `default`（玉石玻璃风：玉青主色 + 半透明白表面）、`dark`（深色模式）、`ocean`（蓝色系）— 从 `public/themes/` 安装，不可修改
- **User themes:** 从内置主题另存创建，可自由修改删除
- **Active theme:** 存储在 `settings.active_theme`，切换时立即重新加载并注入到 document.head；主题名同步到 `<html data-theme>`
- **Slot directory:** `{AppData}/amiba/theme/slots/` — 插槽 HTML（不随主题切换）；可用插槽：`chat.above-messages` / `chat.below-input` / `settings.extra` / `services.above-list`
- **CSS variables:** 30 个变量定义在 `:root` 中，所有页面样式通过 `var(--*)` 引用
- **Doc:** `public/docs/ui-customization.md` — CSS 选择器速查表 + 变量参考 + 插槽列表
- **Prebuilt themes:** `public/themes/{name}/variables.json` + `custom.css` → `installPrebuiltThemes()` 在首次启动时复制到 AppData
- **Migration:** 无旧格式迁移需求（全新功能）

## UI Structure

- **无顶栏设计：** 页面切换靠左右滑动手势（App.vue iPhone 风格跟手手势，`transitionend` 驱动路由切换避免回弹）+ 两侧 `EdgeNavHint` 玻璃竖条（点击也可切换，tooltip 显示目标页名）；页面序列 `PAGE_ORDER` 定义在 `src/router/index.ts`，从左到右：服务仓库 / 服务列表 / 聊天 / 快捷 / 设置 / 记忆
- **页面过渡:** 手势切换用空过渡（JS 已驱动位移）；箭头/编程导航用同步横滑（新页滑入 + 旧页滑出，过渡期间两页 absolute 叠放，`left/right: 0` 保持 max-width 页面居中）；复位由 `@after-enter` 触发避免旧页闪回
- **全局背景:** `src/components/GlassBackground.vue` — 玉色辉光 + 流光动画，fixed 铺满全局，随 `data-theme` 自适应，`prefers-reduced-motion` 时关闭动画
- **服务页返回:** `service-container.vue` 左上角浮动玻璃返回按钮（无顶栏后的唯一返回入口）
- **聊天页输入区:** 无聊天记录时输入框垂直居中（`.chat-page.empty`），有消息后沉底；输入条左侧 › 开关展开功能面板（新建会话/统计/会话列表），会话列表为输入条上方弹出层；消息列表用 `<TransitionGroup>`，入场动画仅对新增消息触发（切页/历史不重放）
- **服务风格指南:** `public/docs/service-style.md` + `public/libs/jade.css`（可复用基础样式表：设计令牌 + 玻璃辉光背景 + 卡片/按钮/输入框/模态类，服务 `<link href="/libs/jade.css">` 引入）— service-dev skill、系统提示 DOCS/SERVICE 指引均已引用，AI 生成服务必须遵循

- **Language:** Chinese comments with English identifiers. Section banners use `// ====...====` / `<!-- ====...==== -->`.
- **Vue:** `<script setup lang="ts">` everywhere; scoped styles below template+script; CSS custom properties for colors/spacing in `:root`.
- **Naming:** PascalCase for `.vue` components; kebab-case for directories; camelCase for functions/variables.
- **Async init:** Entry modules export `initXxx()` called from `bootstrap()` in `main.ts`; each guards with an `initialized` flag.
- **State:** Reactive config via `reactive()` + `watch()` with debounced persistence; Pinia stores for page-level state.
- **AI:** Multi-tool calling via ToolRegistry + toolsets. System prompt: stable layer (identity+rules+skills, cached) + volatile layer (memory+time+nudge, rebuilt each call). Personality via soul.ts (souls/*.md files, `soul_save` tool). Session: multi-session v2 (create/switch/delete, per-session `sessions/<id>.json`). Memory: real-time cache via memory-store.ts (MEMORY.md/USER.md, §-delimited). Skills: SKILL.md with /skill-name commands; skill evolution via skill-usage telemetry + skill-curator lifecycle + optional LLM consolidation. Requirements: per-service REQUIREMENT.md + global summary, 10-turn nudge triggers both memory and requirement checks. Onboarding: first launch → soul_save tool creates personality. Streaming: abortable via AbortController, stop button in ChatPage; 25-round tool call limit triggers confirm-to-continue dialog.
- **JSBridge:** iframe `postMessage` protocol — `ServiceRequest` (type: api, module, method, params, requestId) → `ServiceResponse` (type: api-response, requestId, result/error). Permission-checked by module name. Available modules/permissions: `storage`, `notification`, `ui`, `widgets`, `network`, `background`, `fileAccess`.
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
  - `services/{id}/` — generated app files + `REQUIREMENT.md` (per-service) + `.versions/` (version snapshots)
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
  - `logs/` — 前端日志文件（JSON Lines，按大小轮转，设置页可查看/过滤/导出）
- **Android 源码:** Kotlin 类在 `src-tauri/gen/android/app/src/main/java/com/amiba/desktop/MainActivity.kt`（`JsCallback` + `WebViewHelper` + `FolderPickerHelper`（已废弃，文件夹选取已迁移至 `tauri-plugin-android-fs`））；`setupWindowInsets()` 处理 edge-to-edge 下的状态栏/导航栏/软键盘遮挡；`tauri android init` 会重置 `gen/android`，自定义代码需在重置后重新写入
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
