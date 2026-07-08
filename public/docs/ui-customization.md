---
title: 界面定制指南
description: 宿主 CSS 选择器速查表和 CSS 变量参考，修改界面外观前必读
keywords: [UI, 主题, 样式, CSS, 选择器, 变量, 定制, 颜色, 圆角]
category: platform
---

# 界面定制指南

本文档是 AI 定制宿主界面时的 CSS 选择器和变量速查表。修改任何界面样式前，**必须先读本文档**。

---

## CSS 选择器速查表

### 全局外壳 (App.vue)

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.app-shell` | 应用根容器 | 整个应用的 flex 容器，设背景色/字体在这里 |
| `.topbar` | 顶栏 | 顶部导航栏容器（含导航按钮和标题） |
| `.topbar-title` | 顶栏标题 | 居中显示的文字标题 |
| `.nav-btn` | 导航按钮 | 📱🏠⚙️ 三个导航按钮 |
| `.main-content` | 主内容区 | `<router-view>` 的滚动容器 |

### 首页 `/home`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.home-page` | 首页容器 | 首页整体，max-width 600px 居中 |
| `.welcome-card` | 欢迎卡片 | 蓝色渐变背景的大卡片 |
| `.app-title` | 主标题 | 欢迎卡片内的大标题（28px） |
| `.app-subtitle` | 副标题 | 欢迎卡片内的描述文字 |
| `.section` | 内容区块 | 每个功能区域的容器 |
| `.section-title` | 区块标题 | "系统功能"、"最近使用"等标题 |
| `.grid` | 卡片网格 | 功能入口卡片的 CSS Grid 容器 |
| `.feature-card` | 功能卡片 | 对话/服务/设置/记忆入口卡片 |
| `.feature-icon` | 功能图标 | 卡片内的 emoji 图标 |
| `.feature-name` | 功能名称 | 卡片内的功能名称 |
| `.feature-desc` | 功能描述 | 卡片内的描述文字 |
| `.recent-list` | 最近使用列表 | 最近服务列表容器 |
| `.recent-item` | 最近使用项 | 单个最近使用服务 |
| `.empty-hint` | 空状态区 | 无用户服务时的提示区域 |
| `.cta-btn` | CTA 按钮 | "去对话生成服务"按钮 |

