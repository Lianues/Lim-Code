<script setup lang="ts">
/**
 * InputArea - 输入区容器
 * 扁平化设计，底部栏布局：左侧附件按钮，右侧发送按钮
 */

import { ref, computed, onMounted, watch } from 'vue'
import InputBox from './InputBox.vue'
import SendButton from './SendButton.vue'
import ChannelSelector, { type ChannelOption } from './ChannelSelector.vue'
import ModelSelector from './ModelSelector.vue'
import { IconButton, Tooltip } from '../common'
import { useChatStore } from '../../stores'
import { sendToExtension, showNotification } from '../../utils/vscode'
import { formatFileSize } from '../../utils/file'
import { formatNumber } from '../../utils/format'
import type { Attachment } from '../../types'
import { useI18n } from '../../i18n'

const { t } = useI18n()

// 固定文件项类型
interface PinnedFileItem {
  id: string
  path: string
  workspaceUri: string
  enabled: boolean
  addedAt: number
  exists?: boolean  // 文件是否存在
}

const props = defineProps<{
  uploading?: boolean
  placeholder?: string
  attachments?: Attachment[]
}>()

// 从 store 读取等待状态
const chatStore = useChatStore()

// 配置列表
const configs = ref<any[]>([])
const isLoadingConfigs = ref(false)

const emit = defineEmits<{
  send: [content: string, attachments: Attachment[]]
  cancel: []
  attachFile: []
  removeAttachment: [id: string]
  pasteFiles: [files: File[]]
}>()

const isComposing = ref(false)

// 使用 store 中的 inputValue（跨视图保持）
const inputValue = computed({
  get: () => chatStore.inputValue,
  set: (value: string) => chatStore.setInputValue(value)
})

// 配置选项（用于 ChannelSelector）- 只显示已启用的配置
const channelOptions = computed<ChannelOption[]>(() =>
  configs.value
    .filter(config => config.enabled !== false)  // 过滤掉未启用的配置
    .map(config => ({
      id: config.id,
      name: config.name,
      model: config.model || config.id,
      type: config.type
    }))
)

// 加载配置列表
async function loadConfigs() {
  isLoadingConfigs.value = true
  try {
    const ids = await sendToExtension<string[]>('config.listConfigs', {})
    const loadedConfigs: any[] = []
    
    for (const id of ids) {
      const config = await sendToExtension('config.getConfig', { configId: id })
      if (config) {
        loadedConfigs.push(config)
      }
    }
    
    configs.value = loadedConfigs
  } catch (error) {
    console.error('Failed to load configs:', error)
  } finally {
    isLoadingConfigs.value = false
  }
}

// 当前配置
const currentConfig = computed(() => {
  return configs.value.find(c => c.id === chatStore.configId)
})

// 当前模型
const currentModel = computed(() => {
  return currentConfig.value?.model || ''
})

// 当前配置的模型列表（本地配置中的模型）
const currentModels = computed(() => {
  return currentConfig.value?.models || []
})

// 切换渠道
async function handleChannelChange(channelId: string) {
  await chatStore.setConfigId(channelId)
}

// 更新当前渠道的模型
async function handleModelChange(modelId: string) {
  if (!chatStore.configId) return
  
  try {
    // 调用后端更新配置
    await sendToExtension('config.updateConfig', {
      configId: chatStore.configId,
      updates: { model: modelId }
    })
    
    // 更新本地缓存
    const config = configs.value.find(c => c.id === chatStore.configId)
    if (config) {
      config.model = modelId
    }
    
    // 重新加载配置详情
    await chatStore.loadCurrentConfig()
  } catch (error) {
    console.error('Failed to update model:', error)
  }
}

// 是否有附件
const hasAttachments = computed(() =>
  props.attachments && props.attachments.length > 0
)

// 是否可以发送 - 只在等待响应或上传时禁用发送
// 例外：当有待确认工具时允许发送（用于带批注拒绝）
const canSend = computed(() => {
  const hasContent = inputValue.value.trim().length > 0 ||
    (props.attachments && props.attachments.length > 0)

  // 如果有待确认的工具，允许发送（作为批注拒绝）
  if (chatStore.hasPendingToolConfirmation && hasContent) {
    return true
  }

  return hasContent && !chatStore.isWaitingForResponse && !props.uploading
})

