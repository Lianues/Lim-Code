<script setup lang="ts">
/**
 * 编辑对话框组件
 * 提供编辑、回档并编辑选项
 * 支持附件管理和提示词上下文管理（内联徽章）
 */

import { ref, computed, watch, nextTick } from 'vue'
import type { CheckpointRecord, Attachment } from '../../types'
import type { PromptContextItem } from '../../types/promptContext'
import type { EditorNode } from '../../types/editorNode'
import { getContexts, getPlainText, serializeNodes } from '../../types/editorNode'
import { parseMessageToNodes } from '../../types/contextParser'
import { useAttachments } from '../../composables/useAttachments'
import { MessageAttachments } from '../message'
import InputBox from '../input/InputBox.vue'
import FilePickerPanel from '../input/FilePickerPanel.vue'
import { sendToExtension, showNotification } from '../../utils/vscode'
import { languageFromPath } from '../../utils/languageFromPath'
import { resolveWorkspaceItems } from '../../utils/resolveWorkspaceItems'
import { t } from '../../i18n'
import { getFileType } from '../../utils/file'
import { generateId } from '../../utils/format'

interface Props {
  modelValue?: boolean
  /** 消息前关联的检查点（before 阶段） */
  checkpoints?: CheckpointRecord[]
  /** 原始消息内容 */
  originalContent?: string
  /** 原始消息附件 */
  originalAttachments?: Attachment[]
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  checkpoints: () => [],
  originalContent: '',
  originalAttachments: () => []
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 普通编辑 */
  edit: [newContent: string, attachments: Attachment[]]
  /** 回档并编辑 */
  restoreAndEdit: [newContent: string, attachments: Attachment[], checkpointId: string]
  cancel: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

// Editor nodes (text + inline context chips)
const editorNodes = ref<EditorNode[]>([])
const inputBoxRef = ref<InstanceType<typeof InputBox> | null>(null)

const fileInputRef = ref<HTMLInputElement | null>(null)

// @ 文件选择器状态
const showFilePicker = ref(false)
const filePickerQuery = ref('')
const filePickerRef = ref<InstanceType<typeof FilePickerPanel> | null>(null)

// 使用附件 composable
const {
  attachments: newAttachments,
  addAttachments,
  removeAttachment: removeNewAttachment,
  clearAttachments
} = useAttachments()

// 被删除的原有附件 ID 集合
const removedOriginalAttachmentIds = ref<Set<string>>(new Set())

// 合并原有附件和新上传的附件（过滤掉被删除的原有附件）
const allAttachments = computed(() => [
  ...props.originalAttachments.filter(att => !removedOriginalAttachmentIds.value.has(att.id)),
  ...newAttachments.value
])

// 当对话框打开时，初始化编辑内容、附件和上下文
watch(visible, (newValue) => {
  if (!newValue) return

  const parsed = parseMessageToNodes(props.originalContent)
  editorNodes.value = parsed.nodes

  showFilePicker.value = false
  filePickerQuery.value = ''

  clearAttachments() // 清除之前的新附件
  removedOriginalAttachmentIds.value = new Set() // 重置已删除的原有附件

  nextTick(() => {
    inputBoxRef.value?.focus()
  })
})

/** 是否有可用的检查点 */
const hasCheckpoints = computed(() => props.checkpoints.length > 0)

/** 最近的检查点（用于回档） */
const latestCheckpoint = computed(() => {
  if (props.checkpoints.length === 0) return null
  return [...props.checkpoints].sort((a, b) => b.timestamp - a.timestamp)[0]
})

/** 格式化检查点描述 */
function formatCheckpointDesc(checkpoint: CheckpointRecord): string {
  const toolName = checkpoint.toolName || 'tool'
  const isAfter = checkpoint.phase === 'after'
  if (toolName === 'user_message') {
    return isAfter
      ? t('components.common.editDialog.restoreToAfterUserMessage')
      : t('components.common.editDialog.restoreToUserMessage')
  } else if (toolName === 'model_message') {
    return isAfter
      ? t('components.common.editDialog.restoreToAfterAssistantMessage')
      : t('components.common.editDialog.restoreToAssistantMessage')
  } else if (toolName === 'tool_batch') {
    return isAfter
      ? t('components.common.editDialog.restoreToAfterToolBatch')
      : t('components.common.editDialog.restoreToToolBatch')
  }
  return isAfter
    ? t('components.common.editDialog.restoreToAfterTool').replace('{toolName}', toolName)
    : t('components.common.editDialog.restoreToTool').replace('{toolName}', toolName)
}

function handleCancel() {
  visible.value = false
  clearAttachments()
  editorNodes.value = []
  showFilePicker.value = false
  filePickerQuery.value = ''
  emit('cancel')
}

function handleNodesUpdate(nodes: EditorNode[]) {
  editorNodes.value = nodes
}

function handleRemoveContext(id: string) {
  editorNodes.value = editorNodes.value.filter(n => !(n.type === 'context' && n.context.id === id))
}

function handlePasteFiles(files: File[]) {
  // 粘贴文件按附件处理
  addAttachments(files)
}

// 处理 @ 触发
function handleTriggerAtPicker(query: string, _triggerPosition: number) {
  filePickerQuery.value = query
  showFilePicker.value = true
}

function handleAtQueryChange(query: string) {
  filePickerQuery.value = query
}

function handleCloseAtPicker() {
  showFilePicker.value = false
  filePickerQuery.value = ''
  inputBoxRef.value?.closeAtPicker()
}

function handleAtPickerKeydown(key: string) {
  if (!showFilePicker.value || !filePickerRef.value) return

  if (key === 'ArrowUp') {
    filePickerRef.value.handleKeydown({ key: 'ArrowUp', preventDefault: () => {}, stopPropagation: () => {} } as KeyboardEvent)
  } else if (key === 'ArrowDown') {
    filePickerRef.value.handleKeydown({ key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} } as KeyboardEvent)
  } else if (key === 'Enter') {
    filePickerRef.value.selectCurrent()
  }
}

