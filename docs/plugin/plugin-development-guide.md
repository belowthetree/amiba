# Amiba 插件开发指南

## 1. 环境与工具

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | >= 20 | 运行时 |
| pnpm | >= 9 | 包管理与 workspace |
| TypeScript | >= 5.5 | 插件源码 |
| tsdown | >= 0.22 | Host/Client 双产物打包 |
| React | 18.x | Client UI 组件 |
| `@amiba/cli` | 1.x | `amiba plugin` 管理命令 |
| `create-amiba-plugin` | 1.x | 脚手架 |

初始化：

```bash
pnpm create amiba-plugin my-plugin --form hybrid
# form 可选：host-only | client-only | hybrid | tool | preset | skill | theme
cd my-plugin
pnpm install
```

生成结构：

```
my-plugin/
├── package.json
├── amiba.patch.yml          # 包内自描述装配行
├── src/
│   ├── index.ts             # Host 半入口
│   └── client/
│       ├── index.ts         # Client 半入口
│       ├── SettingsPanel.tsx
│       └── locales.ts
├── tests/
│   ├── host.test.ts
│   └── client.test.tsx
├── tsconfig.json
├── tsconfig.build.json
└── tsdown.config.ts
```

## 2. 最小 Host 插件

```ts
import type { HostContext } from '@amiba/kernel'
import Schema from '@amiba/schema'

export const name = 'my-plugin'
export const inject = ['webServer']

export interface Config {
  greeting: string
}

export const Config = Schema.object({
  greeting: Schema.string().default('hello'),
})

export function apply(ctx: HostContext, config: Config): void {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: '/plugins/my-plugin/api/hello',
      method: 'GET',
      handler: async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, greeting: config.greeting }))
      },
    })
    return dispose
  }, 'my-plugin: hello route')
}
```

## 3. 最小 Client 插件

```tsx
import type { ClientContext } from '@amiba/client-runtime/client'
import type {} from '@amiba/client-ui-settings/client'
import type {} from '@amiba/client-locale/client'
import { en, zh } from './locales'

const NS = 'my-plugin'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-my-plugin: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'my-plugin',
      order: 30,
      label: () => t('nav.label'),
      locale: NS,
      inject: () => ({ greeting: 'hello' }),
    }, SettingsPanel),
  )
}
```

## 4. 构建配置

### 4.1 平台模块表不要硬编码

```ts
// tsdown.config.ts
import { defineConfig } from 'tsdown'
import { createAmibaClientConfig } from '@amiba/build-tools'

const ID = 'my-plugin'

export default defineConfig([
  {
    // Host 半：ESM / Node
    name: ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    dts: false,
    sourcemap: true,
  },
  createAmibaClientConfig({
    id: ID,
    entry: 'src/client/index.ts',
    // 工具自动从 @amiba/client-runtime 读取 platformModules
  }),
])
```

`createAmibaClientConfig` 生成的 bundle 等价于：

```js
window.__AmibaModuleLoader__.load({
  id: "my-plugin",
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

### 4.2 构建与类型检查

```bash
pnpm build        # Host ESM + Client CJS bundle + d.ts
pnpm typecheck
pnpm test
```

## 5. 安装、运行与调试

### 5.1 本地开发

```bash
# 把源码 link 进 web profile（开发期改 lib 产物即可热重载）
amiba plugin --profile web add link:/path/to/my-plugin

# 或生产式安装（拷贝快照）
amiba plugin --profile web add /path/to/my-plugin

# 启动
amiba --profile web
```

### 5.2 从 npm / GitHub 安装

```bash
amiba plugin --profile web add @amiba/plugin-balance
amiba plugin --profile web add github:owner/my-plugin
amiba plugin --profile web add -w my-plugin   # -w：写入 profile workspace 根
```

### 5.3 插件管理命令

```bash
amiba plugin list --profile web
amiba plugin status <id>
amiba plugin remove <id> --profile web
amiba plugin update <id>
amiba plugin reload <id>          # 开发期热重载（默认仅 link: 包允许）
amiba patch validate              # 校验全部 patch 文件
amiba doctor                      # 诊断 peer、Slot、权限、schema 问题
```

### 5.4 热重载闭环

1. `amiba plugin add link:...` 挂源码目录。
2. `pnpm build` 重新生成 `lib/`。
3. `amiba plugin reload <id>`（或 watch 模式自动 reload）。
4. 浏览器刷新；Client bundle rev 按内容哈希更新。

内核 reload 顺序：导入新模块 → 校验 → 新实例 apply → 成功后 dispose 旧实例；任一步失败保留旧实例并返回错误日志。

## 6. 测试

```ts
import { createTestHost } from '@amiba/testing'
import { createRequire } from 'node:module'

