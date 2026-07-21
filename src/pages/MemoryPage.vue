<!-- ============================================================
变形虫 (Amiba) — MemoryPage (记忆管理)
============================================================ -->
<template>
  <div class="memory-page">
    <h2 class="page-title">🧠 {{ $t('memory.title') }}</h2>
    <p class="subtitle">{{ $t('memory.subtitle') }}</p>

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
        :placeholder="activeTab === 'memory' ? $t('memory.memoryPlaceholder') : $t('memory.userPlaceholder')"
        rows="12"
      ></textarea>

      <div class="editor-actions">
        <button class="action-btn primary" @click="saveMemory" :disabled="!dirty">
          💾 {{ $t('memory.save') }}
        </button>
        <button class="action-btn" @click="reload" :disabled="!dirty">
          ↩ {{ $t('memory.revert') }}
        </button>
        <button class="action-btn danger" @click="clearCurrent">
          🗑 {{ $t('memory.clear') }}
        </button>
      </div>
    </div>

    <div class="preview-section" v-if="entries.length > 0">
      <h3>{{ $t('memory.entriesPreview', { n: entries.length }) }}</h3>
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

    <div class="saved-hint" v-if="showSaved">✅ {{ $t('memory.saved') }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { memoryStore } from '../ai/memory-store'

const { t } = useI18n()

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
  const content = memoryStore.get(activeTab.value)
  savedContent.value = content
  editingContent.value = content
  dirty.value = false
  updateCharCounts()
}

async function saveMemory() {
  await memoryStore.setRaw(activeTab.value, editingContent.value)
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
  const name = activeTab.value === 'memory' ? 'MEMORY.md' : 'USER.md'
  if (confirm(t('memory.confirmClear', { name }))) {
    editingContent.value = ''
    await memoryStore.setRaw(activeTab.value, '')
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
  memoryChars.value = (memoryStore.get('memory')).length
  userChars.value = (memoryStore.get('user')).length
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
  padding: var(--spacing-md);
  max-width: 640px;
  margin: 0 auto;
}

.page-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  letter-spacing: -0.3px;
  margin-bottom: 4px;
  color: var(--color-text);
}

.subtitle {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-md);
}

.tabs {
  display: flex;
  gap: var(--spacing-sm);
  margin-bottom: 12px;
}

.tab {
  flex: 1;
  padding: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
  transition: all 0.2s ease;
}

.tab:hover {
  border-color: var(--color-primary);
  transform: translateY(-1px);
}

.tab:active {
  transform: scale(0.97);
}

.tab.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
  font-weight: 600;
}

.tab-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.tab.active .tab-meta {
  color: var(--color-primary);
}

.editor-area {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--spacing-md);
}

.memory-editor {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 12px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.6;
  color: var(--color-text);
  background: var(--color-bg);
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.memory-editor:focus {
  border-color: var(--color-primary);
  background: var(--color-surface);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.editor-actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: 12px;
}

.action-btn {
  padding: 8px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-hover-bg);
}

.action-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.primary {
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}

.action-btn.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.action-btn.danger {
  color: var(--color-error);
  border-color: var(--color-error);
}

.action-btn.danger:hover {
  background: var(--color-error-light);
}

.preview-section {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  box-shadow: var(--shadow-sm);
}

.preview-section h3 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.entry-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 8px 12px;
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  transition: background 0.2s ease;
}

.entry-item:hover {
  background: var(--color-hover-bg);
}

.entry-index {
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-width: 20px;
  text-align: center;
  background: var(--color-primary-light);
  border-radius: 999px;
  padding: 2px 6px;
}

.entry-text {
  flex: 1;
  color: var(--color-text);
}

.entry-delete {
  padding: 4px 8px;
  border: none;
  background: none;
  color: var(--color-error);
  cursor: pointer;
  font-size: 14px;
  border-radius: var(--radius-sm);
  transition: background 0.2s ease;
}

.entry-delete:hover {
  background: var(--color-error-light);
}

.saved-hint {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-text);
  color: var(--color-surface);
  padding: 10px 22px;
  border-radius: 999px;
  font-size: var(--font-size-sm);
  box-shadow: var(--shadow-md);
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
