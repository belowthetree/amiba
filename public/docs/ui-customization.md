---
title: 界面定制指南
description: 宿主 CSS 选择器速查表和 CSS 变量参考，修改界面外观前必读
keywords: [UI, 主题, 样式, CSS, 选择器, 变量, 定制, 颜色, 圆角]
category: platform
---

# 界面定制指南

本文档是 AI 定制宿主界面时的 CSS 选择器和变量速查表。修改任何界面样式前，**必须先读本文档**。

---

## 主题模型

变形虫使用多主题系统：

```
theme/
  default/  dark/  ocean/   ← 内置主题（只读，不可修改）
  我的主题/                  ← 用户自建（可修改可删除）
slots/                       ← 插槽内容，全局共享
```

内置主题不可直接修改。修改内置主题的 CSS 变量或自定义 CSS 时，系统自动创建用户主题副本。切换主题用 `ui_theme_switch`，管理主题用 `ui_theme_list/create/delete`。

---

## CSS 变量参考

> 所有变量定义在 `App.vue` 的 `:root` 中。修改后全局生效。
> 完整列表也可通过 `ui_theme_view` 的 `css_variable_reference` 字段获取。

### 颜色

| 变量 | 默认值 | 影响区域 |
|------|--------|----------|
| `--color-primary` | `#1976D2` | 主色调：按钮、链接、选中态、欢迎卡片渐变 |
| `--color-primary-hover` | `#1565C0` | 主色按钮悬停态 |
| `--color-primary-light` | `#E3F2FD` | 主色浅底：选中项背景、标签背景 |
| `--color-bg` | `#f5f5f5` | 全局页面背景色 |
| `--color-surface` | `#ffffff` | 卡片、顶栏、模态框、面板等容器背景 |
| `--color-text` | `#333333` | 全局正文文字颜色 |
| `--color-text-secondary` | `#999999` | 辅助文字、描述、元信息 |
| `--color-text-muted` | `#ccc` | 极弱文字：占位符、箭头、禁用态 |
| `--color-success` | `#4CAF50` | 成功/确认类状态色 |
| `--color-success-light` | `#E8F5E9` | 成功浅底 |
| `--color-warning` | `#FF9800` | 警告/提醒类状态色 |
| `--color-warning-light` | `#FFF3E0` | 警告浅底 |
| `--color-error` | `#e53935` | 错误/危险/删除类状态色 |
| `--color-error-dark` | `#c62828` | 错误深色：删除按钮悬停 |
| `--color-error-light` | `#ffebee` | 错误浅底 |
| `--color-border` | `#e0e0e0` | 边框、分隔线 |
| `--color-border-light` | `#f0f0f0` | 弱边框、行底分隔 |
| `--color-divider` | `#f5f5f5` | 列表项底部分隔 |
| `--color-hover-bg` | `#f0f0f0` | 悬停/按下态背景 |
| `--color-disabled` | `#ccc` | 禁用态（按钮、输入框） |
| `--color-on-primary` | `#ffffff` | 主色背景上的文字 |
| `--color-tool-msg-bg` | `#F3F4F6` | 工具调用消息背景 |
| `--color-tool-msg-text` | `#6B7280` | 工具调用消息文字 |
| `--color-scrollbar-thumb` | `#c0c0c0` | 滚动条滑块 |

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

---

## CSS 选择器速查表

### 全局外壳 (App.vue)

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.app-shell` | 应用根容器 | flex 容器，设背景色/字体在这里 |
| `.topbar` | 顶栏 | 顶部导航栏容器 |
| `.topbar-title` | 顶栏标题 | 居中文字标题 |
| `.nav-btn` | 导航按钮 | 📱🏠⚙️ 按钮 |
| `.nav-btn:active` | 按钮按下态 | 导航按钮按下时背景 |
| `.home-btn` | 主页/服务按钮 | 📱🏠 按钮的附加类 |
| `.settings-btn` | 设置按钮 | ⚙️ 按钮的附加类 |
| `.main-content` | 主内容区 | router-view 滚动容器 |
| `.page-enter-active` / `.page-leave-active` | 页面过渡 | 路由切换动画时长 |
| `.page-enter-from` | 入场起始 | 透明度 0 + 右移 20px |
| `.page-leave-to` | 退场结束 | 透明度 0 + 左移 20px |
| `::-webkit-scrollbar-thumb` | 滚动条滑块 | 可通过 --color-scrollbar-thumb 调色 |

### 首页 `/home`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.home-page` | 首页容器 | max-width 600px 居中 |
| `.welcome-card` | 欢迎卡片 | 蓝色渐变背景大卡片 |
| `.app-title` | 主标题 | 28px 大字 |
| `.app-subtitle` | 副标题 | 描述文字 |
| `.section` | 内容区块 | 功能区域容器 |
| `.section-title` | 区块标题 | "系统功能"等标题 |
| `.grid` | 卡片网格 | CSS Grid 布局 |
| `.feature-card` | 功能卡片 | 对话/服务/设置/记忆入口 |
| `.feature-icon` | 功能图标 | emoji |
| `.feature-name` | 功能名称 | -- |
| `.feature-desc` | 功能描述 | -- |
| `.recent-list` | 最近使用列表 | -- |
| `.recent-item` | 最近使用项 | -- |
| `.recent-icon` | 服务图标 | 📦 |
| `.recent-name` | 服务名称 | -- |
| `.recent-arrow` | 箭头 | → |
| `.empty-hint` | 空状态区 | 无用户服务提示 |
| `.cta-btn` | CTA 按钮 | "去对话生成服务" |

