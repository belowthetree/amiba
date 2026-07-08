<!-- ============================================================
变形虫 (Amiba) — SelectDropdown (可滚动下拉选择器)
替代原生 <select>，解决选项过多时只显示 6~7 条的问题
============================================================ -->
<template>
  <div class="sel-dropdown" ref="el">
    <button
      class="sel-trigger"
      :class="{ disabled, open: isOpen }"
      :disabled="disabled"
      @click="toggle"
      @keydown.enter="toggle"
      type="button"
    >
      <span class="sel-label" :class="{ placeholder: !selectedLabel }">
        {{ selectedLabel || placeholder }}
      </span>
      <span class="sel-arrow">▾</span>
    </button>
    <div v-if="isOpen" class="sel-menu">
      <div
        v-for="opt in options"
        :key="opt.value"
        class="sel-option"
        :class="{ active: opt.value === modelValue }"
        @click="select(opt.value)"
      >{{ opt.label }}</div>
      <div v-if="options.length === 0" class="sel-empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script lang="ts">
export interface DropdownOption {
  value: string
  label: string
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  options: DropdownOption[]
  placeholder?: string
  disabled?: boolean
  emptyText?: string
}>(), {
  placeholder: '',
  disabled: false,
  emptyText: '请选择...',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const el = ref<HTMLElement | null>(null)
const isOpen = ref(false)

const selectedLabel = computed(() => {
  const found = props.options.find((o) => o.value === props.modelValue)
  return found ? found.label : ''
})

function toggle() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function select(value: string) {
  emit('update:modelValue', value)
  isOpen.value = false
}

function onDocClick(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocClick, true))
onUnmounted(() => document.removeEventListener('click', onDocClick, true))
</script>

<style scoped>
.sel-dropdown {
  position: relative;
  width: 100%;
}

.sel-trigger {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  background: white;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  text-align: left;
  color: inherit;
}

.sel-trigger:focus,
.sel-trigger.open {
  border-color: #1976D2;
}

.sel-trigger.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sel-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sel-label.placeholder {
  color: #999;
}

.sel-arrow {
  font-size: 10px;
  color: #999;
  flex-shrink: 0;
  margin-left: 8px;
  transition: transform 0.2s;
}

.sel-trigger.open .sel-arrow {
  transform: rotate(180deg);
}

.sel-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
}

.sel-option {
  padding: 10px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.sel-option:hover {
  background: #f0f7ff;
}

.sel-option.active {
  background: #e3f2fd;
  color: #1976D2;
  font-weight: 500;
}

.sel-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: #bbb;
  text-align: center;
}
</style>