// 处理发送
function handleSend() {
  if (!canSend.value) return
  
  const content = inputValue.value.trim()
  const attachments = props.attachments || []
  
  emit('send', content, attachments)
  chatStore.clearInputValue()  // 使用 store 方法清空
}

// 处理取消
function handleCancel() {
  emit('cancel')
}

// 处理输入变化
function handleInput(value: string) {
  chatStore.setInputValue(value)  // 使用 store 方法更新
}

// 处理附件
function handleAttachFile() {
  emit('attachFile')
}

function handleRemoveAttachment(id: string) {
  emit('removeAttachment', id)
}

// 处理输入法状态
function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd() {
  isComposing.value = false
}

// 处理粘贴文件
function handlePasteFiles(files: File[]) {
  emit('pasteFiles', files)
}

// 是否正在总结
const isSummarizing = ref(false)

// 固定文件列表
const pinnedFiles = ref<PinnedFileItem[]>([])
// 是否显示固定文件面板
const showPinnedFilesPanel = ref(false)
// 是否正在加载固定文件
const isLoadingPinnedFiles = ref(false)
// 拖拽状态
const isDraggingOver = ref(false)

// 处理总结上下文
async function handleSummarize() {
  if (isSummarizing.value || chatStore.isWaitingForResponse) return
  
  isSummarizing.value = true
  try {
    // 不传递任何参数，全部使用后端配置
    const result = await chatStore.summarizeContext()
    
    if (!result.success) {
      console.warn('Summarize failed:', result.error)
      // 显示 VSCode 通知
      await showNotification(
        t('components.input.notifications.summarizeFailed', { error: result.error || t('common.unknownError') }),
        'warning'
      )
    } else if (result.summarizedMessageCount && result.summarizedMessageCount > 0) {
      console.log(`Summarized ${result.summarizedMessageCount} messages`)
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
  } finally {
    isSummarizing.value = false
  }
}

// 获取附件图标类名
function getAttachmentIconClass(type: string): string {
  if (type === 'image') return 'codicon-file-media'
  if (type === 'video') return 'codicon-device-camera-video'
  if (type === 'audio') return 'codicon-unmute'
  if (type === 'code') return 'codicon-file-code'
  return 'codicon-file'
}

// 判断附件是否有预览
function hasPreview(attachment: Attachment): boolean {
  if (attachment.type === 'image' && attachment.thumbnail) return true
  if (attachment.type === 'video' && attachment.thumbnail) return true
  if (attachment.type === 'audio') return true
  return false
}

// 预览附件（在 VSCode 中打开）
async function previewAttachment(attachment: Attachment) {
  if (!attachment.data) return
  
  try {
    await sendToExtension('previewAttachment', {
      name: attachment.name,
      mimeType: attachment.mimeType,
      data: attachment.data
    })
  } catch (error) {
    console.error('预览附件失败:', error)
  }
}

// Token 使用量颜色
const tokenRingColor = computed(() => {
  const percent = chatStore.tokenUsagePercent
  if (percent >= 90) return '#f14c4c'  // 红色
  if (percent >= 75) return '#cca700'  // 橙色
  return '#89d185'  // 绿色
})

// SVG 圆环参数
const ringRadius = 8
const ringCircumference = 2 * Math.PI * ringRadius
const ringDashOffset = computed(() => {
  const percent = chatStore.tokenUsagePercent
  return ringCircumference * (1 - percent / 100)
})

// 加载固定文件配置
async function loadPinnedFiles() {
  isLoadingPinnedFiles.value = true
  try {
    const config = await sendToExtension<{ files: PinnedFileItem[] }>('getPinnedFilesConfig', {})
    if (config?.files) {
      pinnedFiles.value = config.files
    }
  } catch (error) {
    console.error('Failed to load pinned files:', error)
  } finally {
    isLoadingPinnedFiles.value = false
  }
}

// 检查固定文件是否存在
async function checkPinnedFilesExistence() {
  if (pinnedFiles.value.length === 0) return
  
  try {
    const result = await sendToExtension<{ files: Array<{ id: string; exists: boolean }> }>(
      'checkPinnedFilesExistence',
      { files: pinnedFiles.value.map(f => ({ id: f.id, path: f.path })) }
    )
    
    if (result?.files) {
      // 更新每个文件的存在状态
      for (const fileResult of result.files) {
        const file = pinnedFiles.value.find(f => f.id === fileResult.id)
        if (file) {
          file.exists = fileResult.exists
        }
      }
    }
  } catch (error) {
    console.error('Failed to check pinned files existence:', error)
  }
}

// 处理拖拽进入
function handleDragEnter(e: DragEvent) {
  // 检查是否按住 Shift 键
  if (!e.shiftKey) return
  
  e.preventDefault()
  e.stopPropagation()
  isDraggingOver.value = true
}

// 处理拖拽悬停
function handleDragOver(e: DragEvent) {
  // 检查是否按住 Shift 键
  if (!e.shiftKey) {
    isDraggingOver.value = false
    return
  }
  
  e.preventDefault()
  e.stopPropagation()
  isDraggingOver.value = true
}

// 处理拖拽离开
function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  
  // 检查是否真的离开了面板
  const target = e.currentTarget as HTMLElement
  const related = e.relatedTarget as HTMLElement
  if (target && related && target.contains(related)) {
    return
  }
  
  isDraggingOver.value = false
}

