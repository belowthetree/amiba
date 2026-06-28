# Amiba (变形虫)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri)](https://tauri.app)
[![Build Desktop](https://github.com/belowthetree/amiba/actions/workflows/build-desktop.yml/badge.svg)](https://github.com/belowthetree/amiba/actions/workflows/build-desktop.yml)
[![Build APK](https://github.com/belowthetree/amiba/actions/workflows/build-apk.yml/badge.svg)](https://github.com/belowthetree/amiba/actions/workflows/build-apk.yml)

AI-powered cross-platform instant-app platform. Describe your needs in natural language — AI generates mini-apps that run instantly in iframe sandboxes.

[中文](./README.md)

## Tech Stack

Vue 3 + TypeScript + Vite + Tauri 2 (Windows / macOS / Linux / Android)

## Quick Start

```bash
npm install
npm run dev           # Dev → http://localhost:8080
npm run build         # Production build
cargo tauri dev       # Tauri desktop (dev)
cargo tauri build     # Tauri desktop (package EXE/DMG/deb)
```

## Core Features

### AI Chat
- OpenAI-compatible multi-turn streaming chat (DeepSeek / Qwen / GLM etc.)
- **Memory System**: AI auto-saves user preferences & key info to MEMORY.md / USER.md
- **Personality System**: first-launch onboarding creates AI persona; adjustable via `soul_save` tool
- **Multi-Session**: dropdown to switch historical sessions; each stored independently
- **Requirement Tracking**: AI records service feature requests & optimization notes

### Service Generation
- Natural language → complete HTML/CSS/JS mini-app
- Apps run in iframe sandbox; JSBridge (`window.__amiba__`) provides storage, notifications, navigation
- Chart.js v4 support
- Post-generation editing via AI (`service_file_*` tools)

### Skill Evolution
- Agent **autonomously creates/patches skills**: complex successes or overcome errors → recorded as SKILL.md
- **Usage telemetry**: per-skill use/view/patch counters
- **Curator**: auto-marks unused skills stale → archived; optional LLM consolidation

### Offline-first
- All data stored locally under `{AppData}/amiba/`
- Config, memory, history, services, skills, souls — all local

## Android Build

### Local APK Build

```bash
# 1. Install Android SDK (Android Studio → SDK Manager → SDK 34 + NDK 27)
# 2. Set environment variables
export ANDROID_HOME=~/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.0.xxxx

# 3. Add Rust Android targets
rustup target add aarch64-linux-android armv7-linux-androideabi

# 4. Init Android project (generates src-tauri/gen/android/)
cargo tauri android init

# 5. Build
cargo tauri android build     # release APK
cargo tauri android dev       # debug to connected device
```

Output: `src-tauri/gen/android/app/build/outputs/apk/release/`

### GitHub Actions CI

Push version changes (`tauri.conf.json` / `Cargo.toml` / `package.json`) to trigger APK build. Download from Actions → Artifacts.

## Architecture

```
┌──────────────────────────────────────────────┐
│                   ChatPage                    │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ AI Chat      │  │ iframe Sandbox       │   │
│  │ · sessions   │  │ · JSBridge           │   │
│  │ · streaming  │  │ · __amiba__ API       │   │
│  └──────┬───────┘  └──────────────────────┘   │
│         │                                      │
│  ┌──────▼──────────────────────────────────┐   │
│  │            AI Core (src/ai/)             │   │
│  │  agent.ts         → tool loop + stream   │   │
│  │  system-prompt.ts → stable/volatile cache │   │
│  │  soul.ts          → persona management   │   │
│  │  session.ts       → multi-session v2     │   │
│  │  memory-store.ts  → live memory cache    │   │
│  │  skill-curator.ts → skill lifecycle      │   │
│  │  requirement-store.ts → requirement tracking │
│  └──────┬──────────────────────────────────┘   │
│         │                                      │
│  ┌──────▼──────────────────────────────────┐   │
│  │       ToolRegistry (src/tools/)          │   │
│  │  20+ tools: memory, generate_service,    │   │
│  │  skill_manage_*, requirement_*, ...      │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

## Tool Inventory

| Category | Tools | Description |
|----------|-------|-------------|
| **Memory** | `memory` | Write to MEMORY.md / USER.md |
| **Persona** | `soul_save` | Create/update AI persona file |
| **Generate** | `generate_service` | NL → mini-app |
| **Edit** | `service_file_list/read/write` | Direct file editing on services |
| **Skills** | `skill_view` `skills_list` | View/list skills |
| **Skill Mgmt** | `skill_manage_create/patch/edit/delete/write_file` | AI creates/modifies skills |
| **Requirements** | `requirement_view` `requirement_update` `requirements_summary` | Requirement tracking |

## Memory & Requirement Nudge

Every 10 turns, system injects mandatory checks before AI responds:
1. **Memory check**: user preferences, key decisions → `memory` tool
2. **Requirement check**: feature requests, feedback → `requirement_update` tool

`/new` captures conversation context before clearing; next session starts with a memory checkpoint prompt.

## Project Structure

```
src/
├── ai/               AI core (agent, system-prompt, soul, session, memory, skill, requirement, curator)
├── tools/            20+ AI tools (auto-discovered)
├── host/             Service runtime (sandbox, JSBridge, registry)
├── pages/            7 pages (Chat, Generate, Memory, MyServices, ServiceBrowse, Settings, Home)
├── config/           Config & storage abstraction
├── router/           Routes
└── types/            Type definitions
docs/                 Detailed design docs
skills/               Skill files
```

## Docs

| Doc | Content |
|-----|---------|
| [Architecture](./docs/architecture.md) | System design |
| [Session](./docs/session.md) | Multi-session management |
| [System Prompt](./docs/system-prompt.md) | Two-layer cache |
| [Memory](./docs/memory.md) | Persistent memory |
| [Soul](./docs/soul.md) | Persona management |
| [Skill Evolution](./docs/skill-evolution.md) | 4-phase skill lifecycle |
| [Requirement Tracking](./docs/requirement-tracking.md) | Dual-layer requirements |
| [Tools](./docs/tools.md) | Tool inventory |
| [JSBridge](./docs/jsbridge.md) | Sandbox protocol |
| [Services](./docs/services.md) | Service generation |
| [Development](./docs/development.md) | Dev guide |

## CI/CD

Push version files (`tauri.conf.json` / `Cargo.toml` / `package.json`) to main to auto:
1. Bump patch version (0.1.0 → 0.1.1)
2. Create `v0.1.1` tag
3. Trigger 4-platform build → publish to GitHub Releases

Also supports manual trigger (Actions → workflow_dispatch).

## License

[MIT](./LICENSE) © 2026 belowthetree
