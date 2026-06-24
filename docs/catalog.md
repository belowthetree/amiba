# Catalog 组件规范

## 概述

Catalog 定义了 AI 可以使用的全部 UI 组件及其属性。AI 生成服务时只能使用 Catalog 中列出的组件，不能编造。这是安全白名单的关键一环。

文件位置: `public/catalog/builtin_catalog.yaml`

## 11 个组件

### container — 通用容器

最基础的布局容器。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `direction` | enum: vertical, horizontal | vertical | 布局方向 |
| `padding` | size | — | 内边距 |
| `margin` | size | — | 外边距 |
| `backgroundColor` | color | — | 背景色 |
| `borderRadius` | number | — | 圆角 |
| `alignment` | enum: start, center, end, stretch | — | 对齐 |
| `spacing` | size | — | 子元素间距 |

**is_container**: true

### scroll — 可滚动容器

| 属性 | 类型 | 默认值 |
|------|------|--------|
| `direction` | enum: vertical, horizontal | — |
| `scrollbars` | boolean | false |

**is_container**: true

### card — 卡片容器

带阴影和圆角的卡片容器。

| 属性 | 类型 | 默认值 |
|------|------|--------|
| `elevation` | number | 2 |
| `borderRadius` | number | 12 |
| `padding` | size | — |

**is_container**: true

### text — 文本

| 属性 | 类型 | 默认值 | 必填 |
|------|------|--------|------|
| `content` | string | — | ✓ |
| `size` | number | 16 | |
| `color` | color | — | |
| `weight` | enum: normal, bold, light | — | |
| `align` | enum: left, center, right | — | |
| `maxLines` | number | — | |

### button — 按钮

| 属性 | 类型 | 默认值 | 必填 |
|------|------|--------|------|
| `label` | string | — | ✓ |
| `variant` | enum: primary, secondary, outline, ghost | primary | |
| `size` | enum: small, medium, large | medium | |
| `disabled` | boolean | false | |

**事件**: `onTap`

### input — 输入框

| 属性 | 类型 | 默认值 |
|------|------|--------|
| `type` | enum: text, password, number, email, multiline | — |
| `placeholder` | string | — |
| `value` | string | — |
| `maxLength` | number | — |

**事件**: `onChange`, `onSubmit`

### image — 图片

| 属性 | 类型 | 默认值 | 必填 |
|------|------|--------|------|
| `src` | string | — | ✓ |
| `fit` | enum: cover, contain, fill, none | cover | |
| `width` | size | — | |
| `height` | size | — | |

**事件**: `onTap`

### list — 列表容器

| 属性 | 类型 |
|------|------|
| `direction` | enum: vertical, horizontal |
| `itemSpacing` | size |

**is_container**: true

### spacer — 弹性占位

| 属性 | 类型 | 默认值 |
|------|------|--------|
| `flex` | number | 1 |

### divider — 分隔线

| 属性 | 类型 | 默认值 |
|------|------|--------|
| `thickness` | number | 1 |
| `color` | color | — |

### webview — 内嵌网页

| 属性 | 类型 | 默认值 |
|------|------|--------|
| `src` | string | — |
| `javascriptEnabled` | boolean | true |
| `allowFileAccess` | boolean | false |
| `scalesPageToFit` | boolean | true |

**事件**: `onPageStarted`, `onPageFinished`, `onWebResourceError`

## 类型说明

| 类型 | 含义 | 示例 |
|------|------|------|
| string | 字符串 | `"hello"` |
| number | 数字 | `16` |
| boolean | 布尔 | `true` |
| color | HEX 颜色 | `"#1976D2"` |
| size | 数字或预设 | `16` 或 `"md"` (`xs=4, sm=8, md=16, lg=24, xl=32`) |
| enum | 枚举 | `"primary"` |

## 校验实现

`catalog.ts` 提供校验函数：

```ts
// 验证生成的 UI 是否符合 Catalog 规范
validateGeneratedUI(ui, catalogDef): ValidationError[]

// 验证权限声明
validatePermissions(permissions): ValidationError[]
```

校验项：
1. 每个节点的 `type` 必须在 Catalog 中存在
2. 节点的 `props` key 必须属于该组件定义的 props
3. 必填 props 必须提供
4. 权限声明必须在已知权限列表中
