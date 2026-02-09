<script setup lang="ts">
/**
 * 重试对话框组件
 * 提供重试、回档并重试选项
 */

import { computed } from 'vue'
import type { CheckpointRecord } from '../../types'
import { t } from '../../i18n'

interface Props {
  modelValue?: boolean
  /** 消息前关联的检查点（before 阶段） */
  checkpoints?: CheckpointRecord[]
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  checkpoints: () => []
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 普通重试 */
  retry: []
  /** 回档并重试 */
  restoreAndRetry: [checkpointId: string]
  cancel: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

/** 是否有可用的检查点 */
const hasCheckpoints = computed(() => props.checkpoints.length > 0)

/** 最近的检查点（用于回档） */
const latestCheckpoint = computed(() => {
  if (props.checkpoints.length === 0) return null
  
  // 按时间戳降序排序，取最新的
  return [...props.checkpoints].sort((a, b) => b.timestamp - a.timestamp)[0]
})

/** 格式化检查点描述 */
function formatCheckpointDesc(checkpoint: CheckpointRecord): string {
  const toolName = checkpoint.toolName || 'tool'
  const isAfter = checkpoint.phase === 'after'
  // 对于消息类型，显示更友好的描述
  if (toolName === 'user_message') {
    return isAfter
      ? t('components.common.retryDialog.restoreToAfterUserMessage')
      : t('components.common.retryDialog.restoreToUserMessage')
  } else if (toolName === 'model_message') {
    return isAfter
      ? t('components.common.retryDialog.restoreToAfterAssistantMessage')
      : t('components.common.retryDialog.restoreToAssistantMessage')
  } else if (toolName === 'tool_batch') {
    return isAfter
      ? t('components.common.retryDialog.restoreToAfterToolBatch')
      : t('components.common.retryDialog.restoreToToolBatch')
  }
  return isAfter
    ? t('components.common.retryDialog.restoreToAfterTool').replace('{toolName}', toolName)
    : t('components.common.retryDialog.restoreToTool').replace('{toolName}', toolName)
}

function handleCancel() {
  visible.value = false
  emit('cancel')
}

function handleRetry() {
  visible.value = false
  emit('retry')
}

function handleRestoreAndRetry() {
  if (latestCheckpoint.value) {
    visible.value = false
    emit('restoreAndRetry', latestCheckpoint.value.id)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="dialog-overlay">
        <div class="dialog">
          <div class="dialog-header">
            <i class="codicon codicon-refresh dialog-icon"></i>
            <span class="dialog-title">{{ t('components.common.retryDialog.title') }}</span>
          </div>
          <div class="dialog-body">
            <p>{{ t('components.common.retryDialog.message') }}</p>
            <p v-if="hasCheckpoints" class="checkpoint-hint">
              <i class="codicon codicon-info"></i>
              {{ t('components.common.retryDialog.checkpointHint') }}
            </p>
          </div>
          <div class="dialog-footer">
            <button class="dialog-btn cancel" @click="handleCancel">
              {{ t('components.common.retryDialog.cancel') }}
            </button>
            <!-- 有检查点时显示回档选项 -->
            <button
              v-if="latestCheckpoint"
              class="dialog-btn restore"
              @click="handleRestoreAndRetry"
            >
              <i class="codicon codicon-discard"></i>
              {{ formatCheckpointDesc(latestCheckpoint) }}
            </button>
            <button class="dialog-btn confirm" @click="handleRetry">
              {{ t('components.common.retryDialog.retry') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  min-width: 280px;
  max-width: min(400px, 90%);
  width: calc(100% - 32px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

@media (max-width: 350px) {
  .dialog {
    min-width: unset;
    width: calc(100% - 16px);
    margin: 0 8px;
  }
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.dialog-icon {
  font-size: 18px;
  color: var(--vscode-editorWarning-foreground);
}

.dialog-title {
  font-weight: 500;
  font-size: 14px;
}

.dialog-body {
  padding: 16px;
}

.dialog-body p {
  margin: 0;
  font-size: 13px;
  color: var(--vscode-foreground);
  line-height: 1.5;
}

.dialog-body .checkpoint-hint {
  margin-top: 12px;
  padding: 8px 10px;
  background: var(--vscode-editorInfo-background, rgba(0, 120, 212, 0.1));
  border-radius: 4px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--vscode-editorInfo-foreground, #3794ff);
}

.dialog-body .checkpoint-hint .codicon {
  flex-shrink: 0;
  margin-top: 1px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--vscode-panel-border);
  flex-wrap: wrap;
}

.dialog-btn {
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: background-color 0.15s, opacity 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dialog-btn.cancel {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
}

.dialog-btn.cancel:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.dialog-btn.restore {
  background: var(--vscode-editorInfo-foreground);
  color: white;
}

.dialog-btn.restore:hover {
  opacity: 0.9;
}

.dialog-btn.restore .codicon {
  font-size: 12px;
}

.dialog-btn.confirm {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.dialog-btn.confirm:hover {
  background: var(--vscode-button-hoverBackground);
}

/* 动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.15s ease;
}

.dialog-fade-enter-active .dialog,
.dialog-fade-leave-active .dialog {
  transition: transform 0.15s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog,
.dialog-fade-leave-to .dialog {
  transform: scale(0.95);
}
</style>