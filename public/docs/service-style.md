---
title: 服务界面风格指南（玉石玻璃风）
description: 生成服务的 UI 必须遵循的统一风格：玉石质感、玻璃辉光、流光、简洁布局；基础样式可直接引用 /libs/jade.css 复用
keywords: [风格, 样式, UI, 界面, 玉石, 玻璃, 主题, CSS, 设计, style, glass, jade]
category: guide
---

# 服务界面风格指南（玉石玻璃风）

生成或修改服务的界面时，**必须遵循本指南**，使服务与宿主整体风格统一。

宿主整体风格：**玉石** —— 晶莹、通透、流光隐约、简洁克制。所有服务界面都应呈现这种感觉。

## 快速开始（推荐）：引用 /libs/jade.css

平台内置了可复用的基础样式表 `public/libs/jade.css`（与 `/libs/vue.global.prod.js` 同样的同源静态资源机制，打包时不会被内联，运行时从宿主加载）。**优先直接引用它，不要手抄样式。**

### 用法

`index.html` 的 `<head>` 中引入：

```html
<link href="/libs/jade.css" rel="stylesheet">
```

`<body>` 最前面放玻璃辉光背景节点（**推荐带上**，与宿主背景观感一致）：

```html
<body>
  <div class="glass-bg" aria-hidden="true">
    <div class="gb-glow gb-glow-1"></div>
    <div class="gb-glow gb-glow-2"></div>
    <div class="gb-streak"></div>
  </div>

  <div class="page">
    <!-- 页面内容 -->
  </div>
</body>
```

### jade.css 内置类清单

| 类名 | 用途 |
|------|------|
| `.glass-bg` / `.gb-glow-1` / `.gb-glow-2` / `.gb-streak` | 玻璃辉光背景（玉色辉光 + 流光，fixed 铺满） |
| `.page` | 页面容器：max-width 720px 居中、压在背景之上（z-index 1） |
| `.card` | 玻璃卡片/面板：半透明白 + 背景模糊 + 柔和阴影 |
| `.btn-primary` | 主按钮：玉青胶囊，含 hover/active/disabled |
| `.btn-ghost` | 次要按钮：玻璃质感，hover 泛玉青 |
| `.input` | 输入框：悬浮玻璃，focus 玉青描边微光 |
| `.tag` | 标签：玉青浅底小胶囊 |
| `.modal-overlay` + `.modal-box` | 模态框：遮罩模糊 + 玻璃弹窗 |

同时自动获得：`:root` 设计令牌（见下）、body 基础排版、滚动条样式。服务自己的 `style.css` 只写业务布局样式即可，颜色/圆角/阴影一律引用 `var(--*)` 令牌。

## 核心原则

1. **简洁优先**：内容直出，不要多余的导航栏/标题栏/页脚。宿主已取消全局顶栏，并在服务页左上角提供浮动返回按钮 —— 服务内部**不要再画全局返回栏或重型头部**。
2. **玻璃质感**：卡片/面板/输入框用半透明白 + 背景模糊（`backdrop-filter`），让背景辉光隐约透出。
3. **柔和分层**：用柔和的分层阴影代替粗边框；边框只用极淡的半透明描边。
4. **动效克制**：过渡 0.15–0.3s，ease 缓出；不用弹跳、闪烁、持续循环的抢眼动画。

## 设计令牌（jade.css 已内置，供引用/覆盖）

服务运行在独立 iframe 文档中，不共享宿主 CSS 变量。引用 jade.css 后可直接使用：

```css
:root {
  /* 玉石色系 */
  --color-primary: #2FA98C;        /* 玉青主色：按钮、链接、强调 */
  --color-primary-hover: #238D75;  /* 主色加深（hover/active） */
  --color-primary-light: #E1F3ED;  /* 主色浅底（选中态、标签底） */
  --color-bg: #EDF3F0;             /* 玉白背景 */
  --color-surface: rgba(255, 255, 255, 0.78);  /* 玻璃表面（半透明） */
  --color-text: #1F2329;           /* 正文 */
  --color-text-secondary: #6B7280; /* 次要文字 */
  --color-text-muted: #9CA3AF;     /* 弱化文字 */
  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-on-primary: #FFFFFF;

  /* 圆角 */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;

  /* 柔和分层阴影 */
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.04);
  --shadow-md: 0 4px 8px -2px rgba(16, 24, 40, 0.06), 0 8px 20px -4px rgba(16, 24, 40, 0.08);
  --shadow-float: 0 10px 28px -8px rgba(16, 24, 40, 0.12), 0 2px 8px rgba(16, 24, 40, 0.05);

  /* 字号 / 间距 */
  --font-size-sm: 13px;
  --font-size-md: 15px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
}
```

**自定义：** 在服务的 `style.css` 中（位于 jade.css 之后加载）可覆盖变量或扩展类，例如：

```css
/* 只覆盖个别令牌，其余保持平台一致 */
:root { --radius-lg: 22px; }
/* 业务组件基于令牌扩展 */
.todo-item { background: var(--color-surface); border-radius: var(--radius-md); }
```

## 不引用 jade.css 时的手动方案

特殊场景（如需大幅定制背景）可不引用 jade.css，但必须手动复制上文的令牌定义，并按下方要点实现玻璃感：

- 表面：`background: var(--color-surface)` + `backdrop-filter: blur(18px)` + `border: 1px solid rgba(31,35,41,0.08)`
- 阴影：只用 `--shadow-*` 级别的柔和阴影
- 按钮：胶囊圆角 `999px`、min-height 40px（触控友好）、`:active` 时 `transform: scale(0.96)`
- 背景：玉白底 + 玉色径向辉光（`blur(70px)` 色团）+ 低透明白色流光带（`blur(22px)`、17s 缓慢划过），完整代码见 `/libs/jade.css` 源码中的 `.glass-bg` 部分
- 所有动画遵循 `@media (prefers-reduced-motion: reduce)` 降级

## 禁忌

- ❌ 不要全宽不透明的大色块背景（会盖住辉光，破坏通透感）
- ❌ 不要重型顶栏/底栏导航（宿主已无顶栏，服务内也不要造）
- ❌ 不要自绘「返回宿主」按钮（宿主左上角已提供）
- ❌ 不要高饱和撞色（亮蓝 #1976D2、亮紫等旧配色已废弃）
- ❌ 不要粗黑边框、硬阴影（`box-shadow: 0 2px 4px rgba(0,0,0,0.3)` 这类）
- ❌ 不要持续循环的抢眼动画（辉光/流光这类低透明度慢动画除外）
- ❌ 不要用 `alert()`/`confirm()` 做提示（沙箱禁止，用 `__amiba__.showToast` 或自定义模态框）

## 速查：一句话标准

> 半透玻璃 + 玉青点缀 + 柔和大圆角 + 分层轻阴影 + 克制动效 + 内容直出。
