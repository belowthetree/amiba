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
      <button
        :class="['tab', { active: activeTab === 'requirements' }]"
        @click="activeTab = 'requirements'"
      >
        📋 {{ $t('memory.tabRequirements') }}
        <span class="tab-meta">{{ $t('memory.reqServiceCount', { n: reqDocs.length }) }}</span>
      </button>
    </div>

    <template v-if="activeTab !== 'requirements'">
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
    </template>

    <!-- ==== 需求浏览 / 管理 ==== -->
    <div v-else class="req-area">
      <div v-if="reqDocs.length === 0" class="req-empty">
        {{ $t('memory.reqEmpty') }}
      </div>

      <div v-for="sd in reqDocs" :key="sd.serviceId" class="req-card">
        <div class="req-card-header">
          <span class="req-service-name">{{ sd.doc.frontmatter.service_name || sd.serviceId }}</span>
          <span class="req-service-id">{{ sd.serviceId }}</span>
          <span class="req-badge">{{ sd.doc.frontmatter.priority || 'medium' }}</span>
        </div>

        <template v-for="sec in reqSections" :key="sec.key">
          <div v-if="sd.doc.sections[sec.key].length > 0" class="req-section">
            <div class="req-section-title">{{ sec.label }}（{{ sd.doc.sections[sec.key].length }}）</div>
            <div
              v-for="(entry, i) in sd.doc.sections[sec.key]"
              :key="i"
              class="req-entry"
            >
              <span class="req-entry-text" :class="{ done: sec.key === 'done' }">{{ entry }}</span>
              <button
                v-if="sec.key !== 'done'"
                class="req-btn done-btn"
                :title="$t('memory.reqMarkDone')"
                @click="markDone(sd, sec.key, entry)"
              >✓</button>
              <button
                class="req-btn del-btn"
                :title="$t('app.delete')"
                @click="removeReq(sd, sec.key, entry)"
              >✕</button>
            </div>
          </div>
        </template>

        <div class="req-add">
          <input
            v-model="newReqText[sd.serviceId]"
            class="req-add-input"
            :placeholder="$t('memory.reqAddPlaceholder')"
            @keyup.enter="addReq(sd)"
          />
          <button class="action-btn primary req-add-btn" @click="addReq(sd)">
            ＋ {{ $t('memory.reqAdd') }}
          </button>
        </div>
      </div>
    </div>

    <div class="saved-hint" v-if="showSaved">✅ {{ $t('memory.saved') }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { memoryStore } from '../ai/memory-store'
import {
  listServiceRequirements,
  markRequirementDone,
  removeRequirementEntry,
  addRequirement,
  type RequirementDoc,
} from '../ai/requirement-store'

const { t } = useI18n()

const activeTab = ref<'memory' | 'user' | 'requirements'>('memory')
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
  const tab = activeTab.value === 'user' ? 'user' : 'memory'
  const content = memoryStore.get(tab)
  savedContent.value = content
  editingContent.value = content
  dirty.value = false
  updateCharCounts()
}

async function saveMemory() {
  const tab = activeTab.value === 'user' ? 'user' : 'memory'
  await memoryStore.setRaw(tab, editingContent.value)
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
  const tab = activeTab.value === 'user' ? 'user' : 'memory'
  const name = tab === 'memory' ? 'MEMORY.md' : 'USER.md'
  if (confirm(t('memory.confirmClear', { name }))) {
    editingContent.value = ''
    await memoryStore.setRaw(tab, '')
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

// ==== 需求浏览 / 管理 ====
type ReqEntry = { serviceId: string; doc: RequirementDoc }
const reqDocs = ref<ReqEntry[]>([])
const newReqText = reactive<Record<string, string>>({})

// 分区展示顺序与标签
const reqSections = computed(() => [
  { key: 'current' as const, label: t('memory.reqCurrent') },
  { key: 'optimize' as const, label: t('memory.reqOptimize') },
  { key: 'feedback' as const, label: t('memory.reqFeedback') },
  { key: 'done' as const, label: t('memory.reqDone') },
])

async function loadRequirements() {
  reqDocs.value = await listServiceRequirements()
}

async function markDone(sd: ReqEntry, section: keyof RequirementDoc['sections'], entry: string) {
  await markRequirementDone(sd.serviceId, sd.doc.frontmatter.service_name, entry)
  await loadRequirements()
}

async function removeReq(sd: ReqEntry, section: keyof RequirementDoc['sections'], entry: string) {
  if (!confirm(t('memory.reqConfirmDelete'))) return
  await removeRequirementEntry(sd.serviceId, section, entry)
  await loadRequirements()
}

async function addReq(sd: ReqEntry) {
  const text = (newReqText[sd.serviceId] || '').trim()
  if (!text) return
  await addRequirement(sd.serviceId, sd.doc.frontmatter.service_name, 'current', text)
  newReqText[sd.serviceId] = ''
  await loadRequirements()
}

watch(activeTab, (tab) => {
  if (tab === 'requirements') loadRequirements()
  else load()
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

/* ==== 需求浏览 / 管理 ==== */
.req-area {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.req-empty {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: 48px var(--spacing-md);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
}

.req-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  box-shadow: var(--shadow-sm);
}

.req-card-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: 10px;
}

.req-service-name {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text);
}

.req-service-id {
  flex: 1;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.req-badge {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-primary);
  background: var(--color-primary-light);
  border-radius: 999px;
  padding: 2px 8px;
  flex-shrink: 0;
}

.req-section {
  margin-bottom: 10px;
}

.req-section-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.req-entry {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 6px 10px;
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  margin-bottom: 4px;
}

.req-entry-text {
  flex: 1;
  color: var(--color-text);
  line-height: 1.5;
}

.req-entry-text.done {
  color: var(--color-text-muted);
}

.req-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.req-btn.done-btn {
  color: var(--color-success);
}

.req-btn.done-btn:hover {
  background: var(--color-success-light);
}

.req-btn.del-btn {
  color: var(--color-error);
}

.req-btn.del-btn:hover {
  background: var(--color-error-light);
}

.req-add {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: 10px;
}

.req-add-input {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.req-add-input:focus {
  border-color: var(--color-primary);
  background: var(--color-surface);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.req-add-btn {
  flex-shrink: 0;
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
