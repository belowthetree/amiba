# P4 — 插件 SDK / CLI / 脚手架（进行中）

> 对应路线：`docs/plugin/plugin-migration-roadmap.md` 的 P4。
> Amiba 是 Vue/Vite SPA，无 Node Host；P4 的“SDK/CLI”服务于开发期与构建期，而非运行时 require。

## 步骤清单

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 建立 `@amiba/sdk`：类型化插件契约 + `defineAmibaPlugin()` 助手 | ✅ 已落地 |
| 2 | 创建示例插件（页面 + 设置 Slot + 工具）作为模板，默认不注册 | ✅ 已落地 |
| 3 | `scripts/create-amiba-plugin.mjs` 脚手架 | ✅ 已落地 |
| 4 | 本地插件装配层：`amiba.plugins.yaml` 读取 + base 层合并 | ✅ 已落地 |
| 5 | `amiba plugin` CLI（list/add/remove，写本地配置） | ✅ 已落地 |
| 6 | 插件校验：manifest / inject / provides / Slot / 页面路径检查 | ✅ 已落地 |

## 第 1 步目标

- 新增 `src/sdk/`：重导出内核与注册表类型。
- `defineAmibaPlugin()` 提供类型推断与基础校验，减少第三方插件手写错误。
- 不改任何现有运行逻辑。
