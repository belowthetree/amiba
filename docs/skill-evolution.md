# 技能进化体系（Skill Evolution）

> 基于 Hermes 三层架构（Curator + usage.json + skill_manage），适配 Amiba 技术栈。

## 三层架构

```
Agent 工具层（前台）
  skill_manage_create/patch/edit/delete/write_file
        ↓
遥测层（旁路）
  skills/.usage.json — use/view/patch 计数 + 状态
        ↓
Curator 层（后台）
  确定性 prune（active→stale→archived）+ 可选 LLM 合并
```

## Phase 1: Agent 写入

5 个 `skill_manage_*` 工具，位于 `src/tools/skill-manage.tool.ts`：

| 工具 | 说明 |
|------|------|
| `skill_manage_create` | 创建新 SKILL.md |
| `skill_manage_patch` | 精确查找替换（首选修改方式） |
| `skill_manage_edit` | 完整重写（仅重大重构） |
| `skill_manage_delete` | 归档到 `.archive/`，可声明 `absorbed_into` |
| `skill_manage_write_file` | 添加 references/templates/scripts |

**安全门控**：内置技能（counter/todo/notes/service-dev）只读，不可修改。

## Phase 2: 使用遥测

`src/ai/skill-usage.ts` 管理 `skills/.usage.json`：

```json
{
  "skill-slug": {
    "created_by": null | "agent",
    "use_count": 0,
    "view_count": 0,
    "patch_count": 0,
    "last_used_at": "...",
    "state": "active" | "stale" | "archived",
    "pinned": false
  }
}
```

| 函数 | 触发点 |
|------|--------|
| `bumpUse(slug)` | skill 被加载到对话 |
| `bumpView(slug)` | skill_view 工具被调用 |
| `bumpPatch(slug)` | skill_manage_patch/edit 被调用 |

## Phase 3: Curator 生命周期

`src/ai/skill-curator.ts` 在应用启动时自动检查：

```
active ──(未使用 > 30 天)──→ stale
stale  ──(未使用 > 90 天)──→ archived（移到 .archive/）
stale  ──(再次使用)───────→ active（自动复活）
```

- Pinned 技能不受管理
- 内置技能永不修改
- User-created（created_by=null）默认不自动归档
- 每次运行写入 `skills/.curator-logs/{timestamp}/report.json`

## Phase 4: LLM 智能合并（可选）

`src/ai/skill-consolidation-prompt.ts` — `consolidateEnabled: true` 时启用：

1. 收集 agent-created skills
2. 前缀聚类（vue-*, python-* 等）
3. 独立 LLM Agent 决策：合并到 umbrella / 创建新 umbrella / 降级为支持文件
4. 执行合并 → 归档被吸收的 skill

使用独立 API client，不污染主对话 prompt cache。

## 存储布局

```
skills/{slug}/SKILL.md          ← 技能内容
skills/.usage.json              ← 遥测数据
skills/.archive/{slug}/         ← 归档技能
skills/.curator_state           ← Curator 调度状态
skills/.curator-logs/           ← 运行报告
```

## Phase 5: Skill 审查（SkillReviewer）

`src/ai/skill-reviewer.ts` — 独立审查引擎，在多个触发点 fork 独立 LLM 调用，分析对话内容并自动维护 skill 库：

| 触发点 | 时机 | 行为 |
|--------|------|------|
| `session_end` | `/new` 切换会话时审查旧会话 | 全面审查，可创建/修补/删除 skill |
| `manual` | 用户输入 `/review` 命令 | 同 session_end |
| `mid_session` | 会话超过 20 轮后每 20 轮触发 | 只修补明显错误，不创建新 skill |
| `curator` | 7 天 curator 运行时附带 | 检查长期未用 skill 是否需归档/合并 |

**审查规则（优先级）**：
1. **PATCH** 已存在的 skill（错误/过时/用户纠正）
2. **CREATE** 新 skill（5+ 步复杂任务、可复用技巧）
3. **DELETE** 过时 skill（被另一个完全取代）
4. **不操作**（对话太短、纯查询）

**最小消息阈值**：5 条。通过 `settings.skill_auto_review_enabled`（默认 `true`）控制开关。

### UI 反馈

- `manual` 和 `session_end` 触发时，聊天界面会显示 `🔍 正在整理技能库...` 消息，禁用输入框
- 审查完成后显示汇总消息（`✅ 创建 X 个 / 修补 Y 个 / 删除 Z 个`）
- `mid_session` 和 `curator` 为纯后台执行，不打扰用户
- 并发防护：同一时间只允许一个审查运行

### 响应式状态

`src/ai/skill-reviewer.ts` 导出两个模块级 `ref`，ChatPage 直接监听：

```ts
export const isReviewing: Ref<boolean>     // 审查进行中
export const lastReviewResult: Ref<ReviewResult | null>  // 最近结果
```
