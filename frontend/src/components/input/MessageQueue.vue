<script setup lang="ts">
/**
 * MessageQueue - 消息候选区
 * 显示排队等待发送的消息列表，渲染在输入框上方
 * 每条消息支持"立即发送"、"编辑"、"删除"和"拖拽排序"操作
 */

import { ref } from 'vue'
import { useChatStore } from '../../stores'
import { EditDialog } from '../common'
import { useI18n } from '../../i18n'
import type { Attachment } from '../../types'

const { t } = useI18n()
const chatStore = useChatStore()

// ========== 拖拽排序 ==========

/** 当前正在拖拽的项索引 */
const dragFromIndex = ref<number | null>(null)
/** 当前拖拽悬停的目标索引 */
const dragOverIndex = ref<number | null>(null)

function handleDragStart(index: number, e: DragEvent) {
  dragFromIndex.value = index
  dragOverIndex.value = null

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // 需要设置 data 否则 Firefox 不触发 drag
    e.dataTransfer.setData('text/plain', String(index))
  }
}

function handleDragOver(index: number, e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
  if (dragFromIndex.value !== null && dragFromIndex.value !== index) {
    dragOverIndex.value = index
  }
}

function handleDragLeave(_index: number, _e: DragEvent) {
  // 不立即清除 dragOverIndex，避免子元素进出时闪烁
}

function handleDrop(index: number, e: DragEvent) {
  e.preventDefault()
  if (dragFromIndex.value !== null && dragFromIndex.value !== index) {
    chatStore.moveQueuedMessage(dragFromIndex.value, index)
  }
  dragFromIndex.value = null
  dragOverIndex.value = null
}

function handleDragEnd() {
  dragFromIndex.value = null
  dragOverIndex.value = null
}

// ========== 编辑 ==========

/** 编辑弹窗显隐 */
const showEditDialog = ref(false)
/** 当前正在编辑的消息 ID */
const editingId = ref<string | null>(null)
/** 当前正在编辑的消息原始内容 */
const editingContent = ref('')
/** 当前正在编辑的消息原始附件 */
const editingAttachments = ref<Attachment[]>([])

/** 打开编辑弹窗 */
function handleStartEdit(id: string) {
  const item = chatStore.messageQueue.find(m => m.id === id)
  if (!item) return

  editingId.value = id
  editingContent.value = item.content
  editingAttachments.value = item.attachments
  showEditDialog.value = true
}

/** 编辑完成 */
function handleEditDone(newContent: string, attachments: Attachment[]) {
  if (editingId.value) {
    chatStore.updateQueuedMessage(editingId.value, newContent, attachments)
  }
  editingId.value = null
  editingContent.value = ''
  editingAttachments.value = []
}

// ========== 操作 ==========

/** 立即发送指定消息 */
async function handleSendNow(id: string) {
  await chatStore.sendQueuedMessageNow(id)
}

/** 移除指定消息 */
function handleRemove(id: string) {
  chatStore.removeQueuedMessage(id)
}

/** 截断显示文本 */
function truncate(text: string, maxLen = 80): string {
  const singleLine = text.replace(/\n/g, ' ')
  if (singleLine.length <= maxLen) return singleLine
  return singleLine.slice(0, maxLen) + '\u2026'
}
</script>

