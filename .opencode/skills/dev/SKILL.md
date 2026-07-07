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
| 整体架构/模块关系 | `docs/architecture.md` |
| 开发环境/构建/命名/多语言 | `docs/development.md` |
| 预置服务（public/services/） | 见下方「预置用户服务」节 |

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
| **不要设固定高度** | 面板自动适应内容高度（ResizeObserver），设 `height: xxx` 会导致留白或裁剪 |
| **不要设 `body` 样式** | `body` 的 margin/padding 由宿主 iframe 控制，在 `.widget-root` 上设置 |
| **背景色自管理** | 宿主面板背景透明，widget 必须设置自己的背景色 |
| **字体** | 使用系统栈：`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| **颜色变量** | 推荐使用宿主 CSS 变量：`var(--color-text)`、`var(--color-surface)` |
| **面板宽 280px** | 展开面板固定 280px 宽，内容自适应 |

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
