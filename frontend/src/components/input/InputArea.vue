<script setup lang="ts">
/**
 * InputArea - 输入区容器
 * 负责把编辑器(InputBox)与外部能力(配置/模型/文件读取/VSCode预览)编排在一起。
 */

import { ref, computed, onMounted, watch, nextTick, onBeforeUnmount } from 'vue'
import InputBox from './InputBox.vue'
import FilePickerPanel from './FilePickerPanel.vue'
import SendButton from './SendButton.vue'
import MessageQueue from './MessageQueue.vue'
import InputAttachments from './InputAttachments.vue'
import PinnedFilesWidget from './PinnedFilesWidget.vue'
import SkillsWidget from './SkillsWidget.vue'
import InputSelectorBar from './InputSelectorBar.vue'
import type { ChannelOption } from './types'
import type { PromptMode } from './types'

import { IconButton, Tooltip } from '../common'
import { useChatStore, useSettingsStore } from '../../stores'
import { showNotification, onExtensionCommand } from '../../utils/vscode'
import * as configService from '../../services/config'
import * as contextService from '../../services/context'
import { formatNumber } from '../../utils/format'
import { languageFromPath } from '../../utils/languageFromPath'
import { resolveWorkspaceItems } from '../../utils/resolveWorkspaceItems'
import type { Attachment } from '../../types'
import type { PromptContextItem } from '../../types/promptContext'
import type { EditorNode } from '../../types/editorNode'
import { createTextNode, getPlainText, getContexts, serializeNodes } from '../../types/editorNode'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const chatStore = useChatStore()

const props = defineProps<{
  uploading?: boolean
  placeholder?: string
  attachments?: Attachment[]
}>()

const emit = defineEmits<{
  send: [content: string, attachments: Attachment[]]
  cancel: []
  clearAttachments: []
  attachFile: []
  removeAttachment: [id: string]
  pasteFiles: [files: File[]]
}>()

const isComposing = ref(false)

// 编辑器节点数组（从 store 读写，实现对话级隔离）
const editorNodes = computed({
  get: () => chatStore.editorNodes,
  set: (nodes: EditorNode[]) => chatStore.setEditorNodes(nodes)
})

// 当 store 中的 inputValue 被外部设置（如恢复快照）但 editorNodes 为空时，从文本创建节点
watch(() => chatStore.inputValue, (val) => {
  if (val && chatStore.editorNodes.length === 0) {
    chatStore.setEditorNodes([createTextNode(val)])
  }
}, { immediate: true })

// 反向同步：editorNodes 变化时更新纯文本 inputValue
watch(() => chatStore.editorNodes, (nodes) => {
  chatStore.setInputValue(getPlainText(nodes))
}, { deep: true })

// ========== Configs / Modes ==========

const configs = ref<any[]>([])
const isLoadingConfigs = ref(false)

const promptModes = ref<PromptMode[]>([])

const channelOptions = computed<ChannelOption[]>(() =>
  configs.value
    .filter(config => config.enabled !== false)
    .map(config => ({
      id: config.id,
      name: config.name,
      model: config.model || '',
      type: config.type
    }))
)

const modeOptions = computed<PromptMode[]>(() => promptModes.value)

const currentConfig = computed(() => configs.value.find(c => c.id === chatStore.configId))
const currentModel = computed(() => chatStore.selectedModelId || currentConfig.value?.model || '')
const currentModels = computed(() => currentConfig.value?.models || [])

async function loadConfigs() {
  isLoadingConfigs.value = true
  try {
    const ids = await configService.listConfigIds()
    const loaded: any[] = []

    for (const id of ids) {
      const config = await configService.getConfig(id)
      if (config) loaded.push(config)
    }

    configs.value = loaded
  } catch (error) {
    console.error('Failed to load configs:', error)
  } finally {
    isLoadingConfigs.value = false
  }
}

async function loadPromptModes() {
  try {
    const result = await configService.getPromptModes()
    if (result) {
      promptModes.value = result.modes
      // 仅在 store 还未设置过（使用默认值 'code'）且后端返回不同值时，才初始化 store
      // 后续切换全部由 store 驱动，不再反向覆盖
      // （注：初始加载时 store 可能已从对话元数据恢复，此处不强制覆盖）
    }
  } catch (error) {
    console.error('Failed to load prompt modes:', error)
  }
}