const AUTO_UPLOAD_NON_TEXT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf'
])

function shouldAutoUploadBinaryAttachment(payload?: { name: string; size: number; mimeType: string; data: string }): boolean {
  if (!payload?.data) return false
  const mime = (payload.mimeType || '').toLowerCase()
  if (AUTO_UPLOAD_NON_TEXT_MIME_TYPES.has(mime)) return true
  if (mime.startsWith('audio/')) return true
  if (mime.startsWith('video/')) return true
  return false
}

async function addFileContextByPath(path: string, options?: { autoUploadBinaryAttachment?: boolean }) {
  // Skip directories
  if (path.endsWith('/')) return

  const exists = getContexts(editorNodes.value).some(item => item.filePath === path)
  if (exists) return

  const addWorkspaceAttachment = (relativePath: string, payload?: { name: string; size: number; mimeType: string; data: string }) => {
    if (!payload?.data) return

    const existsAttachment = allAttachments.value.some(att => att.metadata?.sourcePath === relativePath)
    if (existsAttachment) return

    const attachment: Attachment = {
      id: generateId(),
      name: payload.name || relativePath.split('/').pop() || relativePath,
      type: getFileType(payload.mimeType || 'application/octet-stream'),
      size: payload.size || 0,
      mimeType: payload.mimeType || 'application/octet-stream',
      data: payload.data,
      metadata: {
        sourcePath: relativePath
      }
    }

    newAttachments.value = [...newAttachments.value, attachment]
  }

  try {
    const result = await sendToExtension<{
      success: boolean
      path: string
      isText: boolean
      content?: string
      attachment?: { name: string; size: number; mimeType: string; data: string }
      error?: string
    }>(
      'readWorkspaceFileForInput',
      { path }
    )

    if (!result?.success) {
      await showNotification(result?.error || t('components.input.promptContext.readFailed'), 'error')
      return
    }

    const isTextContent = result.isText !== false
    if (!isTextContent) {
      if (options?.autoUploadBinaryAttachment && shouldAutoUploadBinaryAttachment(result.attachment)) {
        addWorkspaceAttachment(result.path || path, result.attachment)
      }
    }

    const contextItem: PromptContextItem = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'file',
      title: result.path || path,
      content: isTextContent ? (result.content || '') : '',
      filePath: result.path || path,
      isTextContent,
      enabled: true,
      addedAt: Date.now()
    }

    inputBoxRef.value?.insertContextAtCaret(contextItem)
  } catch (error: any) {
    console.error('Failed to add file context:', error)
    await showNotification(t('components.input.promptContext.addFailed', { error: error.message || t('common.unknownError') }), 'error')
  }
}

