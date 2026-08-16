# P0 基线与测试计划（Baseline & Test Plan）

## 1. 目的

在任何插件化重构前，把“当前可工作状态”固化为可重复验证的基线。之后 P1–P6 每次大改都必须回到这里验证：构建、单测、桌面启动、核心页面冒烟。

## 2. 执行环境

| 项 | 预期 |
| --- | --- |
| Node | `node -v`（当前项目要求 >=18，实际建议 >=20） |
| npm | `npm -v` |
| Rust | `rustc -V`、`cargo -V` |
| Tauri | `npx tauri --version` |
| 分支/提交 | 记录 `git rev-parse HEAD` |
| 平台 | Windows 11（当前仓库位于 WSL 挂载的 `/mnt/e`，Tauri 构建建议在 Windows 侧执行） |

> 注意：本盘点环境无法执行 shell 命令，因此以下为待执行模板；执行后把结果回填到第 4 节。

## 3. 基线命令

```bash
# 0. 记录版本与提交
node -v && npm -v && rustc -V && cargo -V
npx tauri --version
git rev-parse HEAD
git status --short

# 1. 依赖与类型检查（生产构建已含 vue-tsc）
npm run build

# 2. 单元测试
npm test

# 3. 独立类型检查（若需要更细粒度）
npx vue-tsc -b

# 4. 桌面端构建（不安装，只验证编译）
cd src-tauri && cargo check && cd ..

# 5. 启动冒烟
npm run dev          # 浏览器 http://localhost:8484
# 另开终端：
cargo tauri dev      # 从 src-tauri 运行桌面端
```

### 3.1 建议记录指标

| 指标 | 记录方法 |
| --- | --- |
| `npm run build` 时间 | `time npm run build`（或 PowerShell `Measure-Command`） |
| `npm test` 用例数/通过数 | Vitest 输出尾部 |
| 主 bundle 大小 | `dist/assets/*.js` 体积总和与最大文件 |
| 启动到可交互 | 手工计时（dev / tauri dev） |
| Tauri 启动日志 | 保留终端输出片段 |

## 4. 基线结果记录

> 用户确认（2026-08）：本次 P0 未改动任何功能代码，所有功能正常。下表详细数值可选回填，不影响进入 P1。

| 项 | 结果 |
| --- | --- |
| 执行人 / 日期 |  |
| Git commit |  |
| Node / npm / Rust / Tauri 版本 |  |
| `npm run build` |  |
| `npm test` |  |
| `npx vue-tsc -b` |  |
| `cargo check` |  |
| 主 bundle 体积 |  |
| 异常/告警 |  |

## 5. 手工冒烟清单

浏览器 `npm run dev` 与 Tauri `cargo tauri dev` 分别执行，通过打 ✅。

### 5.1 启动与壳

- [ ] 应用打开无白屏，玻璃背景与边缘提示正常
- [ ] 首次启动完成 storage/config/registry/skills/theme 初始化日志无致命错误
- [ ] 无 API Key 时出现 API 设置引导，填写错误 Key 被拦截，正确配置后可关闭

### 5.2 主页面与手势

- [ ] `/registry` → `/services` → `/` → `/settings` → `/memory` 左右滑动顺序正确
- [ ] 边缘箭头可翻页；服务详情页 `/service/:id` 进入/返回正常
- [ ] 快捷页经 QuickFab 进入/退出正常
- [ ] ChatPage 在 keep-alive 下滑回不重挂载

### 5.3 服务（核心业务）

- [ ] 预置服务首次安装成功，服务列表显示正常
- [ ] 打开一个服务：iframe 沙箱运行、JSBridge `storage` 读写成功
- [ ] 服务 manifest 权限被正确门控（无权限模块调用返回错误）
- [ ] 删除服务后：后台 worker、悬浮块、文件授权、前台 handler 全部释放
- [ ] 服务版本归档/回滚可用

### 5.4 AI 与工具

- [ ] 默认 DeepSeek Responses 配置可对话，流式文本与推理正常
- [ ] 切换 chat 协议/其他供应商后对话正常
- [ ] 工具调用至少跑通：`service_list`、`memory`、`skill_view`、`doc_read`、`session_search`
- [ ] `/new` 创建新会话；多会话切换/删除正常；SQLite FTS5 搜索能命中旧会话
- [ ] 中止生成/步数限制继续生成正常

### 5.5 Skill / 记忆 / 人格

- [ ] 内置 Skill 列表可读；用户 Skill 导入、编辑、归档、删除正常
- [ ] MEMORY.md / USER.md 在记忆页可编辑；对话中 `memory` 工具写入后页面对应更新
- [ ] SOUL.md 创建/修改后新对话生效

### 5.6 主题 / Slot / i18n / 更新

- [ ] 三个内置主题可切换；修改内置主题自动创建用户副本
- [ ] 4 个 HTML slot（`chat.above-messages` / `chat.below-input` / `settings.extra` / `services.above-list`）设置后立即可见
- [ ] zh-CN / en 切换后主页面与设置页更新
- [ ] 检查更新：有更新提示正确，无更新提示“已是最新”；忽略版本后横幅消失

### 5.7 原生能力（仅 Tauri/真机）

- [ ] `web_fetch` 正常返回网页纯文本
- [ ] `web_browse` navigate/click/input_text/get_content/close + 截图浮层可用
- [ ] 局域网发现可开/关；两台设备服务分享收发成功
- [ ] Android 桌面卡片（如可用设备）注册/刷新/删除正常
- [ ] 文件夹选择授权后服务可读取文件

## 6. P0 基线通过定义

- `npm run build`、`npm test`、`npx vue-tsc -b`、`cargo check` 全部零失败。
- 浏览器端冒烟清单全部 ✅。
- Tauri 端 5.7 以外全部 ✅；5.7 因设备/网络原因未通过的逐项写明“未验证（原因）”。
- 结果回填第 4 节后，`p0/README.md` 状态更新为“P0 完成”。
