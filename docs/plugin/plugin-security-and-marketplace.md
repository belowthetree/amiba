# Amiba 插件安全与市场方案

## 1. 威胁模型

| 威胁 | 场景 | 对策 |
| --- | --- | --- |
| 恶意插件读密钥 | 插件扫描 `process.env` | 内核禁用全量 env；`ctx.env.get` 逐项仲裁 |
| 恶意插件访问本地文件 | 插件调用 fs 模块 | 不提供裸 Node 权限；文件访问走 `filesystem` 服务并声明能力 |
| 恶意插件伪造安装接口 | 浏览器跨站请求 Host | Host 白名单 + 自定义头 + Origin 校验 + 写队列 |
| 供应链投毒 | npm 包/安装脚本被替换 | 锁版本、完整性记录、脚本执行确认、最小环境变量 |
| 插件冲突导致进程崩溃 | 双 React/双内核实例 | 平台模块 external、peer 共享、`amiba doctor` 检测 |
| 恶意 UI 窃取会话内容 | Client 插件访问其他插件状态 | Slot 注入面最小化、remote 面按插件隔离 |
| 伪装官方插件 | scoped 包名近似 | 签名/来源校验、市场 badge 与 repository 双向校验 |
| 卸载残留 | 插件写散落文件、全局资源 | 全部资源经服务注册；安装清单记录落点；卸载 dry-run 报告 |

安全总原则：**默认拒绝，声明后最小授权，用户可审，行为可审计，失败可恢复。**

## 2. 权限模型

### 2.1 能力（capability）目录

| capability | 说明 | 默认 |
| --- | --- | --- |
| `kernel:lifecycle` | 调用 loader 安装/卸载/重载插件 | 拒绝 |
| `network:localhost` | 访问 loopback HTTP | 拒绝 |
| `network:host` | 访问指定 host（可带通配符） | 拒绝 |
| `network:any` | 任意网络 | 拒绝（需显式确认） |
| `fs:read` | 读取用户文件 | 拒绝 |
| `fs:write:cwd` | 写入当前工作目录 | 拒绝 |
| `fs:write:home` | 写入 `~/.amiba` 下插件私有目录 | 拒绝 |
| `env:read` | 读取指定环境变量 | 拒绝 |
| `env:all` | 读取全部环境变量 | 永不允许（内核 API 层直接不提供） |
| `credential:resolve` | 解析指定凭据引用 | 拒绝 |
| `settings:write:<ns>` | 写指定设置命名空间 | 拒绝 |
| `commands:execute` | 程序化执行其他命令 | 拒绝 |
| `tool:invoke` | 调用其他插件的工具 | 拒绝 |
| `remote:expose` | 向浏览器暴露 wire 面 | 拒绝 |
| `remote:access:<face>` | 访问其他插件公开 remote 面 | 拒绝 |
| `service:publish` | 向全局 realm 发布服务 | 拒绝 |
| `scheduler` | 注册定时/周期任务 | 拒绝 |
| `sandbox:exec` | 执行沙箱命令 | 拒绝 |
| `notifications` | 发送系统通知 | 拒绝 |

### 2.2 声明与收紧

插件在 `amiba.permissions` 中声明需要的最大能力；用户在 `amiba.patch.yml` 中只能收紧：

```yaml
- insert:
    - id: balance
      name: '@amiba/plugin-balance'
      permissions:
        allow:
          - network:host:api.deepseek.com
          - credential:resolve:DEEPSEEK_API_KEY
        deny:
          - network:any
```

用户策略优先级：`deny > profile allow > home allow > manifest 声明 > 默认拒绝`。

### 2.3 内核强制点