// 根据错误码获取适当的错误消息
function getErrorMessageByCode(errorCode?: string, defaultError?: string): string {
  switch (errorCode) {
    case 'NOT_IN_ANY_WORKSPACE':
      return t('components.input.notifications.fileNotInAnyWorkspace')
    case 'NOT_IN_CURRENT_WORKSPACE':
      // 错误消息中应该包含工作区名称，使用后端返回的 error
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

// 处理拖拽放置
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDraggingOver.value = false
  
  // 检查是否按住 Shift 键
  if (!e.shiftKey) {
    await showNotification(t('components.input.notifications.holdShiftToDrag'), 'warning')
    return
  }
  
  // 尝试从各种格式获取文件 URI
  // VSCode 标签页拖拽使用的格式优先级：
  // 1. application/vnd.code.uri-list - VSCode 专用格式，直接包含 file:// URI
  // 2. resourceurls - JSON 数组格式的 URI 列表
  // 3. codeeditors - 完整的编辑器信息（包含 resource.external）
  // 4. text/uri-list - 标准格式（资源管理器拖拽）
  // 5. text/plain - 备选格式
  
  const vscodeUriList = e.dataTransfer?.getData('application/vnd.code.uri-list')
  const resourceUrls = e.dataTransfer?.getData('resourceurls')
  const codeEditors = e.dataTransfer?.getData('codeeditors')
  const textUriList = e.dataTransfer?.getData('text/uri-list')
  const textPlain = e.dataTransfer?.getData('text/plain')
  
  let urisToProcess: string[] = []
  
  // 1. 优先使用 VSCode 专用 URI 列表格式
  if (vscodeUriList) {
    // 格式: file:///path/to/file（可能是多行）
    urisToProcess = vscodeUriList.split('\n').filter(uri => uri.trim() && uri.startsWith('file://'))
  }
  
  // 2. 使用 resourceurls（JSON 数组格式）
  if (urisToProcess.length === 0 && resourceUrls) {
    try {
      const parsed = JSON.parse(resourceUrls)
      if (Array.isArray(parsed)) {
        urisToProcess = parsed.filter((uri: string) => typeof uri === 'string' && uri.startsWith('file://'))
      }
    } catch {
      // 解析失败，忽略
    }
  }
  
  // 3. 使用 codeeditors（完整编辑器信息）
  if (urisToProcess.length === 0 && codeEditors) {
    try {
      const parsed = JSON.parse(codeEditors)
      if (Array.isArray(parsed)) {
        for (const editor of parsed) {
          // 优先使用 external URL（已编码的 file:// URI）
          if (editor.resource?.external && typeof editor.resource.external === 'string') {
            urisToProcess.push(editor.resource.external)
          }
        }
      }
    } catch {
      // 解析失败，忽略
    }
  }
  
  // 4. 使用标准 text/uri-list（资源管理器拖拽）
  if (urisToProcess.length === 0 && textUriList) {
    urisToProcess = textUriList.split('\n').filter(uri => uri.trim() && !uri.startsWith('#'))
  }
  
  // 5. 备选：text/plain（如果是 file:// 开头）
  if (urisToProcess.length === 0 && textPlain && textPlain.startsWith('file://')) {
    urisToProcess = textPlain.split('\n').filter(uri => uri.trim() && uri.startsWith('file://'))
  }
  
  if (urisToProcess.length > 0) {
    for (const uri of urisToProcess) {
      try {
        // URI 格式如: file:///path/to/file
        const trimmedUri = uri.trim()
        
        // 验证文件并添加（传递完整 URI 给后端解析）
        const validation = await sendToExtension<{
          valid: boolean
          relativePath?: string
          workspaceUri?: string
          error?: string
          errorCode?: string
        }>(
          'validatePinnedFile',
          { path: trimmedUri }
        )
        
        if (!validation?.valid) {
          const errorMessage = getErrorMessageByCode(validation?.errorCode, validation?.error)
          await showNotification(errorMessage, 'error')
          continue
        }
        
        // 添加到固定文件，使用验证返回的工作区 URI
        const addResult = await sendToExtension<{
          success: boolean
          file?: PinnedFileItem
          error?: string
          errorCode?: string
        }>(
          'addPinnedFile',
          { path: validation.relativePath, workspaceUri: validation.workspaceUri }
        )
        
        if (addResult?.success && addResult.file) {
          pinnedFiles.value.push(addResult.file)
          await showNotification(t('components.input.notifications.fileAdded', { path: validation.relativePath }), 'info')
        } else if (!addResult?.success) {
          const errorMessage = getErrorMessageByCode(addResult?.errorCode, addResult?.error)
          await showNotification(errorMessage, 'error')
        }
      } catch (error: any) {
        console.error('Failed to add pinned file:', error)
        await showNotification(t('components.input.notifications.addFailed', { error: error.message || t('common.unknownError') }), 'error')
      }
    }
    return
  }
  
  // 备选：尝试从 files 获取（可能只有文件名）
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) {
    await showNotification(t('components.input.notifications.cannotGetFilePath'), 'warning')
    return
  }
  
  // 对于普通文件，尝试使用文件名（可能会失败）
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    
    try {
      const validation = await sendToExtension<{
        valid: boolean
        relativePath?: string
        workspaceUri?: string
        error?: string
        errorCode?: string
      }>(
        'validatePinnedFile',
        { path: file.name }
      )
      
      if (!validation?.valid) {
        const errorMessage = getErrorMessageByCode(validation?.errorCode, validation?.error)
        await showNotification(errorMessage, 'error')
        continue
      }
      
      const addResult = await sendToExtension<{
        success: boolean
        file?: PinnedFileItem
        error?: string
        errorCode?: string
      }>(
        'addPinnedFile',
        { path: validation.relativePath, workspaceUri: validation.workspaceUri }
      )
      
      if (addResult?.success && addResult.file) {
        pinnedFiles.value.push(addResult.file)
        await showNotification(t('components.input.notifications.fileAdded', { path: validation.relativePath }), 'info')
      } else if (!addResult?.success) {
        const errorMessage = getErrorMessageByCode(addResult?.errorCode, addResult?.error)
        await showNotification(errorMessage, 'error')
      }
    } catch (error: any) {
      console.error('Failed to add pinned file:', error)
      await showNotification(t('components.input.notifications.addFailed', { error: error.message || t('common.unknownError') }), 'error')
    }
  }
}

