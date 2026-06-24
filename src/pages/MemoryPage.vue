<!-- ============================================================
变形虫 (Amiba) — MemoryPage (记忆管理)
============================================================ -->
<template>
  <div class="memory-page">
    <h2 class="page-title">🧠 记忆管理</h2>
    <p class="subtitle">AI 自动维护的持久记忆。条目用 § 分隔。</p>

    <div class="tabs">
      <button
        :class="['tab', { active: activeTab === 'memory' }]"
        @click="activeTab = 'memory'"
      >
        MEMORY.md
        <span class="tab-meta">{{ memoryChars }}/2200</span>
      </button>
      <button
        :class="['tab', { active: activeTab === 'user' }]"
        @click="activeTab = 'user'"
      >
        USER.md
        <span class="tab-meta">{{ userChars }}/1375</span>
      </button>
    </div>

    <div class="editor-area">
      <textarea
        v-model="editingContent"
        class="memory-editor"
        :placeholder="activeTab === 'memory' ? 'AI 的笔记（MEMORY.md）...' : '用户画像（USER.md）...'"
        rows="12"
      ></textarea>

      <div class="editor-actions">
        <button class="action-btn primary" @click="saveMemory" :disabled="!dirty">
          💾 保存
        </button>
        <button class="action-btn" @click="reload" :disabled="!dirty">
          ↩ 还原
        </button>
        <button class="action-btn danger" @click="clearCurrent">
          🗑 清空
        </button>
      </div>
    </div>

    <div class="preview-section" v-if="entries.length > 0">
      <h3>条目预览 ({{ entries.length }} 条)</h3>
      <div class="entry-list">
        <div
          class="entry-item"
          v-for="(entry, i) in entries"
          :key="i"
        >
          <span class="entry-index">{{ i + 1 }}</span>
          <span class="entry-text">{{ entry }}</span>
          <button class="entry-delete" @click="deleteEntry(i)">✕</button>
        </div>
      </div>
    </div>

    <div class="saved-hint" v-if="showSaved">✅ 已保存</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { getMemory, setMemory } from '../ai/memory'

const activeTab = ref<'memory' | 'user'>('memory')
const editingContent = ref('')
const dirty = ref(false)
const showSaved = ref(false)
const savedContent = ref('')

const memoryChars = ref(0)
const userChars = ref(0)

const entries = computed(() => {
  const content = editingContent.value
  if (!content.trim()) return []
  return content
    .split('\n§\n')
    .map((e) => e.replace(/^§\s*/, '').trim())
    .filter(Boolean)
})

async function load() {
  const content = await getMemory(activeTab.value)
  savedContent.value = content
  editingContent.value = content
  dirty.value = false
  updateCharCounts()
}

async function saveMemory() {
  await setMemory(activeTab.value, editingContent.value)
  savedContent.value = editingContent.value
  dirty.value = false
  showSaved.value = true
  updateCharCounts()
  setTimeout(() => (showSaved.value = false), 1500)
}

function reload() {
  editingContent.value = savedContent.value
  dirty.value = false
}

async function clearCurrent() {
  if (confirm(`确定要清空 ${activeTab.value === 'memory' ? 'MEMORY.md' : 'USER.md'} 吗？`)) {
    editingContent.value = ''
    await setMemory(activeTab.value, '')
    savedContent.value = ''
    dirty.value = false
    updateCharCounts()
  }
}

function deleteEntry(index: number) {
  const ents = [...entries.value]
  ents.splice(index, 1)
  editingContent.value = ents.map((e) => '§ ' + e).join('\n§\n')
  if (!editingContent.value && ents.length === 0) editingContent.value = ''
  dirty.value = true
}

async function updateCharCounts() {
  memoryChars.value = (await getMemory('memory')).length
  userChars.value = (await getMemory('user')).length
}

watch(activeTab, () => {
  load()
})

watch(editingContent, (val) => {
  dirty.value = val !== savedContent.value
})

onMounted(() => {
  load()
})
</script>

<style scoped>
.memory-page {
  padding: 16px;
  max-width: 600px;
  margin: 0 auto;
}

.page-title {
  font-size: 22px;
  margin-bottom: 4px;
  color: #333;
}

.subtitle {
  font-size: 13px;
  color: #999;
  margin-bottom: 16px;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.tab {
  flex: 1;
  padding: 10px;
  border: 1px solid #e0e0e0;
  background: white;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tab.active {
  border-color: #1976D2;
  color: #1976D2;
  background: #E3F2FD;
}

.tab-meta {
  font-size: 11px;
  color: #999;
}

.editor-area {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  margin-bottom: 16px;
}

.memory-editor {
  width: 100%;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.memory-editor:focus {
  border-color: #1976D2;
}

.editor-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.action-btn {
  padding: 8px 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  font-size: 13px;
  cursor: pointer;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.primary {
  background: #1976D2;
  color: white;
  border-color: #1976D2;
}

.action-btn.danger {
  color: #e53935;
  border-color: #e53935;
}

.preview-section {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.preview-section h3 {
  font-size: 14px;
  color: #666;
  margin-bottom: 12px;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entry-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f9f9f9;
  border-radius: 6px;
  font-size: 13px;
}

.entry-index {
  color: #999;
  font-size: 11px;
  min-width: 20px;
}

.entry-text {
  flex: 1;
  color: #333;
}

.entry-delete {
  padding: 2px 6px;
  border: none;
  background: none;
  color: #e53935;
  cursor: pointer;
  font-size: 14px;
}

.saved-hint {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 999;
  animation: fadeInOut 1.5s ease;
}

@keyframes fadeInOut {
  0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
  20% { opacity: 1; transform: translateX(-50%) translateY(0); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
</style>
