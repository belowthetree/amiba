# Catalog 组件风格参考

## 概述

Catalog 定义了推荐的 UI 组件风格和颜色体系。AI 生成服务时**以此为风格参考**，但可以直接用 HTML/CSS 自由设计，不必严格拘泥于组件约束。

文件位置: `public/catalog/builtin_catalog.yaml`

## 设计理念

- **旧模式**: Catalog 是严格白名单，AI 只能使用列出的组件，属性逐条校验
- **新模式**: Catalog 是风格指南，AI 参考组件风格写出原生 HTML/CSS，校验只检查基本的 manifest/files 完整性

这样 AI 可以发挥 HTML/CSS 的全部能力，同时保持 UI 风格的一致性和平台感。

## 11 个风格组件

### container — 通用容器（flex 布局）

- 布局方向: vertical / horizontal
- 间距: padding, margin, spacing（4/8/16/24/32 体系）
- 视觉: backgroundColor, borderRadius
- 对齐: start / center / end / stretch

### scroll — 可滚动容器

- 方向: vertical / horizontal
- 滚动条: 可控

### card — 卡片

- 阴影: elevation（1-4 级）
- 圆角: borderRadius（默认 12px）
- 内边距: padding

### text — 文本

- 字体: size（默认 16px）, weight（normal/bold/light）
- 颜色: color
- 对齐: left / center / right
- 截断: maxLines

### button — 按钮

- 变体: primary（蓝 #1976D2）/ secondary（紫 #9C27B0）/ outline / ghost
- 大小: small / medium / large
- 禁用: disabled
- 事件: onClick

### input — 输入框

- 类型: text / password / number / email / multiline
- 占位: placeholder
- 事件: onChange, onSubmit

### image — 图片

- 裁剪: cover / contain / fill / none
- 尺寸: width, height
- 事件: onTap

### list — 列表容器

- 方向: vertical / horizontal
- 间距: itemSpacing

### spacer — 弹性占位

- 弹性: flex（默认 1）

### divider — 分隔线

- 粗细: thickness（默认 1px）
- 颜色: color

### webview — 内嵌网页

- 源: src
- 选项: javascriptEnabled, allowFileAccess, scalesPageToFit

## 颜色体系

| 用途 | 色值 |
|------|------|
| 主色 | `#1976D2` |
| 次色 | `#9C27B0` |
| 背景 | `#fafafa` |
| 文字 | `#333` |
| 边框 | `#e0e0e0` |
| 成功 | `#388E3C` |
| 警告 | `#F57F17` |
| 错误 | `#e53935` |

## 间距体系

`xs=4px, sm=8px, md=16px, lg=24px, xl=32px`

## 校验

`catalog.ts` 提供校验函数：

```ts
// 验证权限声明
validatePermissions(permissions): ValidationError[]

// 验证服务包基本结构
validatePackage(pkg): ValidationError[]
```

校验项（已大幅简化）：
1. manifest 必填字段（id、name）
2. files 数组非空且包含 index.html
3. 权限声明在已知权限列表中
