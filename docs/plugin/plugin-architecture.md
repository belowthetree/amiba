# Amiba 插件化总体架构

## 1. 设计目标

1. **一切功能皆插件**：模型接入、会话、工具、Skill、通知、MCP、市场、设置、主题、语言包等业务能力全部以插件包存在，内核不直接实现任何业务功能。
2. **一切界面皆插件**：Web GUI 不是“带扩展点的单体页面”，而是由 Slot 装配出来的组合界面；设置页、会话页、输入区、侧边栏、状态栏、命令面板都由 UI 插件注册。
3. **一等公民与第三方同权**：官方 `@amiba/*` 插件与社区插件使用同一 manifest、同一 loader、同一 Slot、同一权限模型；禁止在壳层为官方插件写 if/else。
4. **配置即状态**：插件的持久化安装状态只存在于 `amiba.patch.yml`、profile 依赖和 bundles 列表；运行时数据库仅用于缓存，不是第二安装源。
5. **安全默认拒绝**：插件默认无权限；所有敏感能力经 manifest 声明、内核仲裁、用户可审阅。
6. **可演进**：提供稳定的 `apiVersion`，允许内核升级而不破坏插件；旧版本插件可被识别、提示、隔离或兼容运行。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| Amiba Home | `~/.amiba`（可用 `AMIBA_HOME` 覆盖），全部用户态状态根目录 |
| Profile | 一个可启动运行形态：`web`、`headless`、自定义名 |
| 组合（composition） | 一份 YAML 插件行列表，决定某个进程装配哪些插件 |
| 装配行（entry） | `{ id, name, config, disabled, ... }`，插件实例的声明 |
| Host 半 | 运行在 Node 主进程的插件 ESM 模块 |
| Client 半 | 运行在浏览器的插件 bundle |
| 服务（service） | Host/Client 内核容器中按名字解析的实例 |
| 槽位（Slot） | UI 宿主暴露的注册点，插件向其中注册组件 |
| 扩展点（extension point） | Slot、服务 API、事件、命令、waterfall 的统称 |
| Realm | 服务作用域，用于插件组之间的实例隔离 |
| 能力（capability） | 内核可执行权限单元，插件 manifest 声明后由策略仲裁 |

## 3. 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        Amiba Kernel（最小内核）                    │
│  - 进程入口 / profile 选择                                         │
│  - 装配解析（内置组合 + bundles + amiba.patch.yml）                │
│  - 插件加载器（resolve / import / validate / instantiate）         │
│  - Context 服务容器（get / provide / effect / on）                 │
│  - Realm 与生命周期管理（start / stop / dispose / reload）         │
│  - 权限仲裁器（permission.check）                                  │
│  - 事件总线（同步事件 / waterfall）                                 │
└──────┬───────────────────────────────────────────────────────────┘
       │ 通过同一套插件契约装配
       ├── @amiba/web-server          HTTP/WS 服务
       ├── @amiba/agent               Agent 运行时
       ├── @amiba/model               LLM 接入
       ├── @amiba/tool-*              工具
       ├── @amiba/session             会话
       ├── @amiba/settings            设置服务
       ├── @amiba/credentials         凭据服务
       ├── @amiba/skill               Skill 服务
       ├── @amiba/marketplace         插件市场（自己也是插件）
       ├── @amiba/web-shell           Web 壳（最小根布局，只渲染 Slot）
       ├── @amiba/ui-settings         设置界面
       ├── @amiba/ui-conversation     会话界面
       ├── @amiba/ui-dashboard        首页
       └── 第三方插件（同权）…
