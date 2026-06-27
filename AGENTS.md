# 变形虫 (Amiba) — AI-driven instant-app platform

Vue 3 + TypeScript + Vite + Tauri desktop app. Users describe needs in natural language; AI generates mini-apps that run in iframe sandboxes with JSBridge.

## Project

- **Stack:** Vue 3 (Composition API, `<script setup>`), Pinia, Vue Router, Vite 8, TypeScript 6, Tauri 2
- **Entry:** `src/main.ts` → `bootstrap()` inits storage/config/registry/memory/skills, then discovers tools (`discoverTools()`), then mounts `App.vue`
- **Tauri:** `src-tauri/` — Rust glue (`lib.rs`) registers `tauri-plugin-log` + `tauri-plugin-fs`; config at `src-tauri/tauri.conf.json`

## Commands

```bash
npm run dev          # Vite dev server → http://localhost:8080
npm run build        # vue-tsc -b && vite build → dist/
npm run preview      # Vite preview of dist/
cargo tauri dev      # Tauri desktop dev (run from src-tauri/)
cargo tauri build    # Tauri production build (run from src-tauri/)
```

## Architecture

| Module | Path | Role |
|--------|------|------|
| **AI Core** | `src/ai/` | LLM agent (OpenAI-compatible streaming with multi-tool loop), service generator, component catalog, MEMORY.md/USER.md persistence, skill system (SKILL.md + slash commands) |
| **Tools** | `src/tools/` | ToolRegistry (deferred-queue register/dispatch), auto-discovery via `import.meta.glob`, 3 toolsets (core/chat/create), 6 tool implementations |
| **Host Runtime** | `src/host/` | iframe sandbox (`service-container.vue`), postMessage JSBridge (`bridge.ts`), service registry (`registry.ts`) |
| **Pages** | `src/pages/` | 7 routes: Chat, Home, Generate, Memory, MyServices, ServiceBrowse, Settings |
| **Config** | `src/config/` | Reactive settings persisted via Tauri FS plugin (`config.ts`), storage abstraction (`storage.ts`) |
| **Router** | `src/router/` | `createWebHistory` with lazy-loaded page components |
| **Types** | `src/types/` | `ServiceManifest`, `ServicePackage`, `ServiceRequest/Response`, `AppSettings`, `MemoryToolParams`, etc. |

## Conventions

- **Language:** Chinese comments with English identifiers. Section banners use `// ====...====` / `<!-- ====...==== -->`.
- **Vue:** `<script setup lang="ts">` everywhere; scoped styles below template+script; CSS custom properties for colors/spacing in `:root`.
- **Naming:** PascalCase for `.vue` components; kebab-case for directories; camelCase for functions/variables.
- **Async init:** Entry modules export `initXxx()` called from `bootstrap()` in `main.ts`; each guards with an `initialized` flag.
- **State:** Reactive config via `reactive()` + `watch()` with debounced persistence; Pinia stores for page-level state.
- **AI:** OpenAI client with **multi-tool calling** (ToolRegistry + toolsets). Tools auto-discovered from `*.tool.ts` files. Memory files use `§` delimiter for entries with character quotas. Skills use SKILL.md (YAML frontmatter) with `/skill-name` slash commands.
- **JSBridge:** iframe `postMessage` protocol — `ServiceRequest` (type: api, module, method, params, requestId) → `ServiceResponse` (type: api-response, requestId, result/error). Permission-checked by module name.

## Notes

- Storage layout: `{AppData}/amiba/` → flat K/V files (memory, config), `services/{id}/` dirs, `skills/{slug}/SKILL.md` dirs. See `migrate.md` §八 for full spec.
- Tools are code-defined (no persistence): add `src/tools/xxx.tool.ts` + `registry.register(...)` at module top-level → auto-discovered.
- Skills are directory-defined: add `skills/{slug}/SKILL.md` with YAML frontmatter → scanned by `scanSkills()`.
- Phase 1 + Phase 2 of migrate.md are implemented. Phase 3 (check_fn gate, HARDLINE validate, shell inline, curator) is pending.
