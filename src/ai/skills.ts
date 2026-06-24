// ============================================================
// 变形虫 (Amiba) — Skill 匹配
// ============================================================

export interface Skill {
  name: string
  description: string
  keywords: string[]
  template: string
}

const builtinSkills: Skill[] = [
  {
    name: '计数器',
    description: '带计数的简单点击应用',
    keywords: ['计数', '统计', '点击', '计数器', 'counter'],
    template: `{
  "manifest": {
    "id": "user.counter",
    "name": "计数器",
    "version": "1.0.0",
    "description": "点击计数应用",
    "permissions": ["storage"]
  },
  "ui": {
    "version": "1.0.0",
    "root": "page_root",
    "nodes": {
      "page_root": {
        "type": "card",
        "props": { "padding": 24 },
        "children": ["title_text", "count_text", "btn_row"]
      },
      "title_text": {
        "type": "text",
        "props": { "content": "计数器", "size": 24, "weight": "bold", "align": "center" }
      },
      "count_text": {
        "type": "text",
        "props": { "content": "0", "size": 48, "weight": "bold", "align": "center" }
      },
      "btn_row": {
        "type": "container",
        "props": { "direction": "horizontal", "alignment": "center", "spacing": 16 },
        "children": ["minus_btn", "reset_btn", "plus_btn"]
      },
      "minus_btn": {
        "type": "button",
        "props": { "label": "-1", "variant": "outline", "onTap": "handleMinus" }
      },
      "reset_btn": {
        "type": "button",
        "props": { "label": "重置", "variant": "secondary", "onTap": "handleReset" }
      },
      "plus_btn": {
        "type": "button",
        "props": { "label": "+1", "variant": "primary", "onTap": "handlePlus" }
      }
    }
  },
  "logic": "let count = 0;\\n\\nasync function init() {\\n  const saved = await __amiba__.storage.get('counter_value');\\n  if (saved !== undefined && saved !== null) count = saved;\\n  updateDisplay();\\n}\\n\\nfunction updateDisplay() {\\n  const el = document.getElementById('count_text');\\n  if (el) el.textContent = String(count);\\n}\\n\\nasync function handlePlus() {\\n  count++;\\n  await __amiba__.storage.set('counter_value', count);\\n  updateDisplay();\\n}\\n\\nasync function handleMinus() {\\n  count--;\\n  await __amiba__.storage.set('counter_value', count);\\n  updateDisplay();\\n}\\n\\nasync function handleReset() {\\n  count = 0;\\n  await __amiba__.storage.set('counter_value', count);\\n  updateDisplay();\\n  __amiba__.showToast('已重置', 'success');\\n}\\n\\ninit();",
  "tasks": []
}`,
  },
  {
    name: '待办清单',
    description: '简单的 TODO 列表',
    keywords: ['待办', 'todo', '列表', '任务', '清单'],
    template: `{
  "manifest": {
    "id": "user.todo_list",
    "name": "待办清单",
    "version": "1.0.0",
    "description": "管理你的待办事项",
    "permissions": ["storage"]
  },
  "ui": {
    "version": "1.0.0",
    "root": "page_root",
    "nodes": {
      "page_root": {
        "type": "card",
        "props": { "padding": 24 },
        "children": ["title_text", "input_row", "list_container"]
      },
      "title_text": {
        "type": "text",
        "props": { "content": "待办清单", "size": 24, "weight": "bold" }
      },
      "input_row": {
        "type": "container",
        "props": { "direction": "horizontal", "spacing": 8 },
        "children": ["todo_input", "add_btn"]
      },
      "todo_input": {
        "type": "input",
        "props": { "placeholder": "输入待办事项...", "type": "text" }
      },
      "add_btn": {
        "type": "button",
        "props": { "label": "添加", "variant": "primary", "onTap": "handleAdd" }
      },
      "list_container": {
        "type": "list",
        "props": { "direction": "vertical", "itemSpacing": 8 }
      }
    }
  },
  "logic": "let todos = [];\\n\\nasync function init() {\\n  const saved = await __amiba__.storage.get('todos');\\n  if (saved) todos = saved;\\n  renderList();\\n}\\n\\nfunction renderList() {\\n  const container = document.getElementById('list_container');\\n  if (!container) return;\\n  container.innerHTML = todos.map((t, i) => \\n    '<div style=\"display:flex;align-items:center;padding:8px;background:#f5f5f5;border-radius:8px;margin-bottom:4px\">' +\\n    '<span style=\"flex:1;text-decoration:' + (t.done ? 'line-through' : 'none') + '\">' + t.text + '</span>' +\\n    '<button onclick=\"handleToggle(' + i + ')\" style=\"margin-right:4px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;background:white;cursor:pointer\">✓</button>' +\\n    '<button onclick=\"handleDelete(' + i + ')\" style=\"padding:4px 8px;border:1px solid #ccc;border-radius:4px;background:white;cursor:pointer\">✕</button>' +\\n    '</div>'\\n  ).join('');\\n}\\n\\nasync function handleAdd() {\\n  const input = document.getElementById('todo_input');\\n  const val = input?.value?.trim();\\n  if (!val) return;\\n  todos.push({ text: val, done: false });\\n  await __amiba__.storage.set('todos', todos);\\n  input.value = '';\\n  renderList();\\n  __amiba__.showToast('已添加', 'success');\\n}\\n\\nasync function handleToggle(i) {\\n  todos[i].done = !todos[i].done;\\n  await __amiba__.storage.set('todos', todos);\\n  renderList();\\n}\\n\\nasync function handleDelete(i) {\\n  todos.splice(i, 1);\\n  await __amiba__.storage.set('todos', todos);\\n  renderList();\\n}\\n\\ninit();",
  "tasks": []
}`,
  },
  {
    name: '笔记',
    description: '简单的笔记应用',
    keywords: ['笔记', 'note', '记事', '备忘录', '便签'],
    template: `{
  "manifest": {
    "id": "user.notes",
    "name": "笔记",
    "version": "1.0.0",
    "description": "记录你的想法",
    "permissions": ["storage"]
  },
  "ui": {
    "version": "1.0.0",
    "root": "page_root",
    "nodes": {
      "page_root": {
        "type": "card",
        "props": { "padding": 24 },
        "children": ["title_text", "note_input", "save_btn", "divider_1", "notes_list"]
      },
      "title_text": {
        "type": "text",
        "props": { "content": "笔记", "size": 24, "weight": "bold" }
      },
      "note_input": {
        "type": "input",
        "props": { "placeholder": "写点什么...", "type": "multiline" }
      },
      "save_btn": {
        "type": "button",
        "props": { "label": "保存", "variant": "primary", "onTap": "handleSave" }
      },
      "divider_1": {
        "type": "divider",
        "props": {}
      },
      "notes_list": {
        "type": "list",
        "props": { "direction": "vertical", "itemSpacing": 8 }
      }
    }
  },
  "logic": "let notes = [];\\n\\nasync function init() {\\n  const saved = await __amiba__.storage.get('notes');\\n  if (saved) notes = saved;\\n  renderNotes();\\n}\\n\\nfunction renderNotes() {\\n  const container = document.getElementById('notes_list');\\n  if (!container) return;\\n  container.innerHTML = notes.map((n, i) =>\\n    '<div style=\"padding:12px;background:#f5f5f5;border-radius:8px;margin-bottom:4px\">' +\\n    '<div style=\"font-size:12px;color:#999;margin-bottom:4px\">' + n.time + '</div>' +\\n    '<div>' + n.text + '</div>' +\\n    '<button onclick=\"handleDelete(' + i + ')\" style=\"margin-top:8px;padding:2px 8px;font-size:12px;border:1px solid #e53935;color:#e53935;border-radius:4px;background:white;cursor:pointer\">删除</button>' +\\n    '</div>'\\n  ).join('');\\n}\\n\\nasync function handleSave() {\\n  const input = document.getElementById('note_input');\\n  const val = input?.value?.trim();\\n  if (!val) return;\\n  const now = new Date().toLocaleString('zh-CN');\\n  notes.unshift({ text: val, time: now });\\n  await __amiba__.storage.set('notes', notes);\\n  input.value = '';\\n  renderNotes();\\n  __amiba__.showToast('已保存', 'success');\\n}\\n\\nasync function handleDelete(i) {\\n  notes.splice(i, 1);\\n  await __amiba__.storage.set('notes', notes);\\n  renderNotes();\\n}\\n\\ninit();",
  "tasks": []
}`,
  },
]

export function getAllSkills(): Skill[] {
  return [...builtinSkills]
}

export function matchSkill(userPrompt: string): Skill | null {
  const lower = userPrompt.toLowerCase()
  for (const skill of builtinSkills) {
    for (const kw of skill.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return skill
      }
    }
  }
  return null
}

export function getSkillContext(skill: Skill | null): string {
  if (!skill) return ''
  return `\n=== SKILL CONTEXT ===\n名称: ${skill.name}\n描述: ${skill.description}\n参考模板:\n${skill.template}\n`
}