- `ctx.env.get(name)`：检查 `env:read:NAME`。
- `filesystem` 服务：每次调用检查路径前缀与 `fs:*` 能力。
- `credentials.resolve(ref)`：检查 `credential:resolve:REF`。
- `webServer.register`：无需能力（每个插件自有前缀），但远程写接口必须额外通过 Host 白名单。
- `loader` 调用：只有声明 `kernel:lifecycle` 的插件可触达；GUI 市场通过 Host 内部 API，而不是直接给浏览器 loader 权限。
- 所有敏感调用写入审计日志 `~/.amiba/logs/audit.jsonl`，设置页“安全”栏可查看。

### 2.4 权限提示（安装 UI）

安装插件前，市场展示人类可读的权限摘要：

```
该插件将请求：
- 访问 api.deepseek.com（HTTPS）
- 读取凭据 DEEPSEEK_API_KEY
- 注册设置页与聊天区挂件
不请求：文件访问、命令执行、插件安装
```

用户可逐项取消后安装；权限变更（插件升级）会再次提示并默认为“保持旧权限，不自动扩大”。

## 3. 插件签名与供应链

### 3.1 完整性记录

安装时记录：

```json
{
  "id": "balance",
  "package": "@amiba/plugin-balance",
  "version": "1.0.0",
  "source": "npm",
  "integrity": "sha512-...",
  "resolved": "https://registry.npmjs.org/...",
  "files": { "lib/index.js": "sha256-...", "lib/client.js": "sha256-..." },
  "permissions": { "allow": ["..."] },
  "installedAt": "2026-08-14T12:00:00Z"
}
```

启动时校验 `lib/` 关键文件哈希；不匹配时进入“已修改”状态并在诊断页提示（不自动阻断开发期 `link:` 安装）。

### 3.2 市场索引签名

- `registry.json` 由市场 CI 生成，附加 `registry.json.sig`。
- 客户端只把签名索引用于展示；安装始终从真实源拉取，并再校验包完整性。
- 官方/认证插件 badge 只基于签名与来源白名单，不基于仓库 star。

### 3.3 脚本执行防护

继承 DSH 市场已验证的实践：

1. 检测 `install.sh` / `install.ps1` / npm 生命周期脚本。
2. 执行前弹窗确认，展示脚本路径与摘要。
3. 脚本环境变量只包含基础系统变量 + 用户明确提交的材料。
4. npm 安装时剔除所有 `TOKEN/KEY/SECRET/PASSWORD/CREDENTIAL` 类环境变量。
5. 取消安装即清理缓存与临时目录；安装失败保留日志与可重试状态。
6. 默认不允许安装脚本写入 `~/.amiba` 之外的关键配置；需写 patch 时调用 PluginManager 而非自行改文件。

## 4. 插件市场架构

市场本身是插件（`@amiba/marketplace` + `@amiba/ui-marketplace`），因此“没有市场”也是合法 profile。

```
┌────────────────────────────────────────────────────────────┐
│ 数据源                                                      │
│   registry.json（GitHub topic:amiba-plugin，CI 2h 构建）     │
│     → CDN（jsDelivr）→ raw.githubusercontent → 搜索 API 兜底 │
├────────────────────────────────────────────────────────────┤
│ Host 半 @amiba/marketplace                                  │
│   /api/marketplace/list?refresh=1                            │
│   /api/marketplace/install   POST { repo, answers, scope }   │
│   /api/marketplace/uninstall POST { repo }                   │
│   /api/marketplace/update    POST { repo }                   │
│   /api/marketplace/self-update GET                           │
├────────────────────────────────────────────────────────────┤
│ 安装管线（PluginManager 服务统一执行）                       │
│   clone → 识别 kind → 扫描所需 env/credential → 用户确认     │
│   → 安装到目标 profile → 合并 patch → 写 installed.json      │
├────────────────────────────────────────────────────────────┤
│ Client 半 @amiba/ui-marketplace                             │
│   settings.section: "插件市场"                               │
│   搜索 / 分类 / 权限摘要 / 安装进度 / 已安装识别 / 更新提示   │
└────────────────────────────────────────────────────────────┘
```

