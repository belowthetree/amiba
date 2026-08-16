# Amiba 扩展点清单（Host 服务 / UI Slot / 事件）

本文是 Amiba “功能、界面全部插件化”的契约总表。设计原则：

1. **服务即扩展点**：Host 服务提供 API，插件消费 API 就是扩展功能。
2. **Slot 即界面契约**：核心 UI 插件只负责渲染 Slot 容器与默认组件；业务 UI 通过 Slot 注册。
3. **事件/waterfall 用于跨插件协作**：避免插件之间直接 import，也避免“为每个场景开一个服务”。
4. **官方 UI 与第三方 UI 同权**：下表中的 Slot 全部对第三方开放，官方组件只是默认注册项。

## 1. Host 服务

### 1.1 内核提供（不允许插件替换，只读消费）

| 服务名 | 职责 | 插件侧用法 |
| --- | --- | --- |
| `loader` | 解析/装载/卸载插件、查询装配树 | 市场、诊断页、运行时插件管理 |
| `env` | 受权限约束的环境变量访问 | `ctx.env.get('AMIBA_X')` |
| `permissions` | 权限仲裁与审计 | 不应绕过，由内核自动调用 |
| `logger` | 结构化日志 | `ctx.logger.info/warn/error` |
| `events` | 事件总线（底层） | 通常用 `ctx.on` / `ctx.before` |

### 1.2 一等插件提供的服务（每个都是独立 npm 包）

| 服务名 | 提供包（建议） | 功能 | 插件可扩展的 API |
| --- | --- | --- | --- |
| `webServer` | `@amiba/host-webserver` | HTTP/WS 服务器、静态资源 | `register(route)`、`middleware()` |
| `settings` | `@amiba/host-settings` | 命名空间配置读写、订阅 | `registerNamespace(ns, schema)`、`get/set` |
| `credentials` | `@amiba/host-credentials` | 凭据存储与解析 | `resolve(ref)`、`onUpdate(ref, cb)` |
| `modelRegistry` | `@amiba/host-model` | 模型/供应商注册、路由、用量 | `registerProvider()`、`resolveModel()` |
| `agentRegistry` | `@amiba/host-agent` | Agent 创建、运行、停靠 | `spawn()`、`followup()`、`stop()` |
| `sessionRegistry` | `@amiba/host-session` | 会话持久化、事件溯源 | `create/get/list/export`、`onEvent` |
| `toolRegistry` | `@amiba/host-tools` | 工具 schema 注册、调用 | `provide(tool)`、`invoke(name, args)` |
| `skillRegistry` | `@amiba/host-skill` | Skill 发现、装载、索引 | `addSource()`、`get(id)` |
| `commands` | `@amiba/host-commands` | `/command` 注册与执行 | `register(cmd)`、`execute(text)` |
| `systemPrompt` | `@amiba/host-system-prompt` | 系统提示词分节组装 | `section(section)`、`before('prompt/assemble')` |
| `approval` | `@amiba/host-approval` | 敏感操作审批 | `request(req)`、`before('approval/request')` |
| `storage` | `@amiba/host-storage` | 插件私有 KV/文件存储 | `namespace(ns).get/set/delete` |
| `scheduler` | `@amiba/host-scheduler` | 定时/周期任务 | `setInterval(cb, ms)`、`cron(expr, cb)` |
| `notifications` | `@amiba/host-notifications` | 系统通知、推送 | `notify(msg)`、`registerChannel()` |
| `mcp` | `@amiba/host-mcp-client` | MCP 服务器连接与工具导入 | `addServer(cfg)`、`list/remove` |
| `filesystem` | `@amiba/host-filesystem` | 受权限约束的文件访问 | `read/write/list/glob`（沙箱化） |
| `sandbox` | `@amiba/host-sandbox` | 命令/代码执行沙箱 | `exec(cmd, opts)` |
| `knowledge` | `@amiba/host-knowledge` | 记忆、索引、检索 | `upsert/search/delete` |
| `marketplace` | `@amiba/host-marketplace` | 插件发现/安装/更新/卸载 | `list/install/uninstall/update` |
| `pluginManager` | 内置在 marketplace 或独立 | 装配行读改写（GUI 与 CLI 共用） | `addPackage()`、`removeEntry()` |
| `theme` | `@amiba/host-theme` | 主题资源服务 | `registerTheme(theme)` |

### 1.3 服务契约示例

#### 工具注册

```ts
export const inject = ['toolRegistry']

export function apply(ctx: HostContext, config: Config): void {
  ctx.effect(() => ctx.toolRegistry.provide({
    name: 'query_balance',
    description: '查询 API 余额',
    parameters: Schema.object({ currency: Schema.string() }),
    execute: async (args, agentCtx) => ({ ok: true, data }),
  }), 'my-plugin: tool query_balance')
}
```

