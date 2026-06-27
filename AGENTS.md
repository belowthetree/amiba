# 变形虫 (Amiba) — AI-driven instant-app platform

Vue 3 + TypeScript + Vite + Tauri desktop app. Users describe needs in natural language; AI generates mini-apps that run in iframe sandboxes with JSBridge.

## Project

- **Stack:** Vue 3 (Composition API, `<script setup>`), Pinia, Vue Router, Vite 8, TypeScript 6, Tauri 2
- **Entry:** `src/main.ts` → `bootstrap()` inits storage/config/registry/memory/skills/soul, discovers tools, then mounts `App.vue`
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
| **AI Core** | `src/ai/` | LLM agent (multi-tool loop), system prompt assembler (system-prompt.ts), personality system (soul.ts), session manager (session.ts), memory store (memory-store.ts), skill system, service generator, catalog |
| **Tools** | `src/tools/` | ToolRegistry (deferred-queue), auto-discovery, 3 toolsets (core/chat/create), 6 tool impls + service file tools (service-file.tool.ts) |
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
- **AI:** Multi-tool calling via ToolRegistry + toolsets. System prompt assembled by system-prompt.ts (stable + volatile layers, cached). Personality via soul.ts (souls/*.md files). Session state via session.ts singleton. Memory via memory-store.ts (immediate persistence). Skills via SKILL.md with /skill-name commands. Onboarding flow on first launch guides personality creation.
- **JSBridge:** iframe `postMessage` protocol — `ServiceRequest` (type: api, module, method, params, requestId) → `ServiceResponse` (type: api-response, requestId, result/error). Permission-checked by module name.

## Notes

- **Storage layout:** `{AppData}/amiba/` → flat K/V files, `services/{id}/` dirs, `skills/{slug}/SKILL.md` dirs, `souls/{name}.md` personality files
- **Tools:** add `src/tools/xxx.tool.ts` + `registry.register(...)` → auto-discovered
- **Skills:** add `skills/{slug}/SKILL.md` → scanned by `scanSkills()`
- **Personality:** edit `souls/{name}.md` via Settings page → `invalidateSystemPrompt()` → next chat applies new personality
- **Commands:** built-in `/new` starts new session (clears history + rebuilds system prompt). Add commands via `registerCommand()` in `src/ai/commands.ts`
- **Onboarding:** first launch detects no `default.md` → AI guides user through persona creation step-by-step
