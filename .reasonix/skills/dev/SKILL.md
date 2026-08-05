---
name: dev
description: 引导 agent 在任务前后阅读/更新项目开发规范文档，并沉淀经验教训，工作前必须阅读
---

# dev — 开发规范驱动与经验沉淀

在每次开发任务前后，引导 agent 阅读、遵循并更新项目的开发文档，形成"规范驱动开发 → 实践反馈 → 文档演进"的闭环。

## 工作流程

### 1. 任务开始：阅读相关规范

根据当前任务类型，从 `docs/` 目录找到并阅读对应的文档：

| 任务涉及 | 需阅读的文档 |
|----------|------------|
| AI 对话/Agent/记忆 | `docs/memory.md` |
| 服务生成/HTML 渲染 | `docs/ai-generation.md`、`docs/catalog.md` |
| iframe 沙箱/JSBridge | `docs/jbridge.md` |
| 服务注册/生命周期/归档 | `docs/services.md` |
| 服务版本归档 | `docs/development.md`（服务版本归档 节）、`src/host/service-archive.ts` |
| 局域网服务分享 | `docs/development.md`（局域网服务分享 节）、`src/host/service-share.ts` |
| 后台服务/BackgroundServiceManager | `docs/services.md`（后台服务 节）、`docs/jbridge.md`（background 模块）、`docs/development.md`（后台服务 节） |
| 文件访问/fileAccess API | `docs/jbridge.md`（fileAccess 模块）、`src/host/file-access-grants.ts` |
| 悬浮块/widget UI | `docs/services.md`（悬浮块 节）、`src/host/floating-widget-container.vue`、见下方「悬浮块 UI 规范」 |
| Widget 开发/AI 生成 widget | `public/catalog/skills/widget-dev/SKILL.md`（内置 Widget 开发 skill）、见下方「Widget 开发内置 Skill」节 |
| 安卓桌面卡片/系统桌面小组件 | `public/catalog/skills/desktop-widget-dev/SKILL.md`（内置桌面卡片开发 skill）、`docs/android-widget.md`、见下方「桌面卡片内置 Skill」节 |
| 整体架构/模块关系 | `docs/architecture.md` |
| 开发环境/构建/命名/多语言 | `docs/development.md` |
| 预置服务（public/services/） | 见下方「预置用户服务」节 |
| AI 生成代码/服务开发 | `public/catalog/skills/service-dev/SKILL.md`（内置服务开发 skill）、见下方「服务开发内置 Skill」节 |

如果同时涉及多个方面，先阅读最核心的 1-2 份文档，不要一次性全读。

### 2. 开发中：遵循规范

- 严格遵循 `docs/development.md` 中的命名规范、命令、项目结构约定
- 遵循 `AGENTS.md` 中的架构和编码约定
- 新增功能时，检查是否与 `docs/architecture.md` 中的设计哲学和边界（"不做的事情"）一致

### 3. 任务完成后：更新文档

完成开发后，根据实际变更决定是否需要更新文档：

- **代码结构变化**（新增模块、重构、职责转移）→ 更新 `docs/architecture.md` 和 `docs/development.md` 项目结构部分
- **API/协议变化**（JSBridge 方法、服务模型字段）→ 更新对应的 `docs/jbridge.md` 或 `docs/services.md`
- **AI 行为变化**（prompt 调整、生成策略、catalog 组件）→ 更新 `docs/ai-generation.md` 或 `docs/catalog.md`
- **开发流程变化**（新命令、新依赖、新规范）→ 更新 `docs/development.md`
- **Bug 修复中的经验教训** → 在相关文档末尾添加"经验教训"小节，或更新已有的经验条目

### 4. 经验沉淀

每次非平凡任务完成后，自问：

- 有什么踩坑经验值得记录？
- 有什么隐含假设后来被证明是错误的？
- 有什么代码模式被证明有效，应该固化为规范？

将答案以简洁的条目形式写入对应文档。格式：

```markdown
## 经验教训

- **YYYY-MM-DD**: 简要描述问题和解决方案。
```

如果文档已有"经验教训"小节，追加条目；否则在文档末尾新建该小节。

## 原则

- **读前做后**：先读规范再动手，做完后回写文档。
- **最小更新**：只更新真正变化的部分，不为了更新而更新。
- **具体 > 抽象**：记录具体的命令、路径、字段名，而非泛泛而谈。
- **中文为主**：与项目现有文档风格保持一致。

## 预置用户服务

当需要添加一个**应用安装后自动可用的用户服务**（如示例游戏、工具等），使用 `public/services/` 目录。

### 添加流程

1. 在 `public/services/{serviceId}/` 创建服务文件和 `manifest.json`（不用把 manifest 写到 index.json 里）。

2. 在 `public/services/index.json` 中注册：
   ```json
   {
     "services": [
       {
         "id": "user.xxx",
         "files": ["manifest.json", "index.html", "style.css", "app.js"]
       }
     ]
   }
   ```
   - `id` — 服务唯一标识，与目录名一致
   - `files` — 服务所有文件的相对路径列表（第一个必须是 `manifest.json`）

