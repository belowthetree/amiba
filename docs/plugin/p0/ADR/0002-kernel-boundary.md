# ADR-0002 — 内核边界：`@amiba/kernel` 最小化

- 状态：已接受
- 日期：2026-08-14
- 关联：P1 拆分；耦合清单 C01/C02/C06/C14

## 背景

“一切皆插件”的前提是内核只提供机制、不提供业务。当前 `main.ts`、`App.vue`、`config/*`、`ai/*`、`tools/*`、`host/*` 相互直接 import，没有可卸载边界。必须现在划死内核边界，否则 P1 会再次膨胀为单体。

## 决策

`@amiba/kernel`（源码目录建议 `src/kernel/`）只允许以下模块：

| 模块 | 职责 | 备注 |
| --- | --- | --- |
| `context.ts` | `AmibaContext`：get/set/provide/effect/on/before | 浏览器主线程版 Cordis 语义 |
| `loader.ts` | 读取装配清单、解析插件声明、拓扑排序、实例化、dispose/reload | 插件不直接 import 文件 |
| `composition.ts` | 解析 `amiba.plugins.yaml` 的 insert/modify/remove/disabled/isolate | 纯函数，可单测 |
| `permissions.ts` | capability 仲裁：allow/deny、审计回调 | 只实现通用框架，不内置业务权限 |
| `events.ts` | 事件/waterfall 总线 | 统一现有多套订阅 |
| `logger.ts` | 结构化日志接口 + 输出适配器 | 迁移 `config/logger.ts`，去除 console monkey-patch 为唯一方式 |
| `env.ts` | 受控环境变量/运行环境访问 | 内部经 `@amiba/platform` 判断 tauri/harmony/browser |
| `schema.ts` | 插件 Config schema（zod 风格） | 不依赖具体业务字段 |
| `types.ts` | 插件契约公共类型 | |

`@amiba/platform` 作为内核依赖的**平台能力服务**，也属于最小信任集：

| 模块 | 职责 |
| --- | --- |
| `src/config/polyfill.ts` | 首行 polyfill |
| `src/config/platform-bridge.ts` | detectHost / nativeInvoke / nativeListen |
| `src/config/native-fs.ts` | FS 兼容 shim |
| `src/types/native-bridge.ts` | 命令协议注册表 |
| `src/app-lifecycle.ts` | 前台/后台生命周期事件 |

## 内核禁止事项（红线）

以下内容不得出现在 `src/kernel/`，只允许作为插件或内核服务包：

- 任何 Vue 组件、路由页面、页面导航顺序、Slot 宿主实现；
- `ai_*` 设置、provider、model、agent、session、memory、soul、skill 的业务逻辑；
- 服务注册表、ServicePackage、JSBridge handler、网络会话、Widget、后台服务；
- 主题变量、主题目录、任何 CSS 策略；
- i18n 语言包内容（i18n 运行时服务可以在内核，但字典必须在语言包插件）；
- 更新检查、市场、分享、归档等产品功能；
- 硬编码工具清单或工具集；
- 具体原生命令的业务语义（平台桥只按注册表转发）。

## 内核服务与普通插件的区别

| 项 | 内核服务 | 普通插件 |
| --- | --- | --- |
| 生命周期 | 由 kernel 直接装配，先于插件 | 由 loader 按装配清单装配 |
| 依赖 | 只依赖 kernel/platform | 可 inject 任何已注册服务 |
| 数量 | 固定白名单 | 不限 |
| 可禁用 | 否（平台桥、storage 原语等） | 是 |
| 示例 | `logger`、`events`、`permissions`、`env` | `@amiba/session`、`@amiba/theme`、`@amiba/ui-chat` |

首批内核服务固定为：`logger`、`events`、`permissions`、`env`、`storage`（低层 KV）、`platform`。`toolRegistry`、`pageRegistry`、`slotRegistry` 是通用注册表服务，建议放入 kernel 相邻的 `@amiba/registries` 包，不允许在 kernel 内定义具体工具/页面/槽位。

## 迁移规则

1. P1 创建 `src/kernel/` 时，CI 增加依赖方向检查（可用 ESLint `import/no-restricted-paths` 或自定义脚本）：
   - `src/kernel/**` 禁止 import `src/ai/**`、`src/host/**`、`src/pages/**`、`src/components/**`；
   - `src/ai/**` 禁止 import `src/pages/**`；
   - 页面只允许 import 服务接口，不允许 import 其他页面实现。
2. `main.ts` 重构后只保留：`import './config/polyfill'` → `createApp(App)` → `kernel.start()`；其中 `App` 由 shell 插件注册。
3. 现有全局单例（settings、toolRegistry、memoryStore、soulManager、providers、themeState）在 P1 先注册到服务容器；P2 起删除直接 import。

## 验收

- 删除 `src/ai`、`src/host`、`src/pages`、`src/components` 全部引用后，kernel + platform + shell 最小构建仍可通过（空壳启动）。
- 新增业务代码若 import 进 kernel，CI 失败并给出允许位置。