### 聊天页 `/` (ChatPage)

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.chat-page` | 聊天页容器 | -- |
| `.chat-topbar` | 聊天顶栏 | 会话选择器区域 |
| `.topbar-actions` | 顶栏操作区 | ＋📊 按钮容器 |
| `.session-selector` | 会话选择器 | 点击展开下拉 |
| `.session-title` | 会话标题 | -- |
| `.dropdown-arrow` | 下拉箭头 | ▾ |
| `.session-dropdown` | 会话下拉 | 弹出面板 |
| `.session-item` | 会话项 | -- |
| `.session-item.active` | 当前会话项 | 高亮态 |
| `.session-item-title` | 会话项标题 | -- |
| `.session-item-meta` | 会话项元信息 | 消息数+日期 |
| `.session-del` | 删除按钮 | ✕ |
| `.session-empty` | 空会话 | 无会话提示 |
| `.chat-messages` | 消息列表 | 滚动区域 |
| `.chat-empty` | 空状态 | 无消息提示 |
| `.empty-icon` | 空状态图标 | 💬 |
| `.hint` | 提示文字 | -- |
| `.message` | 消息容器 | 含 role 类 .user / .assistant |
| `.message-content` | 消息正文 | -- |
| `.message.user .message-content` | 用户气泡 | 蓝底白字，右对齐 |
| `.message.assistant .message-content` | AI 气泡 | 白底黑字，左对齐，有阴影 |
| `.message.tool .message-content` | 工具消息 | 灰底小字，居中 |
| `.message.error .message-content` | 错误消息 | 橙底，居中 |
| `.reasoning-block` | 思考块 | 折叠区域 |
| `.reasoning-content` | 思考内容 | 内部文字 |
| `.chat-input-bar` | 输入栏 | 底部区域 |
| `.chat-input` | 输入框 | textarea |
| `.send-btn` | 发送按钮 | -- |
| `.stop-btn` | 停止按钮 | 中止流式输出 |
| `.stats-btn` | 统计按钮 | 📊 |
| `.action-btn` | 操作按钮 | ＋新建会话 |
| `.primary-btn` | 主按钮 | 确认/继续 |
| `.secondary-btn` | 次按钮 | 取消 |
| `.modal-overlay` | 模态遮罩 | 背景半透明 |
| `.modal-box` | 模态框 | 弹窗容器 |
| `.modal-close` | 关闭按钮 | ✕ |
| `.stat-row` | 统计行 | -- |
| `.stat-row.total` | 统计合计行 | 加粗 |
| `.stat-label` | 统计标签 | -- |
| `.stat-value` | 统计数值 | 主色文字 |
| `.stat-divider` | 统计分隔线 | -- |
| `.peer-list` | 设备列表 | 局域网设备 |
| `.peer-item` | 设备项 | -- |
| `.peer-icon` | 设备图标 | 🖥️📶 |
| `.peer-name` | 设备名称 | -- |
| `.peer-transport` | 传输方式 | LAN/BLE 标签 |
| `.no-peers` | 无设备 | 空状态 |
| `.limit-actions` | 限制确认栏 | 工具调用达到上限时的按钮行 |
| `.cursor` | 光标 | 流式输出闪烁光标 |

### 设置页 `/settings`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.settings-page` | 设置页容器 | -- |
| `.page-title` | 页面标题 | -- |
| `.tab-bar` | 标签栏 | 通用/技能/数据/日志 |
| `.tab-btn` | 标签按钮 | -- |
| `.tab-btn.active` | 当前标签 | 高亮蓝底 |
| `.settings-section` | 设置卡片 | -- |
| `.section-label` | 区块标题 | -- |
| `.form-group` | 表单项 | 标签+输入框容器 |
| `.form-input` | 输入框 | 通用样式 |
| `.form-input:focus` | 输入框焦点 | 蓝边框 |
| `.toggle-key` | 密码切换 | 👁🙈 |
| `.action-row` | 按钮行 | flex 容器 |
| `.danger-btn` | 危险按钮 | 红色边框 |
| `.secondary-btn` | 次按钮 | 蓝色边框 |
| `.primary-btn` | 主按钮 | 蓝底白字 |
| `.skill-list` | 技能列表 | -- |
| `.skill-item` | 技能项 | 含 `.active` 高亮态 |
| `.skill-item.active` | 选中项 | 蓝底蓝框 |
| `.skill-cards` | 技能卡片网格 | -- |
| `.skill-card` | 技能卡片 | 白底边框 |
| `.skill-card-title` | 卡片标题 | -- |
| `.skill-card-desc` | 卡片描述 | -- |
| `.skill-card-actions` | 卡片操作 | 底部按钮 |
| `.skill-edit-form` | 编辑表单 | 内联编辑区 |
| `.skill-empty` | 空状态 | 无技能提示 |
| `.skill-checkboxes` | 筛选复选框 | -- |
| `.skill-cb-label` | 复选框标签 | -- |
| `.saved-hint` | 保存提示 | "✅ 已保存" |
| `.about-info` | 关于信息 | 版本号 |
| `.switch` | 开关 | 自定义 toggle |
| `.toggle-row` | 开关行 | 描述+开关 |
| `.toggle-desc` | 开关说明 | -- |
| `.toggle-hint` | 开关提示 | -- |
| `.update-area` | 更新区域 | 版本检查 |
| `.update-msg` | 更新消息 | 含 `.error` / `.ok` / `.available` 变体 |
| `.update-notes` | 更新说明 | 滚动区 |
| `.progress-bar` | 进度条容器 | -- |
| `.progress-fill` | 进度条填充 | 蓝底 |
| `.download-progress` | 下载进度 | -- |
| `.log-file-list` | 日志文件列表 | -- |
| `.log-file-item` | 日志文件项 | 含 `.active` 选中态 |
| `.log-file-name` | 文件名 | -- |
| `.log-file-meta` | 文件信息 | -- |
| `.log-file-del` | 删除按钮 | -- |
| `.log-controls` | 日志工具栏 | -- |
| `.log-level-filters` | 级别过滤 | -- |
| `.log-search-row` | 搜索行 | -- |
| `.log-search-input` | 搜索框 | -- |
| `.log-table-wrap` | 表格容器 | 可滚动 |
| `.log-table` | 日志表格 | -- |
| `.log-row` | 日志行 | 含 `.level-error` / `.level-warn` 变体 |
| `.col-time` | 时间列 | 等宽字体 |
| `.col-level` | 级别列 | -- |
| `.col-module` | 模块列 | 蓝色文字 |
| `.col-msg` | 消息列 | -- |
| `.level-badge` | 级别徽章 | 含 `.level-debug/info/warn/error` 变体 |
| `.theme-active-name` | 当前主题名 | -- |
| `.theme-tag` | 主题标签 | 含 `.builtin` / `.user` 变体 |
| `.color-grid` | 色块网格 | -- |
| `.color-chip` | 色块 | 32x32 方块 |

