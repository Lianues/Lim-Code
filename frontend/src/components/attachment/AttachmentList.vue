<script setup lang="ts">
/**
 * AttachmentList - 附件列表
 * 展示消息中的附件，支持预览和下载
 */

import { ref } from 'vue'
import AttachmentItem from './AttachmentItem.vue'
import AttachmentPreview from './AttachmentPreview.vue'
import type { Attachment } from '../../types'

defineProps<{
  attachments: Attachment[]
  compact?: boolean  // 紧凑模式
}>()

const emit = defineEmits<{
  download: [attachment: Attachment]
}>()

const previewAttachment = ref<Attachment | null>(null)
const showPreview = ref(false)

// 打开预览
function openPreview(attachment: Attachment) {
  previewAttachment.value = attachment
  showPreview.value = true
}

// 关闭预览
function closePreview() {
  showPreview.value = false
  previewAttachment.value = null
}

// 处理下载
function handleDownload(attachment: Attachment) {
  emit('download', attachment)
}
</script>

<template>
  <div :class="['attachment-list', { compact }]">
    <AttachmentItem
      v-for="attachment in attachments"
      :key="attachment.id"
      :attachment="attachment"
      :compact="compact"
      @preview="openPreview"
      @download="handleDownload"
    />

    <!-- 预览弹窗 -->
    <AttachmentPreview
      v-if="previewAttachment"
      :attachment="previewAttachment"
      :visible="showPreview"
      @close="closePreview"
      @download="handleDownload"
    />
  </div>
</template>

<style scoped>
.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-list.compact {
  gap: 4px;
}
</style>