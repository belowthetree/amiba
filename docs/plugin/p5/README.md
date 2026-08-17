# P5 — 插件安全 / 管理 / 市场（进行中）

> Amiba 无远程 Node Host，因此 P5 聚焦本地插件供应链与运行时可见性，而非 DSH 的 HTTP 安装端点。

## 步骤清单

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 本地插件完整性：安装清单 + sha256 校验 + 安装事务/回滚 | ✅ 已落地 |
| 2 | `@amiba/plugin-manager` 服务：本地插件清单/装配状态查询 | ✅ 已落地 |
| 3 | `@amiba/ui-marketplace`：本地插件管理页（设置页签） | ✅ 已落地 |
| 4 | 权限审计：把 capability 检查接入 platform/storage 关键入口 | ✅ 已落地（基础接线） |
| 5 | 安全诊断页：权限声明、装配失败、完整性结果 | ✅ 已落地 |
| 6 | 插件包签名/校验（开发期可选，默认关闭） | ✅ 已落地 |

## 第 1 步目标

- CLI `add/remove` 具备事务性：安装失败自动回滚；移除前备份。
- 为 `src/plugins-local/<id>` 生成 `amiba.plugin.lock.json`（文件 sha256）。
- `npm run plugin:verify` 校验所有已安装插件文件未被篡改。