### 服务页 `/services`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.browse-page` | 服务页容器 | -- |
| `.header` | 页面头部 | 标题 + 按钮行 |
| `.header-btns` | 按钮组 | 📂📡 |
| `.import-btn` | 导入按钮 | 📂 |
| `.share-btn` | 分享按钮 | 📡 |
| `.count` | 计数徽章 | 服务数量 |
| `.svc-card` | 服务卡片 | 含 `.disabled` 变体和 :hover/:active 伪类 |
| `.card-icon` | 卡片图标 | emoji |
| `.card-name` | 卡片名称 | -- |
| `.card-desc` | 卡片描述 | -- |
| `.card-meta` | 卡片元数据 | ID+版本 |
| `.card-actions` | 卡片操作 | 底部开关 |
| `.toggle` | 开关 | 自定义 toggle |
| `.toggle-slider` | 开关滑轨 | 含 :checked 变体 |
| `.action-icon` | 操作图标 | 垃圾桶 🗑 |
| `.service-list` | 系统服务列表 | -- |
| `.service-item` | 系统服务项 | 含 :hover |
| `.svc-icon` | 服务图标 | emoji |
| `.svc-info` | 服务信息 | 名称+描述容器 |
| `.svc-name` | 服务名称 | -- |
| `.svc-desc` | 服务描述 | -- |
| `.svc-meta` | 服务元数据 | -- |
| `.svc-badge` | 服务徽章 | 含 `.system` 变体 |
| `.empty` | 空状态 | -- |