### 自动安装机制

- `src/host/registry.ts` 中的 `installPrebuiltServices()` 在 bootstrap 阶段被调用
- 下载 `public/services/index.json` → 逐个 fetch 文件 → 从 `manifest.json` 解析元数据 → `registerService()` + `storeServicePackage()`
- 已注册的服务检查 `getServicePackage()` 文件是否完整（files 非空）→ 不完整则自动重装
- `source` 字段标记为 `'builtin'`（区别于 `ai-generated` / `downloaded`）

### 关键约束

- **目录名 = serviceId**：fetch URL 路径 `/services/{serviceId}/{file}` 必须命中文件
- **manifest.json 与目录同级**：放在 `public/services/{serviceId}/manifest.json`，内容与标准导入包一致（含 `id`、`name`、`version`、`description`、`permissions`）
- **files 数组首项为 manifest.json**：确保安装器优先解析元数据
- **遵循 sandbox 约束**：不使用 `localStorage`/`alert()`/`confirm()`/外部 CDN

## 悬浮块 (Widget) UI 规范

生成或修改悬浮块 HTML 时，必须遵循以下约定：

### API 能力

Widget iframe 内可使用**全部 8 个 `__amiba__` API 模块**，与服务 iframe 完全一致：

| 模块 | 可用方法 |
|------|---------|
| `__amiba__.storage` | `set(key, data)`, `get(key)`, `remove(key)` |
| `__amiba__.showToast` | `(title, icon)` |
| `__amiba__.navigateTo` / `navigateBack` | `(url)` / `(delta?)` |
| `__amiba__.widgets` | `register(config)`, `remove(id)`, `show(id)`, `hide(id)` |
| `__amiba__.network` | `setVisibility`, `getVisibility`, `startDiscovery`, `stopDiscovery`, `getVisibleDevices`, `connect`, `startListening`, `stopListening`, session API |
| `__amiba__.background` | `start()`, `stop()`, `getState()`, `postMessage(msg)`, `onMessage(cb)`, `on(event, cb)` |
| `__amiba__.fileAccess` | `requestAccess(opts)`, `listFiles(token)`, `readText(token, path)`, `readBinary(token, path)` |
| `__amiba__.fetch` | `request({ url, method?, headers?, body? })` |

API 调用通过 `background-manager.ts` 的全局消息处理器路由，`BRIDGE_SCRIPT` 自动在 params 中注入 `serviceId`。

### 结构

```html
<!-- AMIBA_BRIDGE -->
<style>
  .widget-root { /* 根容器，不要设固定高度 */ }
</style>
<div class="widget-root">
  <!-- 内容 -->
</div>
<script>
  // 逻辑
</script>
```

### 样式约束

