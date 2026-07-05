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
- Apps run in iframe sandbox; JSBridge (`window.__amiba__`) provides host capabilities (see "Service API" below)
- Chart.js v4 support
- Post-generation editing via AI (`service_file_*` tools)

### Skill Evolution
- Agent **autonomously creates/patches skills**: complex successes or overcome errors → recorded as SKILL.md
- **Usage telemetry**: per-skill use/view/patch counters
- **Curator**: auto-marks unused skills stale → archived; optional LLM consolidation

### Offline-first
- All data stored locally under `{AppData}/amiba/`
- Config, memory, history, services, skills, souls — all local

## Service API (JSBridge)

Generated services run inside `<iframe sandbox>` and call host capabilities via the `window.__amiba__` global object. Each API method requires the corresponding permission declared in the service manifest.

| Module | Permission | Description |
|--------|-----------|-------------|
| `storage` | `storage` | Per-service key-value storage |
| `notification` | `notification` | Toast notifications |
| `ui` | — | Page navigation |
| `widgets` | `widgets` | Floating widget management |
| `network` | `network` | LAN/BLE device discovery & P2P messaging |

### storage — Key-Value Store

Each service has its own isolated key-value namespace, persisted to disk.

```js
await __amiba__.storage.set('count', 42)
const count = await __amiba__.storage.get('count')
await __amiba__.storage.remove('count')
```

| Method | Parameters | Returns |
|--------|-----------|---------|
| `set(key, data)` | `key: string, data: any` | `Promise<void>` |
| `get(key)` | `key: string` | `Promise<any>` |
| `remove(key)` | `key: string` | `Promise<void>` |

### notification — Toast

```js
await __amiba__.showToast('Saved successfully', 'success')
```

| Method | Parameters | Returns |
|--------|-----------|---------|
| `showToast(title, icon?)` | `title: string, icon?: 'success' \| 'error' \| 'loading' \| 'none'` | `Promise<void>` |

### ui — Navigation

```js
await __amiba__.navigateTo('/chat')
await __amiba__.navigateBack()
```

| Method | Parameters | Returns |
|--------|-----------|---------|
| `navigateTo(url)` | `url: string` | `Promise<void>` |
| `navigateBack(delta?)` | `delta?: number` | `Promise<void>` |

### widgets — Floating Widgets

