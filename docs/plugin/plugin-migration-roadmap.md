# Amiba 全量插件化迁移路线

## 1. 目标与验收标准

目标不是“新增一个插件系统”，而是把 Amiba 重构为：

> 一个只包含最小内核的壳 + 一组可独立安装/卸载/替换的插件，其中官方功能与社区插件在机制上完全同权。

最终验收（Definition of Done）：

1. 内核代码不包含任何业务策略与 UI 组件；架构红线有自动化测试/依赖检查守护。
2. 任意非内核功能插件可被 `disabled: true` 或卸载，壳仍能启动并显示“该功能未安装”的空态。
3. 官方设置页、会话页、首页、市场页全部由 `settings.section`、`dashboard.*`、`conversation.*`、`marketplace.*` 等 Slot 装配；第三方可注册、排序、替换默认项。
4. 一个从未接触 Amiba 的开发者按 `plugin-development-guide.md` 能在 30 分钟内跑通一个“Host API + 设置页签 + 聊天区挂件”插件。
5. 安装、卸载、更新、回滚、reload 全部通过同一 PluginManager，CLI 与 GUI 行为一致。
6. 任何插件默认无权限；敏感能力必须声明并可在安装 UI 审阅。
7. 插件失败可隔离：单个插件 apply 崩溃不阻止其他插件；Client Slot 崩溃不拖垮整页。
8. 旧数据（配置、会话、凭据）迁移后完整可用。

## 2. 前置假设

- 当前 Amiba 具备可识别的“功能模块 + Web 界面 + 配置文件/数据目录”边界。
- 若现有代码无法立即拆分，本路线允许每阶段保留兼容层，但**不新增绕过插件的特例**。
- 技术基线：Node.js >= 20、TypeScript、React 18 Web GUI、npm/pnpm 包管理。
- 内核可以自研，也可以直接复用开源 Cordis 语义；复用优先，避免重复发明服务容器。

## 3. 阶段总览

| 阶段 | 名称 | 核心产出 | 建议周期 |
| --- | --- | --- | --- |
| P0 | 现状盘点与基线 | 模块清单、接口清单、基线测试 | 1 周 |
| P1 | 内核抽出 | `@amiba/kernel`、最小启动、YAML 装配 | 2–3 周 |
| P2 | 服务插件化 | 第一批 `@amiba/host-*` 服务插件 | 2–3 周 |
| P3 | 界面 Slot 化 | `@amiba/web-shell` + Slot 宿主 + 官方 UI 插件 | 2–3 周 |
| P4 | 插件 SDK/CLI | `@amiba/build-tools`、`amiba plugin`、脚手架 | 1–2 周 |
| P5 | 市场与安全 | marketplace 插件、权限系统、签名/回滚 | 2–3 周 |
| P6 | 硬化与 dogfood | 把剩余功能迁出、性能/安全/兼容测试、文档定稿 | 2–3 周 |

总计约 10–16 周（可按团队并行度压缩；P2/P3 可并行）。

## 4. P0：现状盘点与基线

产出：

- `docs/amiba-module-inventory.md`：现有功能模块、文件、数据流、UI 页面/组件清单。
- `docs/amiba-interface-inventory.md`：模块间内部接口、全局状态、配置/凭据/存储使用点。
- 自动化基线：端到端冒烟测试（启动、设置、会话、工具调用、导出等）。
- 架构决策记录（ADR）：内核边界、插件清单格式、Slot 命名、权限目录。

关键动作：

1. 将每个现有功能标注为 `kernel / host-service / ui / feature / data` 五类。
2. 找出所有“跨模块直接 import”“直接读 process.env”“直接读写全局文件”的耦合点。
3. 为现有配置/数据目录定义 Amiba Home 迁移映射。
4. 冻结用户可见行为，作为回归基准。

## 5. P1：内核抽出

### 5.1 目标

建立最小内核并让“空壳”能启动：

```
amiba --profile empty
```

`empty` profile 只包含 `@amiba/web-server`、`@amiba/web-shell` 和诊断页，不应包含任何会话/模型/工具业务。

### 5.2 产出

| 包 | 职责 |
| --- | --- |
| `@amiba/kernel` | Context、loader、realm、effect、事件、权限仲裁、日志 |
| `@amiba/schema` | Config schema（可基于 Schemastery 或 zod 兼容层） |
| `@amiba/cli` | `amiba run/profile/patch` 基础命令 |
| `@amiba/testing` | 测试宿主 |

### 5.3 迁移规则

