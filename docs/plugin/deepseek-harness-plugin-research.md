# DeepSeek Harness 插件化方案调研

> 调研依据：本地 DSH 生态插件样例（DSH-Plugins-Marketplace v1.3.12、@pinkbanana/dsh-balance v0.4.0、dsh-mcp-setting v0.1.2、dsh-qqbot v1.0.1、dsh-anchored-standard v0.1.0、@dsh-external/dsh-super-injector v0.3.3）以及这些插件中直接可见的 DSH 0.1.0-rc.5/rc.6 服务契约。

## 1. 结论摘要

DeepSeek Harness（DSH）的插件化可以概括为一句话：

> **Cordis 式依赖注入内核 + YAML 声明式装配 + npm 标准包分发 + Host/Client 双半插件 + Slot 注册式界面扩展。**

它并不是在应用里“留几个 if/else 钩子”，而是：

1. **内核（loader/context）极小**：负责解析配置、装配服务、注入依赖、管理生命周期。
2. **官方功能本身就是插件**：模型、工具、会话、设置页、语言、UI 面板都是 `@deepseek-ai/*` 包，与第三方插件共享同一套 `name / inject / Config / apply` 契约。
3. **装配是数据而非代码**：`cordis.yml` 与 `cordis.patch.yml` 只是 YAML 列表，用户补丁以 `insert` 追加插件行；安装/卸载插件最终都表现为修改这些配置文件和 `node_modules`。
4. **浏览器端同样插件化**：客户端 bundle 通过 `window.__ModuleLoader__.load` 注册，插件可以向 Slot 注册 React 组件，从而新增设置页、对话区挂件、输入区按钮等 UI。
5. **生态分发闭环**：`dsh plugin` CLI 安装 npm 包；插件市场通过 GitHub topic 发现、静态 registry 分发、白名单接口安装；preset 与 skill 是轻量内容插件形态。

## 2. 总体架构

```
┌────────────────────────────────────────────────────────────┐
│ npm 插件包（package.json + lib/index.js + lib/client.js）    │
├────────────────────────────────────────────────────────────┤
│ YAML 装配层                                                  │
│   base.cordis.yml / web.cordis.yml   —— 官方组合（只读）      │
│   profiles/<name>/package.json       —— bundles 依赖          │
│   cordis.patch.yml                   —— 用户/插件补丁         │
├────────────────────────────────────────────────────────────┤
│ Cordis 内核                                                  │
│   Context：服务容器（ctx.get / ctx.provide）                 │
│   Loader： 解析 npm 包 → 校验 inject → 执行 apply             │
│   Effect：  ctx.effect 注册资源，dispose 自动回收              │
│   Event：   ctx.on 事件与 waterfall 中间件                   │
├────────────────────────────────────────────────────────────┤
│ 进程入口：dsh / dsh web / dsh --profile <name>               │
└────────────────────────────────────────────────────────────┘
```

### 2.1 内核语义（Cordis）

第三方插件源码直接展示了内核 API：

- `ctx.get(name)`：按服务名取依赖实例；不存在时返回 `undefined`。
- `ctx.provide(name, value)`：向当前 realm 提供服务。
- `ctx.effect(setup, label?)`：注册带清理函数的资源；插件卸载、热重载、profile 停止时自动逆序 dispose。
- `ctx.on(event, listener)`：订阅事件；带 `next` 参数时是中间件（waterfall），可 `return next()` 继续链路。
- `ctx.logger`：结构化日志。
- `realm / isolate`：插件组可放入隔离 realm，使同名服务在 preset/会话边界内各自持有实例，避免全局注册冲突。

### 2.2 YAML 装配行

一个 DSH 插件在配置文件中只表现为一行或一个 `insert` 块：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: qqbot
      name: 'dsh-qqbot'
```

或带配置与禁用：

```yaml
- insert:
    - id: dsh-balance
      name: '@pinkbanana/dsh-balance'
      config:
        apiKeyRef: DEEPSEEK_API_KEY
        cacheMs: 30000
      disabled: false
