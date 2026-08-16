# ADR-0003 — 插件清单与插件包格式

- 状态：已接受
- 日期：2026-08-14
- 关联：`plugin-architecture.md` 的 manifest 章节需按本 ADR 修订

## 背景

原方案使用 npm `package.json` 的 `amiba` 字段，隐含 Node 模块解析。ADR-0001 确定 Amiba 插件是浏览器 ESM 模块。需要定义：插件如何声明入口、依赖、能力与资源。

## 决策

### 1. 一个插件 = 一个目录（或仓库）

```
my-plugin/
├── amiba.plugin.json      # 权威清单（仓库/目录形态）
├── package.json           # npm 发布时含等价的 amiba 字段
├── src/
│   ├── index.ts           # 入口：export name/inject/Config/apply
│   └── ...
└── README.md
```

`amiba.plugin.json` 是目录/仓库形态的权威清单；发布到 npm 时，`package.json` 内嵌等价 `amiba` 字段，`amiba.plugin.json` 作为构建源。两者冲突时以 `amiba.plugin.json` 为准，CLI 负责校验一致性。

### 2. 清单 schema（v1）

```json
{
  "apiVersion": 1,
  "id": "balance",
  "kind": "plugin",
  "entry": "src/index.ts",
  "inject": ["toolRegistry", "serviceRegistry"],
  "provides": {
    "services": [],
    "tools": ["query_balance"],
    "pages": [],
    "slots": ["settings.extra", "chat.below-input"],
    "commands": ["/balance"]
  },
  "permissions": {
    "allow": [
      "network:https",
      "credential:resolve:default_provider"
    ]
  },
  "config": {
    "schema": "src/config-schema.ts",
    "defaults": {}
  }
}
```

### 3. 字段

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `apiVersion` | int | ✅ | 当前 1 |
| `id` | string | ✅ | kebab-case，装配实例 id 默认值；全局唯一 |
| `kind` | enum | ✅ | `plugin` / `tool-pack` / `preset` / `skill` / `theme` / `locale` / `resource` |
| `entry` | string | plugin/tool-pack ✅ | 相对插件根的 ESM 入口 |
| `inject` | string[] | — | 内核服务/注册表依赖 |
| `provides` | object | — | 静态自述，供装配校验与市场展示 |
| `permissions` | object | — | 能力白名单，用户侧只能收紧 |
| `config` | object | — | schema 入口与默认值 |
| `pages` | array | UI 插件 | 页面注册声明 |
| `slots` | array | UI 插件 | Slot 静态声明（运行时仍以 `slots.register` 为准） |
| `resources` | array | theme/locale/resource | 资源文件列表 |

### 4. 入口契约

所有可执行插件入口导出：

```ts
export const name: string          // 与清单 id 一致
export const inject?: string[]     // 与清单一致；清单为权威
export const Config?: Schema<Config>
export function apply(ctx: AmibaContext, config: Config): void | (() => void)
```

工具包插件额外支持：

```ts
export const tools: ToolDefinition[]
```

`@amiba/kernel` 装配器会把 `tools` 逐项注册进 `toolRegistry`，替代当前 `*.tool.ts` 顶层副作用注册。

### 5. kind 语义

| kind | 入口/资源 | 安装位置（AppData） | 说明 |
| --- | --- | --- | --- |
| `plugin` | ESM 入口 | `amiba/plugins/<id>/` | 通用宿主功能/UI |
| `tool-pack` | `tools` 导出 | 同 plugin | 仅提供 AI 工具 |
| `preset` | `amiba.preset.yml` + `agent.amiba.yml` | `amiba/presets/<id>/` | 工具/系统提示组合 |
| `skill` | `SKILL.md` | `amiba/skills/<slug>/` | 现有 Skill 格式，不强行加代码入口 |
| `theme` | `amiba.theme.json` + 资源 | `amiba/theme/<id>/` | 现有主题目录即事实格式 |
| `locale` | 语言包 JSON/TS | `amiba/locales/<id>/` | 插件语言包 |
| `resource` | 静态文件 | `amiba/resources/<id>/` | 文档、示例、catalog 等 |

### 6. 与用户服务 manifest 的关系

`services/{id}/manifest.json` 继续作为**沙箱内容服务**的 manifest，不在本清单 schema 内。两者的关系：

| 概念 | manifest | 执行环境 | 权限检查 |
| --- | --- | --- | --- |
| Amiba 宿主插件 | `amiba.plugin.json` | 主线程 ESM | kernel permissions |
| 用户沙箱服务 | `services/{id}/manifest.json` | iframe sandbox | JSBridge manifest 权限 |
| 服务提供的 AI 工具 | 运行时 `tools/register` | 主线程代理执行 | ServiceTools 门控 |

宿主插件可以依赖 `serviceRegistry` 服务操作沙箱服务；沙箱服务不能直接加载宿主插件。

### 7. 权限目录 v1（与 ADR-0004 联动）

权限命名统一 `domain:action[:target]`：

```yaml
# 原生与平台
platform:tauri
platform:harmony
storage:read:app
storage:write:app
storage:read:services
storage:write:services
fs:pick-folder
fs:read:granted
network:https
network:lan
network:session
web:fetch
web:browse
session:db
widget:desktop
notification
# AI 与数据
ai:invoke
ai:web-search
credential:resolve:<ref>
memory:read
memory:write
skills:read
skills:write
requirements:read
requirements:write
# 宿主注册表
tool:register
tool:invoke:<tool>
page:register
slot:register
command:register
service:manage
plugin:manage
```

### 8. 迁移与兼容

- P1 为每个内置功能创建 `amiba.plugin.json`，入口先复用现有文件。
- 现有 `package.json` 不立即加 `amiba` 字段；当仓库拆为 monorepo 包时再逐包添加。
- `apiVersion` 升 major 必须同时提供迁移说明；内核支持最近两个 major。
