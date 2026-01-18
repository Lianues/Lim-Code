<script setup lang="ts">
/**
 * 模式选择器组件
 * 用于在输入区域选择提示词模式
 */

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { CustomScrollbar } from '../common'
import { useI18n } from '../../i18n'

const { t } = useI18n()

export interface PromptMode {
  id: string
  name: string
  icon?: string
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: PromptMode[]
  placeholder?: string
  disabled?: boolean
  dropUp?: boolean
}>(), {
  disabled: false,
  dropUp: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'openSettings'): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const highlightedIndex = ref(-1)
const containerRef = ref<HTMLElement>()
const inputRef = ref<HTMLInputElement>()

const selectedOption = computed(() => {
  return props.options.find(opt => opt.id === props.modelValue)
})

const filteredOptions = computed(() => {
  if (!searchQuery.value) {
    return props.options
  }
  const query = searchQuery.value.toLowerCase()
  return props.options.filter(opt =>
    opt.name.toLowerCase().includes(query)
  )
})

function open() {
  if (props.disabled) return
  isOpen.value = true
  highlightedIndex.value = props.options.findIndex(opt => opt.id === props.modelValue)
  searchQuery.value = ''
  setTimeout(() => inputRef.value?.focus(), 10)
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

function selectMode(option: PromptMode) {
  emit('update:modelValue', option.id)
  close()
}

function openSettings() {
  emit('openSettings')
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
        selectMode(filteredOptions.value[highlightedIndex.value])
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

// 当搜索变化时重置高亮
watch(searchQuery, () => {
  highlightedIndex.value = filteredOptions.value.length > 0 ? 0 : -1
})

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div ref="containerRef" class="mode-selector" :class="{ disabled, open: isOpen }">
    <!-- 触发按钮 -->
    <button
      class="mode-trigger"
      :disabled="disabled"
      @click="toggle"
      @keydown="handleKeydown"
      :title="selectedOption?.name || t('components.input.mode.selectMode')"
    >
      <i :class="['codicon', selectedOption?.icon ? `codicon-${selectedOption.icon}` : 'codicon-symbol-method']"></i>
      <span class="mode-name">{{ selectedOption?.name || t('components.input.mode.selectMode') }}</span>
      <i class="codicon codicon-chevron-down arrow-icon" :class="{ open: isOpen }"></i>
    </button>

    <!-- 下拉面板 -->
    <Transition name="dropdown">
      <div v-if="isOpen" class="mode-panel" :class="{ 'drop-up': dropUp }">
        <!-- 搜索框 -->
        <div class="search-wrapper">
          <input
            ref="inputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            :placeholder="t('components.input.mode.search')"
            @keydown="handleKeydown"
            @click.stop
          />
        </div>
        
        <CustomScrollbar :max-height="180" :width="5" :offset="1">
          <div class="mode-list">
            <div
              v-for="(option, index) in filteredOptions"
              :key="option.id"
              class="mode-item"
              :class="{ 
                selected: option.id === modelValue,
                highlighted: index === highlightedIndex
              }"
              @click="selectMode(option)"
              @mouseenter="highlightedIndex = index"
            >
              <i :class="['codicon', option.icon ? `codicon-${option.icon}` : 'codicon-symbol-method']"></i>
              <span class="mode-item-name">{{ option.name }}</span>
              <i v-if="option.id === modelValue" class="codicon codicon-check"></i>
            </div>
            
            <!-- 无结果提示 -->
            <div v-if="filteredOptions.length === 0" class="no-results">
              {{ t('components.input.mode.noResults') }}
            </div>
          </div>
        </CustomScrollbar>
        
        <!-- 分隔线 -->
        <div class="mode-divider"></div>
        
        <!-- 设置按钮 -->
        <button class="mode-settings-btn" @click="openSettings">
          <i class="codicon codicon-settings-gear"></i>
          <span>{{ t('components.input.mode.manageMode') }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mode-selector {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.mode-selector.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.mode-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  color: var(--vscode-input-foreground);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  height: 24px;
  width: 100px;
  min-width: 100px;
  max-width: 100px;
}

.mode-trigger:hover:not(:disabled) {
  border-color: var(--vscode-focusBorder);
}

.mode-selector.open .mode-trigger {
  border-color: var(--vscode-focusBorder);
}

.mode-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.mode-trigger .codicon:first-child {
  flex-shrink: 0;
  font-size: 12px;
}

.mode-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

.arrow-icon {
  flex-shrink: 0;
  font-size: 10px;
  transition: transform 0.15s ease;
}

.arrow-icon.open {
  transform: rotate(180deg);
}

.mode-panel {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 200px;
  width: 200px;
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  overflow: hidden;
}

.mode-panel.drop-up {
  top: auto;
  bottom: 100%;
  margin-top: 0;
  margin-bottom: 4px;
}

/* 搜索框 */
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

.mode-list {
  padding: 4px;
}

.mode-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.mode-item:hover,
.mode-item.highlighted {
  background: var(--vscode-list-hoverBackground);
}

.mode-item.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.mode-item .codicon {
  font-size: 14px;
  flex-shrink: 0;
}

.mode-item-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-item .codicon-check {
  font-size: 12px;
  margin-left: 8px;
}

.no-results {
  padding: 12px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.mode-divider {
  height: 1px;
  background: var(--vscode-panel-border);
  margin: 4px 0;
}

.mode-settings-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  background: transparent;
  border: none;
  color: var(--vscode-textLink-foreground);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s ease;
}

.mode-settings-btn:hover {
  background: var(--vscode-list-hoverBackground);
}

.mode-settings-btn .codicon {
  font-size: 14px;
}

/* 下拉动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.mode-selector.drop-up .dropdown-enter-from,
.mode-selector.drop-up .dropdown-leave-to {
  transform: translateY(-4px);
}
</style>
