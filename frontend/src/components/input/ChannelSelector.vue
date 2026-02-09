<script setup lang="ts">
/**
 * 渠道选择器组件
 * 支持选择渠道配置
 */

import { ref, computed } from 'vue'
import { CustomScrollbar } from '../common'
import { useI18n } from '../../i18n'
import { useSearchableDropdown } from '../../composables'

const { t } = useI18n()

import type { ChannelOption } from './types'

export type { ChannelOption }

const props = withDefaults(defineProps<{
  modelValue: string
  options: ChannelOption[]
  placeholder?: string
  disabled?: boolean
  dropUp?: boolean
}>(), {
  disabled: false,
  dropUp: false
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const containerRef = ref<HTMLElement>()

const { isOpen, toggle, close, inputRef, searchQuery, filteredItems, highlightedIndex, handleKeydown: handleDropdownKeydown } = useSearchableDropdown<ChannelOption>(containerRef, {
  items: () => props.options,
  getKey: (opt) => opt.id,
  selectedKey: () => props.modelValue,
  disabled: () => !!props.disabled,
  filter: (opt, q) =>
    opt.name.toLowerCase().includes(q) ||
    opt.model?.toLowerCase().includes(q) ||
    opt.type?.toLowerCase().includes(q)
})

void inputRef // used in template via ref="inputRef"
const selectedOption = computed(() => props.options.find(opt => opt.id === props.modelValue))

function selectChannel(option: ChannelOption) {
  emit('update:modelValue', option.id)
  close()
}

function handleKeydown(event: KeyboardEvent) {
  handleDropdownKeydown(event, selectChannel)
}
</script>

<template>
  <div
    ref="containerRef"
    :class="['channel-selector', { open: isOpen, disabled, 'drop-up': dropUp }]"
    @keydown="handleKeydown"
  >
    <button
      type="button"
      class="selector-trigger"
      :disabled="disabled"
      @click="toggle"
    >
      <span v-if="selectedOption" class="selected-value">
        <span class="selected-label">{{ selectedOption.name }}</span>
      </span>
      <span v-else class="placeholder">{{ placeholder || t('components.input.channelSelector.placeholder') }}</span>
      <span :class="['select-arrow', isOpen ? 'arrow-up' : 'arrow-down']">▼</span>
    </button>

    <Transition name="dropdown">
            <div v-if="isOpen" class="selector-dropdown">
        <!-- 搜索框 -->
        <div class="search-wrapper">
          <input
            ref="inputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            :placeholder="t('components.input.channelSelector.searchPlaceholder')"
            @click.stop
          />
        </div>

        <!-- 渠道列表 -->
        <CustomScrollbar :max-height="220" :width="5" :offset="1">
          <div class="channels-list">
            <div
                            v-for="(option, index) in filteredItems"
              :key="option.id"
              :class="[
                'channel-item',
                {
                  selected: option.id === modelValue,
                                    highlighted: index === highlightedIndex
                }
              ]"
              @click="selectChannel(option)"
                            @mouseenter="highlightedIndex = index"
            >
              <div class="channel-content">
                <span class="channel-name">{{ option.name }}</span>
                <span class="channel-model">{{ option.model }}</span>
              </div>
              <span v-if="option.id === modelValue" class="check-icon">✓</span>
            </div>

                        <div v-if="filteredItems.length === 0" class="empty-state">
              <span>{{ t('components.input.channelSelector.noMatch') }}</span>
            </div>
          </div>
        </CustomScrollbar>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.channel-selector {
  position: relative;
  width: 100%;
}

.channel-selector.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.selector-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background-color 0.15s;
}

.selector-trigger:hover:not(:disabled) {
  border-color: var(--vscode-focusBorder);
}

.channel-selector.open .selector-trigger {
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
  font-size: 8px;
  margin-left: 6px;
  transition: transform 0.15s;
}

.select-arrow.arrow-up {
  transform: rotate(180deg);
}

.selector-dropdown {
  position: absolute;
  top: auto;
  bottom: 100%;
  left: 0;
  right: 0;
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

.channels-list {
  padding: 4px 0;
}

.channel-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  cursor: pointer;
  transition: background-color 0.1s;
  position: relative;
}

.channel-item:hover,
.channel-item.highlighted {
  background: var(--vscode-list-hoverBackground);
}

.channel-item.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.channel-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.channel-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-model {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-item.selected .channel-model {
  color: var(--vscode-list-activeSelectionForeground);
  opacity: 0.8;
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

/* 动画 */
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
