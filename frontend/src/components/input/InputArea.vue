<script setup lang="ts">
/**
 * InputArea - 输入区容器
 * 负责把编辑器(InputBox)与外部能力(配置/模型/文件读取/VSCode预览)编排在一起。
 */

import { ref, computed, onMounted, watch, nextTick, onBeforeUnmount } from 'vue'
import InputBox from './InputBox.vue'
import FilePickerPanel from './FilePickerPanel.vue'
import SlashCommandPanel from './SlashCommandPanel.vue'
import ContextStatusDialog from './ContextStatusDialog.vue'
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
import { sendToExtension, showNotification, onExtensionCommand } from '../../utils/vscode'
import * as configService from '../../services/config'
import * as contextService from '../../services/context'
import { formatNumber, generateId } from '../../utils/format'
import { languageFromPath } from '../../utils/languageFromPath'
import { resolveWorkspaceItems } from '../../utils/resolveWorkspaceItems'
import { getFileType } from '../../utils/file'
import type { Attachment } from '../../types'
import type { PromptContextItem } from '../../types/promptContext'
import type { SkillItem } from '../../services/skills'
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

function isPureContextStatusCommand(): boolean {
  const plainText = getPlainText(editorNodes.value).trim().toLowerCase()
  const hasContexts = getContexts(editorNodes.value).length > 0
  const hasAttachments = (props.attachments?.length || 0) > 0
  return plainText === '/context-status' && !hasContexts && !hasAttachments
}

function openContextStatusDialog() {
  // 修改原因：`/context-status` 应打开纯前端诊断窗口，而不是通过 chatStore.sendMessage 进入 ChatFlow 或模型对话路径。
  // 修改方式：统一由本地状态控制窗口打开，窗口内部通过 `context.getStatus` 只读接口读取后端快照。
  // 修改目的：按钮和手输命令都不创建聊天消息、不创建 assistant 占位、不影响主上下文。
  showContextStatusDialog.value = true
}