工具目录按 agent realm 合并，因此插件可以只向特定 preset/agent 提供工具；工具 schema 会进入模型请求，必须精简（描述短、详情放 tool result）。

#### 命令注册

```ts
ctx.effect(() => ctx.commands.register({
  name: 'qqbot',
  aliases: ['qq'],
  usage: '/qqbot on|off',
  execute: async (argv, session) => ({ ok: true, value }),
}), 'my-plugin: /qqbot')
```

#### 模型供应商注册

```ts
ctx.effect(() => ctx.modelRegistry.registerProvider({
  id: 'my-provider',
  label: 'My Provider',
  createClient: (config) => new MyClient(config),
  defaultConfig: Schema.object({ baseUrl: Schema.string(), apiKey: Schema.string().role('secret') }),
  capabilities: ['chat', 'reasoning', 'tools'],
}), 'my-plugin: model provider')
```

## 2. Client 服务

| 服务名 | 提供包（建议） | 插件侧用法 |
| --- | --- | --- |
| `runtime` | `@amiba/client-runtime` | `ClientContext`、`SnapshotStore`、模块表 |
| `slots` | `@amiba/client-ui-slots` | `slots.register` / `slots.inject` / `SlotMap` 类型 |
| `locale` | `@amiba/client-locale` | `locale.register(ns, dict)` / `bind(ns)` |
| `theme` | `@amiba/client-theme` | `theme.token(name)`、订阅主题切换 |
| `connection` | `@amiba/client-connection` | 连接状态、`connection.api` wire 面 |
| `remote` | `@amiba/api-remotes/client` | `remote.commands.execute`、`remote.$on`、`remote.api` |
| `router` | `@amiba/client-router` | 页面注册、导航、深链 |
| `toast` | `@amiba/client-toast` | 全局提示 |
| `dialog` | `@amiba/client-dialog` | 模态框、确认框 |
| `palette` | `@amiba/client-palette` | 命令面板条目注册 |
| `uiPrimitives` | `@amiba/client-ui-primitives` | 统一按钮、输入、卡片等基础组件（external 平台模块） |

## 3. UI Slot 总表

Slot 命名规范：`<domain>.<component>`，例如 `settings.section`、`conversation.input.left`。官方 UI 插件只负责定义 Slot 容器和默认项，第三方可注册、覆盖默认项、按 `order` 排序。

### 3.1 应用壳层

| Slot | 宿主 | 注入参数 | 说明 |
| --- | --- | --- | --- |
| `app.bootstrap` | web-shell | - | 应用启动期全局初始化 UI（只执行 effect） |
| `app.error` | web-shell | `error` | 全局错误页替换 |
| `app.dialog` | dialog 服务 | `dialogCtx` | 自定义对话框渲染器 |
| `app.notice` | toast 服务 | `notice` | 自定义通知渲染 |

### 3.2 布局

| Slot | 宿主 | 注入参数 | 说明 |
| --- | --- | --- | --- |
| `layout.sidebar.primary` | web-shell | `{ collapsed, setCollapsed }` | 主导航条目 |
| `layout.sidebar.secondary` | web-shell | 同上 | 次导航/工具列表 |
| `layout.topbar` | web-shell | `{ route }` | 顶栏工具 |
| `layout.statusbar` | web-shell | - | 状态栏信息 |
| `layout.quick-switch` | web-shell | - | 快速切换器条目 |

### 3.3 首页

| Slot | 宿主 | 说明 |
| --- | --- | --- |
| `dashboard.hero` | `@amiba/ui-dashboard` | 首屏主卡 |
| `dashboard.card` | `@amiba/ui-dashboard` | 普通卡片，按 order 网格排列 |
| `dashboard.activity` | `@amiba/ui-dashboard` | 最近会话/动态流条目 |

### 3.4 设置

| Slot | 宿主 | 说明 |
| --- | --- | --- |
| `settings.section` | `@amiba/ui-settings` | 设置页顶级页签（DSH 兼容语义） |
| `settings.general.card` | `@amiba/ui-settings` | “通用”页中的卡片 |
| `settings.model.card` | `@amiba/ui-settings` | “模型”页中的供应商/参数卡片 |
| `settings.profile.card` | `@amiba/ui-settings` | Profile 配置卡片 |
| `settings.about.card` | `@amiba/ui-settings` | 关于页卡片 |

### 3.5 会话与对话