### 聊天页 `/` (ChatPage)

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.chat-page` | 聊天页容器 | 聊天页整体 |
| `.chat-topbar` | 聊天顶栏 | 会话选择器 + 新建/统计按钮 |
| `.topbar-actions` | 顶栏操作区 | ＋和📊按钮容器 |
| `.session-selector` | 会话选择器 | 点击展开会话下拉 |
| `.session-title` | 会话标题 | 当前会话名称 |
| `.dropdown-arrow` | 下拉箭头 | ▾ 箭头 |
| `.session-dropdown` | 会话下拉 | 会话列表弹出面板 |
| `.session-item` | 会话项 | 下拉列表中单个会话 |
| `.session-item-title` | 会话项标题 | 会话列表中会话名称 |
| `.session-item-meta` | 会话项元信息 | 会话消息数+日期 |
| `.session-del` | 删除按钮 | 会话删除 ✕ |
| `.session-empty` | 空会话 | 无会话提示 |
| `.chat-messages` | 消息列表 | 消息滚动区域 |
| `.chat-empty` | 空状态 | 无消息时的提示区 |
| `.empty-icon` | 空状态图标 | 💬 emoji |
| `.hint` | 提示文字 | 空状态辅助文字 |
| `.message` | 消息容器 | 单条消息（含 role 类 .user / .assistant） |
| `.message-content` | 消息内容 | 消息正文文本 |
| `.message.user .message-content` | 用户气泡 | 用户消息（蓝底白字，右对齐，16px 圆角） |
| `.message.assistant .message-content` | AI 气泡 | AI 回复（白底黑字，左对齐，有阴影，16px 圆角） |
| `.message.tool .message-content` | 工具消息 | 工具调用（灰底小字，居中，12px 圆角） |
| `.message.error .message-content` | 错误消息 | 错误/警告（橙底，居中） |
| `.reasoning-block` | 思考块 | AI 思考过程折叠区域 |
| `.reasoning-content` | 思考内容 | 思考块内部文字 |
| `.chat-input-bar` | 输入栏 | 底部输入区域容器 |
| `.chat-input` | 输入框 | textarea 消息输入框 |
| `.send-btn` | 发送按钮 | 发送消息按钮 |
| `.stop-btn` | 停止按钮 | 中止流式输出按钮 |
| `.stats-btn` | 统计按钮 | 📊 状态统计按钮 |
| `.action-btn` | 操作按钮 | 顶栏＋新建会话按钮 |
| `.primary-btn` | 主按钮 | 确认/继续等主要操作按钮 |
| `.secondary-btn` | 次按钮 | 取消等次要操作按钮 |
| `.modal-overlay` | 模态遮罩 | 统计/确认弹窗的背景遮罩 |
| `.modal-box` | 模态框 | 模态弹窗容器 |
| `.modal-close` | 关闭按钮 | 模态框✕关闭 |
| `.stat-row` | 统计行 | 📊 统计弹窗中的一行 |
| `.stat-label` | 统计标签 | 统计项名称 |
| `.stat-value` | 统计数值 | 统计项数值 |
| `.stat-divider` | 统计分隔线 | 统计弹窗中的分隔线 |
| `.peer-item` | 设备项 | 局域网可见设备列表项 |

### 设置页 `/settings`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.settings-page` | 设置页容器 | 设置页整体 |
| `.page-title` | 页面标题 | 页面顶部标题 |
| `.tab-bar` | 标签栏 | 通用/技能/数据/日志 标签 |
| `.tab-btn` | 标签按钮 | 单个标签按钮 |
| `.settings-section` | 设置卡片 | 每个设置的卡片区块 |
| `.section-label` | 区块标题 | 卡片标题 |
| `.form-group` | 表单项 | 标签+输入框的容器 |
| `.form-input` | 输入框 | 所有输入框/下拉框/textarea 通用样式 |
| `.toggle-key` | 密码切换 | 👁🙈 按钮 |
| `.skill-list` | 列表容器 | 技能/供应商列表 |
| `.skill-item` | 列表项 | 单个技能/供应商条目 |
| `.skill-cards` | 技能卡片网格 | 技能展示的卡片布局 |
| `.skill-card` | 技能卡片 | 单个技能卡片 |
| `.skill-card-title` | 技能卡片标题 | 卡片内技能名称 |
| `.skill-card-desc` | 技能卡片描述 | 卡片内技能描述 |
| `.skill-card-actions` | 技能卡片操作 | 卡片底部操作按钮 |
| `.skill-edit-form` | 技能编辑表单 | 技能内联编辑区域 |
| `.skill-empty` | 空状态 | 无技能提示 |
| `.danger-btn` | 危险按钮 | 红色删除类按钮 |
| `.saved-hint` | 保存提示 | "✅ 已保存"浮动提示 |
| `.toggle-row` | 开关行 | LAN 可见性等开关行 |
| `.switch` | 开关 | 自定义 toggle 开关 |
| `.primary-btn` | 主按钮 | 主要操作按钮 |
| `.secondary-btn` | 次按钮 | 次要操作按钮 |
| `.progress-bar` | 进度条容器 | 下载/导入进度条 |
| `.progress-fill` | 进度条填充 | 进度条蓝色填充部分 |
| `.update-area` | 更新区域 | 版本检查+下载按钮区 |
| `.update-msg` | 更新消息 | 更新状态文字提示 |
| `.about-info` | 关于信息 | 版本号+作者信息 |
| `.log-file-list` | 日志文件列表 | 日志文件选择区 |
| `.log-file-item` | 日志文件项 | 单个日志文件条目 |
| `.log-table` | 日志表格 | 日志内容表格 |
| `.log-row` | 日志行 | 表格中单条日志 |