// 移除固定文件
async function handleRemovePinnedFile(id: string) {
  try {
    await sendToExtension('removePinnedFile', { id })
    pinnedFiles.value = pinnedFiles.value.filter(f => f.id !== id)
  } catch (error: any) {
    console.error('Failed to remove pinned file:', error)
    await showNotification(t('components.input.notifications.removeFailed', { error: error.message || t('common.unknownError') }), 'error')
  }
}

// 切换固定文件启用状态
async function handleTogglePinnedFile(id: string, enabled: boolean) {
  try {
    await sendToExtension('setPinnedFileEnabled', { id, enabled })
    const file = pinnedFiles.value.find(f => f.id === id)
    if (file) {
      file.enabled = enabled
    }
  } catch (error: any) {
    console.error('Failed to toggle pinned file:', error)
  }
}

// 切换固定文件面板显示
async function togglePinnedFilesPanel() {
  showPinnedFilesPanel.value = !showPinnedFilesPanel.value
  if (showPinnedFilesPanel.value) {
    // 打开时重新加载并检查文件存在性
    await loadPinnedFiles()
    await checkPinnedFilesExistence()
  }
}

// 获取启用的固定文件数量
const enabledPinnedFilesCount = computed(() => {
  return pinnedFiles.value.filter(f => f.enabled).length
})