| Slot | 宿主 | 说明 |
| --- | --- | --- |
| `conversation.session.item` | `@amiba/ui-conversation` | 会话列表条目附加信息/按钮 |
| `conversation.header` | `@amiba/ui-conversation` | 会话头部操作 |
| `conversation.message.avatar` | `@amiba/ui-conversation` | 消息头像替换 |
| `conversation.message.content` | `@amiba/ui-conversation` | 特定内容块渲染器（按 contentType 匹配） |
| `conversation.message.toolbar` | `@amiba/ui-conversation` | 消息操作按钮 |
| `conversation.message.actions` | `@amiba/ui-conversation` | 消息下拉菜单项 |
| `conversation.composer.before` | `@amiba/ui-conversation` | 输入区上方区块 |
| `conversation.composer.dock` | `@amiba/ui-conversation` | 输入卡片下方挂件（DSH 同名） |
| `conversation.input.left` | `@amiba/ui-conversation` | 输入区工具行左侧（DSH 同名） |
| `conversation.input.right` | `@amiba/ui-conversation` | 输入区工具行右侧 |
| `conversation.attachment` | `@amiba/ui-conversation` | 附件解析/预览器 |
| `conversation.export` | `@amiba/ui-conversation` | 导出格式插件 |

### 3.6 工具与审批界面

| Slot | 宿主 | 说明 |
| --- | --- | --- |
| `tool.form` | `@amiba/ui-tool` | 按 `toolName` 匹配的自定义表单 |
| `tool.result` | `@amiba/ui-tool` | 按 `contentType` 匹配的结果渲染器 |
| `approval.card` | `@amiba/ui-approval` | 审批卡渲染器（如 QQ 审批转发就是替换这里） |

### 3.7 命令面板

| Slot | 宿主 | 说明 |
| --- | --- | --- |
| `palette.item` | `@amiba/client-palette` | 命令面板条目 |
| `palette.provider` | `@amiba/client-palette` | 动态命令源（搜索文件、会话等） |

### 3.8 市场与管理

| Slot | 宿主 | 说明 |
| --- | --- | --- |
| `marketplace.source` | `@amiba/ui-marketplace` | 插件源（GitHub/npm/本地目录） |
| `marketplace.card` | `@amiba/ui-marketplace` | 插件卡附加信息/操作 |
| `marketplace.install.dialog` | `@amiba/ui-marketplace` | 安装前确认/材料收集面板 |

### 3.9 Slot 注册统一描述符

```ts
export interface SlotRegistration<
  SlotName extends keyof SlotMap = keyof SlotMap,
  Component extends SlotComponent<SlotName> = SlotComponent<SlotName>,
> {
  /** Slot 名；注册到错误 Slot 会在类型与运行时被双重拒绝 */
  name: SlotName
  /** 该 Slot 内唯一 id（推荐 `${pluginName}:${localId}`） */
  id: string
  /** 排序，小值在前；冲突按插件装配顺序稳定排序 */
  order?: number
  /** 导航/标签文本；locale 变化时宿主会重新求值 */
  label?: () => string
  /** 图标资源 id */
  icon?: string
  /** 语言命名空间，宿主据此注入 t 函数 */
  locale?: string
  /** 为 true 时覆盖同 Slot 默认组件 */
  replaceDefault?: boolean
  /** 业务注入面；参数由宿主 Slot 定义 */
  inject?: SlotInject<SlotName>
}

export interface SlotHandle {
  dispose(): void
  update(patch: Partial<SlotRegistration>): void
}
```

客户端使用：

```ts
ctx.effect(() => {
  const handle = ctx.slots.register(
    {
      name: 'settings.section',
      id: 'my-plugin',
      order: 30,
      label: () => t('nav.label'),
      locale: NS,
      inject: () => ({ load: () => controller.load() }),
    },
    MySettingsPage,
  )
  return () => handle.dispose()
}, 'my-plugin: settings slot')
```

## 4. 页面/路由注册

除 Slot 外，需要独立页面的插件使用 `router` 服务：

```ts
ctx.effect(() => ctx.router.registerPage({
  id: 'my-plugin-page',
  path: '/my-plugin',
  title: () => t('page.title'),
  render: (props) => <MyPage {...props} />,
  sidebar: { section: 'tools', order: 20, icon: 'plugin' },
}), 'my-plugin: page')
```

Shell 的侧边栏与路由表完全由该注册动态生成；“设置页”只是 `settings.section` Slot 的一种便捷宿主，不走独立路由。

## 5. 事件与 Waterfall

### 5.1 Host 事件

