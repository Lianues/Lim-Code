<script setup lang="ts">
/**
 * HistoryPanel - 对话历史面板
 * 使用Drawer组件包裹ConversationList
 */

import { Drawer, CustomScrollbar } from '../common'
import ConversationList from './ConversationList.vue'
import type { Conversation } from '../../stores'
import { t } from '../../i18n'

defineProps<{
  modelValue: boolean
  conversations: Conversation[]
  currentId: string | null
  loading?: boolean
  formatTime: (timestamp: number) => string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [id: string]
  delete: [id: string]
  newChat: []
}>()

function handleSelect(id: string) {
  emit('select', id)
  emit('update:modelValue', false)
}

function handleNewChat() {
  emit('newChat')
  emit('update:modelValue', false)
}
</script>

<template>
  <Drawer
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="t('components.history.title')"
    placement="left"
    width="320px"
  >
    <div class="history-panel">
      <!-- 新建对话按钮 -->
      <div class="panel-header">
        <button class="new-chat-button" @click="handleNewChat">
          <i class="codicon codicon-add"></i>
          <span>{{ t('components.header.newChat') }}</span>
        </button>
      </div>

      <!-- 对话列表 -->
      <CustomScrollbar class="panel-content">
        <ConversationList
          :conversations="conversations"
          :current-id="currentId"
          :loading="loading"
          :format-time="formatTime"
          @select="handleSelect"
          @delete="emit('delete', $event)"
        />
      </CustomScrollbar>
    </div>
  </Drawer>
</template>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  margin: calc(-1 * var(--spacing-lg, 20px));
}

.panel-header {
  padding: var(--spacing-md, 16px);
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.new-chat-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm, 8px);
  width: 100%;
  padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
  background: var(--vscode-foreground);
  color: var(--vscode-editor-background);
  border: none;
  border-radius: var(--radius-sm, 2px);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: opacity var(--transition-fast, 0.1s);
}

.new-chat-button:hover {
  opacity: 0.85;
}

.new-chat-button .codicon {
  font-size: 14px;
}

.panel-content {
  flex: 1;
  overflow: hidden;
}
</style>