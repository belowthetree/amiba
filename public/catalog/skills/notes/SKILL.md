---
name: notes
description: 简单的笔记应用
keywords:
  - 笔记
  - note
  - 记事
  - 备忘录
  - 便签
---

# 笔记 — 参考模板

## 输出格式

```json
{
  "manifest": {
    "id": "user.notes",
    "name": "笔记",
    "version": "1.0.0",
    "description": "记录你的想法",
    "permissions": ["storage"]
  },
  "files": [
    { "path": "index.html", "content": "..." },
    { "path": "style.css", "content": "..." },
    { "path": "app.js", "content": "..." }
  ]
}
```

## 代码示例

### app.js

```js
let notes = [];

async function init() {
  const saved = await __amiba__.storage.get('notes');
  if (saved) notes = saved;
  renderNotes();
}

function renderNotes() {
  const container = document.getElementById('notes_list');
  if (!container) return;
  container.innerHTML = notes.map((n, i) =>
    '<div style="padding:12px;background:#f5f5f5;border-radius:8px;margin-bottom:4px">' +
    '<div style="font-size:12px;color:#999;margin-bottom:4px">' + n.time + '</div>' +
    '<div>' + n.text + '</div>' +
    '<button onclick="handleDelete(' + i + ')" style="margin-top:8px;padding:2px 8px;font-size:12px;border:1px solid #e53935;color:#e53935;border-radius:4px;background:white;cursor:pointer">删除</button>' +
    '</div>'
  ).join('');
}

async function handleSave() {
  const input = document.getElementById('note_input');
  const val = input?.value?.trim();
  if (!val) return;
  const now = new Date().toLocaleString('zh-CN');
  notes.unshift({ text: val, time: now });
  await __amiba__.storage.set('notes', notes);
  input.value = '';
  renderNotes();
  __amiba__.showToast('已保存', 'success');
}

async function handleDelete(i) {
  notes.splice(i, 1);
  await __amiba__.storage.set('notes', notes);
  renderNotes();
}

init();
```
