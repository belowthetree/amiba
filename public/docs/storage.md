---
title: 存储 API
description: __amiba__.storage 持久化存储使用规范，含数据生命周期和最佳实践
keywords: [storage, 存储, 持久化, 数据, set, get, remove, localStorage]
category: api
---

# 存储 API

服务通过 `__amiba__.storage` 读写其专属的持久化键值存储。数据在服务卸载后仍然保留。

## API

**权限**: manifest.permissions 中需声明 `"storage"`

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `set(key, data)` | key: string, data: any | `Promise<void>` | 存储数据。data 可以是字符串、数字、对象（自动 JSON 序列化） |
| `get(key)` | key: string | `Promise<any>` | 读取数据。不存在返回 `undefined` |
| `remove(key)` | key: string | `Promise<void>` | 删除指定键的数据 |

## 示例

```js
// 存储
await __amiba__.storage.set('username', '张三')
await __amiba__.storage.set('settings', { theme: 'dark', fontSize: 14 })

// 读取
const name = await __amiba__.storage.get('username')  // '张三'
const settings = await __amiba__.storage.get('settings')  // { theme: 'dark', ... }

// 删除
await __amiba__.storage.remove('username')

// 应用初始化时恢复状态
async function init() {
  const saved = await __amiba__.storage.get('messages')
  if (saved) messages = saved  // 是数组就直接用
}

// 数据变更后保存
await __amiba__.storage.set('messages', messages)
```

## 类型说明

- set 时传入对象或数组，get 时自动还原为对象/数组（内部 JSON 序列化/反序列化）
- set 时传入字符串，get 时得到字符串
- set 时传入数字，get 时得到数字

## 与 localStorage 的区别

| | `__amiba__.storage` | `localStorage` |
|---|---|---|
| 可用性 | ✅ 沙箱中可用 | ❌ 沙箱禁止 |
| API | 异步 (Promise) | 同步 |
| 存储位置 | 服务专属目录 | 浏览器 Origin |
| 数据隔离 | 服务间隔离 | 同 Origin 共享 |
| 容量 | 无硬限制 | ~5MB |

## 最佳实践

1. **init 时加载** — 页面初始化时读取所有需要恢复的状态
2. **变更即保存** — 数据修改后立即 `set`，不要等页面卸载
3. **批量存储** — 将多个字段合并为对象一次性存储，减少 API 调用
4. **容错处理** — get 可能返回 undefined，做好默认值兜底
