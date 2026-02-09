<script setup lang="ts">
/**
 * 自定义下拉选择框组件
 * 支持 v-model 双向绑定
 */

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import CustomScrollbar from './CustomScrollbar.vue'
import type { SelectOption } from './types'

export type { SelectOption }

const props = withDefaults(defineProps<{
  modelValue: string
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  searchable?: boolean
  dropUp?: boolean  // 向上展开
  compact?: boolean  // 紧凑模式
}>(), {
  placeholder: '请选择',
  disabled: false,
  searchable: false,
  dropUp: false,
  compact: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const highlightedIndex = ref(-1)
const containerRef = ref<HTMLElement>()
const inputRef = ref<HTMLInputElement>()

const selectedOption = computed(() => {
  return props.options.find(opt => opt.value === props.modelValue)
})

const filteredOptions = computed(() => {
  if (!searchQuery.value) {
    return props.options
  }
  const query = searchQuery.value.toLowerCase()
  return props.options.filter(opt => 
    opt.label.toLowerCase().includes(query) ||
    opt.description?.toLowerCase().includes(query)
  )
})

function open() {
  if (props.disabled) return
  isOpen.value = true
  highlightedIndex.value = props.options.findIndex(opt => opt.value === props.modelValue)
  if (props.searchable) {
    searchQuery.value = ''
    setTimeout(() => inputRef.value?.focus(), 10)
  }
}

function close() {
  isOpen.value = false
  searchQuery.value = ''
  highlightedIndex.value = -1
}

function toggle() {
  if (isOpen.value) {
    close()
  } else {
    open()
  }
}

function selectOption(option: SelectOption) {
  emit('update:modelValue', option.value)
  close()
}

function handleKeydown(event: KeyboardEvent) {
  if (!isOpen.value) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      open()
    }
    return
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      highlightedIndex.value = Math.min(
        highlightedIndex.value + 1,
        filteredOptions.value.length - 1
      )
      break
    case 'ArrowUp':
      event.preventDefault()
      highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0)
      break
    case 'Enter':
      event.preventDefault()
      if (highlightedIndex.value >= 0 && highlightedIndex.value < filteredOptions.value.length) {
        selectOption(filteredOptions.value[highlightedIndex.value])
      }
      break
    case 'Escape':
      event.preventDefault()
      close()
      break
  }
}

function handleClickOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    close()
  }
}

watch(searchQuery, () => {
  highlightedIndex.value = 0
})

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div
    ref="containerRef"
    :class="['custom-select', { open: isOpen, disabled, 'drop-up': dropUp, compact }]"
    @keydown="handleKeydown"
  >
    <button
      type="button"
      class="select-trigger"
      :disabled="disabled"
      @click="toggle"
    >
      <span v-if="selectedOption" class="selected-value">
        <span class="selected-label">{{ selectedOption.label }}</span>
      </span>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <span :class="['select-arrow', isOpen ? 'arrow-up' : 'arrow-down']">▼</span>
    </button>

    <Transition name="dropdown">
      <div v-if="isOpen" class="select-dropdown">
        <div v-if="searchable" class="search-wrapper">
          <input
            ref="inputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="搜索..."
            @click.stop
          />
        </div>

        <CustomScrollbar :max-height="200" :width="5" :offset="1">
          <div class="options-list">
            <div
              v-for="(option, index) in filteredOptions"
              :key="option.value"
              :class="[
                'option-item',
                {
                  selected: option.value === modelValue,
                  highlighted: index === highlightedIndex
                }
              ]"
              @click="selectOption(option)"
              @mouseenter="highlightedIndex = index"
            >
              <div class="option-content">
                <span class="option-label">{{ option.label }}</span>
                <span v-if="option.description" class="option-description">{{ option.description }}</span>
              </div>
              <span v-if="option.value === modelValue" class="check-icon">✓</span>
            </div>

            <div v-if="filteredOptions.length === 0" class="empty-state">
              <span>没有匹配的选项</span>
            </div>
          </div>
        </CustomScrollbar>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.custom-select {
  position: relative;
  width: 100%;
}

.custom-select.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background-color 0.15s;
}

.select-trigger:hover:not(:disabled) {
  border-color: var(--vscode-focusBorder);
}

.custom-select.open .select-trigger {
  border-color: var(--vscode-focusBorder);
}

.selected-value {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.selected-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.select-arrow {
  flex-shrink: 0;
  font-size: 10px;
  margin-left: 8px;
  transition: transform 0.15s;
}

.select-arrow.arrow-up {
  transform: rotate(180deg);
}

.select-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  overflow: hidden;
}

/* 向上展开 */
.custom-select.drop-up .select-dropdown {
  top: auto;
  bottom: 100%;
  margin-top: 0;
  margin-bottom: 4px;
}

/* 紧凑模式 */
.custom-select.compact .select-trigger {
  padding: 4px 8px;
  font-size: 12px;
}

.custom-select.compact .select-arrow {
  font-size: 8px;
  margin-left: 6px;
}

.search-wrapper {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--vscode-dropdown-border);
  min-width: 0;
  overflow: hidden;
}

.search-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 3px;
  padding: 4px 8px;
  color: var(--vscode-input-foreground);
  font-size: 12px;
  outline: none;
}

.search-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.options-list {
  padding: 4px 0;
}

.option-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin: 0;
  cursor: pointer;
  transition: background-color 0.1s;
}

.option-item:hover,
.option-item.highlighted {
  background: var(--vscode-list-hoverBackground);
}

.option-item.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.option-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-label {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-item.selected .option-description {
  color: var(--vscode-list-activeSelectionForeground);
  opacity: 0.8;
}

.check-icon {
  flex-shrink: 0;
  font-size: 14px;
  margin-left: 8px;
}

.empty-state {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>