async function handleModeChange(modeId: string) {
  try {
    await chatStore.setCurrentPromptModeId(modeId)
  } catch (error) {
    console.error('Failed to change mode:', error)
  }
}

function openModeSettings() {
  settingsStore.showSettings('prompt')
}

async function handleChannelChange(channelId: string) {
  await chatStore.setConfigId(channelId)
}

async function handleModelChange(modelId: string) {
  if (!chatStore.configId) return
  await chatStore.setSelectedModelId(modelId)
}

// ========== Send / Cancel ==========

const hasAttachments = computed(() => (props.attachments?.length || 0) > 0)

const canSend = computed(() => {
  if (!currentModel.value) return false

  const plainText = getPlainText(editorNodes.value).trim()
  const hasContexts = getContexts(editorNodes.value).length > 0
  const hasContent = plainText.length > 0 || hasContexts || (props.attachments?.length || 0) > 0

  if (chatStore.hasPendingToolConfirmation && hasContent) {
    return true
  }

  // 允许在 AI 响应期间输入（会入队），只需有内容且未上传中即可
  return hasContent && !props.uploading
})

function handleSend() {
  if (!canSend.value) return

  const content = serializeNodes(editorNodes.value).trim()
  const currentAttachments = props.attachments || []

  // 智能决策：AI 空闲且队列为空时直接发送，否则入队
  if (!chatStore.isWaitingForResponse && chatStore.messageQueue.length === 0) {
    // 直接发送
    emit('send', content, currentAttachments)
  } else {
    // 加入候选区队列
    // 如果有工具待确认，仍走直接发送路径（拒绝工具的场景）
    if (chatStore.hasPendingToolConfirmation) {
      emit('send', content, currentAttachments)
    } else {
      chatStore.enqueueMessage(content, currentAttachments)
      // 入队后清空附件（通知父组件）
      emit('clearAttachments')
    }
  }

  editorNodes.value = []
  chatStore.clearInputValue()
}

function handleCancel() {
  emit('cancel')
}

function handleNodesUpdate(nodes: EditorNode[]) {
  editorNodes.value = nodes
}

function handleAttachFile() {
  emit('attachFile')
}

function handleRemoveAttachment(id: string) {
  emit('removeAttachment', id)
}

function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd() {
  isComposing.value = false
}

function handlePasteFiles(files: File[]) {
  emit('pasteFiles', files)
}

async function previewAttachment(attachment: Attachment) {
  if (!attachment.data) return

  try {
    await contextService.previewAttachment(attachment)
  } catch (error) {
    console.error('预览附件失败:', error)
  }
}

// ========== @ file picker ==========

const showFilePicker = ref(false)
const filePickerQuery = ref('')
const inputBoxRef = ref<InstanceType<typeof InputBox> | null>(null)
const filePickerRef = ref<InstanceType<typeof FilePickerPanel> | null>(null)

let unsubscribeAddContext: (() => void) | null = null

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

async function addFileContextByPath(path: string) {
  // Skip directories
  if (path.endsWith('/')) return

  const exists = getContexts(editorNodes.value).some(item => item.filePath === path)
  if (exists) return

  try {
    const result = await contextService.readWorkspaceTextFile(path)

    if (!result?.success) {
      await showNotification(result?.error || t('components.input.promptContext.readFailed'), 'error')
      return
    }

    const contextItem: PromptContextItem = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'file',
      title: result.path,
      content: result.content,
      filePath: result.path,
      enabled: true,
      addedAt: Date.now()
    }

    inputBoxRef.value?.insertContextAtCaret(contextItem)
  } catch (error: any) {
    console.error('Failed to add file context:', error)
    await showNotification(t('components.input.promptContext.addFailed', { error: error.message || t('common.unknownError') }), 'error')
  }
}

