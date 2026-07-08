# 变形虫 (Amiba) — AI-driven instant-app platform

Vue 3 + TypeScript + Vite + Tauri desktop app. Users describe needs in natural language; AI generates mini-apps that run in iframe sandboxes with JSBridge.

## Project

- **Stack:** Vue 3 (Composition API, `<script setup>`), Pinia, Vue Router, Vite 8, TypeScript 6, Tauri 2
- **Entry:** `src/main.ts` → `bootstrap()` inits storage/config/registry/memory/skills/soul, discovers tools, then mounts `App.vue`
- **Tauri:** `src-tauri/` — Rust glue (`lib.rs`) registers `tauri-plugin-log` + `tauri-plugin-fs`; `db.rs` — SQLite FTS5 session DB via `rusqlite`; `web.rs` — WebView 浏览器引擎（桌面 WebView + Android JNI/Kotlin + iOS WKWebView），提供 `web_fetch`/`web_browse` 等命令
- **Android 特定:** Kotlin 辅助类在 `MainActivity.kt`（`JsCallback` + `WebViewHelper`）; JVM 通过 `libloading` 动态查找 `JNI_GetCreatedJavaVMs`; App ClassLoader 用于 native 线程加载 app 类

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
| **AI Core** | `src/ai/` | LLM agent (multi-tool loop), system prompt assembler (system-prompt.ts: stable/volatile split cache + nudge), personality system (soul.ts), session manager v2 (session.ts: multi-session with create/switch/delete), memory store (memory-store.ts: real-time cache + frozen snapshot + threat scanning + context fencing), skill system (skills.ts + skill-parser + skill-commands + skill-usage + skill-curator + skill-consolidation-prompt + skill-packager + skill-zip), requirement store (requirement-store.ts: per-service + global REQUIREMENT.md), service validator (service-validator.ts: storage API check, sandbox API check, permission consistency), document index (doc-index.ts: builtin + user doc search/read), service packager (packager.ts: inline multi-file package into single HTML), catalog |
| **Tools** | `src/tools/` | ToolRegistry (deferred-queue), auto-discovery, 4 toolsets (core/service/docs), 25+ tool impls: memory, catalog_search, skill_view/list, skill_manage_*(5 tools), service_list/view/create, service_file_*(4 tools), service_validate, doc_list/read/search, soul_save, requirement_*(3 tools), session_search, web_fetch, web_browse |
| **Host Runtime** | `src/host/` | iframe sandbox (`service-container.vue`), postMessage JSBridge (`bridge.ts`), service registry (`registry.ts`), LAN network bridge (`network-bridge.ts` + `network-session.ts`), service sharing (`service-share.ts`), skill sharing (`skill-share.ts`), version archive (`service-archive.ts`), floating widget manager, background service manager (`background-manager.ts`), file access grants (`file-access-grants.ts`) |
| **Web Bridge** | `src/config/web-bridge.ts` | 封装 Tauri `web_fetch`/`web_click`/`web_input_text`/`web_get_content`/`web_close` 命令，含超时和日志 |
| **Updater** | `src/config/updater.ts` | 纯前端更新检查：调 GitHub Releases API，semver 比较，Rust reqwest 下载（绕过浏览器 CORS），全平台统一 |
| **Pages** | `src/pages/` | 5 routes: Chat, Home, Memory, ServiceBrowse, Settings; ShareDialog (局域网服务分享弹窗), SkillShareDialog (局域网技能分享弹窗) |
| **Config** | `src/config/` | Reactive settings persisted via Tauri FS plugin (`config.ts`), storage abstraction (`storage.ts`: auto-mkdir + pretty-print JSON), session-db wrapper (`session-db.ts`: Tauri invoke → Rust SQLite FTS5) |
| **i18n** | `src/i18n/` | vue-i18n based internationalization: `locales/zh-CN.ts` + `locales/en.ts`, type-safe via `LocalesSchema`, synced with `settings.language` via `watch()` |
| **Router** | `src/router/` | `createWebHistory` with lazy-loaded page components |
| **Types** | `src/types/` | `ServiceManifest`, `ServicePackage`, `ServiceRequest/Response`, `AppSettings`, `MemoryToolParams`, `SkillPackage`, etc. |

## AI Core modules

| File | Role |
|------|------|
| `agent.ts` | OpenAI-compatible streaming chat loop with multi-tool dispatch, memory checkpoint injection |
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
| `web_fetch` | core | 获取网页可读文本（全平台 WebView，Android 走 Kotlin helper） |
| `web_browse` | core | 浏览器交互：navigate / click / input_text / get_content / close |

## Conventions

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
  - `logs/` — 前端日志文件（JSON Lines，按大小轮转，设置页可查看/过滤/导出）
- **Android 源码:** Kotlin 类在 `src-tauri/gen/android/app/src/main/java/com/amiba/desktop/MainActivity.kt`（`JsCallback` + `WebViewHelper`）；`tauri android init` 会重置 `gen/android`，自定义代码需在重置后重新写入
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
