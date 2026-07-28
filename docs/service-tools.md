# 服务向 AI 提供工具（Service-Provided Tools）

> 状态：**Phase 1 已实现**（运行时注册 + tool-call 通道 + 动态 svc 工具集 + 权限/开关/校验 + 设置 UI）。
> 核心实现：`src/host/service-tools.ts`（窄腰）、`bridge.ts`（tools API + tool-call/tool-result）、
> `toolsets.ts`（dynamic 工具集）、`service-tools.test.ts`（16 项单测）。Phase 2 见文末。

## 概述

让 iframe 沙箱中的服务可以声明并注册自己的工具，主聊天 AI 在对话中可发现、调用它们；调用经 JSBridge 路由到服务内执行，结果回流到 Agent 工具循环。例如番茄钟服务暴露 `start_timer` / `get_stats`，用户对 AI 说"帮我开始一个 25 分钟番茄钟"即可触发。

这是现有能力方向的**反向通道**：目前是 AI 用宿主工具操作服务文件（service_file_*）、服务经 `ai` 模块调用 AI（service-ai）；本设计让 **AI 能调用服务运行时暴露的能力**。

## 设计目标

- **动态注册**：服务运行时经 JSBridge 注册工具，handler 活在 iframe 内；工具随服务存活而出现/消失，下一条 AI 消息即生效
- **窄腰复用**：服务工具统一汇入全局 `ToolRegistry`，继承现成的错误隔离、结果截断、`checkFn` 门控；agent.ts / system-prompt.ts 零改动
- **最小授权**：新权限 `tools`（AI→服务方向，与 `ai` 服务→AI 方向正交）；readonly/sensitive 双层 + 用户逐服务开关，仿照 `SERVICE_AI_TOOLS` 模式
- **沙箱不破**：宿主只做路由与校验，不执行服务代码；调用全程经 postMessage，超时与异常全部隔离为 JSON error

## 现状盘点（设计依据）

- AI 工具全部宿主侧静态注册：`ToolRegistry`（src/tools/tool-registry.ts）+ 静态 `TOOLSETS`（src/tools/toolsets.ts）；每次 `streamChat` 调用经 `toAISdkTools()` 现建工具集（agent.ts）——动态工具下一条消息即可生效
- JSBridge 两个方向：service→host 请求/响应（`api`/`api-response`），host→service **单向事件**（`event`，无响应）——缺的原语是 host→service 请求/响应通道
- 工具 schema 走 API 的 tools 参数，不进 system prompt（system-prompt.ts 注释），动态工具不破坏 stable 层缓存
- `ServiceContext`（src/host/service-context.ts）统一管理每服务运行时资源（bridge/session/widget），是工具注销的天然收口点
- 权限按 module 名在 `createBridge` 逐条检查；服务设置已有 `aiConfig` 开关 + readonly/sensitive 白名单模式可仿照

## 架构

```
┌─ 服务 (iframe) ──────────────────────────────┐
│  __amiba__.tools.register([{                 │
│    name, description, parameters, level,     │
│    handler: async (args) => result           │
│  }])                                         │
│  __amiba__.tools.unregister([name])          │
└──────────┬───────────────────────────────────┘
           │ api/tools/register（权限检查 'tools'）
┌──────────▼───────────────────────────────────┐
│  bridge.ts（BRIDGE_SCRIPT + tool-call 监听）  │
│  service-container.vue / background-manager  │
│    └─ 建桥时注入 callServiceTool              │
│                                              │
│  service-tools.ts（服务工具窄腰，新模块）      │
│  · 工具表 Map<serviceId, Map<name, entry>>   │
│  · 校验 → 同步进 ToolRegistry（toolset='svc'）│
│  · AI 可见名 svc_<serviceId>__<tool>         │
│  · ServiceContext.destroy() 收口注销          │
└──┬───────────────────────────────────────────┘
   │ toAISdkTools 每次现取 dynamic toolset 'svc'
   ▼
┌──────────────────────────────────────────────┐
│  streamChat（agent.ts 零改动）                │
│  LLM tool_call → registry.dispatch           │
│    → callServiceTool → tool-call/tool-result │
│    → JSON.stringify → 截断 → 回填工具循环     │
└──────────────────────────────────────────────┘
```