async function handleSelectFile(path: string, asText: boolean = false) {
  showFilePicker.value = false
  filePickerQuery.value = ''

  if (asText || path.endsWith('/')) {
    inputBoxRef.value?.replaceAtTriggerWithText(` @${path} `)
    nextTick(() => inputBoxRef.value?.focus())
    return
  }

  inputBoxRef.value?.replaceAtTriggerWithText('')
  await addFileContextByPath(path)

  nextTick(() => inputBoxRef.value?.focus())
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

// ========== contexts from editor ==========

function handleRemovePromptContextItem(id: string) {
  editorNodes.value = editorNodes.value.filter(node => !(node.type === 'context' && node.context.id === id))
}

async function handleAddFileContexts(files: { path: string; isDirectory: boolean }[]) {
  const inserted = new Set<string>()

  for (const file of files) {
    if (file.isDirectory) continue
    if (inserted.has(file.path)) continue
    inserted.add(file.path)

    await addFileContextByPath(file.path)
  }

  nextTick(() => inputBoxRef.value?.focus())
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
  try {
    await contextService.showContextContent({
      title: ctx.title,
      content: ctx.content,
      language: ctx.language || languageFromPath(ctx.filePath)
    })
  } catch (error) {
    console.error('Failed to show context content:', error)
  }
}

// ========== summarize + token ring ==========

const isSummarizing = computed(() => !!chatStore.autoSummaryStatus?.isSummarizing)

async function handleSummarize() {
  if (isSummarizing.value || chatStore.isWaitingForResponse) return

  try {
    const result = await chatStore.summarizeContext()

    if (!result.success && result.errorCode !== 'ABORTED') {
      await showNotification(
        t('components.input.notifications.summarizeFailed', { error: result.error || t('common.unknownError') }),
        'warning'
      )
    } else if (result.summarizedMessageCount && result.summarizedMessageCount > 0) {
      await showNotification(
        t('components.input.notifications.summarizeSuccess', { count: result.summarizedMessageCount }),
        'info'
      )
    }
  } catch (error: any) {
    console.error('Summarize error:', error)
    await showNotification(
      t('components.input.notifications.summarizeError', { error: error.message || t('common.unknownError') }),
      'error'
    )
  }
}

const tokenRingColor = computed(() => {
  const percent = chatStore.tokenUsagePercent
  if (percent >= 90) return '#f14c4c'
  if (percent >= 75) return '#cca700'
  return '#89d185'
})

const ringRadius = 8
const ringCircumference = 2 * Math.PI * ringRadius
const ringDashOffset = computed(() => ringCircumference * (1 - chatStore.tokenUsagePercent / 100))

// ========== lifecycle ==========

onMounted(() => {
  // Receive context chips pushed from the extension (e.g. editor selection hover/lightbulb).
  unsubscribeAddContext = onExtensionCommand('input.addContext', (payload: any) => {
    const contextItem = payload?.contextItem as PromptContextItem | undefined
    if (!contextItem) return

    // Best-effort: insert at caret if possible; otherwise fall back to append.
    const inserted = inputBoxRef.value?.insertContextAtCaret(contextItem)
    if (!inserted) {
      editorNodes.value = [...editorNodes.value, { type: 'context', context: contextItem }]
    }

    // Keep the input ready for typing.
    nextTick(() => inputBoxRef.value?.focus())
  })

  loadConfigs()
  loadPromptModes()
})

onBeforeUnmount(() => {
  if (unsubscribeAddContext) unsubscribeAddContext()
})

watch(() => chatStore.configId, () => {
  if (chatStore.configId && !configs.value.some(c => c.id === chatStore.configId)) {
    loadConfigs()
  }
})

watch(() => chatStore.currentConfig, () => {
  loadConfigs()
}, { deep: true })

watch(() => settingsStore.promptModesVersion, () => {
  loadPromptModes()
})
</script>

<template>
  <div class="input-area">
    <InputAttachments
      v-if="hasAttachments"
      :attachments="props.attachments || []"
      :uploading="props.uploading"
      @remove="handleRemoveAttachment"
      @preview="previewAttachment"
    />

    <!-- 消息候选区（排队队列） -->
    <MessageQueue />

    <div class="input-box-container">
      <FilePickerPanel
        ref="filePickerRef"
        :visible="showFilePicker"
        :query="filePickerQuery"
        @select="handleSelectFile"
        @close="handleCloseAtPicker"
        @update:query="(q) => filePickerQuery = q"
      />

      <InputBox
        ref="inputBoxRef"
        :nodes="editorNodes"
        :disabled="false"
        :placeholder="props.placeholder"
        @update:nodes="handleNodesUpdate"
        @remove-context="handleRemovePromptContextItem"
        @send="handleSend"
        @composition-start="handleCompositionStart"
        @composition-end="handleCompositionEnd"
        @paste="handlePasteFiles"
        @drop-file-items="handleDropFileItems"
        @open-context="handleOpenContext"
        @trigger-at-picker="handleTriggerAtPicker"
        @close-at-picker="handleCloseAtPicker"
        @at-query-change="handleAtQueryChange"
        @at-picker-keydown="handleAtPickerKeydown"
      />
    </div>

    <div class="bottom-toolbar">
      <div class="toolbar-left">
        <Tooltip :content="t('components.input.attachFile')" placement="top-left">
          <IconButton
            icon="codicon-attach"
            size="small"
            :disabled="props.uploading"
            class="attach-button"
            @click="handleAttachFile"
          />
        </Tooltip>

        <PinnedFilesWidget />
        <SkillsWidget />
      </div>

      <div class="toolbar-right">
        <Tooltip :content="t('components.input.summarizeContext')" placement="top">
          <IconButton
            icon="codicon-fold"
            size="small"
            :disabled="chatStore.isWaitingForResponse || chatStore.usedTokens === 0 || isSummarizing"
            :loading="isSummarizing"
            class="summarize-button"
            @click="handleSummarize"
          />
        </Tooltip>

        <div class="token-ring-wrapper">
          <svg class="token-ring" width="22" height="22" viewBox="0 0 22 22">
            <circle
              cx="11"
              cy="11"
              :r="ringRadius"
              fill="none"
              stroke="var(--vscode-panel-border)"
              stroke-width="2"
            />
            <circle
              cx="11"
              cy="11"
              :r="ringRadius"
              fill="none"
              :stroke="tokenRingColor"
              stroke-width="2"
              stroke-linecap="round"
              :stroke-dasharray="ringCircumference"
              :stroke-dashoffset="ringDashOffset"
              transform="rotate(-90 11 11)"
            />
          </svg>
          <div class="token-tooltip">
            <div class="token-tooltip-row">
              <span class="token-tooltip-label">{{ t('components.input.tokenUsage') }}</span>
              <span class="token-tooltip-value">{{ chatStore.tokenUsagePercent.toFixed(1) }}%</span>
            </div>
            <div class="token-tooltip-row">
              <span class="token-tooltip-label">{{ t('components.input.context') }}</span>
              <span class="token-tooltip-value">{{ formatNumber(chatStore.usedTokens) }} / {{ formatNumber(chatStore.maxContextTokens) }}</span>
            </div>
          </div>
        </div>

        <SendButton
          :disabled="!canSend"
          :loading="chatStore.isWaitingForResponse"
          @click="handleSend"
          @cancel="handleCancel"
        />
      </div>
    </div>

    <InputSelectorBar
      :current-mode-id="chatStore.currentPromptModeId"
      :mode-options="modeOptions"
      :is-loading-configs="isLoadingConfigs"
      :config-id="chatStore.configId"
      :channel-options="channelOptions"
      :current-model-id="currentModel"
      :model-options="currentModels"
      :model-disabled="!chatStore.configId || isLoadingConfigs"
      @mode-change="handleModeChange"
      @open-mode-settings="openModeSettings"
      @channel-change="handleChannelChange"
      @model-change="handleModelChange"
    />
  </div>
</template>

<style scoped>
.input-area {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-editor-background);
  border-top: 1px solid var(--vscode-panel-border);
}

.input-box-container {
  position: relative;
}

.bottom-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.attach-button :deep(i.codicon) {
  font-size: 17px !important;
}

.summarize-button :deep(i.codicon) {
  font-size: 15px !important;
}

.token-ring-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.token-ring {
  display: block;
}

.token-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  padding: 4px 8px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 3px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s, visibility 0.15s;
  z-index: 1000;
  pointer-events: none;
}

.token-ring-wrapper:hover .token-tooltip {
  opacity: 1;
  visibility: visible;
}

.token-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  right: 8px;
  border: 4px solid transparent;
  border-top-color: var(--vscode-editorWidget-border);
}

.token-tooltip::before {
  content: '';
  position: absolute;
  top: 100%;
  right: 9px;
  border: 3px solid transparent;
  border-top-color: var(--vscode-editorWidget-background);
  z-index: 1;
}

.token-tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 10px;
  line-height: 1.5;
}

.token-tooltip-label {
  color: var(--vscode-descriptionForeground);
}

.token-tooltip-value {
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: 10px;
}
</style>