| 规则 | 说明 |
|------|------|
| **不要设固定宽高** | 面板宽高完全由 widget 内容驱动（ResizeObserver 自动测量），设死会导致留白或裁剪 |
| **由 `.widget-root` 控制尺寸** | 根容器自然宽度即为面板宽度，推荐用 `min-width` / `max-width` 约束而不设 `width` |
| **不要设 `body` 样式** | `body` 的 margin/padding 由宿主 iframe 控制，在 `.widget-root` 上设置 |
| **背景色自管理** | 宿主面板背景透明，widget 必须设置自己的背景色 |
| **字体** | 使用系统栈：`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| **颜色变量** | 推荐使用宿主 CSS 变量：`var(--color-text)`、`var(--color-surface)` |
| **宽度范围 180~400px** | 面板宽度由 widget 内容自然宽度决定，宿主角联 180~400px |
| **高度范围 60~520px** | 面板高度由 widget 内容自然高度决定，宿主角联 60~520px |

### 自动高度

宿主通过 `ResizeObserver` 自动监测内容高度并通过 `postMessage` 同步，无需手动调用。需要触发重新测量时改变 DOM 即可。

### 示例 (音乐播放器控件)

```html
<!-- AMIBA_BRIDGE -->
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .widget-root {
    padding: 10px 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #16213e;
    color: #eee;
    border-radius: 8px;
  }
  .track-info { font-size: 12px; color: #ccc; }
</style>
<div class="widget-root">
  <div class="track-info">未在播放</div>
  <!-- 内容 -->
</div>
<script>
  (function() {
    // 使用 __amiba__ API 与宿主/后台通信
  })();
</script>
```

## 后台服务开发模式

生成或修改后台服务时，遵循以下模式：

### background.json 配置

```json
{
  "entry": "background.js",
  "schedule": { "type": "interval", "intervalMs": 60000 },
  "onEvents": ["peer-discovered"]
}
```

### 后台入口文件模板

```js
// 接收前台/悬浮块指令
__amiba__.background.onMessage(function(msg) {
  switch (msg.action) {
    case 'play': /* ... */ break;
    case 'pause': /* ... */ break;
  }
})

// 向前台推送状态
__amiba__.background.postMessage({ type: 'state', playing: true })

// 监听定时器
__amiba__.background.on('tick', function(data) {
  // data.trigger: 'interval' | 'cron'
})

// 使用标准 API
await __amiba__.storage.set('key', value)
const v = await __amiba__.storage.get('key')
```

### 关键约束

| 规则 | 说明 |
|------|------|
| **前台先 start 再发消息** | 必须 `await __amiba__.background.start()` 后再 `postMessage` |
| **start 后验证状态** | `start()` 返回不代表就绪，建议再调一次 `getState()` 确认 `running: true` |
| **状态同步用 storage** | 悬浮块无法直接接收后台 `postMessage`，后台应写入 `storage`，悬浮块轮询 |
| **容量限制** | 最多 3 个并发，`settings.max_background_services` 控制 |
| **遵循架构** | 所有修改都需要遵循架构和设计理念 |

## 文件访问 API 使用模式

`fileAccess` 提供通用的磁盘文件访问，需 `fileAccess` 权限。

### 流程

```js
// 1. 请求授权（弹出 confirm，用户确认后获取 token）
var grant = await __amiba__.fileAccess.requestAccess({
  pattern: '{*.mp3,*.flac}',
  purpose: __amiba__.storage.get.bind ? '' : '扫描音乐文件'
})
// → { token, path, pattern }

// 2. 扫描文件列表
var files = await __amiba__.fileAccess.listFiles(grant.token)
// → [{ name, path, size, isDir }, ...]

// 3. 读取文件
var text = await __amiba__.fileAccess.readText(grant.token, 'readme.txt')
var b64  = await __amiba__.fileAccess.readBinary(grant.token, 'song.mp3')
```

### 关键约束

| 规则 | 说明 |
|------|------|
| **token 即生命周期** | token 仅本次应用生命周期有效（内存 Map），重启需重新 `requestAccess` |
| **path 不传则弹选择器** | `requestAccess({ path: undefined })` → 弹出系统文件夹选择对话框 |
| **token 绑定 serviceId** | 不同服务各自独立授权，token 不可跨服务使用 |

## 服务开发内置 Skill

`public/catalog/skills/service-dev/SKILL.md` 是 **AI 生成服务代码的权威规范**，包含：

- 权限选择指南（storage / notification / widgets / network / background / fileAccess / fetch）
- HTML/JS/CSS 规范、Manifest 规范、Files 规范
- Sandbox 约束（禁止 localStorage / alert / 外部 CDN）
- Widget 开发完整规范（8 模块 API 全支持）
- Chart.js / Vue 3 使用规范
- P2P 网络服务开发模板
- 常见错误清单（含 Vue 专项）
- 服务迭代修改工作流

当用户要求开发/创建/修改服务时，**必须先 `doc_read("service-dev.md")` 或通过 skill 系统查阅此规范**。

此外 `public/catalog/skills/p2p-network/SKILL.md` 提供 P2P 网络开发专项指南，`public/catalog/skills/widget-dev/SKILL.md` 提供 Widget 开发专项指南，`public/docs/` 下有 `widgets.md`、`jbridge.md`、`network.md`、`sandbox.md` 等参考文档。

## Widget 开发内置 Skill

`public/catalog/skills/widget-dev/SKILL.md` 是 **AI 生成 Widget 代码的权威规范**，包含：

- Widget 概述（与服务主页面的差异对比表）
- widget.json 配置规范（trigger/lifecycle 模式详解）
- HTML 模板硬约束（尺寸、背景、字体、Bridge 占位符）
- 完整 8 模块 API 能力说明（storage / notification / ui / widgets / network / background / fileAccess / fetch）
- 编程式 API（运行时动态注册）
- 完整示例（基础笔记 + 进阶音乐播放器控件）
- 常见错误清单 + 检查清单

当用户要求开发/创建悬浮块/快捷页面时，**必须先查阅此规范**。

## 桌面卡片内置 Skill

`public/catalog/skills/desktop-widget-dev/SKILL.md` 是 **AI 生成安卓系统桌面卡片的权威规范**，包含：

- 与悬浮块（widget-dev）的区别对比（系统桌面 vs 应用内，勿混淆）
- **默认全局卡片**（`desktop_widget_create`，无权限要求）；服务卡片仅当用户明确要求、需共享服务数据、或随服务分发时（`services/{id}/desktop-widgets/{cardId}/`）
- widget.json 字段（layout: lines / bigText / image、size 尺寸档位 small/medium/large、样式字段 accentColor/backgroundColor/textColor/hideTitleBar、tapPath、updateIntervalMin）
- logic.js 沙箱约束（仅 `desktopWidget.publish` / `desktopWidget.renderHtml` + `storage`，10s 超时，恰好 publish 一次）
- publish 数据格式（title / icon / lines ≤6×60 字 / image / imageData（renderHtml 自定义卡面）/ footer / 样式覆盖）
- AI 管理工具（`desktop_widget_create` / `list` / `enable` / `refresh` / `delete`）
- 完整示例（记账本最近支出卡片）+ 常见错误清单 + 检查清单

当用户要求把内容「放到手机/系统桌面」时，**必须先查阅此规范**。服务卡片权限为 `desktopWidgets`（勿写成 `widgets`；全局卡片无需权限）。宿主侧实现参考 `docs/android-widget.md`。