### 记忆页 `/memory`

| 选择器 | 元素 | 说明 |
|--------|------|------|
| `.memory-page` | 记忆页容器 | -- |
| `.subtitle` | 副标题 | -- |
| `.tabs` | 标签栏 | MEMORY.md / USER.md |
| `.tab` | 标签按钮 | 含 `.active` 变体 |
| `.tab-meta` | 字数统计 | 如 42/2200 |
| `.editor-area` | 编辑区 | 卡片容器 |
| `.memory-editor` | 编辑器 | textarea，含 :focus |
| `.editor-actions` | 操作按钮行 | -- |
| `.action-btn` | 操作按钮 | 含 `.primary` / `.danger` / `:disabled` 变体 |
| `.preview-section` | 预览区 | -- |
| `.entry-list` | 条目列表 | -- |
| `.entry-item` | 条目项 | -- |
| `.entry-index` | 序号 | -- |
| `.entry-text` | 正文 | -- |
| `.entry-delete` | 删除按钮 | ✕ |
| `.saved-hint` | 保存提示 | "✅ 已保存" |

---

## 插槽列表

以下插槽可通过 `ui_slot_set` 设置 HTML 内容，在界面指定位置插入自定义元素：

| 插槽名 | 位置 | 使用建议 |
|--------|------|----------|
| `topbar.left` | 顶栏标题左侧 | 快捷按钮、时钟。推荐宽 40-160px |
| `topbar.center` | 替换顶栏标题 | 搜索框。设置后默认标题隐藏 |
| `topbar.right` | 设置按钮左侧 | 快捷操作按钮。推荐宽 40-160px |
| `home.above-welcome` | 首页欢迎卡片上方 | 公告、自定义 banner |
| `home.below-features` | 功能卡片下方 | 快捷入口、统计面板 |
| `home.above-recent` | 最近使用列表上方 | 搜索框、筛选按钮 |
| `chat.above-messages` | 消息列表上方 | 快捷指令按钮 |
| `chat.below-input` | 输入框下方 | 快捷按钮、快捷键说明 |
| `settings.extra` | 设置页末尾 | 自定义配置项 |
| `services.above-list` | 服务列表上方 | 搜索框、分类筛选 |

插槽内容为完整 HTML 片段，可包含 `<style>` 和 `<script>`（脚本用 IIFE）。插槽不随主题切换。

---

## 工作流程

修改界面时，遵循以下流程：

1. `doc_read("ui-customization.md")` — 获取选择器和变量参考
2. `ui_theme_view` — 查看当前主题状态（激活主题、可用主题列表、当前变量值）
3. 按需选择：
   - **切换主题** → `ui_theme_switch("dark")`
   - **创建新主题** → `ui_theme_create({ name: "我的主题" })`（从当前复制）
   - **改颜色/圆角/字体** → `ui_theme_set_variable` / `ui_theme_set_variables`
   - **复杂样式** → `ui_theme_set_css`（参考上方选择器速查表）
   - **加界面元素** → `ui_slot_list` → `ui_slot_set`
4. 内置主题（default/dark/ocean）不可直接修改——修改时自动创建用户主题副本

### 示例

```
用户: "把聊天页背景改成深色"  
  → doc_read("ui-customization.md")  // 找到 .chat-page + --color-bg
  → ui_theme_set_css({ css: ".chat-page { background: #1a1a2e; }" })

用户: "创建暗黑主题"  
  → ui_theme_create({ name: "暗黑模式" })
  → ui_theme_set_variables({ variables: { "--color-bg": "#1a1a2e", "--color-surface": "#16213e", ... } })

用户: "切换到 ocean 主题"  
  → ui_theme_switch({ name: "ocean" })

用户: "在顶栏加一个时钟"  
  → ui_slot_list  // 找到 topbar.left
  → ui_slot_set({ slot: "topbar.left", html: "<span id='clock'>12:00</span><script>(function(){...})()</script>" })
```