```

**红线**：任何功能/界面代码出现在 kernel 包中都被视为架构回归；kernel 只允许包含上述“最小内核”列表中的机制，不包含业务策略。

## 4. 目录与装配布局

```
~/.amiba/
├── amiba.patch.yml                       # home 层用户补丁（作用于所有 profile）
├── settings.yaml                         # 用户设置
├── .credentials.yaml                     # 凭据（0600，插件经凭据服务访问）
├── plugins/
│   ├── registry.json                     # 市场/插件清单缓存
│   └── installed.json                    # 安装记录（缓存，可重建）
├── profiles/
│   ├── web/
│   │   ├── package.json                  # profile 依赖（含 bundles）
│   │   ├── pnpm-lock.yaml
│   │   ├── node_modules/
│   │   ├── amiba.patch.yml               # profile 层补丁
│   │   └── amiba.bundles.yml             # bundle 补丁自动汇总（只读生成）
│   └── headless/
│       └── ...
├── presets/<id>/                         # Agent 预设（内容插件）
│   ├── amiba.preset.yml
│   └── agent.amiba.yml
├── skills/<name>/                        # Skill（内容插件）
│   └── SKILL.md
└── cache/                                # 市场克隆、下载、构建缓存
```

## 5. 装配模型

### 5.1 装配层优先级（低 → 高）

```
1. 内置组合        packages/presets/base.amiba.yml / web.amiba.yml / headless.amiba.yml
2. 内置 bundles    Amiba 发行版随包官方插件
3. profile bundles profile/package.json 的 amiba bundles（由 `amiba plugin add` 生成）
4. home patch      ~/.amiba/amiba.patch.yml
5. profile patch   ~/.amiba/profiles/<profile>/amiba.patch.yml
6. 运行时覆盖      CLI `--plugin` / `--disable`（仅当前进程，不持久化）
```

同一 `id` 的行由高层覆盖；`disabled: true` 在高层关闭低层行；`remove` 操作用于显式删除。解析结果是纯数据 `ResolvedComposition`，可打印、可 diff、可测试。

### 5.2 patch 文件格式

与 DSH 的 `cordis.patch.yml` 同构，改名并增强：

```yaml
# ~/.amiba/profiles/web/amiba.patch.yml
- insert:
    - id: balance
      name: '@amiba/plugin-balance'
      config:
        cacheMs: 30000
      permissions:
        allow: [network:api.deepseek.com, credential:resolve:DEEPSEEK_API_KEY]

- modify:
    id: balance
    config:
      cacheMs: 60000

- remove:
    id: legacy-plugin
```

内核提供 `amiba patch validate / diff / apply --dry-run` 子命令；所有 GUI 写 patch 必须通过 PluginManager 服务，走临时文件 + 原子 rename + `.bak` 备份 + 写队列。

### 5.3 装配行完整字段

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 实例 id，进程/profile 内唯一 |
| `name` | string | 是 | npm 包名、相对文件路径、URL 或 `github:owner/repo` |
| `config` | object | 否 | 经插件 `Config` schema 校验后传入 `apply` |
| `disabled` | boolean | 否 | 默认 false |
| `group` | boolean | 否 | 当前行作为组合组 |
| `isolate` | map | 否 | 声明 entry-local realm |
| `permissions` | object | 否 | 用户侧对 manifest 权限的收紧（只能减少，不能扩大） |
| `configFile` | string | 否 | 从独立文件读配置，便于密钥/大配置分离 |

## 6. 插件清单（`package.json` 的 `amiba` 字段）

### 6.1 完整示例

```json
{
  "name": "@amiba/plugin-balance",
  "version": "1.0.0",
  "type": "module",
  "main": "./lib/index.js",
  "types": "./lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "amiba": {
    "apiVersion": 1,
    "kind": "plugin",
    "bundle": { "patch": "./amiba.patch.yml" },
    "client": {
      "platform": "web",
      "entry": "./lib/client.js",
      "inject": ["runtime", "locale", "ui.settings", "ui.conversation"],
      "immediately": false
    },
    "permissions": [
      { "capability": "network:host", "hosts": ["api.deepseek.com"] },
      { "capability": "credential:resolve", "refs": ["DEEPSEEK_API_KEY"] }
    ],
    "provides": {
      "hostServices": ["balance-api"],
      "uiSlots": ["settings.section", "conversation.composer.dock"],
      "commands": ["/balance"],
      "tools": ["query_balance"]
    }
  },
  "peerDependencies": {
    "@amiba/kernel": "^1.0.0",
    "@amiba/host-webserver": "^1.0.0",
    "@amiba/host-credentials": "^1.0.0",
    "@amiba/client-runtime": "^1.0.0",
    "@amiba/client-ui-slots": "^1.0.0"
  }
}
```

### 6.2 字段说明

| 字段 | 说明 |
| --- | --- |
| `apiVersion` | 插件契约版本。内核只加载其支持的主版本；不兼容时给出结构化错误 |
| `kind` | `plugin` / `preset` / `skill` / `theme` / `resource`；不同 kind 有不同入口，但清单结构统一 |
| `bundle.patch` | 包内自描述 patch；`amiba plugin add` 时合并进 profile bundles |
| `client.platform` | `web`；未来可扩展 `desktop`、`cli` |
| `client.entry` | Client 半文件；缺省为 `./lib/client.js` |
| `client.inject` | 客户端依赖的服务名，必须可解析 |
| `client.immediately` | 为 true 时 Client 半在模块加载后立即 `apply`，否则等其 inject 的 UI 宿主就绪 |
| `permissions` | 能力白名单；用户可在 patch 中进一步收紧 |
| `provides` | 静态自述，供市场、依赖解析、禁用影响分析使用；不用于运行授权 |

## 7. 插件契约

### 7.1 Host 半

```ts
// 最小插件
export const name = 'my-plugin'
export const inject = ['webServer'] as const