### 服务页 `/services`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.browse-page` | 服务页容器 | 服务浏览页整体 |
| `.header` | 页面头部 | 标题 + 导入/分享按钮行 |
| `.header-btns` | 头部按钮组 | 📂📡 按钮容器 |
| `.import-btn` | 导入按钮 | 📂 文件夹导入 |
| `.share-btn` | 分享按钮 | 📡 局域网分享 |
| `.count` | 计数徽章 | 服务数量标记 |
| `.svc-card` | 服务卡片 | 单个服务卡片 |
| `.card-icon` | 卡片图标 | 卡片内 emoji 图标 |
| `.card-name` | 卡片名称 | 卡片内服务名称 |
| `.card-desc` | 卡片描述 | 卡片内服务描述 |
| `.card-meta` | 卡片元数据 | 卡片内 ID 和版本号 |
| `.card-actions` | 卡片操作 | 卡片底部开关/按钮行 |
| `.toggle` | 开关 | 启用/禁用 toggle |
| `.service-list` | 系统服务列表 | 系统服务列表容器 |
| `.service-item` | 系统服务项 | 系统服务条目 |
| `.svc-icon` | 服务图标 | 系统服务 emoji |
| `.svc-name` | 服务名称 | 系统服务名称 |
| `.svc-desc` | 服务描述 | 系统服务描述 |
| `.svc-meta` | 服务元数据 | 系统服务版本/大小 |
| `.svc-badge` | 服务徽章 | 系统服务标记 |
| `.empty` | 空状态 | 无服务时的提示区域 |

### 记忆页 `/memory`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.memory-page` | 记忆页容器 | 记忆页整体 |
| `.subtitle` | 副标题 | 页面描述文字 |
| `.tabs` | 标签栏 | MEMORY.md / USER.md 切换 |
| `.tab` | 标签按钮 | 单个记忆标签 |
| `.tab-meta` | 标签元信息 | 字数统计（如 42/2200） |
| `.editor-area` | 编辑区 | 编辑器容器卡片 |
| `.memory-editor` | 编辑器 | textarea 编辑器 |
| `.editor-actions` | 操作按钮行 | 保存/还原/清除按钮容器 |
| `.preview-section` | 预览区 | 已有条目预览区域 |
| `.entry-list` | 条目列表 | 已保存条目预览列表 |
| `.entry-item` | 条目项 | 单条记忆预览 |
| `.entry-index` | 条目序号 | 条目编号 |
| `.entry-text` | 条目文字 | 条目正文 |
| `.entry-delete` | 删除按钮 | 条目删除 ✕ |

---

## CSS 变量参考

> 所有变量定义在 `:root` 中。修改后全局生效。

### 颜色

| 变量 | 默认值 | 影响区域 |
|------|--------|----------|
| `--color-primary` | `#1976D2` | 主色调：按钮、链接、欢迎卡片渐变、选中态 |
| `--color-primary-hover` | `#1565C0` | 主色按钮悬停态 |
| `--color-bg` | `#f5f5f5` | 全局页面背景色 |
| `--color-surface` | `#ffffff` | 卡片、顶栏、输入框等容器背景色 |
| `--color-text` | `#333333` | 全局正文文字颜色 |
| `--color-text-secondary` | `#999999` | 辅助文字、描述文字颜色 |
| `--color-success` | `#4CAF50` | 成功/确认类状态色 |
| `--color-warning` | `#FF9800` | 警告/提醒类状态色 |
| `--color-error` | `#F44336` | 错误/危险类状态色 |

### 圆角

| 变量 | 默认值 | 影响区域 |
|------|--------|----------|
| `--radius-sm` | `6px` | 小圆角：按钮、输入框、标签 |
| `--radius-md` | `10px` | 中圆角：卡片、面板 |
| `--radius-lg` | `16px` | 大圆角：模态框、欢迎卡片 |

