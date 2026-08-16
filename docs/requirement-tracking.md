# 需求追踪体系（Requirement Tracking）

## 概述

`src/ai/requirement-store.ts` + `src/tools/requirement.tool.ts` 实现两层需求追踪：

- **单服务层级**：每个生成的服务有独立的 `REQUIREMENT.md`
- **全局层级**：汇总所有服务需求的 `REQUIREMENTS.md`

## 数据模型

### 单服务 REQUIREMENT.md

```markdown
---
service_id: user.todo-app
service_name: 待办清单
version: 1.2.0
last_reviewed: 2026-06-28
status: active
priority: high
---

## 当前需求
- 优先级排序
- 截止日期提醒

## 待优化
- 移动端适配

## 用户反馈
- "希望加搜索框" (2026-06-25)

## 已完成需求
- ~~基础 CRUD~~ (v1.0)
```

### 全局 REQUIREMENTS.md

```markdown
---
updated_at: 2026-06-28
service_count: 5
---

## 活跃服务需求
### 待办清单 (user.todo-app) [high]
- 优先级排序
- 搜索框

## 潜在新服务机会
| 数据报表需求 | 数据仪表盘 |
```

## 触发机制

10 轮 nudge 中同时要求 memory 和 requirement 检查：

```
3. 需求检查（如果对话涉及已生成的服务）：
   - 新功能需求 → requirement_update(type="requirement")
   - 界面/体验优化 → requirement_update(type="optimization")
   - 用户反馈 → requirement_update(type="feedback")
   - 无法通过修改现有服务满足 → 标记 global_opportunity
```

## API

| 函数 | 说明 |
|------|------|
| `getServiceRequirement(id, name?)` | 读取或初始化单服务文档 |
| `addRequirement(id, name, section, content)` | 追加条目 |
| `markRequirementDone(id, name, content)` | 标记为已完成 |
| `removeRequirementEntry(id, section, content)` | 删除条目（任意分区） |
| `listServiceRequirements()` | 列出所有已有 REQUIREMENT.md 的服务文档 |
| `getGlobalRequirements()` | 读取全局汇总 |
| `syncGlobalRequirements()` | 扫描所有服务，重建全局文件 |
| `addGlobalOpportunity(desc, suggestedService)` | 追加潜在新服务 |

## 管理界面

记忆管理页（`/memory`）的「需求」Tab 提供浏览与管理：按服务卡片展示四个分区条目，
支持标记完成、删除条目、向「当前需求」手动追加；所有变更经上述 API 落盘并自动同步全局汇总。

## 工具

| 工具 | 说明 |
|------|------|
| `requirement_view(service_id)` | 查看单服务需求文档 |
| `requirement_update(service_id, type, content, global_opportunity?)` | 追加需求/优化/反馈/完成 |
| `requirements_summary()` | 查看全局需求汇总 |

## 新服务判定流程

```
用户提需求 → requirements_summary → 全局检查
  ├─ 现有服务可满足 → service_file_* 编辑
  ├─ 全局已有类似机会 → 参考设计
  └─ 全新需求 → generate_service + global_opportunity
```

## 存储

```
services/{id}/REQUIREMENT.md   ← 单服务（AI 写入）
services/REQUIREMENTS.md       ← 全局（自动同步）
```