| 事件 | 触发时机 | 常用消费者 |
| --- | --- | --- |
| `plugin/status` | 插件加载/失败/卸载 | 诊断页、通知 |
| `credentials/updated` | 凭据写入/删除 | 需要热重连的插件 |
| `settings/changed` | 设置命名空间变更 | 运行时重读配置 |
| `session/created` | 新会话 | 记忆、统计 |
| `session/event` | 会话事件落库 | 导出、通知 |
| `turn/start` / `turn/end` | 一轮对话起止 | 用量、审批 |
| `tool/call` | 工具调用前后 | 日志、拦截 |
| `model/request` | 模型请求前后 | 路由、缓存 |
| `approval/request` | 审批发起 | QQ/IM 转发审批 |
| `filesystem/access` | 文件访问（内核审计） | 安全监控 |

### 5.2 关键 Waterfall（可修改链路）

| Waterfall | 语义 | 插件可做 |
| --- | --- | --- |
| `model/config` | 解析 provider/model/config | 注入默认模型、按任务改参数 |
| `model/request` | 组装模型请求 | 追加/裁剪消息、改 reasoning、缓存 |
| `prompt/assemble` | 组装系统提示词分节 | 增删 persona/tool guidance 等 section |
| `tool/catalog` | 生成某 Agent 的工具目录 | 首轮锚定、按权限过滤工具 |
| `tool/execute` | 工具执行前后 | 审批、沙箱策略、结果改写 |
| `message/ingest` | 用户消息进入 Agent 前 | 近距离引导、内容过滤 |
| `message/render` | Client 渲染消息块 | 自定义块渲染（Client 侧） |

使用示例：

```ts
ctx.before('prompt/assemble', (sections, next) => {
  sections.push({ name: 'my-plugin:channel', order: 10, text: '...' })
  return next(sections)
})
```

规则：waterfall 中间件必须显式 `return next(...)`；终止链路必须明确返回替代值；动态内容只允许追加到用户消息附近或消息尾，避免系统提示前缀频繁变化导致请求缓存全量 miss。

## 6. 命令命名空间

`/` 命令按 `<plugin>:<verb>` 命名空间管理：

```
/plugin list | add | remove | update
/session new | use | export
/qqbot on | off            ← 第三方插件
/balance                   ← 第三方插件
```

- 命令注册冲突（同名）由内核拒绝并提示。
- Client 可通过 `remote.commands.execute(sessionId, line)` 触发。
- 命令返回值统一 `{ ok: true, value? } | { ok: false, error: { code, message } }`。

## 7. Wire API 面

Host 插件可声明浏览器可见 API：

```ts
// Host
ctx.remote.expose('balance', {
  query: async (force: boolean) => result,
})
```

```ts
// Client
const balance = ctx.remote.api('balance')
const result = await balance.query(false)
```

| 内置 wire 面 | 提供者 | Client 用法 |
| --- | --- | --- |
| `commands` | commands 服务 | `execute(sessionId, line)` |
| `settings` | settings 服务 | `get/set`（无秘密字段） |
| `credentials` | credentials 服务 | 只写不回显、状态查询 |
| `sessions` | session 服务 | 会话列表/创建/导出 |
| `plugins` | pluginManager | 市场与诊断页 |
| `models` | model 服务 | 供应商/模型/用量 |

访问规则：插件只能访问自己 expose 的面、manifest `remote` 声明中列出的内置面；禁止访问其他第三方插件的面，除非对方 manifest 声明 `publicRemote: true`。

## 8. SlotMap 类型与稳定性

`@amiba/client-ui-slots` 发布 SlotMap：

```ts
export interface SlotMap {
  'layout.sidebar.primary': { runtime: { collapsed: boolean } }
  'settings.section': { runtime: undefined }
  'conversation.input.left': { runtime: { sessionId: SessionId } }
  'conversation.composer.dock': { runtime: { sessionId: SessionId } }
  // ...
}
```

新增 Slot 属于 minor 版本变更；删除/改注入参数属于 major；弃用至少保留一个 major 版本并打 `@deprecated`。插件声明 `apiVersion` 与 client peer 范围，`amiba doctor` 能静态检查 Slot 存在性。

## 9. 命名与治理约定

- 服务名、Slot 名：小写点分，`domain.component`。
- 事件名：`domain/action`。
- 插件实例 id：kebab-case，全局/profile 内唯一。
- 语言命名空间：与包短名一致。
- 路由前缀：`/plugins/<plugin-id>/api/...`。
- 日志标签：`<plugin-id>: <scope>`。
- 每个官方 UI 插件必须把自己所有的渲染点都定义为 Slot；若新增 Slot，先提 PR 到 `@amiba/client-ui-slots` 的 SlotMap。