<template>
  <div v-if="chatStore.messageQueue.length > 0" class="message-queue">
    <div class="queue-header">
      <i class="codicon codicon-list-ordered queue-icon"></i>
      <span class="queue-title">{{ t('components.input.queue.title') }}</span>
      <span class="queue-count">({{ chatStore.messageQueue.length }})</span>
    </div>
    <div class="queue-list">
      <div
        v-for="(item, index) in chatStore.messageQueue"
        :key="item.id"
        class="queue-item"
        :class="{
          'queue-item--dragging': dragFromIndex === index,
          'queue-item--drag-over': dragOverIndex === index && dragFromIndex !== index
        }"
        :draggable="false"
        @dragover="handleDragOver(index, $event)"
        @dragleave="handleDragLeave(index, $event)"
        @drop="handleDrop(index, $event)"
      >
        <!-- 左侧拖拽手柄 -->
        <span
          class="queue-drag-handle"
          draggable="true"
          :title="t('components.input.queue.drag')"
          @dragstart="handleDragStart(index, $event)"
          @dragend="handleDragEnd"
        >
          <i class="codicon codicon-gripper"></i>
        </span>

        <span class="queue-item-index">{{ index + 1 }}</span>
        <span class="queue-item-content" :title="item.content">
          {{ truncate(item.content) }}
          <span v-if="item.attachments.length > 0" class="queue-item-attachments">
            <i class="codicon codicon-attach"></i>{{ item.attachments.length }}
          </span>
        </span>
        <div class="queue-item-actions">
          <button
            class="queue-action-btn edit-btn"
            :title="t('components.input.queue.edit')"
            @click="handleStartEdit(item.id)"
          >
            <i class="codicon codicon-edit"></i>
          </button>
          <button
            class="queue-action-btn send-now-btn"
            :title="t('components.input.queue.sendNow')"
            @click="handleSendNow(item.id)"
          >
            <i class="codicon codicon-play"></i>
          </button>
          <button
            class="queue-action-btn remove-btn"
            :title="t('components.input.queue.remove')"
            @click="handleRemove(item.id)"
          >
            <i class="codicon codicon-close"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗（复用现有 EditDialog） -->
    <EditDialog
      v-model="showEditDialog"
      :original-content="editingContent"
      :original-attachments="editingAttachments"
      @edit="handleEditDone"
    />
  </div>
</template>

<style scoped>
.message-queue {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.1));
  border: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.2));
  border-radius: 4px;
  margin-bottom: 6px;
  max-height: 150px;
  overflow-y: auto;
}

.queue-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.15));
  margin-bottom: 2px;
}

.queue-icon {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.queue-title {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
}

.queue-count {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 3px;
  transition: background-color 0.1s, box-shadow 0.15s;
  border: 1px solid transparent;
}

.queue-item:hover {
  background: var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.1));
}

/* 正在被拖拽的项：半透明 */
.queue-item--dragging {
  opacity: 0.35;
}

/* 拖拽悬停目标：顶部指示线 */
.queue-item--drag-over {
  border-top: 2px solid var(--vscode-focusBorder, #007fd4);
  padding-top: 2px;
}

/* ========== 拖拽手柄 ========== */
.queue-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
  flex-shrink: 0;
  cursor: grab;
  color: var(--vscode-descriptionForeground);
  opacity: 0;
  transition: opacity 0.1s;
  border-radius: 2px;
}

.queue-drag-handle:active {
  cursor: grabbing;
}

.queue-item:hover .queue-drag-handle {
  opacity: 0.6;
}

.queue-drag-handle:hover {
  opacity: 1 !important;
  background: var(--vscode-toolbar-hoverBackground);
}

.queue-drag-handle .codicon {
  font-size: 14px;
}

.queue-item-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  font-size: 10px;
  font-weight: 600;
  color: var(--vscode-badge-foreground, #fff);
  background: var(--vscode-badge-background, #4d4d4d);
  border-radius: 9px;
  flex-shrink: 0;
}

.queue-item-content {
  flex: 1;
  font-size: 12px;
  color: var(--vscode-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.queue-item-attachments {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.8;
}

.queue-item-attachments .codicon {
  font-size: 10px;
}

.queue-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s;
}

.queue-item:hover .queue-item-actions {
  opacity: 1;
}

.queue-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--vscode-foreground);
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.1s, background-color 0.1s;
}

.queue-action-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground);
}

.queue-action-btn .codicon {
  font-size: 12px;
}

.edit-btn:hover {
  color: var(--vscode-charts-blue, #3794ff);
}

.send-now-btn:hover {
  color: var(--vscode-charts-green, #89d185);
}

.remove-btn:hover {
  color: var(--vscode-charts-red, #f14c4c);
}
</style>