```

`name` 是 npm 包名（可 scoped、可 `file:`/`link:`），loader 负责 `import()` 该包并读取其 `name / inject / Config / apply` 导出。`id` 是本次装配行的实例标识，同一插件可多行实例化。

### 2.3 分层与生效顺序

- **base/web 组合**：官方功能（模型、会话、工具、设置基础能力）作为只读基础层。
- **profile bundles**：`dsh plugin add` 写入 profile 的 `package.json`，启动时作为 bundles 层装配。
- **cordis.patch.yml**：用户与插件自己追加的行；home 层作用于所有 profile，profile 层只作用于当前 profile。
- **热重载**：web profile 的 HMR 默认关闭，多数配置改动需重启；社区“注入器”插件提供了运行时 `loader.create` 热装配路径。

## 3. 插件包格式

### 3.1 `package.json` 中的 `dsh` 声明

以 `@pinkbanana/dsh-balance` 为例（节选、格式化）：

```json
{
  "name": "@pinkbanana/dsh-balance",
  "version": "0.4.0",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-settings"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.6",
    "react": "^18.2.0"
  }
}
```

要点：

- `.` 导出 Host 半（Node 进程运行），`./client` 导出 Client 半（浏览器 bundle）。
- `dsh.client.platform` 限定客户端平台（`web`）。
- `dsh.client.inject` 声明浏览器插件依赖的服务/模块。
- `dsh.bundle.patch` 指向包内补丁文件；执行 `dsh plugin add` 时自动把它合并进 profile 的 bundles 装配。
- peerDependencies 声明对 DSH 服务定义包的版本范围，npm 安装到 profile 后与 DSH 共享同一份依赖实例。

### 3.2 Host 半：Node 插件契约

宿主插件是标准 ESM 模块，导出：

```ts
export const name = 'dsh-balance'
export const inject = ['webServer', 'credentials']

export interface Config { /* ... */ }
export const Config = z.object({ /* Schemastery schema */ })

export function apply(ctx: Context, config: Config): void
```

真实样例（dsh-balance）中可见的服务用法：

```ts
export function apply(ctx: Context, config: Config): void {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/dsh-balance/api/balance', handler }),
    'dsh-balance: /dsh-balance/api/balance',
  )
  const credential = await ctx.credentials.resolve(credentialRef(config.apiKeyRef))
  ctx.logger.warn(...)
}
```

真实样例（dsh-qqbot）中可见的更多扩展点：

```ts
export const name = 'qqbot'
export const inject = ['agents', 'commands']
export const Config = Schema.object({
  appId: Schema.string(),
  appSecret: Schema.string().role('secret'),
  sandbox: Schema.boolean(),
})

// 注册 /qqbot 命令；监听 session 事件；读取 credentials；写入 systemPrompt section；
// 消费 user-approval 事件；调用 dsh-llm 创建用户消息等。
```

关键工程约束（来自注入器 README 的铁律）：

- **所有资源注册必须包在 `ctx.effect` 里**，否则卸载/热重载会留下僵尸资源。
- 路由、工具、事件监听、UI 注册都要可 dispose。
- `inject` 声明要准确：Cordis 会先装配依赖服务，缺失时插件树加载失败；不要依赖 `ctx.get` 的偶然可用。
- 版本耦合用 peerDependencies 范围（`>=0.0.1-rc <2`）而不是硬编码具体版本。

### 3.3 Client 半：浏览器 bundle 协议

浏览器端发布物是一个 CJS 格式 bundle，入口处向全局 loader 注册：

```js
window.__ModuleLoader__.load({
  id: "dsh-mcp-setting",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    /* bundle 内容 */
    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  }
});
```

构建配置的关键约束（来自 dsh-qqbot / dsh-mcp-setting 的 `tsdown.config.ts`）：

- client bundle 单独构建，格式 `cjs`，平台 `browser`。
- React、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-ui-slots` 等平台模块必须 external，由 DSH 平台模块表提供，否则会产生双 React 或破坏运行时。
- `@deepseek-ai/dsh-client-runtime/client` 也要 external。
- CSS Modules 在构建期内联为 `<style data-plugin-css>`，带插件标识便于卸载/调试。
- bundle id 必须与 npm 包名一致。

### 3.4 Client 插件契约

与 Host 半几乎一致：

```ts
export const inject = ['slots', 'locale', 'remote', 'remote.commands', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'qqbot',
    order: 20,
    label: () => t('settings.nav'),
    locale: NS,
    inject: (): QqbotSettingsInjected => ({ /* 业务接口 */ }),
  }, QqbotSettingsSection))
}
```

DSH client 上下文提供：

- `ctx.effect`：与 Host 相同的资源生命周期。
- `ctx.get`：取客户端服务实例。
- `ctx.on`：客户端事件，如 `connection/reset`。
- `ctx.locale.register / bind`：双语字典注册与翻译绑定。
- `ctx.slots.register / inject`：Slot 注册与依赖触发。
- `ctx.remote.commands.execute(sessionId, line)`：向 Host 发送命令。
- `ctx.remote.$on('credentials/updated', ...)`：订阅 Host 推送事件。
- `ctx.connection.api`：访问 Host 暴露的 wire API 面。
- `SnapshotStore`：注入面通过 `hooks` 传递可订阅状态。