- 先把现有进程入口改成“kernel + 临时官方大插件包”，保持行为不变。
- 新代码禁止进 kernel；CI 增加 `kernel-boundary` 检查：kernel 包不得 import 任何业务包。
- patch 写操作先只读支持，避免过早做事务写入。

### 5.4 退出标准

- 空 profile 启动成功。
- 同一插件可在两份不同 YAML 中装配出两个实例，配置互不串扰。
- `ctx.effect` 的卸载/重载测试通过（无残留路由、监听、定时器）。
- 插件缺失依赖时报错包含插件 id、缺失服务名与修复建议。

## 6. P2：服务插件化

### 6.1 目标

把现有功能模块转成 Host 服务插件，并定义第一批扩展点。

建议映射（按 Amiba 实际模块调整）：

| 现有功能 | 目标插件包 | 对外扩展点 |
| --- | --- | --- |
| Web 服务器 | `@amiba/host-webserver` | route/middleware/remote expose |
| 模型接入 | `@amiba/host-model` | provider 注册、model/config waterfall |
| Agent 循环 | `@amiba/host-agent` | agent spawn/followup、生命周期事件 |
| 会话存储 | `@amiba/host-session` | 会话 CRUD、事件流、导出 |
| 工具系统 | `@amiba/host-tools` | tool provide/invoke |
| Skill 系统 | `@amiba/host-skill` | skill source/loader |
| 命令 | `@amiba/host-commands` | command register |
| 设置/凭据 | `@amiba/host-settings` / `credentials` | namespace、credentialRef |
| 审批 | `@amiba/host-approval` | approval/request waterfall |
| 通知 | `@amiba/host-notifications` | channel 注册 |
| MCP | `@amiba/host-mcp-client` | server CRUD |
| 文件/沙箱 | `@amiba/host-filesystem` / `sandbox` | 受权限的 exec/fs |
| 市场 | `@amiba/marketplace` | PluginManager 服务 |

### 6.2 迁移规则

- 每拆一个模块：先建立接口包（类型 + 服务名 + 事件名），再迁移实现，最后删除旧代码。
- 旧模块可先整体包成插件（“黑盒插件”），行为稳定后再拆内部扩展点。
- 所有跨插件调用改为 `ctx.get` / `ctx.before` / 事件，不直接 import 实现类。
- 配置读写统一走 settings/credentials；禁止各模块自己扫 `process.env`。

### 6.3 退出标准

- `empty` profile + 任意一个服务插件可以单独启动。
- 第三方临时插件可注册一条路由、一个工具、一条命令并正确卸载。
- `credentials` 与 `env` 权限强制生效，恶意测试插件无法读取未声明密钥。

## 7. P3：界面 Slot 化

### 7.1 目标

Web GUI 变成“壳渲染 Slot，页面由插件装配”。

### 7.2 组件迁移映射

| 现有界面 | Slot 宿主插件 | 开放 Slot |
| --- | --- | --- |
| 整体布局/侧边栏/顶栏 | `@amiba/web-shell` | `layout.*` |
| 首页 | `@amiba/ui-dashboard` | `dashboard.*` |
| 设置页 | `@amiba/ui-settings` | `settings.*` |
| 会话页 | `@amiba/ui-conversation` | `conversation.*` |
| 工具/审批 UI | `@amiba/ui-tool` / `ui-approval` | `tool.*` / `approval.card` |
| 命令面板 | `@amiba/client-palette` | `palette.*` |
| 主题/语言 | `@amiba/ui-theme` / `ui-locale` | theme/locale 注册 |

### 7.3 迁移规则

- 任何官方页面组件先“原地 Slot 化”：宿主渲染 Slot 列表，官方组件作为 default 注册项。
- 第三方注册与官方注册走同一 `ctx.slots.register`；禁止 UI 宿主 `if (pluginId.startsWith('@amiba/'))` 特判。
- Slot 注入面只传数据/回调，不传大对象；需要共享状态使用 `SnapshotStore` + `hooks`。
- 样式只允许主题 token + 插件 scoped style；新增 token 走 theme 插件版本化流程。

### 7.4 退出标准

- 禁用 `@amiba/ui-settings` 后设置入口消失，但 shell 正常。
- 第三方插件可新增设置页签、聊天区挂件、输入区按钮，且与官方项按 `order` 稳定排序。
- Client 插件卸载后对应 Slot、样式、订阅全部清理。
- 单个 Slot 组件抛错有边界隔离，页面其余部分可用。

## 8. P4：插件 SDK 与 CLI