### 4.1 类型识别

| 仓库特征 | kind | 安装位置 |
| --- | --- | --- |
| `SKILL.md` | skill | `~/.amiba/skills/<name>` |
| `amiba.preset.yml` + `agent.amiba.yml` | preset | `~/.amiba/presets/<id>` |
| `amiba.theme.json` | theme | `~/.amiba/themes/<id>` |
| `package.json` 含 `amiba` | plugin | 目标 profile 依赖 + patch |
| `install.sh` / `install.ps1` | script | 确认后执行（受 3.3 约束） |
| 其他 | resource/manual | 展示仓库信息，不自动安装 |

### 4.2 已安装判定

1. `installed.json` 安装记录。
2. profile 依赖与 `node_modules` 包名映射（含 scoped）。
3. `amiba.patch.yml` 装配行扫描。
4. `package.json` 的 `repository` 字段双向校验，防同名不同源。
5. 市场本体 `repository` 自识别。

### 4.3 版本与更新

- 已装版本：`installed.json`；历史安装读安装目录 `package.json`。
- 最新版本：registry 元数据（显示层）+ 目标源 `npm view`/git tag（确认安装层）。
- 仅 `package.json` 版本不一致时提示更新；更新等于“新版本安装 + 旧版本回滚点”。
- 更新前自动记录当前版本文件清单，失败可 `amiba plugin rollback <id>`。

## 5. Host 接口防护

所有写接口统一要求：

- 请求头：`X-Amiba-Plugin: <plugin-id>`。
- Host 白名单：loopback、RFC1918 私有网段、`AMIBA_ALLOWED_HOSTS` 显式追加。
- Origin 校验：与 Host 同源或白名单。
- 请求体大小上限（默认 1 MiB）。
- 写操作串行队列 + 临时文件 + 原子 rename + `.bak`。
- 错误响应不回显堆栈与凭据；错误 code 白名单。

## 6. 运行时隔离与崩溃恢复

- 插件默认运行在主进程（与 DSH 相同）；高风险插件可标记 `amiba.runtime: "worker"`，内核在 worker_thread 中加载，Host 服务通过 RPC 代理。
- 插件 apply 失败：跳过该 entry，其他插件继续启动。
- 插件运行期未捕获异常：记录 + 可配置“失败 N 次后自动禁用该装配行”。
- 热重载事务：新实例成功才切换；失败保留旧实例并返回 rollback 状态。
- Client 插件异常：Error Boundary 按 Slot 隔离，单个 Slot 崩溃不影响页面其他区域。

## 7. 审计与诊断

设置 → 安全提供：

- 最近敏感操作（凭据解析、文件访问、网络访问、插件安装）。
- 每个插件的权限声明、实际使用、最后活动时间。
- 装配树与失败原因。
- 一键生成诊断包（脱敏后的版本、配置、插件清单、日志摘要）。

CLI：

```bash
amiba security audit          # 检查权限、哈希、known-vulnerability 缓存
amiba plugin rollback <id>    # 回滚最近一次更新
amiba patch diff              # 显示配置改动
```

## 8. 与 DSH 市场实践对照

| 能力 | DSH-Plugins-Marketplace 现状 | Amiba 方案 |
| --- | --- | --- |
| 静态 registry + 搜索兜底 | 有 | 有 |
| 一键安装/已安装识别/更新 | 有 | 有 |
| 环境变量材料暂停输入 | 有 | 有 |
| 脚本确认 + 最小 env | 有 | 有 |
| Host/CSRF/DNS-rebinding 防护 | 有 | 有 |
| 卸载（删目录 + patch + 记录） | 有 | 有 |
| 权限声明与强制 | 无 | **有** |
| 包完整性哈希校验 | 无 | **有** |
| 更新回滚点 | 无 | **有** |
| 风险插件 worker 隔离 | 无 | **有（可选）** |
| 审计日志 | 部分 | **统一审计面** |
