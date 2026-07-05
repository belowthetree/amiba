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
| 整体架构/模块关系 | `docs/architecture.md` |
| 开发环境/构建/命名/多语言 | `docs/development.md` |

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
