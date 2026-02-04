<script setup lang="ts">
/**
 * MessageActions - 消息操作按钮组件
 * 提供编辑、复制、删除、重试等操作
 */

import { ref, onUnmounted } from 'vue'
import { IconButton } from '../common'
import type { Message } from '../../types'
import { t } from '../../i18n'

defineProps<{
  message: Message
  canEdit?: boolean
  canRetry?: boolean
  canViewRaw?: boolean
}>()

const emit = defineEmits<{
  edit: []
  copy: []
  delete: []
  retry: []
  viewRaw: []
}>()

// 复制状态
const isCopied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (copyTimer) {
    clearTimeout(copyTimer)
    copyTimer = null
  }
})

// 处理复制
function handleCopy() {
  // 触发复制事件
  emit('copy')
  
  // 清除之前的定时器
  if (copyTimer) {
    clearTimeout(copyTimer)
  }
  
  // 设置为已复制状态
  isCopied.value = true
  
  // 1秒后恢复
  copyTimer = setTimeout(() => {
    isCopied.value = false
    copyTimer = null
  }, 1000)
}
</script>

<template>
  <div class="message-actions">
    <!-- 编辑按钮（仅用户消息） -->
    <IconButton
      v-if="canEdit"
      icon="codicon-edit"
      size="small"
      @click="emit('edit')"
    />

    <!-- 复制按钮 -->
    <IconButton
      :icon="isCopied ? 'codicon-check' : 'codicon-copy'"
      size="small"
      :tooltip="isCopied ? t('components.common.tooltip.copied') : t('common.copy')"
      @click="handleCopy"
    />

    <!-- 查看原始返回（仅助手消息/调试用） -->
    <IconButton
      v-if="canViewRaw"
      icon="codicon-eye"
      size="small"
      :tooltip="t('components.message.actions.viewRaw')"
      @click="emit('viewRaw')"
    />

    <!-- 重试按钮（仅 AI 消息） -->
    <IconButton
      v-if="canRetry"
      icon="codicon-refresh"
      size="small"
      @click="emit('retry')"
    />

    <!-- 删除按钮 -->
    <IconButton
      icon="codicon-trash"
      size="small"
      variant="danger"
      @click="emit('delete')"
    />
  </div>
</template>

<style scoped>
.message-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
</style>