export interface Config {
  enabled: boolean
  endpoint: string
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  endpoint: Schema.string().default('https://example.com'),
})

export function apply(ctx: HostContext, config: Config): void {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: '/my-plugin/api',
      handler,
    })
    return dispose
  }, 'my-plugin: api routes')
}
```

规则：

1. `name` 是日志、权限、Slot id 前缀的权威来源；必须与包名一致（scoped 包可只取短名，但推荐一致）。
2. `inject` 显式声明依赖；kernel 按拓扑装配，缺失依赖直接报错并给出缺失服务与可选包提示。
3. `Config` 可选；未提供时 `config` 必须为空对象。
4. `apply(ctx, config)` 只做注册；任何长任务必须在 `ctx.effect` 内启动并返回清理函数。
5. 禁止在 `apply` 顶层 `await`；异步初始化用 `ctx.effect` 中启动、内部排队。
6. 禁止读取 `process.env` 全量对象；只能通过 `ctx.env.get(name)` 并受权限约束。
7. 所有公开函数必须是无副作用纯函数优先，便于单测与卸载。

### 7.2 Client 半

```ts
export const inject = ['slots', 'locale', 'runtime'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-my-plugin: dictionaries')

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'my-plugin',
      order: 30,
      label: () => ctx.locale.bind(NS)('nav.label'),
      locale: NS,
      inject: () => ({ load: () => controller.load() }),
    }, SettingsPanel),
  )
}
```

规则：

1. Client 半只能通过 `ctx.remote` 与 Host 半通信，禁止直接访问凭据。
2. 样式必须使用主题 token 或插件 scoped CSS，并注册为可清理的 `<style data-plugin-css>`。
3. Slot 组件通过注入面（inject face）获得业务接口，不直接 import 服务实例（便于测试与树摇）。
4. 所有订阅在 `ctx.effect` 返回的 disposer 中解除。

### 7.3 Kernel API 最小集合

Host 与 Client 使用同一套 `Context` 语义：

```ts
interface Context {
  readonly [key: string]: unknown
  get<T>(name: string): T | undefined
  set(name: string, value: unknown): void
  effect(setup: () => void | (() => void), label?: string): void
  on(event: string, listener: (this, ...args) => unknown): () => void
  before(event: string, listener: (this, ...args, next) => unknown): () => void
  provide<T>(name: string, value: T): void
  mixin(name: string, value: unknown): void
  logger: Logger
  env: EnvFacade
  permissions: PermissionFacade
}
```

事件监听约定：

- `ctx.on`：普通事件，返回值被忽略。
- `ctx.before`：waterfall 中间件，可 `return next(...)` 修改后续参数或提前终止。
- 资源注册必须 `ctx.effect`；dispose 逆序执行，reload 即 `dispose + 重新 import + apply`。

## 8. 生命周期

```
resolve package
  → read amiba manifest / validate apiVersion
  → validate permissions against user policy
  → import module
  → validate exports(name/inject/Config/apply)
  → topologically order by inject
  → for each entry:
        create scoped ctx
        resolve config = defaults ← bundle patch ← composition patch ← settings? ← env
        validate config with Config schema
        apply(ctx, config)
        record effects / provided services / event subscriptions / slot registrations
  → emit amiba:plugin-ready
```

停止/卸载/热重载：

```
unload(entryId)
  → dispose entry effects（逆序）
  → remove slot registrations / route / command / tool registrations
  → remove scoped realm
  → evict module cache（可选 reload）
  → 任一步失败：保留旧实例，回滚新实例，返回结构化错误