test('host plugin registers route', async () => {
  const host = await createTestHost({
    plugins: [
      '@amiba/host-webserver',
      { id: 'my-plugin', name: require.resolve('..') },
    ],
  })
  const res = await host.fetch('/plugins/my-plugin/api/hello')
  expect(await res.json()).toEqual({ ok: true, greeting: 'hello' })
  await host.dispose()
})
```

客户端测试用 `@amiba/client-test-runtime` 创建最小 ClientContext，不依赖真实浏览器：

```ts
const ctx = createTestClientContext(['slots', 'locale'])
apply(ctx)
expect(ctx.slots.get('settings.section', 'my-plugin')).toBeDefined()
```

验证清单：

- [ ] `apply` 中的每个资源都通过 `ctx.effect` 注册
- [ ] reload 两次无 duplicate 注册错误
- [ ] dispose 后路由/工具/Slot/事件监听全部消失
- [ ] 无权限调用被内核拒绝
- [ ] 缺凭据时返回结构化错误而非崩溃
- [ ] zh/en 字典齐全，locale 切换后导航文本更新

## 7. 发布

```bash
pnpm build
pnpm pack
pnpm publish
```

发布前要求：

1. `package.json` 含 `amiba` 元数据，`apiVersion` 正确。
2. `files` 包含 `lib/`、`amiba.patch.yml`、`README`、license。
3. 运行 `amiba plugin pack --verify`（等价于 `amiba doctor` 对 tarball 的检查）。
4. 仓库 topic 加 `amiba-plugin`（进入市场索引）。
5. 版本号遵循 semver；`amiba.platformModules` 兼容当前内核主版本。

## 8. 声明式内容插件

### 8.1 Agent 预设

```
my-preset/
├── amiba.preset.yml
└── agent.amiba.yml
```

`amiba.preset.yml`：

```yaml
name: My Preset
description: 定制工具组合
order: 10
```

`agent.amiba.yml` 与主组合同构，只作用于 agent scope：

```yaml
- id: persona
  name: '@amiba/agent-persona'
  config:
    text: You are a helpful assistant.

- id: tools
  name: amiba:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: tool-bash
      name: '@amiba/tool-bash'
    - id: tool-skill
      name: '@amiba/tool-skill'
```

安装：

```bash
amiba preset install ./my-preset
# 复制到 ~/.amiba/presets/my-preset
```

### 8.2 Skill

```
my-skill/
└── SKILL.md      # 必需；frontmatter 声明 name/description
```

```markdown
---
name: ppt-workflow
description: 生成 PPT 的工作流。用户需要做演示文稿时使用。
---

# 流程
1. 收集内容…
2. 生成大纲…
```

安装：

```bash
amiba skill install ./my-skill
# 复制到 ~/.amiba/skills/my-skill
```

### 8.3 主题

```
my-theme/
├── amiba.theme.json
└── tokens.css
```

`amiba.theme.json`：

```json
{
  "name": "my-theme",
  "label": { "zh": "我的主题", "en": "My Theme" },
  "tokens": {
    "--amiba-color-primary": "#4D6BFE",
    "--amiba-radius-card": "12px"
  }
}
```

主题注册为 `kind: theme` 插件后，设置 → 外观自动出现选项。

## 9. 插件开发红线（吸取 DSH 生态经验）

1. **资源注册必须挂 `ctx.effect`**：工具、路由、监听、定时器、Slot 一律可 dispose。
2. **peerDependencies 用范围**：`^1.0.0` 或 `>=1.0.0 <2`，不锁具体 patch。
3. **Host 与 Client 分别构建**：出 UI 的插件必须同时产出 `lib/index.js` 与 `lib/client.js`。
4. **Client 不得持有秘密**：密钥只在 Host 半解析，Client 只收派生结果。
5. **提示词遵守缓存原则**：静态文本放 system/靠前 section；动态文本走消息尾；不要动态拼接 system 前缀。
6. **工具 schema 精简**：description 一句话，详情进 tool result 或引导文本。
7. **跨平台路径**：使用 `node:path`、`pathToFileURL`；命令执行用参数数组。
8. **错误结构化**：对浏览器返回 `{ ok: false, code, message }`；日志中不输出秘密。
9. **单一实例原则**：peer 依赖通过 profile 的 node_modules 共享，避免自己打包 `@amiba/kernel`。
10. **声明式优先**：能用 YAML 组合/preset 表达的能力，不写新代码。