// InputBox 拖拽文件路径（徽章模式）
async function handleAddFileContexts(files: { path: string; isDirectory: boolean }[]) {
  for (const file of files) {
    if (file.isDirectory) continue
    await addFileContextByPath(file.path, { autoUploadBinaryAttachment: true })
  }

  nextTick(() => {
    inputBoxRef.value?.focus()
  })
}

async function handleDropFileItems(items: string[], insertAsTextPath: boolean) {
  const resolved = await resolveWorkspaceItems(items)
  if (resolved.length === 0) return

  if (insertAsTextPath) {
    inputBoxRef.value?.insertPathsAsAtText(resolved)
    nextTick(() => inputBoxRef.value?.focus())
    return
  }

  await handleAddFileContexts(resolved)
}

async function handleOpenContext(ctx: PromptContextItem) {
  if (ctx.isTextContent === false && ctx.filePath) {
    try {
      await sendToExtension('openWorkspaceFile', { path: ctx.filePath })
    } catch (error) {
      console.error('Failed to open workspace file:', error)
    }
    return
  }

  try {
    await sendToExtension('showContextContent', {
      title: ctx.title,
      content: ctx.content,
      language: ctx.language || languageFromPath(ctx.filePath) || 'plaintext'
    })
  } catch (error) {
    console.error('Failed to show context content:', error)
  }
}

// 从 @ 面板选择
async function handleSelectFileFromPicker(path: string, asText: boolean = false) {
  showFilePicker.value = false
  filePickerQuery.value = ''

  // Ctrl+Click or directory: insert as plain @path text
  if (asText || path.endsWith('/')) {
    inputBoxRef.value?.replaceAtTriggerWithText(` @${path} `)
    nextTick(() => inputBoxRef.value?.focus())
    return
  }

  // Remove @query from the editor, then insert the chip at the same caret position.
  inputBoxRef.value?.replaceAtTriggerWithText('')
  await addFileContextByPath(path)

  nextTick(() => inputBoxRef.value?.focus())
}

function serializeAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.map(att => ({
    id: att.id,
    name: att.name,
    type: att.type,
    size: att.size,
    mimeType: att.mimeType,
    data: att.data,
    thumbnail: att.thumbnail,
    metadata: att.metadata ? { ...att.metadata } : undefined
  }))
}

function getFinalContent(): string {
  return serializeNodes(editorNodes.value).trim()
}

const canSubmit = computed(() => {
  const hasText = getPlainText(editorNodes.value).trim().length > 0
  const hasContexts = getContexts(editorNodes.value).length > 0
  const hasAttachments = allAttachments.value.length > 0
  return hasText || hasContexts || hasAttachments
})

function handleEdit() {
  const finalContent = getFinalContent()
  if (finalContent || allAttachments.value.length > 0) {
    visible.value = false
    emit('edit', finalContent, serializeAttachments(allAttachments.value))
    clearAttachments()
    editorNodes.value = []
  }
}

function handleRestoreAndEdit() {
  const finalContent = getFinalContent()
  if (latestCheckpoint.value && (finalContent || allAttachments.value.length > 0)) {
    visible.value = false
    emit('restoreAndEdit', finalContent, serializeAttachments(allAttachments.value), latestCheckpoint.value.id)
    clearAttachments()
    editorNodes.value = []
  }
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return

  await addAttachments(Array.from(input.files))
  input.value = ''
}