```

内核保证：

- **事务性 reload**：新实例先 apply 成功，再 dispose 旧实例；新实例 apply 失败不影响旧实例运行。
- **幂等 id**：重复装配行是配置错误，loader 给出精确 YAML 路径，不静默覆盖。
- **隔离失败**：插件 throw 只 fail 该 entry（及其唯一依赖它的 entry），不拉垮整个 profile；失败清单在启动报告中展示，web profile 显示“插件诊断”页面。

## 9. Realm 与作用域

继承 DSH 的 realm 思想并系统化：

| Realm | 生命周期 | 用途 |
| --- | --- | --- |
| `root` | 进程 | 全局单例服务：webServer、settings、credentials、registry |
| `profile` | profile | 按 profile 隔离的配置视图 |
| `plugin` | 插件实例 | 插件私有服务默认作用域 |
| `group` | 组合组 | 插件组共享服务（preset 内共享 workflowEngine 等） |
| `agent` | Agent/会话 | 按会话隔离的工具目录、systemPrompt、compaction 状态 |

插件可以在装配行中用 `isolate` 创建命名 realm，也可以在代码中 `ctx.provide` 时指定。默认规则：**`ctx.provide` 提供到当前插件 realm；需要全局发布必须通过内核显式 API 并声明 capability `service:publish`**，防止两个插件无意注册同名全局服务。

## 10. Host-Client 通信

### 10.1 同源 HTTP

Client 半通过 `fetch` 访问 Host 半注册的 `/plugins/<plugin-id>/api/*` 前缀路由。所有 route 必须在 `apply` 中经 `ctx.webServer.register` 注册，内核自动完成：

- 方法白名单；
- 请求体大小限制；
- `X-Amiba-Plugin` 头 + Origin/Host 白名单（loopback、私有网段、`AMIBA_ALLOWED_HOSTS`）；
- 权限审计日志。

### 10.2 Remote / Wire 面

Host 服务可声明 wire 接口：

```ts
ctx.remote.expose('balance', {
  query: (force: boolean) => Promise<BalanceResult>,
})
```

Client 侧：

```ts
const api = ctx.remote.api('balance')
const result = await api.query(false)
```

内核基于 manifest `permissions` 决定该插件是否能访问某 remote 面；默认拒绝跨插件访问其他插件的 remote 面。

### 10.3 推送事件

```
Host 事件（credentials/updated、plugin/status、session/event）
  → 白名单映射为 wire event
  → WebSocket / SSE 推送到已连接 Client
  → Client ctx.remote.$on(name, handler)
```

## 11. 配置与凭据

配置解析顺序（低 → 高）：

```
Config schema 默认值
  → bundle patch 行 config
  → home/profile patch 行 config
  → settings.yaml 对应命名空间（若插件注册了设置页）
  → 环境变量 AMIBA_<PLUGIN_ID>_<KEY>（显式声明 env 能力后）
```

凭据只通过凭据服务：

```ts
const ref = credentialRef('DEEPSEEK_API_KEY')
const cred = await ctx.credentials.resolve(ref)   // 只有声明 capability 才允许
```

秘密值不进入日志、不进入客户端 bundle、不写入 settings.yaml。设置页通过 wire 面提交，Host 以“是否已配置”回显，不回传明文。

## 12. 插件分类（kind）

| kind | 入口 | 用途 | 对应 DSH |
| --- | --- | --- | --- |
| `plugin` | Host + 可选 Client | 任意功能与界面 | cordis plugin |
| `preset` | `amiba.preset.yml` + `agent.amiba.yml` | Agent 能力组合 | `.agent-presets` |
| `skill` | `SKILL.md` + 可选资源 | 给模型的流程知识 | `~/.dsh/skills` |
| `theme` | 主题 token + CSS 资源 | 换肤，不注册业务逻辑 | 无（DSH 只有内置主题） |
| `resource` | 静态资源清单 | 图标、语言包、示例 | 无 |

前四类都在市场可发现、可安装、可卸载；安装位置统一由 PluginManager 决定。

## 13. 版本与兼容性

- `amiba.apiVersion` 采用主版本整数，每年至多升级一次；内核可同时支持最近两个主版本（dual-load）。
- Host 服务契约通过 `@amiba/host-*` 与 `@amiba/client-*` 类型包发布，peerDependencies 用范围。
- `amiba doctor` 检查：缺失 peer、重复依赖实例、过期 apiVersion、Slot id 冲突、Config schema 失效。
- 客户端 bundle 的平台模块表由 `@amiba/client-runtime/package.json` 的 `amiba.platformModules` 导出，构建工具读取，不再硬编码在 tsdown 配置里。

## 14. 依赖与排序

1. `inject` 声明是第一排序依据（拓扑序）。
2. 相同依赖层按 bundle patch 顺序、`order` 字段稳定排序。
3. Slot 注册的 `ctx.slots.inject(slotName, effect)` 提供第二类排序：宿主 Slot 插件就绪后才执行注册 effect。
4. 事件 waterfall 提供第三类排序：插件不依赖启动顺序，而是在事件链中按 `order` 参与。
5. 禁止使用模块顶层副作用影响装配结果；装配结果必须由配置 + apply 决定。

## 15. 内核最小化验收清单

以下内容**允许**存在于 kernel：

- 进程入口、profile 解析、配置文件读取
- 插件包解析/加载/装配
- Context 服务容器、realm、effect、事件
- 权限仲裁器
- 结构化日志与错误报告
- 插件状态查询（供诊断页）

以下内容**禁止**存在于 kernel（必须是插件）：

- 任何 HTTP/WS 服务器实现
- Agent、模型、工具、会话、Skill 任何逻辑
- 设置、凭据、主题、i18n 具体策略
- 任何 React 组件、任何 Slot 宿主实现
- 插件市场、安装脚本执行策略