// 初始化加载配置
onMounted(() => {
  loadConfigs()
  loadPinnedFiles()
})

// 监听配置变化，确保配置列表包含当前配置
watch(() => chatStore.configId, () => {
  // 如果当前配置不在列表中，重新加载
  if (chatStore.configId && !configs.value.some(c => c.id === chatStore.configId)) {
    loadConfigs()
  }
})

// 监听 currentConfig 变化，当用户在设置中修改模型后会触发 loadCurrentConfig()
// 这样可以及时更新模型选择器的列表，而不需要等待视图切换
watch(() => chatStore.currentConfig, () => {
  loadConfigs()
}, { deep: true })
</script>

<template>
  <div class="input-area">
    <!-- 附件列表 -->
    <div v-if="hasAttachments" class="attachments-list">
      <div
        v-for="attachment in attachments"
        :key="attachment.id"
        class="attachment-item"
        :class="{ 'has-preview': hasPreview(attachment) }"
      >
        <!-- 图片预览 -->
        <img
          v-if="attachment.type === 'image' && attachment.thumbnail"
          :src="attachment.thumbnail"
          :alt="attachment.name"
          class="attachment-preview clickable"
          @click="previewAttachment(attachment)"
          :title="t('components.input.clickToPreview')"
        />
        <!-- 视频预览（缩略图 + 播放图标） -->
        <div
          v-else-if="attachment.type === 'video' && attachment.thumbnail"
          class="media-preview-wrapper clickable"
          @click="previewAttachment(attachment)"
          :title="t('components.input.clickToPreview')"
        >
          <img
            :src="attachment.thumbnail"
            :alt="attachment.name"
            class="attachment-preview"
          />
          <i class="codicon codicon-play media-overlay-icon"></i>
        </div>
        <!-- 音频预览（音乐图标） -->
        <div
          v-else-if="attachment.type === 'audio'"
          class="media-preview-wrapper audio-placeholder clickable"
          @click="previewAttachment(attachment)"
          :title="t('components.input.clickToPreview')"
        >
          <i class="codicon codicon-unmute media-center-icon"></i>
        </div>
        <!-- 其他文件显示图标 -->
        <i
          v-else
          :class="['codicon', getAttachmentIconClass(attachment.type), 'attachment-icon']"
        ></i>
        <span class="attachment-name">{{ attachment.name }}</span>
        <span class="attachment-size">{{ formatFileSize(attachment.size) }}</span>
        <IconButton
          icon="codicon-close"
          size="small"
          :disabled="uploading"
          @click="handleRemoveAttachment(attachment.id)"
        />
      </div>
    </div>

    <!-- 输入框 -->
    <InputBox
      :value="inputValue"
      :disabled="false"
      :placeholder="placeholder"
      @update:value="handleInput"
      @send="handleSend"
      @composition-start="handleCompositionStart"
      @composition-end="handleCompositionEnd"
      @paste="handlePasteFiles"
    />

    <!-- 固定文件面板（弹出） -->
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
            <i :class="['codicon', file.exists === false ? 'codicon-warning' : 'codicon-file-text']"></i>
            <span class="pinned-file-path" :title="file.exists === false ? `${t('components.input.fileNotExists')}: ${file.path}` : file.path">
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
      <!-- 拖拽提示 -->
      <div class="pinned-files-footer">
        <div class="drag-hint">
          <i class="codicon codicon-info"></i>
          <span>{{ t('components.input.pinnedFilesPanel.dragHint') }}</span>
        </div>
      </div>
      <!-- 拖拽遮罩 -->
      <div v-if="isDraggingOver" class="drag-overlay">
        <i class="codicon codicon-cloud-upload"></i>
        <span>{{ t('components.input.pinnedFilesPanel.dropHint') }}</span>
      </div>
    </div>

    <!-- 底部工具栏：附件按钮 + 固定文件按钮 + 发送按钮 -->
    <div class="bottom-toolbar">
      <!-- 左侧：附件按钮 + 固定文件按钮 -->
      <div class="toolbar-left">
        <Tooltip :content="t('components.input.attachFile')" placement="top-left">
          <IconButton
            icon="codicon-attach"
            size="small"
            :disabled="uploading"
            class="attach-button"
            @click="handleAttachFile"
          />
        </Tooltip>
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
      </div>

      <!-- 右侧：压缩按钮 + Token 圆环 + 发送按钮 -->
      <div class="toolbar-right">
        <!-- 压缩上下文按钮 -->
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
        
        <!-- Token 使用量圆环（始终显示） -->
        <div class="token-ring-wrapper">
          <svg class="token-ring" width="22" height="22" viewBox="0 0 22 22">
            <!-- 背景圆环 -->
            <circle
              cx="11"
              cy="11"
              :r="ringRadius"
              fill="none"
              stroke="var(--vscode-panel-border)"
              stroke-width="2"
            />
            <!-- 进度圆环 -->
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
          <!-- 悬浮提示 -->
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

    <!-- 选择器栏：渠道选择器 + 模型选择器 -->
    <div class="selector-bar">
      <!-- 渠道选择器 -->
      <div class="channel-selector-wrapper">
        <ChannelSelector
          :model-value="chatStore.configId"
          :options="channelOptions"
          :placeholder="t('components.input.selectChannel')"
          :disabled="isLoadingConfigs"
          :drop-up="true"
          @update:model-value="handleChannelChange"
        />
      </div>
      
      <!-- 分隔线 -->
      <span class="selector-separator"></span>
      
      <!-- 模型选择器 -->
      <div class="model-selector-wrapper">
        <ModelSelector
          :models="currentModels"
          :current-model="currentModel"
          :disabled="!chatStore.configId || isLoadingConfigs"
          @update:model="handleModelChange"
        />
      </div>
    </div>
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

