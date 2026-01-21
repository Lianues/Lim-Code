<script setup lang="ts">
import type { Attachment } from '../../types'
import { IconButton } from '../common'
import { formatFileSize } from '../../utils/file'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const props = defineProps<{
  attachments: Attachment[]
  uploading?: boolean
}>()

const emit = defineEmits<{
  (e: 'remove', id: string): void
  (e: 'preview', attachment: Attachment): void
}>()

function getAttachmentIconClass(type: string): string {
  if (type === 'image') return 'codicon-file-media'
  if (type === 'video') return 'codicon-device-camera-video'
  if (type === 'audio') return 'codicon-unmute'
  if (type === 'code') return 'codicon-file-code'
  return 'codicon-file'
}

function hasPreview(attachment: Attachment): boolean {
  if (attachment.type === 'image' && attachment.thumbnail) return true
  if (attachment.type === 'video' && attachment.thumbnail) return true
  if (attachment.type === 'audio') return true
  return false
}
</script>

<template>
  <div class="attachments-list">
    <div
      v-for="attachment in props.attachments"
      :key="attachment.id"
      class="attachment-item"
      :class="{ 'has-preview': hasPreview(attachment) }"
    >
      <img
        v-if="attachment.type === 'image' && attachment.thumbnail"
        :src="attachment.thumbnail"
        :alt="attachment.name"
        class="attachment-preview clickable"
        @click="emit('preview', attachment)"
        :title="t('components.input.clickToPreview')"
      />

      <div
        v-else-if="attachment.type === 'video' && attachment.thumbnail"
        class="media-preview-wrapper clickable"
        @click="emit('preview', attachment)"
        :title="t('components.input.clickToPreview')"
      >
        <img
          :src="attachment.thumbnail"
          :alt="attachment.name"
          class="attachment-preview"
        />
        <i class="codicon codicon-play media-overlay-icon"></i>
      </div>

      <div
        v-else-if="attachment.type === 'audio'"
        class="media-preview-wrapper audio-placeholder clickable"
        @click="emit('preview', attachment)"
        :title="t('components.input.clickToPreview')"
      >
        <i class="codicon codicon-unmute media-center-icon"></i>
      </div>

      <i
        v-else
        :class="['codicon', getAttachmentIconClass(attachment.type), 'attachment-icon']"
      ></i>

      <span class="attachment-name">{{ attachment.name }}</span>
      <span class="attachment-size">{{ formatFileSize(attachment.size) }}</span>
      <IconButton
        icon="codicon-close"
        size="small"
        :disabled="props.uploading"
        @click="emit('remove', attachment.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.attachments-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-list-hoverBackground);
  border-radius: var(--radius-sm, 2px);
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  background: var(--vscode-editor-background);
  border-radius: var(--radius-sm, 2px);
  transition: background-color var(--transition-fast, 0.1s);
}

.attachment-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.attachment-icon {
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}

.attachment-preview {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.clickable {
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}

.clickable:hover {
  opacity: 0.8;
  transform: scale(1.05);
}

.attachment-item.has-preview {
  padding: var(--spacing-xs, 4px);
}

.media-preview-wrapper {
  position: relative;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
}

.media-preview-wrapper .attachment-preview {
  width: 100%;
  height: 100%;
}

.audio-placeholder {
  background: linear-gradient(135deg, #3a3d41, #2d2d30);
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-overlay-icon {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 10px;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.media-center-icon {
  font-size: 16px;
  color: var(--vscode-foreground);
  opacity: 0.8;
}

.attachment-name {
  flex: 1;
  font-size: 12px;
  color: var(--vscode-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
}
</style>