function handleSend() {
  if (isPureContextStatusCommand()) {
    openContextStatusDialog()
    editorNodes.value = []
    chatStore.clearInputValue()
    return
  }

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
const showSlashPicker = ref(false)
const slashPickerQuery = ref('')
const slashPickerRef = ref<InstanceType<typeof SlashCommandPanel> | null>(null)
const showContextStatusDialog = ref(false)

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

function handleTriggerSlashPicker(query: string, _triggerPosition: number) {
  slashPickerQuery.value = query
  showSlashPicker.value = true
}

function handleSlashQueryChange(query: string) {
  slashPickerQuery.value = query
}

function handleCloseSlashPicker() {
  showSlashPicker.value = false
  slashPickerQuery.value = ''
  inputBoxRef.value?.closeSlashPicker()
}

function normalizeDirectoryPath(path: string): string {
  const normalized = (path || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalized) return ''
  return `${normalized}/`
}

function hasContextWithPath(path: string): boolean {
  const key = (path || '').replace(/\/+$/g, '')
  if (!key) return false
  return getContexts(editorNodes.value).some(item => ((item.filePath || '').replace(/\/+$/g, '') === key))
}

function hasContextWithSkill(skill: SkillItem): boolean {
  const skillId = skill.id || skill.name
  return getContexts(editorNodes.value).some(item =>
    item.type === 'skill' && ((item.attributes?.['skill-id'] || item.attributes?.skill) === skillId || item.attributes?.skill === skill.name)
  )
}

function addDirectoryContextByPath(path: string) {
  const dirPath = normalizeDirectoryPath(path)
  if (!dirPath) return
  if (hasContextWithPath(dirPath)) return

  const contextItem: PromptContextItem = {
    id: `dir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'file',
    title: dirPath,
    content: '',
    filePath: dirPath,
    isTextContent: false,
    enabled: true,
    addedAt: Date.now()
  }

  inputBoxRef.value?.insertContextAtCaret(contextItem)
}

const AUTO_UPLOAD_NON_TEXT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf'
])

function shouldAutoUploadBinaryAttachment(payload?: contextService.WorkspaceInputFileAttachmentPayload): boolean {
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

  const addWorkspaceAttachment = (relativePath: string, payload?: contextService.WorkspaceInputFileAttachmentPayload) => {
    if (!payload?.data) return

    const existsAttachment = (props.attachments || []).some(att => att.metadata?.sourcePath === relativePath)
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

    chatStore.addStoreAttachment(attachment)
  }

  try {
    const result = await contextService.readWorkspaceFileForInput(path)

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

function handleSlashPickerKeydown(key: string) {
  if (!showSlashPicker.value || !slashPickerRef.value) return

  if (key === 'ArrowUp') {
    slashPickerRef.value.handleKeydown({ key: 'ArrowUp', preventDefault: () => {}, stopPropagation: () => {} } as KeyboardEvent)
  } else if (key === 'ArrowDown') {
    slashPickerRef.value.handleKeydown({ key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} } as KeyboardEvent)
  } else if (key === 'Enter') {
    slashPickerRef.value.selectCurrent()
  }
}

function handleCompleteSlashCommand(replacement: string) {
  // 为什么要在父层处理补全：只有 InputArea 同时掌握面板状态和 InputBox 的 DOM 替换能力。
  // 怎么做：只有 `/skill ` 需要 keepOpen 进入 Skill 查询阶段；其他 context command 补全后关闭面板，等待用户发送或继续编辑参数。
  // 目的：避免 `/context-status` 等一次性命令补全后面板持续拦截 Enter，导致用户无法直接发送命令。
  const keepOpen = replacement.trim().toLowerCase().startsWith('/skill')
  showSlashPicker.value = keepOpen
  inputBoxRef.value?.replaceSlashTriggerWithText(replacement, { keepOpen })
  nextTick(() => inputBoxRef.value?.focus())
}

function handleSelectSkill(skill: SkillItem) {
  showSlashPicker.value = false
  slashPickerQuery.value = ''
  if (hasContextWithSkill(skill)) {
    inputBoxRef.value?.replaceSlashTriggerWithText('')
    nextTick(() => inputBoxRef.value?.focus())
    return
  }

  inputBoxRef.value?.replaceSlashTriggerWithText('')
  // 修改原因：旧 `/skill` 引用只提示 read_skill，主 Agent 容易漏读 read_skill 返回的 resources manifest，也容易误以为 SubAgent 会继承主会话已读 Skill。
  // 修改方式：把 chip 正文改为中文渐进披露说明，明确 read_skill -> 按需 read_skill_resource -> SubAgent 显式传递规则的链路。
  // 修改目的：让 Skill 引用、Skill 附属资源和 SubAgent 派单共享同一套中文提示词模型，避免多轮审查时丢失中央数据库和资源读取要求。
  const skillReferenceContent = [
    `已选择 Skill 引用：“${skill.name}”。`,
    `这只是 Skill 引用，不是 Skill 正文；不要根据标题或名称推断 Skill 内容。`,
    `如本任务相关，回答前先调用 read_skill，name 必须是 "${skill.name}"。`,
    `read_skill 返回 resources manifest 后，只在任务需要时，按 manifest 中的 relativePath 使用 read_skill_resource 读取 textReadable=true 的相关资源；不要无条件读取所有资源。`,
    `如果要把该 Skill 用于 SubAgent，请把已读取的必要规则写进 SubAgent prompt/context，或明确要求 SubAgent 自己调用 read_skill 并按需调用 read_skill_resource；不要假设 SubAgent 会继承主 Agent 已读过的 Skill。`
  ].join('\n')
  const contextItem: PromptContextItem = {
    id: `skill-${skill.id}-${Date.now()}`,
    type: 'skill',
    title: skill.name,
    content: skillReferenceContent,
    enabled: true,
    addedAt: Date.now(),
    attributes: {
      skill: skill.name,
      'skill-id': skill.id
    }
  }
  nextTick(() => {
    inputBoxRef.value?.insertContextAtCaret(contextItem)
    inputBoxRef.value?.focus()
  })
}

// ========== contexts from editor ==========

function handleRemovePromptContextItem(id: string) {
  editorNodes.value = editorNodes.value.filter(node => !(node.type === 'context' && node.context.id === id))
}

async function handleAddFileContexts(files: { path: string; isDirectory: boolean }[], options?: { allowDirectoryBadge?: boolean }) {
  const inserted = new Set<string>()

  for (const file of files) {
    const key = file.isDirectory ? normalizeDirectoryPath(file.path) : file.path
    if (!key) continue
    if (inserted.has(key)) continue
    inserted.add(key)

    if (file.isDirectory) {
      if (options?.allowDirectoryBadge) {
        addDirectoryContextByPath(file.path)
      }
      continue
    }

    await addFileContextByPath(file.path, { autoUploadBinaryAttachment: true })
  }

  nextTick(() => inputBoxRef.value?.focus())
}

async function handleDropFileItems(
  items: string[],
  insertAsTextPath: boolean,
  dragMeta?: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }
) {
  const resolved = await resolveWorkspaceItems(items)
  if (resolved.length === 0) return

  if (insertAsTextPath) {
    inputBoxRef.value?.insertPathsAsAtText(resolved)
    nextTick(() => inputBoxRef.value?.focus())
    return
  }

  const allowDirectoryBadge = !!dragMeta?.shiftKey && !insertAsTextPath
  await handleAddFileContexts(resolved, { allowDirectoryBadge })
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
    await contextService.showContextContent({
      title: ctx.title,
      content: ctx.content,
      language: ctx.language || languageFromPath(ctx.filePath) || 'plaintext'
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
    const result = await chatStore.compactContext()

    if (!result.success && result.errorCode !== 'ABORTED') {
      await showNotification(
        t('components.input.notifications.summarizeFailed', { error: result.error || t('common.unknownError') }),
        'warning'
      )
    } else if (result.success) {
      await showNotification(
        // 修改原因：compact 成功的兜底通知属于用户可见文案，不能在后端 payload 缺失时退回英文。
        // 修改方式：优先使用后端已本地化 payload，否则使用输入区现有的“压缩上下文”i18n 文案。
        // 目的：避免手动 compact 的通知在本地化界面中出现中英混排。
        result.message || result.title || t('components.input.summarizeContext'),
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

const canRunContextStatus = computed(() => !!chatStore.currentConversationId)

function handleOpenContextStatusEvent() {
  openContextStatusDialog()
}

function handleContextStatus() {
  if (!canRunContextStatus.value) return
  // 修改原因：用户不应该必须记住 `/context-status`，也不应该担心它会被 AI 当普通提示词处理。
  // 修改方式：按钮只打开 ContextStatusDialog，由 Dialog 自己通过只读后端接口加载状态；只读诊断允许在模型响应期间打开。
  // 修改目的：让上下文健康状态成为可发现、可点击的 UI 能力，同时完全避开聊天发送链路。
  openContextStatusDialog()
}

const tokenRingColor = computed(() => {
  // 修改原因：旧 token ring 使用硬编码亮色，在 VS Code 浅色主题下对比度不足。
  // 修改方式：根据风险阈值返回 VS Code 主题变量，并保留 fallback 色。
  // 修改目的：让上下文用量入口在深色、浅色和高对比主题中都可读。
  const percent = chatStore.tokenUsagePercent
  if (percent >= 90) return 'var(--vscode-errorForeground, #f14c4c)'
  if (percent >= 75) return 'var(--vscode-editorWarning-foreground, #cca700)'
  return 'var(--vscode-charts-green, #388a34)'
})

const ringRadius = 8
const ringCircumference = 2 * Math.PI * ringRadius
const ringDashOffset = computed(() => ringCircumference * (1 - chatStore.tokenUsagePercent / 100))

// ========== lifecycle ==========

onMounted(() => {
  // 修改原因：旧 context command 卡片可能提供 `/context-status` next action，但该 action 现在也必须打开本地窗口，不能走 chatStore.sendMessage。
  // 修改方式：通过一个轻量 window event 连接 MessageItem 和输入区窗口状态，避免把诊断窗口状态塞进聊天消息模型。
  // 修改目的：所有前端入口都收敛到同一个 ContextStatusDialog，不影响主对话上下文。
  window.addEventListener('limcode:open-context-status', handleOpenContextStatusEvent)

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
  window.removeEventListener('limcode:open-context-status', handleOpenContextStatusEvent)
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

    <ContextStatusDialog
      v-model="showContextStatusDialog"
      :conversation-id="chatStore.currentConversationId"
    />

    <div class="input-box-container">
      <FilePickerPanel
        ref="filePickerRef"
        :visible="showFilePicker"
        :query="filePickerQuery"
        @select="handleSelectFile"
        @close="handleCloseAtPicker"
        @update:query="(q) => filePickerQuery = q"
      />

      <SlashCommandPanel
        ref="slashPickerRef"
        :visible="showSlashPicker"
        :query="slashPickerQuery"
        @select-skill="handleSelectSkill"
        @complete-command="handleCompleteSlashCommand"
        @close="handleCloseSlashPicker"
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
        @trigger-slash-picker="handleTriggerSlashPicker"
        @close-slash-picker="handleCloseSlashPicker"
        @slash-query-change="handleSlashQueryChange"
        @slash-picker-keydown="handleSlashPickerKeydown"
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

        <Tooltip :content="t('components.input.contextStatus.title')" placement="top">
          <IconButton
            icon="codicon-info"
            size="small"
            :disabled="!canRunContextStatus"
            class="context-status-button"
            @click="handleContextStatus"
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

.summarize-button :deep(i.codicon),
.context-status-button :deep(i.codicon) {
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