## 4. UI 插槽（Slot）机制

Slot 是 DSH Web GUI 插件化的核心。已观察到的 Slot 名称包括：

| Slot | 用途 | 样例 |
| --- | --- | --- |
| `settings.section` | 设置页左侧/顶部导航新页签 | dsh-balance、dsh-qqbot、dsh-mcp-setting、市场插件 |
| `conversation.composer.dock` | 聊天输入卡片下方常驻挂件 | dsh-balance 余额摘要 |
| `conversation.input.left` | 输入区工具行左侧按钮 | dsh-qqbot 连接 QQ 开关 |

Slot 注册描述符的通用字段（从多个插件归纳）：

```ts
{
  name: SlotName,          // 必须与宿主渲染的 slot 名一致
  id: string,              // 插件内唯一；同一 slot 内唯一
  order: number,           // 排序
  label: () => string,     // 可随 locale 重新求值的文本
  locale?: string,         // 语言命名空间
  inject?: (...args) => T, // 把插件业务能力注入组件 props
}
```

组件类型由 `@deepseek-ai/dsh-client-ui-slots` 提供：

```ts
type Props = PropsRuntime<'settings.section'>
  & InjectFace<MyInjected>
  & PropsLocale<typeof MY_NS>
```

`ctx.slots.inject(name, effect)` 的语义是：当宿主渲染指定 slot 时执行 effect，由 effect 调 `ctx.slots.register(...)`。这使得 slot 的注册是惰性、可重复、可 dispose 的，也天然表达“插件 A 的 slot 依赖宿主插件 B 已挂载”的启动顺序。

## 5. 配置、凭据与设置

DSH 把配置分成清晰的面：

| 面 | 存放 | 语义 |
| --- | --- | --- |
| 插件 Config schema | 插件导出 `Config` | 装配行 `config:` 的静态校验与默认值 |
| cordis.yml 基础层 | 组合文件 | 官方预设/部署默认值 |
| settings 命名空间 | `settings.yaml` | 用户可在设置界面修改的命名空间（部分硬编码白名单） |
| credential 引用 | `.credentials.yaml` | 秘密值，按引用名读写，支持环境变量遮蔽 |
| 环境变量 | `process.env` | CLI/无头环境的兜底 |

插件 `Config` 使用 Schemastery（zod 风格）声明，支持 `.role('secret')`、`.role('credential-ref')` 等语义角色。凭据解析链路示例（dsh-qqbot）：

```
credential 库（设置页写入）
  → settings.yaml 的插件命名空间
  → cordis.yml 装配行 config 基础层
  → 环境变量
```

浏览器永远不直接拿凭据：Host 半通过 `ctx.credentials.resolve(ref)` 取到密钥后只把派生结果（余额、模型列表、状态）以 JSON 返回给 Client 半。

## 6. CLI 插件管理

官方安装/卸载命令形态（来自插件 README）：

```bash
dsh plugin --profile web add @pinkbanana/dsh-balance
dsh plugin --profile web add -w dsh-qqbot        # -w 写入 pnpm workspace 根依赖
dsh plugin --profile web remove dsh-mcp-setting
dsh plugin --profile web add link:/path/to/plugin # 开发期 link
dsh plugin --profile web add github:owner/repo    # 从 GitHub 安装
dsh --profile web                                  # 启动
```

其行为等价于：在 profile 目录执行包管理安装 + 按包内 `dsh.bundle.patch` 注册 bundles 行。插件包可以携带 `cordis.patch.yml` 自描述装配行，安装后无需用户手改配置。

## 7. 非代码插件：Agent 预设与 Skill

DSH 生态有另外两类“内容插件”，它们不写 TypeScript 也能改变能力：

### 7.1 Agent 预设（preset）

安装到 `~/.dsh/.agent-presets/<id>/`：

```
<id>/
├── preset.yml            # name / description / order（UI 展示）
├── agent.cordis.yml      # agent 平面组合：工具、persona、plan-mode、compaction、workflow……
└── tool-bootstrap.mjs    # 本地服务插件（可选）
```

`agent.cordis.yml` 与宿主组合同构，因此预设只是“作用在 agent scope 上的配置插件”。其中可见高级语义：

- `isolate: <realm>`：将服务组放入独立 realm，preset 间同名服务不冲突。
- `disabled: !!js expression`：按平台/环境条件禁用行。
- 服务行既可引用 npm 包（`@deepseek-ai/dsh-tool-bash`），也可引用相对文件（`./tool-bootstrap.mjs`）。