Programmatically register and control floating panels. Can also be declared declaratively via `widget.json` in the service bundle (see [Services document](docs/services.md#widget)).

```js
await __amiba__.widgets.register({
  id: 'my-widget',
  icon: '🔔',
  page: 'widgets/alert.html',
  edge: 'right',
  position: 200,
  showOn: [],
  trigger: 'manual'
})
await __amiba__.widgets.show('my-widget')
await __amiba__.widgets.hide('my-widget')
await __amiba__.widgets.remove('my-widget')
```

| Method | Parameters | Returns |
|--------|-----------|---------|
| `register(config)` | `config: FloatingWidgetConfig` | `Promise<void>` |
| `remove(id)` | `id: string` | `Promise<void>` |
| `show(id)` | `id: string` | `Promise<void>` |
| `hide(id)` | `id: string` | `Promise<void>` |

`FloatingWidgetConfig` fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique kebab-case identifier |
| `icon` | `string` | ✅ | Emoji icon e.g. `"📝"` |
| `label` | `string` | — | Tooltip text |
| `page` | `string` | ✅ | Widget HTML file path |
| `edge` | `'left' \| 'right'` | ✅ | Snap edge |
| `position` | `number` | ✅ | Initial Y position (px from top) |
| `showOn` | `string[]` | ✅ | Route names where widget lives; empty = global |
| `trigger` | `'manual' \| 'page'` | ✅ | `manual` = API-controlled (default), `page` = auto-show on matching route |

### network — LAN / BLE Networking

Device discovery, peer-to-peer connection and messaging. See [Network Communication](docs/network.md).

```js
// Visibility & Discovery
await __amiba__.network.setVisibility({ lan: true, ble: false })
const vis = await __amiba__.network.getVisibility()
await __amiba__.network.startDiscovery('lan')
await __amiba__.network.stopDiscovery('lan')
const devices = await __amiba__.network.getVisibleDevices()
__amiba__.network.onPeerDiscovered((peer) => { /* { id, name, transport, address } */ })

// TCP listener (start on demand to accept incoming connections)
await __amiba__.network.startListening('my-service')
await __amiba__.network.stopListening('my-service')

// Connect (with service matching)
const session = await __amiba__.network.connect(peerId, 'my-service')
await session.send(JSON.stringify({ type: 'chat', text: 'hello' }))
session.on('message', (msg) => { const data = JSON.parse(msg); /* ... */ })
session.on('close', (reason) => { /* peer disconnected */ })
await session.close()

// Accept incoming connections
__amiba__.network.onSession((session) => { /* same as above */ })
```

**Visibility & Discovery:**

| Method | Parameters | Returns |
|--------|-----------|---------|
| `setVisibility(opts)` | `{ lan: boolean, ble: boolean }` | `Promise<void>` |
| `getVisibility()` | — | `Promise<{ lan: boolean, ble: boolean }>` |
| `startDiscovery(transport)` | `'lan' \| 'ble' \| 'all'` | `Promise<void>` |
| `stopDiscovery(transport)` | `'lan' \| 'ble' \| 'all'` | `Promise<void>` |
| `getVisibleDevices()` | — | `DiscoveredPeer[]` |
| `onPeerDiscovered(cb)` | `(peer: DiscoveredPeer) => void` | `void` |

**Session Management:**

| Method | Parameters | Returns |
|--------|-----------|---------|
| `connect(peerId, serviceKey)` | `peerId: string, serviceKey: string` | `Promise<Session>` |
| `onSession(cb)` | `(session: Session) => void` | `void` |
| `startListening(serviceKey)` | `serviceKey: string` | `Promise<void>` |
| `stopListening(serviceKey)` | `serviceKey: string` | `Promise<void>` |

**Session Object:**

| Property / Method | Description |
|------------------|-------------|
| `.id` | Session UUID |
| `.peerId` | Peer device ID |
| `.peerName` | Peer device name |
| `.send(message)` | Send `string` message, returns `Promise<void>` |
| `.close()` | Close session, returns `Promise<void>` |
| `.on('message', cb)` | Listen for messages, `cb(message: string)` |
| `.on('close', cb)` | Listen for close, `cb(reason?: string)` |

### Permission Reference

| Permission | Description |
|-----------|-------------|
| `storage` | Per-service key-value storage |
| `notification` | Toast notifications |
| `widgets` | Floating widget functionality |
| `network` | LAN/BLE networking (discovery & messaging) |

## Android Build

### Local APK Build

```bash
# 1. Install Android SDK (Android Studio → SDK Manager → SDK 34 + NDK 27)
# 2. Set environment variables
export ANDROID_HOME=~/Android/Sdk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.0.xxxx

# 3. Add Rust Android targets
rustup target add aarch64-linux-android armv7-linux-androideabi

# 4. Init Android project (generates src-tauri/gen/android/)
cargo tauri android init

# 5. Build
cargo tauri android build     # release APK
cargo tauri android dev       # debug to connected device
```

Output: `src-tauri/gen/android/app/build/outputs/apk/universal/release/`

**Note**: First local build needs `.cargo/config.toml` with NDK linker config (CI generates this automatically).

### Signing the APK

Release APKs must be signed before they can be installed or published to Google Play.

**Local signing (for personal testing):**

```bash
# 1. Generate keystore (first time only)
keytool -genkey -v -keystore release.keystore -alias amiba \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=belowthetree, OU=Dev, O=Unknown, L=Unknown, ST=Unknown, C=CN" \
  -storepass your_password -keypass your_password

# 2. Sign APK with apksigner
$ANDROID_HOME/build-tools/35.0.0/apksigner sign \
  --ks release.keystore --ks-key-alias amiba \
  --out app-release-signed.apk \
  app-universal-release-unsigned.apk

# 3. Install to device
adb install -r app-release-signed.apk
```

> ⚠️ **Never commit `release.keystore` to git** — it contains your private key. Instead, base64-encode it and store in GitHub Secrets.

### CI Auto-Signing

1. Add these to GitHub repository → **Settings → Secrets → Actions**:

| Secret Name | Description |
|------------|-------------|
| `KEYSTORE_BASE64` | Base64-encoded keystore file |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_PASSWORD` | Key password |

2. Bump `package.json` version and push to main → CI builds, signs, and publishes APK to GitHub Releases.

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
| [Network](./docs/network.md) | LAN/BLE device discovery & P2P messaging |
| [Services](./docs/services.md) | Service generation |
| [Development](./docs/development.md) | Dev guide |

## CI/CD

Change `package.json` version and push to main to auto:
1. Check if version already released (tag exists)
2. Build Windows / macOS / Linux / Android
3. Create `v{version}` tag → publish to GitHub Releases

```bash
npm version patch      # 0.1.4 → 0.1.5
git push origin main   # triggers build
```

Manual trigger also available (Actions → workflow_dispatch).

## License

[MIT](./LICENSE) © 2026 belowthetree