function handleRemoveAttachment(id: string) {
  const isOriginal = props.originalAttachments.some(att => att.id === id)

  if (isOriginal) {
    removedOriginalAttachmentIds.value.add(id)
  } else {
    removeNewAttachment(id)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="dialog-overlay">
        <div class="dialog edit-dialog">
          <div class="dialog-header">
            <i class="codicon codicon-edit dialog-icon"></i>
            <span class="dialog-title">{{ t('components.common.editDialog.title') }}</span>
          </div>

          <div class="dialog-body">
            <!-- 输入区域 -->
            <div class="edit-input-wrapper">
              <FilePickerPanel
                ref="filePickerRef"
                :visible="showFilePicker"
                :query="filePickerQuery"
                @select="handleSelectFileFromPicker"
                @close="handleCloseAtPicker"
              />

              <InputBox
                ref="inputBoxRef"
                :nodes="editorNodes"
                :placeholder="t('components.common.editDialog.placeholder')"
                :submit-on-enter="false"
                :min-rows="4"
                :max-rows="14"
                @update:nodes="handleNodesUpdate"
                @remove-context="handleRemoveContext"
                @paste="handlePasteFiles"
                @drop-file-items="handleDropFileItems"
                @open-context="handleOpenContext"
                @trigger-at-picker="handleTriggerAtPicker"
                @close-at-picker="handleCloseAtPicker"
                @at-query-change="handleAtQueryChange"
                @at-picker-keydown="handleAtPickerKeydown"
              />
            </div>

            <!-- 附件区域 -->
            <div class="attachment-section">
              <button class="attachment-btn" @click="triggerFileInput" :title="t('components.common.editDialog.addAttachment')">
                <i class="codicon codicon-add"></i>
                <span>{{ t('components.common.editDialog.addAttachment') }}</span>
              </button>
              <input
                ref="fileInputRef"
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.json,.js,.ts,.py,.java,.c,.cpp,.h,.css,.html,.xml,.md"
                style="display: none"
                @change="handleFileSelect"
              />

              <div v-if="allAttachments.length > 0" class="attachment-list">
                <MessageAttachments
                  :attachments="allAttachments"
                  :readonly="false"
                  @remove="handleRemoveAttachment"
                />
              </div>
            </div>

            <p v-if="hasCheckpoints" class="checkpoint-hint">
              <i class="codicon codicon-info"></i>
              {{ t('components.common.editDialog.checkpointHint') }}
            </p>
          </div>

          <div class="dialog-footer">
            <button class="dialog-btn cancel" @click="handleCancel">
              {{ t('components.common.editDialog.cancel') }}
            </button>

            <button
              v-if="latestCheckpoint"
              class="dialog-btn restore"
              :disabled="!canSubmit"
              @click="handleRestoreAndEdit"
            >
              <i class="codicon codicon-discard"></i>
              {{ formatCheckpointDesc(latestCheckpoint) }}
            </button>

            <button
              class="dialog-btn confirm"
              :disabled="!canSubmit"
              @click="handleEdit"
            >
              {{ t('components.common.editDialog.save') }}
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
  min-width: 320px;
  max-width: 90%;
  width: calc(100% - 32px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.edit-dialog {
  /* 使用最大宽度限制，不再固定宽度 */
  max-width: min(500px, 90%);
}

@media (max-width: 400px) {
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
  color: var(--vscode-editorInfo-foreground);
}

.dialog-title {
  font-weight: 500;
  font-size: 14px;
}

.dialog-body {
  padding: 16px;
}

.edit-input-wrapper {
  position: relative;
}

/* Make InputBox fit edit dialog sizing */
.edit-input-wrapper :deep(.input-editor) {
  min-height: 100px;
  max-height: 300px;
  border-radius: 4px;
  padding: 10px;
}

/* 附件区域 */
.attachment-section {
  margin-top: 12px;
}

.attachment-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px dashed var(--vscode-panel-border);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.attachment-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
  border-color: var(--vscode-focusBorder);
}

.attachment-btn .codicon {
  font-size: 14px;
}

.attachment-list {
  margin-top: 8px;
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

.dialog-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-btn.cancel {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
}

.dialog-btn.cancel:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
}

.dialog-btn.restore {
  background: var(--vscode-editorInfo-foreground);
  color: white;
}

.dialog-btn.restore:hover:not(:disabled) {
  opacity: 0.9;
}

.dialog-btn.restore .codicon {
  font-size: 12px;
}

.dialog-btn.confirm {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.dialog-btn.confirm:hover:not(:disabled) {
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