### 阴影

| 变量 | 默认值 | 影响区域 |
|------|--------|----------|
| `--shadow-sm` | `0 1px 4px rgba(0,0,0,0.06)` | 轻微阴影：列表项、小卡片 |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.1)` | 中等阴影：弹出卡片、悬浮面板 |

### 字体

| 变量 | 默认值 | 影响区域 |
|------|--------|----------|
| `--font-size-xs` | `11px` | 极小：标签、徽标 |
| `--font-size-sm` | `13px` | 小：辅助说明、时间戳 |
| `--font-size-md` | `15px` | 正文：消息、表单内容 |
| `--font-size-lg` | `18px` | 大：小标题、卡片标题 |
| `--font-size-xl` | `24px` | 特大：页面主标题 |

### 间距

| 变量 | 默认值 | 影响区域 |
|------|--------|----------|
| `--spacing-xs` | `4px` | 极小间距：图标与文字之间 |
| `--spacing-sm` | `8px` | 小间距：列表项之间 |
| `--spacing-md` | `16px` | 中等间距：页面内边距、卡片内边距 |
| `--spacing-lg` | `24px` | 大间距：区块之间 |

### 组件专属

| 变量 | 默认值 | 影响区域 |
|------|--------|----------|
| `--topbar-bg` | 继承 `--color-surface` | 顶栏背景色 |
| `--topbar-text` | 继承 `--color-text` | 顶栏文字颜色 |
| `--card-bg` | 继承 `--color-surface` | 卡片容器背景色 |
| `--card-radius` | 继承 `--radius-md` | 卡片圆角大小 |
| `--input-bg` | `#ffffff` | 输入框背景色 |
| `--input-border` | `#dddddd` | 输入框边框颜色 |
| `--input-radius` | 继承 `--radius-sm` | 输入框圆角大小 |

---

## 插槽列表

以下插槽可通过 `ui_slot_set` 设置 HTML 内容，在界面指定位置插入自定义元素：

| 插槽名 | 位置 | 使用建议 |
|--------|------|----------|
| `topbar.left` | 顶栏标题左侧 | 快捷按钮、时钟、状态指示器。推荐宽 40-160px |
| `topbar.center` | 替换顶栏标题 | 搜索框、面包屑。设置后默认标题隐藏 |
| `topbar.right` | 设置按钮左侧 | 快捷操作按钮、通知图标。推荐宽 40-160px |
| `home.above-welcome` | 首页欢迎卡片上方 | 公告、自定义 banner |
| `home.below-features` | 功能卡片下方 | 快捷入口、统计面板 |
| `home.above-recent` | 最近使用列表上方 | 搜索框、筛选按钮 |
| `chat.above-messages` | 消息列表上方 | 快捷指令按钮、上下文提示 |
| `chat.below-input` | 输入框下方 | 快捷按钮、键盘快捷键说明 |
| `settings.extra` | 设置页末尾 | 自定义配置项、扩展功能入口 |
| `services.above-list` | 服务列表上方 | 搜索框、分类筛选、批量操作按钮 |

插槽内容为完整 HTML 片段，可包含 `<style>` 和 `<script>`（脚本用 IIFE）。

---

## 工作流程

修改界面时，遵循以下流程：

1. `ui_theme_view` — 查看当前主题状态
2. **3 种修改方式（按需选择）：**
   - **改主题变量** → `ui_theme_set_variable` / `ui_theme_set_variables`（改颜色/圆角/字体等全局变量）
   - **改自定义 CSS** → `ui_theme_set_css`（针对特定选择器，如 `.chat-page { background: #e8f5e9; }`）
   - **加界面元素** → `ui_slot_list` → `ui_slot_set`（在指定插槽位置插入 HTML）
3. 如果效果不理想，`ui_theme_reset` 恢复默认
