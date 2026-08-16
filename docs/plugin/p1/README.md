# P1 — 内核抽出（已完成）

> 对应路线：`docs/plugin/plugin-migration-roadmap.md` 的 P1。
> 原则：每一步都可独立编译/测试；默认装配结果与改造前一致。

## 步骤清单

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 创建 `src/kernel/`：context / loader / composition / events / permissions / logger + 单测 | ✅ 已通过验证 |
| 2 | 收编 `@amiba/platform`：polyfill / platform-bridge / native-fs / app-lifecycle | ✅ 已通过验证 |
| 3 | 把 `App.vue + router` 原样包成 `@amiba/ui-shell` 黑盒插件 | ✅ 已通过验证 |
| 4 | 新增 `@amiba/ui-diagnostics` 装配树页面 | ✅ 已通过验证 |
| 5 | 改造 `main.ts` 为 `kernel.start()`，默认装配与现状一致 | ✅ 已通过验证 |

## 第 1 步交付

```
src/kernel/
├── index.ts          # 公共出口
├── types.ts          # PluginManifest / PluginDefinition / 权限错误
├── events.ts         # 普通事件 + waterfall 总线
├── logger.ts         # 结构化日志接口 + console 适配器
├── permissions.ts    # capability 通配匹配 + 默认拒绝 + 审计
├── composition.ts    # amiba.plugins.yaml 解析与多层合并
├── context.ts        # ctx.get/set/provide/effect/on/before/fork/dispose
├── loader.ts         # inject/provides 拓扑装配、失败隔离、卸载/重载
└── kernel.test.ts    # 内核单测（含装配、清理、权限、事件）
```

## 第 5 步交付

```
src/kernel/start.ts                      # startKernel()：只装配，不 import 业务插件
src/plugins/registry.ts                  # 内置插件注册表（platform / ui-shell / ui-diagnostics / legacy-bootstrap）
src/plugins/legacy-bootstrap/            # 原 main.ts 全部初始化逻辑的黑盒插件
src/bootstrap.ts                         # startAmiba()：startKernel + 诊断页路由接入
src/main.ts                              # 缩减为 polyfill + void startAmiba()
```

默认装配顺序：`platform(10) → ui-shell(20) → ui-diagnostics(30) → legacy-bootstrap(90)`；legacy-bootstrap 按原顺序执行全部初始化，并从服务容器取 `uiShell/router/lifecycle` 挂载 Vue。诊断页以隐藏路由 `__amiba/diagnostics` 接入。

## 第 4 步交付

```
src/plugins/ui-diagnostics/
├── amiba.plugin.json        # provides: diagnostics / pages:[diagnostics]
├── index.ts                 # 诊断服务：component / path / title
├── DiagnosticsPage.vue      # 装配树 + 事件总线展示组件
└── ui-diagnostics.test.ts   # 服务注册单测
```

`ctx.get('diagnostics')` 返回 `{ component, path: '/__amiba/diagnostics', title }`。组件接收 `source: KernelDiagnosticsSource`（未来直接传 `KernelLoader`），当前不注册路由。

## 第 3 步交付

```
src/plugins/ui-shell/
├── amiba.plugin.json   # inject: [platform]，provides: uiShell / router
└── index.ts            # 原样导出 App.vue 与 router 服务
```

`ctx.get('uiShell')` 返回 `{ component: App, pageOrder: PAGE_ORDER }`；`ctx.get('router')` 返回现有 router 单例。尚未改动 `main.ts`，因此现有挂载路径不受影响。

## 第 2 步交付

```
src/plugins/platform/
├── amiba.plugin.json   # apiVersion=1，provides: platform / fs / lifecycle
├── index.ts            # 包装 config/polyfill、platform-bridge、native-fs、app-lifecycle
└── platform.test.ts    # 服务注册 + browser 宿主探测单测
```

`app-lifecycle.ts` 的 `initAppLifecycle()` 增加返回 `() => void` disposer；现有 `main.ts` 忽略返回值，行为不变。

## 第 1 步不做什么

- 不改 `main.ts`、`App.vue`、router 或任何业务模块。
- 不在 `src/kernel` 引入任何 `src/ai`、`src/host`、`src/pages`、`src/components` 依赖。
- 不实现插件文件发现/打包；loader 只接收已解析到内存的模块。

## 验证结果

- `npx vue-tsc -b` 通过
- `npm test` 通过
- `npm run build` 通过
- `npm run dev` 现有页面与功能正常
- 诊断页 `http://localhost:8484/__amiba/diagnostics` 可访问

## P1 退出结论

最小内核已可装配并接管应用启动；现有初始化逻辑暂时以 `legacy-bootstrap` 黑盒插件存在，行为与改造前一致。下一步进入 P2：把黑盒内的功能逐步拆成独立服务插件。
