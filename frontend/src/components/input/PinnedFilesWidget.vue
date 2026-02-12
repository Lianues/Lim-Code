<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { IconButton, Tooltip } from '../common'
import { getFileIcon } from '../../utils/fileIcons'
import { showNotification } from '../../utils/vscode'
import { extractVscodeDropItems } from '../../utils/vscodeDragDrop'
import { useI18n } from '../../i18n'
import type { PinnedFileItem } from '../../services/pinnedFiles'
import {
  addPinnedFile,
  checkPinnedFilesExistence,
  listPinnedFiles,
  removePinnedFile,
  setPinnedFileEnabled,
  validatePinnedFile
} from '../../services/pinnedFiles'
import { useChatStore } from '../../stores'

const { t } = useI18n()
const chatStore = useChatStore()

const pinnedFiles = ref<PinnedFileItem[]>([])
const showPinnedFilesPanel = ref(false)
const isLoadingPinnedFiles = ref(false)
const isDraggingOver = ref(false)

async function loadPinnedFiles() {
  isLoadingPinnedFiles.value = true
  const conversationId = chatStore.currentConversationId

  try {
    pinnedFiles.value = await listPinnedFiles(conversationId)
  } catch (error) {
    console.error('Failed to load pinned files:', error)
    pinnedFiles.value = []
  } finally {
    isLoadingPinnedFiles.value = false
  }
}

async function refreshPinnedFilesExistence() {
  if (pinnedFiles.value.length === 0) return

  try {
    const result = await checkPinnedFilesExistence(pinnedFiles.value.map(f => ({ id: f.id, path: f.path })))
    if (result?.files) {
      for (const fileResult of result.files) {
        const file = pinnedFiles.value.find(f => f.id === fileResult.id)
        if (file) file.exists = fileResult.exists
      }
    }
  } catch (error) {
    console.error('Failed to check pinned files existence:', error)
  }
}

function getErrorMessageByCode(errorCode?: string, defaultError?: string): string {
  switch (errorCode) {
    case 'NOT_IN_ANY_WORKSPACE':
      return t('components.input.notifications.fileNotInAnyWorkspace')
    case 'NOT_IN_CURRENT_WORKSPACE':
      return defaultError || t('components.input.notifications.fileNotInWorkspace')
    case 'NO_WORKSPACE':
    case 'WORKSPACE_NOT_FOUND':
    case 'INVALID_URI':
    case 'NOT_FILE':
    case 'FILE_NOT_EXISTS':
    default:
      return defaultError || t('components.input.notifications.fileNotInWorkspace')
  }
}

function handleDragEnter(e: DragEvent) {
  if (!e.shiftKey) return

  e.preventDefault()
  e.stopPropagation()
  isDraggingOver.value = true
}

function handleDragOver(e: DragEvent) {
  if (!e.shiftKey) {
    isDraggingOver.value = false
    return
  }

  e.preventDefault()
  e.stopPropagation()
  isDraggingOver.value = true
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()

  const target = e.currentTarget as HTMLElement
  const related = e.relatedTarget as HTMLElement
  if (target && related && target.contains(related)) return

  isDraggingOver.value = false
}

async function tryAddPinnedFile(pathOrUri: string) {
  const validation = await validatePinnedFile(pathOrUri)

  if (!validation?.valid) {
    const errorMessage = getErrorMessageByCode(validation?.errorCode, validation?.error)
    await showNotification(errorMessage, 'error')
    return
  }

  const addResult = await addPinnedFile(validation.relativePath, validation.workspaceUri, chatStore.currentConversationId)

  if (addResult?.success && addResult.file) {
    pinnedFiles.value.push(addResult.file)
    await showNotification(t('components.input.notifications.fileAdded', { path: validation.relativePath }), 'info')
  } else if (!addResult?.success) {
    const errorMessage = getErrorMessageByCode(addResult?.errorCode, addResult?.error)
    await showNotification(errorMessage, 'error')
  }
}