### 7.2 Skill

安装到 `~/.dsh/skills/`，核心是 `SKILL.md`。市场识别仓库类型优先级为：`SKILL.md` → agent 预设（`preset.yml` + `agent.cordis.yml`）→ cordis 插件（`package.json`）→ 安装脚本。

## 8. 插件市场与安全

DSH-Plugins-Marketplace 自身就是一个完整的服务端 + 客户端插件，其模式值得照搬：

- **发现**：GitHub topic `dsh-plugin`；CI 每 2 小时生成静态 `registry.json`（jsDelivr CDN 优先、raw 兜底、搜索 API 最后）。
- **列表**：按 star 排序、已安装置顶、分类 chips、搜索、深浅色主题 token。
- **安装管线**：clone 到 `~/.dsh/marketplace/cache/<owner>__<name>` → 识别类型 → 扫描 README/脚本/env 中所需密钥 → 需要时暂停等待用户输入 → 执行安装 → 写 `installed.json`。
- **已安装判定**：安装清单 + 目录启发式 + package.json 名称映射 + `repository` 字段双向校验 + 本体识别。
- **卸载**：删除安装目录 + 移除 `cordis.patch.yml` 注册行 + 删除安装记录。
- **安全**：
  - 安装接口要求 `X-DSH-Marketplace` 头（防 CSRF）+ Host 白名单（loopback/私有网段/显式追加）+ Origin 校验。
  - 第三方安装脚本执行前必须用户确认；脚本环境变量最小化。
  - npm 安装时剔除全部 `TOKEN/KEY/SECRET/PASSWORD/CREDENTIAL` 类环境变量。
  - 用户提交的密钥只作为本次安装进程环境变量，不落盘。
  - 插件包随 DSH 启动加载，明确告知“安装即信任”。

## 9. 运行时插件管理层（社区补强的关键缺口）

`dsh-super-injector` 证明了 DSH 插件模型可以做到“运行时手术台”：

- 不修改 patch/package.json/bundles，通过 junction 链接 + `ctx.loader.create({ name, config })` 运行时装配。
- 提供 `dev_inject_plugin`、`dev_reload_package`、`dev_uninject_plugin`、`dev_stage_add/promote/demote` 等工具。
- 注入清单持久化，重启后自动恢复；失败回滚保留旧代。
- 其口号“一切皆插件”与本项目目标一致。

它同时也暴露了 DSH 官方模型在 0.1.0-rc 阶段的薄弱点：

- 官方装配机制是启动期配置，热重载/卸载/失败回滚依赖社区插件。
- client 模块表需要构建工具硬编码，接口稳定性不足。
- settings wire 面存在硬编码命名空间白名单，树外插件注册配置命名空间不可用（dsh-qqbot 被迫走 credential 面）。
- 无统一权限声明，安全靠插件自律 + Host 白名单。

这些薄弱点正是 Amiba 设计应当补齐的部分。

## 10. 对 Amiba 设计的关键启示

| DSH 做法 | Amiba 应继承 | Amiba 应改进 |
| --- | --- | --- |
| 内核小、功能皆插件 | 完全继承 | 把“功能皆插件”写成架构红线与测试验收标准 |
| npm 包 + package.json `dsh` 元数据 | 改为 `amiba` 元数据 | 增加 `apiVersion`、`permissions`、`capabilities`、明确 kind |
| YAML patch 装配 | 继承 `amiba.patch.yml` | 补事务性写入、错误回滚、diff/校验 |
| Host/Client 双半插件 | 完全继承 | 把 client 平台模块表发布为 SDK 常量，不再硬编码 |
| Slot 注册 | 完全继承并扩为全界面槽位 | 类型化 SlotMap，slot 即契约；核心 UI 自身也只通过 slot 装配 |
| `dsh plugin` CLI | 继承 `amiba plugin` | 命令与 GUI 共用同一 PluginManager 服务 |
| 市场（topic + registry + installed.json） | 继承完整模式 | 增加清单签名/校验、回滚、依赖解析、权限审批 |
| preset/skill | 继承为声明式内容插件 | 统一 manifest，允许 preset/skill 声明依赖与权限 |
| 凭据服务 | 继承 Host 代理模式 | 任何插件不得读全量 `process.env`，由权限系统强制 |
| 热重载 | 视为一等能力 | 内核直接提供 install/uninstall/reload/dispose 事务，不再靠社区补丁 |