/* 附件列表 */
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

/* 图片预览 */
.attachment-preview {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

/* 可点击的预览 */
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

/* 媒体预览包装器（视频、音频） */
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

/* 音频占位背景 */
.audio-placeholder {
  background: linear-gradient(135deg, #3a3d41, #2d2d30);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 叠加层图标（右下角小图标，用于视频） */
.media-overlay-icon {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 10px;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

/* 居中图标（用于音频） */
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

/* 底部工具栏 */
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

/* 附件按钮图标放大 1.2 倍 */
.attach-button :deep(i.codicon) {
  font-size: 17px !important; /* 14px * 1.2 ≈ 17px */
}

/* 压缩按钮 */
.summarize-button :deep(i.codicon) {
  font-size: 15px !important;
}

/* Token 圆环 */
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

/* 提示框小三角 */
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

/* 选择器栏 */
.selector-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding-top: 4px;
  border-top: 1px solid var(--vscode-panel-border);
  max-width: 280px;
}

/* 渠道选择器 */
.channel-selector-wrapper {
  flex: 1;
  min-width: 0;
}

.channel-selector-wrapper :deep(.channel-selector) {
  width: 100%;
}

.channel-selector-wrapper :deep(.selector-dropdown) {
  width: 180px;
  min-width: 180px;
}

/* 模型选择器 */
.model-selector-wrapper {
  flex: 1;
  min-width: 0;
}

.model-selector-wrapper :deep(.model-selector) {
  width: 100%;
}

/* 选择器分隔线 */
.selector-separator {
  width: 1px;
  height: 14px;
  background: var(--vscode-panel-border);
  opacity: 0.6;
}

/* 固定文件按钮 */
.pinned-files-button-wrapper {
  position: relative;
  display: inline-flex;
}

/* 图钉图标顺时针旋转90度（朝下） */
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

/* 固定文件面板 */
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

.pinned-file-item .codicon-file-text {
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

/* 拖拽状态 */
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

/* 加载动画 */
.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>