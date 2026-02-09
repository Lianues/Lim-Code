<script setup lang="ts">
/**
 * 模型选择器组件
 * 点击后向上弹出模型列表下拉框
 */

import { ref, computed } from 'vue'
import { CustomScrollbar } from '../common'
import { useI18n } from '../../i18n'
import { useSearchableDropdown } from '../../composables'

const { t } = useI18n()

import type { ModelInfo } from './types'

export type { ModelInfo }

const props = withDefaults(defineProps<{
  models: ModelInfo[]
  modelValue: string
  disabled?: boolean
}>(), {
  models: () => [],
  disabled: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', modelId: string): void
}>()

const containerRef = ref<HTMLElement>()

const { isOpen, toggle, close, inputRef, searchQuery, filteredItems, highlightedIndex, handleKeydown: handleDropdownKeydown } = useSearchableDropdown<ModelInfo>(containerRef, {
  items: () => props.models,
  getKey: (m) => m.id,
  selectedKey: () => props.modelValue,
  disabled: () => !!props.disabled,
  filter: (m, q) => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)
})

void inputRef // used in template via ref="inputRef"
const filteredModels = computed(() => filteredItems.value)

function selectModel(model: ModelInfo) {
  emit('update:modelValue', model.id)
  close()
}

function handleKeydown(event: KeyboardEvent) {
  handleDropdownKeydown(event, selectModel)
}
</script>

<template>
  <div
    ref="containerRef"
        :class="['model-selector', { open: isOpen, disabled }]"
    @keydown="handleKeydown"
  >
    <button
      type="button"
      class="model-trigger"
      :disabled="disabled"
            @click="toggle"
    >
      <span class="model-id">{{ modelValue || t('components.input.modelSelector.placeholder') }}</span>
            <span :class="['select-arrow', isOpen ? 'arrow-up' : 'arrow-down']">▼</span>
    </button>

    <Transition name="dropdown">
            <div v-if="isOpen" class="model-dropdown">
        <div class="search-wrapper">
          <input
            ref="inputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            :placeholder="t('components.input.modelSelector.searchPlaceholder')"
            @click.stop
          />
        </div>

        <CustomScrollbar :max-height="220" :width="5" :offset="1">
          <div class="models-list">
            <template v-if="filteredModels.length > 0">
              <div
                v-for="(model, index) in filteredModels"
                :key="model.id"
                                :class="['model-item', { selected: model.id === modelValue, highlighted: index === highlightedIndex }]"
                @click="selectModel(model)"
                @mouseenter="highlightedIndex = index"
              >
                <div class="model-content">
                  <span class="model-name">{{ model.name || model.id }}</span>
                  <span v-if="model.name && model.name !== model.id" class="model-id-hint">{{ model.id }}</span>
                </div>
                <span v-if="model.id === modelValue" class="check-icon">✓</span>
              </div>
            </template>
            <div v-else class="empty-state">
                            <span>{{ searchQuery ? t('components.input.modelSelector.noMatch') : t('components.input.modelSelector.addInSettings') }}</span>
            </div>
          </div>
        </CustomScrollbar>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.model-selector {
  position: relative;
  width: 100%;
}

.model-selector.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.model-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 8px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s, color 0.15s;
}

.model-trigger:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}

.model-selector.open .model-trigger {
  background: var(--vscode-toolbar-activeBackground);
  color: var(--vscode-foreground);
}

.model-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-arrow {
  flex-shrink: 0;
  font-size: 8px;
  margin-left: 6px;
  transition: transform 0.15s;
}

.select-arrow.arrow-up {
  transform: rotate(180deg);
}

.model-dropdown {
  position: absolute;
  bottom: 100%;
  right: 0;
  width: 180px;
  min-width: 180px;
  margin-bottom: 4px;
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  overflow: visible;
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

.models-list {
  padding: 4px 0;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  cursor: pointer;
  transition: background-color 0.1s;
}

.model-item:hover,
.model-item.highlighted {
  background: var(--vscode-list-hoverBackground);
}

.model-item.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.model-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.model-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-id-hint {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-item.selected .model-id-hint {
  color: var(--vscode-list-activeSelectionForeground);
  opacity: 0.7;
}

.check-icon {
  flex-shrink: 0;
  font-size: 12px;
  margin-left: 8px;
}

.loading-state,
.empty-state {
  padding: 12px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
