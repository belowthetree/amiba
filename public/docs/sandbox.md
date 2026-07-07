---
title: Sandbox 约束
description: iframe 沙箱中的 API 限制和替代方案，生成服务前必读
keywords: [sandbox, 安全, localStorage, BroadcastChannel, 沙箱, 限制, iframe]
category: platform
---

# Sandbox 约束

服务运行在 `<iframe sandbox="allow-scripts allow-same-origin">` 中。以下 API 和功能受沙箱限制而**不可用**，必须使用替代方案。

## 禁止的 API 及替代方案

| 禁止使用 | 原因 | 替代方案 |
|----------|------|----------|
| `localStorage.setItem()` / `getItem()` | 沙箱内同一标签页只有一个 iframe 实例，localStorage 不可靠 | `__amiba__.storage.set(key, data)` / `get(key)` / `remove(key)` |
| `sessionStorage` | 同上 | 同上 |
| `BroadcastChannel` | 沙箱内只有一个 iframe 实例，无法多窗口 | `network` 权限 + `__amiba__.network.*` P2P API |
| `SharedWorker` | 沙箱不支持 SharedWorker | 同上 |
| `alert()` / `confirm()` / `prompt()` | 沙箱阻止弹窗 | `__amiba__.showToast(title, icon)` 或自定义模态框 |
| `window.open()` | 沙箱禁止开新窗口 | `__amiba__.navigateTo(url)` |
| `fetch()` 访问外部 URL | CORS + 沙箱双重限制 | 避免使用；同源静态资源可内联 |
| 外部 CDN `<script src="https://...">` | 可能被 CSP 阻止 | 预置库：`/libs/chart.umd.min.js`、`/libs/vue.global.prod.js` |

## 沙箱属性

- 当前 sandbox 属性: `allow-scripts allow-same-origin`
- `allow-same-origin` 使 iframe 可加载同源脚本（如 `/libs/vue.global.prod.js`、`/libs/chart.umd.min.js`）
- 服务运行在**单个 iframe 实例**中
- 无法多开标签页/窗口
- 无 `allow-popups`，无 `allow-top-navigation`

## 不同运行环境的 sandbox 属性

| 环境 | sandbox 属性 | 说明 |
|------|-------------|------|
| 前台服务 iframe | `allow-scripts allow-same-origin` | 完整能力，可加载同源资源 |
| 后台服务 iframe | `allow-scripts` | 无 `allow-same-origin`，由 `BackgroundServiceManager` 管理 |
| 悬浮块 iframe | `allow-scripts` | 无 `allow-same-origin`，面板尺寸由 `widget.json` 声明 |

## 关键原则

1. **数据持久化**: 必须用 `__amiba__.storage.*`，不得用 localStorage
2. **多端通信**: "多人/聊天/协作"功能必须用 `network` 权限 + P2P API，不得在本地模拟多角色
3. **UI 反馈**: 用 `__amiba__.showToast()` 替代浏览器原生弹窗
4. **校验**: 生成或修改代码后调用 `service_validate` 自动检测违规
5. **磁盘文件**: 用 `fileAccess` 权限 + `__amiba__.fileAccess.*` API，不直接访问文件系统
6. **后台运行**: 用 `background` 权限 + `background.json` 声明，不依赖前台页面存活

## 常见错误

- ❌ `localStorage.setItem('key', value)` → ✅ `await __amiba__.storage.set('key', value)`
- ❌ `new BroadcastChannel('chat')` → ✅ `__amiba__.network.connect(peerId, serviceKey)`
- ❌ `alert('成功')` → ✅ `__amiba__.showToast('成功', 'success')`
- ❌ `fetch('/Users/.../music/')` → ✅ `await __amiba__.fileAccess.requestAccess({...})`
- ❌ 后台直接用 `setInterval`  → ✅ 在 `background.json` 声明 `schedule`，监听 `tick` 事件
