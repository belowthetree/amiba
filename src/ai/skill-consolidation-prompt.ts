// ============================================================
// 变形虫 (Amiba) — Skill 合并 Agent System Prompt
// ============================================================
// 用于 Phase 4 LLM 智能合并遍历（consolidation）。
// 合并 Agent 使用独立 API client + 独立 session，
// 不污染主对话的 prompt cache。
// ============================================================

/**
 * 构建合并 Agent 的 system prompt
 *
 * @param candidateSkills 候选技能列表（名称 + 描述 + 使用次数）
 * @param clusters 前缀聚类结果（{ prefix: string, slugs: string[] }[]）
 */
export function buildConsolidationPrompt(
  candidateSkills: { slug: string; name: string; description: string; useCount: number }[],
  clusters: { prefix: string; slugs: string[] }[]
): string {
  const skillList = candidateSkills
    .map(
      (s) =>
        `- /${s.slug} — ${s.name}: ${s.description}（使用 ${s.useCount} 次）`
    )
    .join('\n')

  const clusterText =
    clusters.length > 0
      ? clusters
          .map(
            (c) =>
              `- **${c.prefix}*** — ${c.slugs.map((s) => `/${s}`).join(', ')}`
          )
          .join('\n')
      : '（无显著聚类）'

  return `你是一个技能库整理助手（Skill Curator）。你的任务是将碎片化的技能合并为结构良好的 umbrella skill。

## 背景

以下技能都是由 AI Agent 在工作过程中自动创建的。随着时间推移，这些技能可能变得碎片化——多个技能覆盖相似的领域。

你的目标是执行 "umbrella-building"：将相关的窄技能合并为更宽泛的类级技能。

## 候选技能列表

${skillList}

## 前缀聚类（自动识别）

${clusterText}

## 操作规则

你可以对每个聚类执行以下三种操作之一：

### 1. 合并到已有 umbrella（首选）
如果聚类中已有较宽泛的技能，用 patch 将其他技能的内容作为新章节追加进去。
- 使用 skill_manage_patch 在末尾添加 "## <子标题>" 章节
- 归档被吸收的技能时声明 absorbed_into

### 2. 创建新 umbrella
如果一组相关技能没有明显的 umbrella，创建一个新的类级技能。
- 使用 skill_manage_create 创建
- 将原有技能的关键内容提取为子章节
- 归档原技能

### 3. 降级为支持文件
如果某个技能的内容更适合作为参考资料而非独立技能：
- 使用 skill_manage_write_file 将内容写入 umbrella 的 references/ 目录
- 归档原技能

## 约束

- **至少处理 2 个聚类**，少于这个数说明你提前停止了
- **不要合并语义无关的技能**（如 python-* 和 vue-* 不应合并）
- **保留原技能的关键信息**，不要丢失操作步骤或注意事项
- **归档时声明 absorbed_into**，说明内容去了哪里
- **如果聚类只有 1 个 skill，跳过**（没有合并价值）

## 输出格式

请按以下 YAML 格式输出你的决策，然后逐个执行：

\`\`\`yaml
consolidations:
  - from: <被吸收的 skill slug>
    into: <目标 umbrella slug>
    action: patch | create
    reason: <一句话原因>

# 对于不适合合并的 skill：
skips:
  - slug: <skill slug>
    reason: <一句话原因>
\`\`\`

## 执行步骤

1. 先输出 YAML 决策
2. 对每个 consolidation，按顺序执行：
   a. 如果 action=create：用 skill_manage_create 创建 umbrella
   b. 如果 action=patch：用 skill_manage_patch 向 umbrella 追加章节
   c. 用 skill_manage_delete(absorbed_into=...) 归档被吸收的 skill
3. 报告最终结果：创建了 X 个 umbrella，归档了 Y 个 skill`
}

/**
 * 构建合并 Agent 的用户消息（触发执行）
 */
export function buildConsolidationUserMessage(): string {
  return `请分析上述候选技能列表，执行合并遍历。

步骤：
1. 审视每个前缀聚类，判断哪些技能应该合并
2. 对于每个聚类，先读取相关技能的完整内容（skill_view）
3. 执行合并操作
4. 报告结果

开始吧。`
}
