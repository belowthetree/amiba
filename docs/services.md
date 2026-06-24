# 服务模型

## 服务概念

在变形虫中，"服务"是一个统一的抽象。系统内置功能和用户生成的迷你应用都是服务，它们通过统一的方式注册、切换和运行。

## 系统内置服务（6 个，不可变）

| 服务 | 路由 | 描述 |
|------|------|------|
| 首页 | `/` | 功能入口卡片 + 最近使用 |
| AI 对话 | `/chat` | 消息气泡 + 输入框，流式 LLM 对话 |
| AI 生成 | `/generate` | 输入需求 → 流式进度 → 生成服务包 |
| 设置 | `/settings` | API Key / Base URL / Model / 主题 |
| 我的服务 | `/my-services` | 已安装列表 + 开关 + 删除 |
| 记忆管理 | `/memory` | MEMORY.md / USER.md 查看管理 |

内置服务的 ID 以 `system.` 为前缀（如 `system.chat`），不可删除、不可禁用。

## 用户服务（动态，可变）

由 AI 生成或下载获得。每个服务是一个独立文件夹：

```
config/services/<service-id>/
├── manifest.json    # { id, name, version, permissions }
├── index.html       # 主界面
├── logic.js         # 业务逻辑
└── tasks.json       # 定时任务（可选）
```

在实际运行中，服务内容被序列化为单个 HTML 文件（内联 CSS/JS），通过 iframe 的 `srcdoc` 属性加载。

### manifest.json

```json
{
  "id": "user.hello_world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "基础示例",
  "permissions": ["notification"]
}
```

用户服务的 ID 以 `user.` 为前缀。

### 权限

| 权限 | 说明 |
|------|------|
| `storage` | 允许服务读写其专属的键值存储 |
| `notification` | 允许服务弹出 Toast 通知 |

## 服务注册

```
首次启动: 复制预置 demo → 注册到 ServiceRegistry
AI 生成:  写入 HTML 到 localStorage → 注册 → 首页可见
下载安装:  同上
```

### ServiceRegistry API

```ts
// 注册服务
registerService(manifest, 'ai-generated'): ServiceEntry

// 移除服务（仅用户服务）
unregisterService(id): boolean

// 启/禁用服务
toggleService(id, enabled): void

// 获取服务 HTML 内容
storeServiceHtml(id, html): void
getServiceHtml(id): string
```

## 服务运行

用户服务在 `service-container.vue` 中运行：

1. 根据路由参数找到对应服务
2. 检查服务是否存在且已启用
3. 加载服务的 HTML 内容
4. 在 `<iframe sandbox="allow-scripts">` 中渲染
5. 注入 `__amiba__` 全局对象建立 JSBridge
6. 根据 manifest 权限放行 API 调用

## 命名规范

- **服务 ID**: 内置 `system.xxx`，用户 `user.yyy`
- **配置键**: 全小写下划线 `ai_base_url`, `ai_model`
- **API 方法**: camelCase `setStorage`, `navigateTo`
