# ADR-0004 — UI Slot 体系与权限执行模型

- 状态：已接受
- 日期：2026-08-14
- 关联：耦合清单 C03/C04/C05/C08/C13；`plugin-extension-points.md` 需按本 ADR 落地为 Vue 版

## 背景

当前 Amiba 有两种 UI 扩展：

1. 4 个 HTML 字符串 Slot（`chat.above-messages`、`chat.below-input`、`settings.extra`、`services.above-list`），由 `theme/slots/*.html` 驱动；
2. 硬编码页面/组件树，没有宿主插件 Slot。

HTML Slot 对 AI/用户服务非常合适，但对宿主插件来说没有类型、没有生命周期、不能注入 Vue 组件。必须双层设计。

## 决策一：Slot 分两层

### 1. `service.slot.*` — 沙箱 HTML Slot（兼容层，冻结）

- 保持现有 4 个 slot 的存储位置与 `SlotRenderer.vue` 行为不变；
- 命名加前缀语义：`service.slot.chat.above-messages` 等，但兼容读取旧目录；
- 只允许沙箱服务/AI `ui_slot_*` 工具写入，不允许宿主插件写入；
- 安全增强：P1 给 `SlotRenderer` 加大小上限、CSP 说明与“脚本执行”开关（默认开以兼容现有行为，未来可收紧）。

### 2. `ui.slot.*` — 类型化 Vue Slot（宿主插件专用，新建）

统一描述符：

```ts
export interface UISlotRegistration<Name extends keyof UISlotMap> {
  name: Name
  id: string                       // `${pluginId}:${localId}`
  order?: number
  component: Component             // Vue 组件
  label?: () => string
  icon?: string
  locale?: string
  inject?: UISlotInject<Name>      // 业务注入面，由宿主定义
  replaceDefault?: boolean
}

export interface UISlotHandle {
  dispose(): void
  update(patch: Partial<UISlotRegistration>): void
}
```

`@amiba/ui-slots` 提供：

```ts
ctx.slots.register(reg, component)  // 返回 handle
ctx.slots.inject(name, effect)      // 宿主就绪时执行注册 effect
ctx.slots.get(name, id)
ctx.slots.list(name)
```

所有注册必须经 `ctx.effect`，卸载即清理。

### 3. 首批 `UISlotMap`（直接映射现有界面）

| Slot | 宿主 | 运行时参数 | 说明 |
| --- | --- | --- | --- |
| `ui.slot.app.global` | App shell | - | 全局浮层/横幅（更新横幅迁移至此） |
| `ui.slot.app.bootstrap` | kernel | - | 启动期 UI effect |
| `ui.slot.chat.above-messages` | ui-chat | `{ session }` | 与 HTML slot 同位置，Vue 版 |
| `ui.slot.chat.below-input` | ui-chat | `{ session }` | 与 HTML slot 同位置 |
| `ui.slot.settings.section` | ui-settings | - | 设置页签 |
| `ui.slot.settings.card` | ui-settings | `{ section }` | 设置卡片 |
| `ui.slot.services.above-list` | ui-services | `{ registry }` | 服务列表上方 |
| `ui.slot.memory.tab` | ui-memory | - | 记忆页 Tab（需求 Tab 迁移） |
| `ui.slot.page` | ui-shell/pageRegistry | `{ route }` | 独立页面注册的组件渲染点 |
| `ui.slot.dialog` | ui-shell | `{ dialog }` | 全局对话框扩展 |

新增 Slot 必须进入 `UISlotMap` 类型；删除/改参数升级 minor/major 并保留兼容期。

## 决策二：页面注册表

页面是 Slot 之外的第二类 UI 扩展，因为路由/导航顺序/手势/预览需要结构数据：

```ts
export interface PageRegistration {
  id: string
  path: string
  name: string
  component: Component
  title: () => string
  icon?: string
  order?: number          // 参与 PAGE_ORDER
  keepAlive?: boolean
  preview?: Component     // 手势预览；缺省复用 component
}

ctx.pages.register(page)  // 返回 handle
```

内核 shell 从 `ctx.pages.list()` 生成：

- vue-router 路由；
- `PAGE_ORDER`；
- 手势目标与预览组件表；
- keep-alive include 列表。

内置页面迁移后声明自己的 order（registry=10、services=20、chat=30、settings=40、memory=50），行为与现版本一致。

## 决策三：权限执行模型

### 1. 主线程插件权限

- 插件 manifest 声明 `permissions.allow`；`amiba.plugins.yaml` 用户 overlay 只能 `deny`/缩小，不能扩大。
- kernel `permissions.check(pluginId, capability, target?)` 在以下入口强制：
  - `ctx.env.get`
  - storage 服务（按 `storage:*` 路径域）
  - `nativeInvoke`（按命令 → capability 映射表）
  - `credential:resolve`
  - registry 注册点（`tool:register` / `page:register` / `slot:register` / `command:register`）
- 默认拒绝；审计日志记录 capability、插件 id、时间、目标与结果。

### 2. 沙箱服务权限

- 继续使用 `ServiceManifest.permissions`（`storage/notification/widgets/network/background/fileAccess/fetch/ai/tools/desktopWidgets`）。
- 服务 manifest 权限只对 iframe JSBridge 生效，不授予主线程能力。
- 宿主插件若访问 `serviceRegistry` 修改服务，需要 `service:manage` 能力。

### 3. 原生命令 → capability 映射（v1）

| 命令族 | capability |
| --- | --- |
| `download_file/cancel_download` | `update:install` |
| `service_http_request` | `network:https` |
| `search_sessions/index_message*/get_session/list_sessions_cmd/delete_session_cmd/scroll_session/read_session_cmd` | `session:db` |
| `web_*` | `web:fetch` / `web:browse` |
| `network_*` | `network:lan` / `network:session` |
| `read_tombstone` | `fs:diagnostics` |
| `android_widget_*` | `widget:desktop` |

该映射表放在 `src/types/native-bridge.ts` 同级的 capability 注册表中，鸿蒙壳同步实现。

### 4. 凭据

- 现有 `settings.api_key` 与 `AiProvider.apiKey` 迁入 `credentials` 服务；
- UI 只显示“已配置/未配置”，写穿不回显；
- `credential:resolve:<ref>` 逐引用授权；
- 兼容期保留旧存储键，由 credentials 迁移读取，设置页改为写 credentials。

## 验收

- 任意宿主插件可注册 `ui.slot.chat.below-input` 且卸载后无残留。
- 页面注册表生成的 `PAGE_ORDER` 与当前 `['/registry','/services','/','/settings','/memory']` 一致。
- 现有 4 个 HTML slot 行为不回退。
- 未声明 `credential:resolve` 的测试插件读取不到密钥。
- 原生命令映射表被 `nativeInvoke` 强制执行，未授权调用返回结构化错误。
