<script setup lang="ts">
/**
 * ConversationList - 对话历史列表组件
 * 扁平化设计，显示所有对话记录
 */

import { ref } from 'vue'
import { IconButton } from '../common'
import { useChatStore } from '../../stores'
import { sendToExtension } from '../../utils/vscode'
import type { Conversation } from '../../stores'
import { t } from '../../i18n'

const props = defineProps<{
  conversations: Conversation[]
  currentId: string | null
  /** 初始加载（整页 loading） */
  loading?: boolean
  /** 滚动分页加载（底部 loading） */
  loadingMore?: boolean
  /** 是否还有更多可加载 */
  hasMore?: boolean
  formatTime: (timestamp: number) => string
}>()

const emit = defineEmits<{
  select: [id: string]
  delete: [id: string]
}>()

// 使用 chatStore 检查删除状态
const chatStore = useChatStore()

// 悬停状态
const hoverItemId = ref<string | null>(null)

// 处理删除
function handleDelete(id: string) {
  // 如果正在删除，不重复触发
  if (chatStore.isDeletingConversation(id)) {
    return
  }
  emit('delete', id)
}

// 处理在文件管理器中显示
async function handleRevealInExplorer(id: string) {
  try {
    await sendToExtension('conversation.revealInExplorer', { conversationId: id })
  } catch (error) {
    console.error('Failed to reveal in explorer:', error)
  }
}
</script>

<template>
  <div class="conversation-list">
    <!-- 加载状态 -->
    <div v-if="loading" class="list-loading">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
    </div>

    <!-- 空状态 -->
    <div v-else-if="conversations.length === 0" class="list-empty">
      <span class="empty-text">{{ t('components.history.empty') }}</span>
    </div>

    <!-- 对话列表 -->
    <div v-else class="list-items">
      <div
        v-for="conversation in conversations"
        :key="conversation.id"
        :class="['conversation-item', { active: conversation.id === currentId }]"
        @click="emit('select', conversation.id)"
        @mouseenter="hoverItemId = conversation.id"
        @mouseleave="hoverItemId = null"
      >
        <div class="item-content">
          <div class="item-title">{{ conversation.title }}</div>
          <div class="item-meta">
            <span class="item-time">{{ formatTime(conversation.updatedAt) }}</span>
            <span v-if="conversation.messageCount > 0" class="item-count">
              {{ conversation.messageCount }} messages
            </span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div
          v-show="hoverItemId === conversation.id || chatStore.isDeletingConversation(conversation.id)"
          class="item-actions"
          @click.stop
        >
          <i
            v-if="chatStore.isDeletingConversation(conversation.id)"
            class="codicon codicon-loading codicon-modifier-spin deleting-indicator"
          ></i>
          <template v-else>
            <IconButton
              icon="codicon-folder-opened"
              size="small"
              :title="t('components.history.revealInExplorer')"
              @click="handleRevealInExplorer(conversation.id)"
            />
            <IconButton
              icon="codicon-trash"
              size="small"
              :title="t('components.history.deleteConversation')"
              @click="handleDelete(conversation.id)"
            />
          </template>
        </div>
      </div>

      <!-- 底部滚动加载指示（无感加载：仅展示轻量 loading） -->
      <div v-if="loadingMore" class="list-loading-more">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conversation-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl, 32px) var(--spacing-md, 16px);
  color: var(--vscode-descriptionForeground);
}

.list-loading .codicon {
  font-size: 18px;
}

.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl, 32px) var(--spacing-md, 16px);
}

.empty-text {
  font-size: 13px;
  color: var(--vscode-descriptionForeground);
}

.list-items {
  display: flex;
  flex-direction: column;
}

.list-loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-sm, 8px) 0;
  color: var(--vscode-descriptionForeground);
}

.list-loading-more .codicon {
  font-size: 14px;
}

.conversation-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--spacing-sm, 8px) var(--spacing-md, 16px);
  cursor: pointer;
  transition: background-color var(--transition-fast, 0.1s);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.conversation-item:last-child {
  border-bottom: none;
}

.conversation-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.conversation-item.active {
  background: var(--vscode-list-activeSelectionBackground);
}

.item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.item-time {
  opacity: 0.8;
}

.item-count {
  opacity: 0.6;
}

.item-preview {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex-shrink: 0;
  margin-left: var(--spacing-sm, 8px);
}

.deleting-indicator {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
}

.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>