核心决策：**运行时注册是执行真相**（handler 只能活在 iframe 里），manifest 静态声明 `aiTools` 只做发现层（设置页展示、service-validator 一致性校验）。v1 只有"服务运行中"的工具对 AI 可见。

## JSBridge 协议扩展（关键新原语）

新增一对消息类型（不走 `event`，因为需要响应）：

- host→iframe：`{ type: 'tool-call', requestId, tool, args }`
- iframe→host：`{ type: 'tool-result', requestId, result, error }`

- 宿主侧 `createBridge` 返回值增加 `callServiceTool(tool, args)`：pending map + 30s 超时（与 `callHost` 一致），iframe 销毁时批量 reject
- BRIDGE_SCRIPT 内部维护 `toolHandlers` 表 + `tool-call` 消息监听（参照现有 `ai-event` 分发模式）
- 权限门控加一条 `tools` module 检查

### 服务侧 API

```js
__amiba__.tools.register([
  {
    name: 'start_timer',                 // ^[a-zA-Z0-9_-]{1,32}$
    description: '开始一个番茄钟',        // ≤ 512 字符
    parameters: {                        // JSON Schema object
      type: 'object',
      properties: { minutes: { type: 'number' } },
    },
    level: 'sensitive',                  // readonly(默认开) | sensitive(默认关)
    handler: async (args) => {
      // …执行服务内逻辑…
      return { ok: true, endsAt: '…' }   // 任意可 JSON 序列化的值
    },
  },
])
__amiba__.tools.unregister(['start_timer'])  // 可选；服务卸载时宿主自动清理
```

## 宿主侧模块设计

### 新文件 `src/host/service-tools.ts`（服务工具窄腰）

- **工具表**：`Map<serviceId, Map<localName, { decl, callServiceTool }>>`。前台容器（service-container.vue）与后台 worker（background-manager.ts）建桥时注入 `callServiceTool`；服务卸载时整体清除
- **注册即同步进 ToolRegistry**：`toolset: 'svc'`，handler 闭包 = `callServiceTool` → `JSON.stringify(result)`；复用 registry 现成的错误隔离与 `maxResultSizeChars` 截断（默认 8000 字符）
- **AI 可见名**：`svc_<sanitize(serviceId)>__<tool>`，如 `svc_user_pomodoro__start_timer`。serviceId 清洗（`.`→`_`）后截断 24 字符 + tool 32 字符，总长 ≤62，满足 OpenAI 工具名 `^[a-zA-Z0-9_-]{1,64}$`；`svc_` 前缀杜绝与内置工具及跨服务撞名
- **description 自动前缀** `【服务名】`，给模型服务上下文
- **注册校验**：name 正则、description ≤512、parameters 必须是 JSON Schema object、每服务 ≤8 个工具、单次 args ≤16KB；非法条目拒绝并在 api-response 回执错误
- **checkFn 门控**：服务实例存活 + 用户总开关开启 +（sensitive 工具）逐项已授权

### toolsets.ts 动态化（最小侵入）

- `TOOLSETS` 加 `svc: { tools: [], dynamic: true }`；`chat.includes` 加 `'svc'`
- `resolveToolset` / `toAISdkTools` 遇到 `dynamic: true` 时改从 `toolRegistry` 按 toolset 现取名字
- 其余链路（agent.ts、system-prompt.ts、agent-runner.ts）零改动

### ServiceContext.destroy() 增加一步

注销本服务全部 svc 工具（含调用中 pending 的批量 reject）。

## 权限与用户控制

- **新权限 `'tools'`**：manifest 声明，意为"服务向 AI 暴露工具"。与 `ai`（服务调用 AI，花钱/读对话）正交——风险模型不同，独立授权。`Permission` 类型、`ServiceRequest.module` 枚举、bridge 权限块同步加
- **manifest 新增可选 `aiTools?: ServiceToolDecl[]`**（无 handler 的纯元数据），用于设置页展示与校验
- **服务设置弹窗**（现有 🤖 aiConfig 处）新增「AI 工具」区：总开关（`toolsConfig.enabled`，声明即默认启用）+ 工具列表（名称/描述/级别，来自 manifest 静态声明）+ sensitive 工具逐项开关——完全仿照 `SERVICE_AI_TOOLS` 双层模式
- **service-validator** 加一致性校验：声明 aiTools 必须有 `tools` 权限；有权限无声明给出提示