async function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDraggingOver.value = false

  if (!e.shiftKey) {
    await showNotification(t('components.input.notifications.holdShiftToDrag'), 'warning')
    return
  }

  const dt = e.dataTransfer
  if (!dt) {
    await showNotification(t('components.input.notifications.cannotGetFilePath'), 'warning')
    return
  }

  const candidates = extractVscodeDropItems(dt).map(i => i.uriOrPath).filter(Boolean)
  if (candidates.length === 0) {
    await showNotification(t('components.input.notifications.cannotGetFilePath'), 'warning')
    return
  }

  for (const c of candidates) {
    try {
      await tryAddPinnedFile(c)
    } catch (error: any) {
      console.error('Failed to add pinned file:', error)
      await showNotification(t('components.input.notifications.addFailed', { error: error.message || t('common.unknownError') }), 'error')
    }
  }
}

async function handleRemovePinnedFile(id: string) {
  try {
    await removePinnedFile(id, chatStore.currentConversationId)
    pinnedFiles.value = pinnedFiles.value.filter(f => f.id !== id)
  } catch (error: any) {
    console.error('Failed to remove pinned file:', error)
    await showNotification(t('components.input.notifications.removeFailed', { error: error.message || t('common.unknownError') }), 'error')
  }
}

async function handleTogglePinnedFile(id: string, enabled: boolean) {
  try {
    await setPinnedFileEnabled(id, enabled, chatStore.currentConversationId)
    const file = pinnedFiles.value.find(f => f.id === id)
    if (file) file.enabled = enabled
  } catch (error: any) {
    console.error('Failed to toggle pinned file:', error)
  }
}

async function togglePinnedFilesPanel() {
  showPinnedFilesPanel.value = !showPinnedFilesPanel.value
  if (showPinnedFilesPanel.value) {
    await loadPinnedFiles()
    await refreshPinnedFilesExistence()
  }
}

const enabledPinnedFilesCount = computed(() => pinnedFiles.value.filter(f => f.enabled).length)

function getPinnedFileIcon(file: PinnedFileItem): string {
  if (file.exists === false) return 'codicon codicon-warning'
  return getFileIcon(file.path)
}

onMounted(() => {
  loadPinnedFiles()
})

watch(() => chatStore.currentConversationId, async () => {
  await loadPinnedFiles()
  if (showPinnedFilesPanel.value) {
    await refreshPinnedFilesExistence()
  }
})
</script>

<template>
  <Tooltip :content="t('components.input.pinnedFiles')" placement="top">
    <div class="pinned-files-button-wrapper">
      <IconButton
        icon="codicon-pin"
        size="small"
        :class="{ 'has-files': enabledPinnedFilesCount > 0 }"
        class="pinned-files-button"
        @click="togglePinnedFilesPanel"
      />
      <span v-if="enabledPinnedFilesCount > 0" class="pinned-files-badge">
        {{ enabledPinnedFilesCount }}
      </span>
    </div>
  </Tooltip>

  <div
    v-if="showPinnedFilesPanel"
    class="pinned-files-panel"
    :class="{ 'drag-over': isDraggingOver }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div class="pinned-files-header">
      <span class="pinned-files-title">
        <i class="codicon codicon-pin"></i>
        {{ t('components.input.pinnedFilesPanel.title') }}
      </span>
      <IconButton
        icon="codicon-close"
        size="small"
        @click="showPinnedFilesPanel = false"
      />
    </div>
    <div class="pinned-files-description">
      {{ t('components.input.pinnedFilesPanel.description') }}
    </div>
    <div class="pinned-files-content">
      <div v-if="isLoadingPinnedFiles" class="pinned-files-loading">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
        <span>{{ t('components.input.pinnedFilesPanel.loading') }}</span>
      </div>
      <div v-else-if="pinnedFiles.length === 0" class="pinned-files-empty">
        <i class="codicon codicon-info"></i>
        <span>{{ t('components.input.pinnedFilesPanel.empty') }}</span>
      </div>
      <div v-else class="pinned-files-list">
        <div
          v-for="file in pinnedFiles"
          :key="file.id"
          class="pinned-file-item"
          :class="{ disabled: !file.enabled, 'not-exists': file.exists === false }"
        >
          <input
            type="checkbox"
            :checked="file.enabled"
            @change="handleTogglePinnedFile(file.id, !file.enabled)"
            class="pinned-file-checkbox"
            :disabled="file.exists === false"
          />
          <i :class="getPinnedFileIcon(file)"></i>
          <span
            class="pinned-file-path"
            :title="file.exists === false ? `${t('components.input.fileNotExists')}: ${file.path}` : file.path"
          >
            {{ file.path }}
          </span>
          <span v-if="file.exists === false" class="file-not-exists-hint">{{ t('components.input.pinnedFilesPanel.notExists') }}</span>
          <IconButton
            icon="codicon-close"
            size="small"
            @click="handleRemovePinnedFile(file.id)"
            :title="t('components.input.remove')"
          />
        </div>
      </div>
    </div>
    <div class="pinned-files-footer">
      <div class="drag-hint">
        <i class="codicon codicon-info"></i>
        <span>{{ t('components.input.pinnedFilesPanel.dragHint') }}</span>
      </div>
    </div>
    <div v-if="isDraggingOver" class="drag-overlay">
      <i class="codicon codicon-cloud-upload"></i>
      <span>{{ t('components.input.pinnedFilesPanel.dropHint') }}</span>
    </div>
  </div>