产出：

- `@amiba/build-tools`：`createAmibaClientConfig`，从 runtime 读取平台模块表。
- `create-amiba-plugin`：7 类脚手架（host-only/client-only/hybrid/tool/preset/skill/theme）。
- `@amiba/testing` / `@amiba/client-test-runtime`。
- CLI：`amiba plugin add/remove/list/update/reload/status`，与 GUI 共用 PluginManager。
- 文档：`plugin-development-guide.md` 的示例与 CI 模板。

退出标准：

- 脚手架生成项目 → `pnpm build` → `amiba plugin add link:...` → 浏览器可见 UI，全程无需手改平台模块表。
- 新开发者 30 分钟跑通最小 Host + Client 插件。
- CLI 安装结果与 GUI 安装结果可互换，`amiba patch diff` 能解释每个文件变化。

## 9. P5：市场与安全

产出：

- `@amiba/marketplace` + `@amiba/ui-marketplace`（自己作为插件安装）。
- 静态 registry CI（topic `amiba-plugin`）、CDN、搜索 API 兜底。
- 权限目录、安装 UI 权限摘要、用户收紧策略。
- 完整性哈希、签名索引、更新回滚点。
- 审计日志与安全诊断页。

退出标准：

- 从市场安装/更新/卸载插件全流程闭环。
- 安装含 `install.sh` 的仓库必须经过确认与最小 env，取消后无残留。
- 请求敏感权限的插件在安装前展示权限摘要，用户可拒绝单项。
- 恶意测试插件在默认策略下无法读密钥、无法全量读 env、无法安装其他插件。

## 10. P6：硬化与 dogfood

- 把剩余特殊功能（导出、导入、备份、升级器等）全部迁为插件。
- 压力/性能：100 个插件装配时间、启动失败恢复、Slot 渲染性能。
- 兼容矩阵：旧插件 apiVersion、双内核版本、无头/低权限 profile。
- 安全：依赖漏洞扫描、签名验证、模糊测试安装器。
- 文档定稿与架构红线检查纳入 CI：
  - kernel 不得 import 业务包；
  - 官方插件不得走非插件路径；
  - SlotMap 变更必须更新 minor/major；
  - manifest 权限目录变更必须 ADR。

## 11. 兼容与回滚策略

1. **双运行期**：P1–P3 期间新旧实现并存，通过 feature flag/profile 选择；每个阶段必须可回退。
2. **数据兼容**：会话、设置、凭据先以旧路径读取，插件服务写入新路径，迁移脚本保证双读/单写切换。
3. **配置兼容**：旧配置项映射为“兼容插件”的 Config 默认值；旧插件 API 可封装为适配插件。
4. **回滚**：每阶段保留“禁用该批插件即回到上一行为”的开关；插件更新必须可 `rollback`。
5. **失败演练**：每阶段至少一次故障演练——故意让核心插件 apply 失败，验证诊断页与恢复流程。

## 12. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 内核边界不断扩大 | 又变回单体 | CI 边界检查 + ADR + 每周内核 diff 评审 |
| Slot 过度碎片化 | 性能下降、难以维护 | Slot 分层治理：布局级稳定、页面级谨慎、组件级最小必要 |
| 插件间隐含依赖 | 卸载 A 导致 B 崩溃 | `inject`/`provides` 静态声明 + `amiba doctor` + 卸载影响分析 |
| 权限模型过松/过紧 | 安全事件或插件不可用 | 权限目录版本化，默认拒绝但提供快捷“开发者模式”仅限 link 插件 |
| 浏览器 bundle 契约不稳定 | 第三方插件频繁失效 | 平台模块表由 SDK 导出；SlotMap/remote 面 semver 管理 |
| 迁移期间体验回退 | 用户流失 | 行为基线测试 + 渐进切换 + 保持默认 profile 不变 |
| 市场成为攻击面 | 供应链投毒 | 脚本确认、哈希、签名、权限摘要、审计与回滚 |

## 13. 里程碑检查表

- [ ] P0 模块/接口清单与 ADR 完成
- [ ] P1 空 profile 启动，装配/卸载测试通过
- [ ] P2 所有核心功能至少“黑盒插件化”，扩展点类型包发布
- [ ] P3 所有官方页面 Slot 化，无硬编码特判
- [ ] P4 新插件 30 分钟开发闭环打通
- [ ] P5 市场安装 + 权限摘要 + 安全测试通过
- [ ] P6 剩余功能迁出，红线 CI 生效，方案文档与实现一致
