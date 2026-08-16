# ADR-0001 — Amiba 插件运行时模型：浏览器原生内核 + Vite 装配

- 状态：已接受
- 日期：2026-08-14
- 决策者：Amiba 插件化 P0
- 关联：`plugin-architecture.md`（需按本 ADR 修正其 Node/npm/profile 描述）

## 背景

原插件方案直接借鉴 DeepSeek Harness，假设存在一个 **Node Host 进程** 与一个浏览器 Client。但 Amiba v0.10.4 实际是：

- Vue 3 + Vite 单页应用，全部宿主逻辑运行在 WebView/浏览器主线程；
- 没有 Node 服务端、没有 `~/.dsh` 用户目录、没有 npm require 运行时；
- 原生能力由 Tauri（Rust）命令提供；
- 已有 iframe 沙箱服务模型承载“用户生成的小应用”。

照搬 DSH 的 Host/Client 双半插件会引入一个本不存在的服务端，违背 Amiba “宿主 thin、离线优先、Web 原生”的架构哲学。

## 决策

**采用“浏览器原生插件内核 + 构建期/本地包装配”的模型。**

### 1. 插件运行在浏览器主线程

每个 Amiba 插件是一个前端 ESM/TS 模块（可含 Vue 组件），统一契约仍为：

```ts
export const name: string
export const inject?: string[]
export const Config?: Schema<Config>
export function apply(ctx: AmibaContext, config: Config): void
```

`@amiba/kernel` 提供与 Cordis 语义一致的 Context：`get / set / provide / effect / on / before / logger / permissions / env`。内核本身运行在主线程，不创建 Node 进程。

### 2. 没有 Node Host 半 / Client 半之分

DSH 的 “Host 插件 + Client bundle” 在 Amiba 中合并为单个前端插件：

- 业务逻辑直接在主线程执行；
- 需要原生能力时，通过 `@amiba/platform` 的 `nativeInvoke/nativeListen` 访问 Tauri/鸿蒙 capability；
- 不引入 iframe 或 worker 作为默认宿主插件运行时（高风险插件后期可声明 `runtime: 'worker'`，不在 P0 范围）。

### 3. 插件来源分三类

| 来源 | 装载方式 | 适用 |
| --- | --- | --- |
| 内置官方插件 | 仓库内 `src/plugins/*`，Vite `import.meta.glob` 构建期发现 | 首批迁移的官方功能 |
| 本地开发插件 | `amiba plugin dev link:<path>` 生成虚拟模块，Vite dev/build 注入 | 开发者 |
| 已安装第三方插件 | AppData `amiba/plugins/<id>/plugin.mjs`，由插件 CLI 预先打包为浏览器 ESM bundle；构建时生成 `amiba.generated-plugins.ts` 注册表后打包进应用 | 用户安装 |

P0 只承诺第 1 类。第 2、3 类的最终形态在 P4 用可运行原型验证，核心约束是：

- 不执行未经 CSP 与哈希校验的远程代码；
- 安装动作在应用外由 CLI 完成，或应用内由市场插件调用 `pluginManager` 后要求用户重启生效；
- 不承诺“任意时刻热加载任意 JS”。

### 4. 配置文件

用户插件选择采用 `{AppData}/amiba/amiba.plugins.yaml`（仅浏览器可见的装配数据）：

```yaml
- insert:
    - id: balance
      name: '@amiba/plugin-balance'
      config: {}
      disabled: false
```

保留 YAML 补丁语义与 DSH 相似，但 `name` 解析目标是“已打包进应用或已安装到 `amiba/plugins/` 的插件 id”，不是 Node `require()` 包名。

### 5. “Host/Client 通信”映射

原方案中的 Host-Client 通信在 Amiba 中对应三条已有通道：

| DSH 概念 | Amiba 映射 |
| --- | --- |
| Host 插件注册 HTTP 路由 | 主线程服务 `ctx.router` / `ctx.commands` / `ctx.tools` / `ctx.services` |
| Client 插件 Slot 注册 | `@amiba/ui-slots` Vue Slot 注册表 |
| Client 经 HTTP 调 Host | 主线程直接调用服务；跨 iframe 仍走 JSBridge |
| 凭据不出 Host | 凭据只在主线程 `credentials` 服务内，服务 iframe/插件 UI 均不可直接读取 |

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
| --- | --- |
| A. 引入 Node Host 进程，完全复刻 DSH | 增加部署面与常驻进程，破坏离线/单机定位；改动量相当于重写产品 |
| B. 所有宿主插件也放进 iframe 沙箱 | 宿主功能需要深度访问 Vue 状态、路由、工具与原生桥；iframe postMessage 只能表达异步 API，无法低成本替换现有页面与工具 |
| C. 不用内核，只继续加 Slot | 无法解决 bootstrap、生命周期、依赖注入与卸载问题，只是继续打补丁 |

## 影响

- `plugin-architecture.md` 中目录布局、profile、npm 安装、Host/Client 双产物章节需在 P1 前修订为“浏览器内核版”。
- `plugin-development-guide.md` 的构建链从 tsdown 双 bundle 改为 Vite 插件打包；脚手架仍可保留相似命令。
- `deepseek-harness-plugin-research.md` 保持原样，作为参考而非最终实现。
- 所有 Amiba 官方插件包名从 `@amiba/host-*` / `@amiba/client-*` 调整为 `@amiba/*` 单包，仅保留平台边界包 `@amiba/platform`。