</template>

<style scoped>
.pinned-files-button-wrapper {
  position: relative;
  display: inline-flex;
}

.pinned-files-button :deep(i.codicon) {
  transform: rotate(-90deg);
}

.pinned-files-button.has-files :deep(i.codicon) {
  color: var(--vscode-textLink-foreground);
}

.pinned-files-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  font-size: 10px;
  font-weight: 500;
  line-height: 14px;
  text-align: center;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-radius: 7px;
}

.pinned-files-panel {
  position: absolute;
  bottom: 100%;
  left: 8px;
  right: 8px;
  margin-bottom: 8px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  max-height: 300px;
  display: flex;
  flex-direction: column;
}

.pinned-files-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.pinned-files-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.pinned-files-title .codicon {
  font-size: 14px;
  transform: rotate(-90deg);
}

.pinned-files-description {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.pinned-files-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.pinned-files-loading,
.pinned-files-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.pinned-files-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pinned-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--vscode-list-hoverBackground);
  border-radius: 4px;
}

.pinned-file-item.disabled {
  opacity: 0.5;
}

.pinned-file-item.not-exists {
  background: rgba(255, 100, 100, 0.1);
  border: 1px solid rgba(255, 100, 100, 0.3);
}

.pinned-file-item.not-exists .codicon-warning {
  color: var(--vscode-notificationsWarningIcon-foreground, #cca700);
}

.file-not-exists-hint {
  font-size: 10px;
  color: var(--vscode-errorForeground, #f14c4c);
  flex-shrink: 0;
  padding: 1px 4px;
  background: rgba(255, 100, 100, 0.15);
  border-radius: 3px;
}

.pinned-file-checkbox {
  cursor: pointer;
  accent-color: var(--vscode-checkbox-foreground);
}

.pinned-file-item .icon,
.pinned-file-item .codicon {
  font-size: 14px;
  opacity: 0.7;
  flex-shrink: 0;
}

.pinned-file-path {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pinned-files-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--vscode-panel-border);
}

.drag-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-textBlockQuote-background);
  border-radius: 4px;
}

.drag-hint .codicon {
  font-size: 12px;
  opacity: 0.7;
}

.pinned-files-panel.drag-over {
  border-color: var(--vscode-focusBorder);
  box-shadow: 0 0 0 2px rgba(var(--vscode-focusBorder), 0.3);
}

.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(var(--vscode-editor-background), 0.95);
  border-radius: 6px;
  z-index: 10;
}

.drag-overlay .codicon {
  font-size: 32px;
  color: var(--vscode-textLink-foreground);
}

.drag-overlay span {
  font-size: 13px;
  color: var(--vscode-foreground);
}

.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