```ts
interface ServiceToolDecl {
  name: string                     // ^[a-zA-Z0-9_-]{1,32}$
  description: string
  parameters?: Record<string, any> // JSON Schema；缺省 = 无参空 schema
  level?: 'readonly' | 'sensitive' // 缺省 readonly
}
```

## 生命周期矩阵

| 场景 | 行为 |
|---|---|
| 服务前台打开 | 建桥 → register → 下一条 AI 消息起工具可见 |
| 离开服务页 | `ServiceContext.destroy` → 工具消失 |
| 后台运行中 | background worker 的桥同样接线，工具可用 |
| 服务未运行 | `checkFn` false，工具不进 tools 参数（不出现、不报错，最省 token） |
| 调用中服务卸载 | pending 调用立即 reject → registry 错误隔离返回 JSON error |
| 服务删除 | `destroyServiceRuntime` 收口清理 |

## 服务内嵌 AI（service-ai）的关系

- 服务自身工具**不进** `SERVICE_AI_TOOLS` 白名单（那是宿主工具清单）；服务在自己 UI 里本就能直接执行自身逻辑，无需绕 AI
- Phase 2 可考虑把"仅本服务自身工具"注入其内嵌 AI 会话，让服务内聊天也能用自己的工具

## 分阶段实施

### Phase 1（MVP）

运行时注册 + host→service 通道 + 动态 svc 工具集 + 权限/开关/校验 + 文档。

| 文件 | 改动 |
|---|---|
| `src/types/service.ts` | `Permission + 'tools'`；`ServiceToolDecl`；`ToolsConfig`；`tool-call`/`tool-result` 消息类型 |
| `src/host/bridge.ts` | BRIDGE_SCRIPT 的 `tools` API + `tool-call` 监听；`createBridge` 返回 `callServiceTool`；权限块加 `tools` |
| `src/host/service-tools.ts`（新） | 工具表 + registry 同步 + 校验 + 命名 |
| `src/host/service-tools.test.ts`（新） | 16 项单测：命名/校验/门控/路由/注销/caller 守护 |
| `src/tools/toolsets.ts` | dynamic 工具集支持；chat includes 'svc' |
| `src/host/service-context.ts` | destroy 收口注销工具 |
| `src/host/service-container.vue` | apiHandler 处理 tools 模块；建桥注入 callServiceTool |
| `src/host/background-manager.ts` | 后台 worker 同样接线 |
| `src/host/registry.ts` + 服务设置 UI | `toolsConfig` 持久化与开关 |
| `src/ai/service-validator.ts` | 声明/权限一致性校验 |
| 文档 | 本文档；docs/jsbridge.md；public/docs/ 服务侧文档；service-dev skill；AGENTS.md |

### Phase 2（后续）

- **未运行服务自动拉起**：调用命中静态声明但无实例 → 复用 background-manager 隐藏 iframe 冷启动（等 register 握手，10s 超时），空闲 N 分钟回收
- **服务内嵌 AI 注入自身工具**：service-ai 白名单外叠加"仅本服务工具"通道
- **Widget 支持 tools 模块**：Phase 1 未接线（全局处理器无 tools case，widget 内调用 register 会收到 Unknown module 错误），需要 widget 销毁时注销工具的生命周期钩子

## 关键取舍

- **运行时注册而非纯 manifest 声明**：handler 必须活在 iframe 里，纯静态声明无法执行；运行时注册天然与代码同步，不会有"声明了但没实现"的漂移。静态声明只保留发现价值
- **v1 不自动拉起未运行服务**：冷启动握手 + 生命周期回收复杂度高，且"AI 悄悄启动一个服务"有用户感知问题；先要求用户明确打开服务，Phase 2 再评估
- **不复用 `ai` 权限**：`ai` 是服务→AI 方向（花钱、读对话），`tools` 是 AI→服务方向（触发服务动作），风险模型不同，独立授权
- **未运行即不可见（而非可见但报错）**：避免模型反复尝试调用不存在的实例浪费 token；设置页展示已满足能力发现
