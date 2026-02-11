<script setup lang="ts">
/**
 * MessageItem - 单条消息组件
 * 扁平化设计，所有消息统一靠左布局
 * 按 parts 原始顺序显示内容
 */

import { ref, computed, watch, onUnmounted } from 'vue'
import MessageActions from './MessageActions.vue'
import ToolMessage from './ToolMessage.vue'
import MessageAttachments from './MessageAttachments.vue'
import InlineContextMessage from './InlineContextMessage.vue'
import MessageTaskCards from './MessageTaskCards.vue'
import { MarkdownRenderer, RetryDialog, EditDialog, JsonViewerDialog } from '../common'
import type { Message, ToolUsage, CheckpointRecord, Attachment } from '../../types'
import { hasContextBlocks } from '../../types/contextParser'
import { formatTime } from '../../utils/format'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const props = defineProps<{
  message: Message
  messageIndex: number  // 后端消息索引
}>()

const emit = defineEmits<{
  edit: [messageId: string, newContent: string, attachments: Attachment[]]
  restoreAndEdit: [messageId: string, newContent: string, attachments: Attachment[], checkpointId: string]
  delete: [messageId: string]
  retry: [messageId: string]
  restoreAndRetry: [messageId: string, checkpointId: string]
  copy: [content: string]
}>()

const chatStore = useChatStore()
const settingsStore = useSettingsStore()

// 流式输出指示器文本：支持用户自定义（外观设置），为空时使用 i18n 默认值
const streamingIndicatorText = computed(() => {
  const custom = (settingsStore.appearanceLoadingText || '').trim()
  return custom || t('common.loading') || 'Loading'
})

// 使用 Array.from 以更好地支持中文等多字节字符
const streamingIndicatorChars = computed(() => Array.from(streamingIndicatorText.value))

const showActions = ref(false)
const showRetryDialog = ref(false)
const showEditDialog = ref(false)
const showRawDialog = ref(false)

// 消息角色判断
const isUser = computed(() => props.message.role === 'user')
const isTool = computed(() => props.message.role === 'tool')

// 是否为总结消息
const isSummary = computed(() => props.message.isSummary === true)

// 是否为流式消息
const isStreaming = computed(() => props.message.streaming === true)


// 总结消息展开状态
const isSummaryExpanded = ref(false)

/**
 * 渲染块类型
 */
interface RenderBlock {
  type: 'text' | 'tool' | 'thought'
  text?: string
  tools?: ToolUsage[]
}

// 思考内容展开状态
const isThoughtExpanded = ref(false)


const todoDebugPrinted = new Set<string>()
function debugTodoOnce(key: string, data: Record<string, unknown>) {
  if (todoDebugPrinted.has(key)) return
  todoDebugPrinted.add(key)
  console.debug('[todo-debug][MessageItem]', data)
}

// 实时思考时间（用于动态更新显示）
const elapsedThinkingTime = ref(0)
let thinkingTimer: ReturnType<typeof setInterval> | null = null

/**
 * 格式化时间显示（毫秒转秒）
 * @param ms 毫秒数
 * @returns 格式化后的时间字符串（秒为单位）
 */
function formatDuration(ms: number): string {
  const seconds = ms / 1000
  return `${seconds.toFixed(1)}s`
}

// 启动思考计时器
function startThinkingTimer() {
  if (thinkingTimer) return
  
  const startTime = props.message.metadata?.thinkingStartTime
  if (!startTime) return
  
  // 立即更新一次
  elapsedThinkingTime.value = Date.now() - startTime
  
  // 每 100ms 更新一次
  thinkingTimer = setInterval(() => {
    elapsedThinkingTime.value = Date.now() - startTime
  }, 100)
}

// 停止思考计时器
function stopThinkingTimer() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer)
    thinkingTimer = null
  }
}

// 组件卸载时清理定时器
onUnmounted(() => {
  stopThinkingTimer()
})

// JSON 工具调用边界标记
const TOOL_CALL_START = '<<<TOOL_CALL>>>'
const TOOL_CALL_END = '<<<END_TOOL_CALL>>>'

// XML 工具调用标记
const XML_TOOL_START = '<tool_use>'
const XML_TOOL_END = '</tool_use>'

/**
 * 过滤掉文本中的工具调用标记
 * 支持 JSON 格式（<<<TOOL_CALL>>>...<<<END_TOOL_CALL>>>）
 * 和 XML 格式（<tool_use>...</tool_use>）
 * 流式响应时，这些标记可能先显示，等完成后才转换为 functionCall
 */
function filterToolCallMarkers(text: string): string {
  let result = text
  
  // 1. 处理 JSON 格式
  if (result.includes(TOOL_CALL_START)) {
    // 移除完整的工具调用块
    const jsonRegex = new RegExp(
      TOOL_CALL_START.replace(/[<>]/g, '\\$&') +
      '[\\s\\S]*?' +
      TOOL_CALL_END.replace(/[<>]/g, '\\$&'),
      'g'
    )
    result = result.replace(jsonRegex, '')
    
    // 移除不完整的开始标记（流式时可能只有开头）
    const jsonStartIdx = result.indexOf(TOOL_CALL_START)
    if (jsonStartIdx !== -1) {
      result = result.substring(0, jsonStartIdx)
    }
  }
  
  // 2. 处理 XML 格式
  if (result.includes(XML_TOOL_START)) {
    // 移除完整的工具调用块
    const xmlRegex = new RegExp(
      XML_TOOL_START.replace(/[<>]/g, '\\$&') +
      '[\\s\\S]*?' +
      XML_TOOL_END.replace(/[<>]/g, '\\$&'),
      'g'
    )
    result = result.replace(xmlRegex, '')
    
    // 移除不完整的开始标记（流式时可能只有开头）
    const xmlStartIdx = result.indexOf(XML_TOOL_START)
    if (xmlStartIdx !== -1) {
      result = result.substring(0, xmlStartIdx)
    }
  }
  
  return result.trim()
}

/**
 * 将 parts 转换为渲染块，保持原始顺序
 *
 * 连续的 text 块会合并，连续的 functionCall 块会合并成一个 tools 块。
 *
 * 性能优化：对 text/thought 类型的 block 做引用稳定化——
 * 当仅工具状态变更（message.tools 变化而 parts 不变）导致 computed 重算时，
 * text/thought block 的内容不会变化。通过复用上一次的对象引用，
 * 避免下游 MarkdownRenderer 的 watch 被触发。
 */
let _prevRenderBlocks: RenderBlock[] = []

const renderBlocks = computed<RenderBlock[]>(() => {
  const parts = props.message.parts
  if (!parts || parts.length === 0) {
    _prevRenderBlocks = []
    return []
  }
  
  const blocks: RenderBlock[] = []
  let currentTextBlock: string[] = []
  let currentToolBlock: ToolUsage[] = []
  let currentThoughtBlock: string[] = []
  
  const messageTools = props.message.tools || []
  let functionCallOrdinal = 0

  // 辅助函数：刷新文本块
  const flushText = () => {
    if (currentTextBlock.length > 0) {
      const text = filterToolCallMarkers(currentTextBlock.join(''))
      if (text) {
        blocks.push({ type: 'text', text })
      }
      currentTextBlock = []
    }
  }
  
  // 辅助函数：刷新工具块
  const flushTools = () => {
    if (currentToolBlock.length > 0) {
      blocks.push({ type: 'tool', tools: [...currentToolBlock] })
      currentToolBlock = []
    }
  }
  
  // 辅助函数：刷新思考块
  const flushThought = () => {
    if (currentThoughtBlock.length > 0) {
      const text = currentThoughtBlock.join('')
      if (text.trim()) {
        blocks.push({ type: 'thought', text })
      }
      currentThoughtBlock = []
    }
  }
  
  for (const part of parts) {
    // 处理思考内容
    if (part.thought && part.text) {
      // 思考内容：先刷新其他块
      flushText()
      flushTools()
      currentThoughtBlock.push(part.text)
      continue
    }
    
    // 处理文本
    if (part.text) {
      // 文本块：先刷新思考块和工具块
      flushThought()
      flushTools()
      currentTextBlock.push(part.text)
    }
    
    // 处理工具调用（即使同一个 part 有 thoughtSignature）
    if (part.functionCall) {
      // 工具调用：先刷新文本块和思考块
      flushText()
      flushThought()
      
      // 从 message.tools 中查找对应的工具状态。
      // 优先按 functionCall.id 匹配；若 part 里没有 id（某些模型/模式下会缺失），
      // 回退到同序位工具，确保每条工具消息都能拿到稳定 toolId（用于 TODO 快照锚定）。
      const toolIdFromPart = typeof part.functionCall.id === 'string' ? part.functionCall.id : ''
      let existingTool: ToolUsage | undefined
      if (toolIdFromPart) {
        existingTool = messageTools.find(t => t.id === toolIdFromPart)
      } else if (functionCallOrdinal < messageTools.length) {
        existingTool = messageTools[functionCallOrdinal]
      }

      const stableToolId =
        toolIdFromPart ||
        existingTool?.id ||
        `${props.message.id}:tool:${functionCallOrdinal}`
      
      debugTodoOnce(`function-call-${props.message.id}-${functionCallOrdinal}-${stableToolId}`, {
        messageId: props.message.id,
        messageBackendIndex: props.message.backendIndex,
        functionCallOrdinal,
        functionCallName: part.functionCall.name,
        functionCallIdFromPart: toolIdFromPart || null,
        resolvedToolId: stableToolId,
        existingToolId: existingTool?.id || null
      })

      currentToolBlock.push({
        id: stableToolId,
        name: part.functionCall.name,
        args: part.functionCall.args,
        partialArgs: part.functionCall.partialArgs,
        status: existingTool?.status,
        result: existingTool?.result
      })

      functionCallOrdinal += 1
    }
    // 忽略其他类型（如 inlineData、fileData 等，后续可扩展）
  }
  
  // 刷新剩余块
  flushThought()
  flushText()
  flushTools()

  // 引用稳定化：复用上一次内容相同的 text/thought block 的对象引用，
  // 避免仅因工具状态变更而触发下游 MarkdownRenderer 的无效重渲染
  const prev = _prevRenderBlocks
  if (prev.length === blocks.length) {
    for (let i = 0; i < blocks.length; i++) {
      const cur = blocks[i]
      const old = prev[i]
      if (
        cur.type === old.type &&
        (cur.type === 'text' || cur.type === 'thought') &&
        cur.text === old.text
      ) {
        blocks[i] = old
      }
    }
  }
  _prevRenderBlocks = blocks
  
  return blocks
})


/**
 * 主内容区渲染块
 */
const contentRenderBlocks = computed<RenderBlock[]>(() => {
  // 不隐藏任何工具，按原始渲染块完整展示
  return renderBlocks.value
})

// 判断是否正在思考中（有思考块但没有普通文本块也没有工具调用块，且消息正在流式输出，且没有最终的思考时间）
// 注意：必须在 renderBlocks 定义之后才能使用
const isThinking = computed(() => {
  if (!isStreaming.value) return false
  
  // 如果已经有后端计算的思考时间，说明思考已完成
  if (props.message.metadata?.thinkingDuration) return false
  
  const hasThoughtBlock = renderBlocks.value.some(b => b.type === 'thought')
  const hasTextBlock = renderBlocks.value.some(b => b.type === 'text' && b.text && b.text.trim())
  const hasToolBlock = renderBlocks.value.some(b => b.type === 'tool')
  
  // 有思考块，且没有文本块和工具调用块时，才认为正在思考
  // 当有工具调用时，思考已完成，正在等待工具响应
  return hasThoughtBlock && !hasTextBlock && !hasToolBlock
})

// 获取思考时间显示文本
// 优先使用后端提供的最终时间，否则使用实时计算的时间
const thinkingTimeDisplay = computed(() => {
  // 如果有最终的思考时间，使用它
  const duration = props.message.metadata?.thinkingDuration
  if (duration && duration > 0) {
    return formatDuration(duration)
  }
  
  // 如果正在思考中，显示实时时间
  if (isThinking.value && elapsedThinkingTime.value > 0) {
    return formatDuration(elapsedThinkingTime.value)
  }
  
  return null
})

// 监听思考状态变化
watch(isThinking, (thinking) => {
  if (thinking) {
    startThinkingTimer()
  } else {
    stopThinkingTimer()
  }
}, { immediate: true })

// 监听 thinkingStartTime 变化（确保首次有值时启动）
watch(
  () => props.message.metadata?.thinkingStartTime,
  (startTime) => {
    if (startTime && isThinking.value && !thinkingTimer) {
      startThinkingTimer()
    }
  },
  { immediate: true }
)

// 获取当前消息及之前所有消息的检查点
// 之前消息的存档点：包含所有阶段（before/after），因为这些代表已完成的操作状态
// 当前消息的存档点：只包含 before 阶段，因为用户要撤销的是这条消息的效果
const availableCheckpoints = computed<CheckpointRecord[]>(() => {
  return chatStore.checkpoints
    .filter(cp => {
      if (cp.messageIndex < props.messageIndex) return true          // 之前的消息：包含所有阶段
      if (cp.messageIndex === props.messageIndex && cp.phase === 'before') return true  // 当前消息：只包含 before
      return false
    })
})

// 获取用于编辑用户消息的最新检查点
// 优先显示该用户消息的"消息前存档"（如果存在）
// 如果不存在，则显示之前最近的一个存档点
const checkpointsBeforeMessage = computed<CheckpointRecord[]>(() => {
  // 首先查找该消息的"用户消息前"存档点
  const userMessageBefore = chatStore.checkpoints.find(cp =>
    cp.messageIndex === props.messageIndex &&
    cp.toolName === 'user_message' &&
    cp.phase === 'before'
  )
  
  if (userMessageBefore) {
    // 如果有该消息的"消息前存档"，只返回这一个
    return [userMessageBefore]
  }
  
  // 否则，找之前最近的一个存档点（按 messageIndex 降序排列取第一个）
  const previousCheckpoints = chatStore.checkpoints
    .filter(cp => cp.messageIndex < props.messageIndex)
    .sort((a, b) => b.messageIndex - a.messageIndex)
  
  if (previousCheckpoints.length > 0) {
    return [previousCheckpoints[0]]
  }
  
  return []
})

// 模型版本
const modelVersion = computed(() => props.message.metadata?.modelVersion)

// 角色显示名称
const roleDisplayName = computed(() => {
  if (isUser.value) return t('components.message.roles.user')
  if (isTool.value) return t('components.message.roles.tool')
  // 助手消息显示模型版本
  return modelVersion.value || t('components.message.roles.assistant')
})

// Token 使用情况
const usageMetadata = computed(() => props.message.metadata?.usageMetadata)
const hasUsage = computed(() =>
  !isUser.value && !isTool.value && usageMetadata.value &&
  (usageMetadata.value.totalTokenCount || usageMetadata.value.promptTokenCount || usageMetadata.value.candidatesTokenCount)
)

// 响应持续时间（从请求发送到响应结束，使用后端提供的数据）
const responseDuration = computed(() => {
  const duration = props.message.metadata?.responseDuration
  if (duration && duration > 0) {
    return formatDuration(duration)
  }
  return null
})

// Token 速率计算
// 如果模型返回了思考内容，则计算 (输出token + 思考token) / 流式持续时间
// 如果没有思考内容，则只计算 输出token / 流式持续时间
// 只有多于一个流式块时才显示速率
const tokenRate = computed(() => {
  const metadata = props.message.metadata
  if (!metadata) return null
  
  const streamDuration = metadata.streamDuration
  const chunkCount = metadata.chunkCount
  
  // 只有多于一个流式块时才计算速率
  if (!streamDuration || streamDuration <= 0 || !chunkCount || chunkCount <= 1) {
    return null
  }
  
  const usage = metadata.usageMetadata
  if (!usage) return null
  
  // 获取输出 token 数
  const outputTokens = usage.candidatesTokenCount || 0
  const thoughtTokens = usage.thoughtsTokenCount || 0
  
  // 如果有思考 token，则计算总的（输出 + 思考）；否则只计算输出
  const totalTokens = thoughtTokens > 0 ? (outputTokens + thoughtTokens) : outputTokens
  
  if (totalTokens <= 0) return null
  
  // 计算速率（tokens/s）
  const durationSeconds = streamDuration / 1000
  const rate = totalTokens / durationSeconds
  
  return rate.toFixed(1)
})

// 消息类名
const messageClass = computed(() => ({
  'message-item': true,
  'user-message': isUser.value,
  'assistant-message': !isUser.value,
  'streaming': isStreaming.value,
  'summary-message': isSummary.value
}))

// 格式化时间（只有有效时间戳时才显示）
const formattedTime = computed(() => {
  if (!props.message.timestamp || props.message.timestamp === 0) {
    return null
  }
  return formatTime(props.message.timestamp, 'HH:mm')
})

// 开始编辑（显示编辑对话框）
function startEdit() {
  showEditDialog.value = true
}

// 处理编辑保存
function handleEdit(newContent: string, attachments: Attachment[]) {
  emit('edit', props.message.id, newContent, attachments)
}

// 处理回档并编辑
function handleRestoreAndEdit(newContent: string, attachments: Attachment[], checkpointId: string) {
  emit('restoreAndEdit', props.message.id, newContent, attachments, checkpointId)
}

// 处理操作
function handleCopy() {
  emit('copy', props.message.content)
}

function handleDelete() {
  emit('delete', props.message.id)
}

function handleRetryClick() {
  // 始终显示重试对话框
  showRetryDialog.value = true
}

function handleViewRaw() {
  showRawDialog.value = true
}

const rawMessageView = computed(() => {
  const attachments = (props.message.attachments || []).map(att => {
    const { data, thumbnail, ...rest } = att as any
    return {
      ...rest,
      hasData: !!data,
      hasThumbnail: !!thumbnail,
      dataSize: typeof data === 'string' ? data.length : 0,
      thumbnailSize: typeof thumbnail === 'string' ? thumbnail.length : 0
    }
  })

  return {
    id: props.message.id,
    role: props.message.role,
    createdAt: props.message.timestamp,
    backendIndex: props.message.backendIndex,
    modelVersion: (props.message.metadata as any)?.modelVersion,
    content: props.message.content,
    parts: props.message.parts,
    tools: props.message.tools,
    attachments,
    metadata: props.message.metadata,
    checkpoints: {
      availableBefore: availableCheckpoints.value,
      editRestoreCandidates: checkpointsBeforeMessage.value
    },
    debug: {
      renderBlocks: renderBlocks.value
    }
  }
})

function handleRetry() {
  emit('retry', props.message.id)
}

function handleRestoreAndRetry(checkpointId: string) {
  emit('restoreAndRetry', props.message.id, checkpointId)
}

</script>

<template>
  <div
    :class="messageClass"
    @mouseenter="showActions = true"
    @mouseleave="showActions = false"
  >
    <div class="message-header">
      <div class="message-role-indicator">
        <span class="role-label">
          {{ roleDisplayName }}
        </span>
      </div>

      <!-- 操作按钮 -->
      <MessageActions
        :class="{ 'actions-visible': showActions }"
        :message="message"
        :can-edit="isUser"
        :can-retry="!isUser"
        :can-view-raw="!isUser"
        @edit="startEdit"
        @copy="handleCopy"
        @delete="handleDelete"
        @retry="handleRetryClick"
        @view-raw="handleViewRaw"
      />
    </div>
    
    <!-- 重试对话框 -->
    <RetryDialog
      v-model="showRetryDialog"
      :checkpoints="availableCheckpoints"
      @retry="handleRetry"
      @restore-and-retry="handleRestoreAndRetry"
    />
    
    <!-- 编辑对话框 -->
    <EditDialog
      v-model="showEditDialog"
      :checkpoints="checkpointsBeforeMessage"
      :original-content="message.content"
      :original-attachments="message.attachments || []"
      @edit="handleEdit"
      @restore-and-edit="handleRestoreAndEdit"
    />

    <!-- 原始返回查看（调试用） -->
    <JsonViewerDialog
      v-model="showRawDialog"
      :value="rawMessageView"
      :title="t('components.message.actions.viewRaw')"
      width="860px"
    />

    <div class="message-body">
      <!-- 总结消息特殊显示 -->
      <div v-if="isSummary" class="summary-block">
        <div
          class="summary-header"
          @click="isSummaryExpanded = !isSummaryExpanded"
        >
          <i class="codicon" :class="isSummaryExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"></i>
          <i class="codicon codicon-fold summary-icon"></i>
          <span class="summary-label">{{ t('components.message.summary.title') }}</span>
          <span v-if="message.summarizedMessageCount" class="summary-count">
            {{ t('components.message.summary.compressed', { count: message.summarizedMessageCount }) }}
          </span>
        </div>
        <div v-if="isSummaryExpanded" class="summary-content">
          <MarkdownRenderer
            :content="message.content"
            :latex-only="false"
            class="summary-text"
          />
        </div>
      </div>
      
      <!-- 普通消息显示 -->
      <template v-else>
        <!-- 用户消息的上下文块显示 -->
        <!-- 用户消息现在支持将 <lim-context> 以内联徽章的形式渲染在正文中 -->
        
        <!-- 用户消息的附件显示 -->
        <MessageAttachments
          v-if="isUser && message.attachments && message.attachments.length > 0"
          :attachments="message.attachments"
        />

        <!-- 显示模式 -->
        <div class="message-content">
        <!-- 有 parts 时渲染内容块（TODO 工具块会下沉到消息底部） -->
        <template v-if="renderBlocks.length > 0">
          <template v-for="(block, index) in contentRenderBlocks" :key="index">
            <!-- 思考块：可折叠显示 -->
            <div v-if="block.type === 'thought'" class="thought-block">
              <div
                class="thought-header"
                @click="isThoughtExpanded = !isThoughtExpanded"
              >
                <i class="codicon" :class="isThoughtExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'"></i>
                <i class="codicon codicon-lightbulb thought-icon" :class="{ 'thinking-pulse': isThinking }"></i>
                <span class="thought-label">{{ isThinking ? t('components.message.thought.thinking') : t('components.message.thought.thoughtProcess') }}</span>
                <span v-if="thinkingTimeDisplay" class="thought-time" :class="{ 'thinking-active': isThinking }">
                  {{ thinkingTimeDisplay }}
                </span>
                <span v-if="!isThoughtExpanded" class="thought-preview">
                  {{ (block.text || '').slice(0, 50) }}{{ (block.text || '').length > 50 ? '...' : '' }}
                </span>
              </div>
              <div v-if="isThoughtExpanded" class="thought-content">
                <MarkdownRenderer
                  :content="block.text || ''"
                  :latex-only="false"
                  class="thought-text"
                />
              </div>
            </div>
            
            <!-- 文本块：使用 MarkdownRenderer 渲染 -->
            <!-- 用户消息仅渲染 LaTeX，助手消息渲染完整 Markdown -->
            <!-- 用户消息如果有上下文块，使用解析后的内容 -->
            <InlineContextMessage
              v-else-if="block.type === 'text' && isUser && hasContextBlocks(block.text || '')"
              :content="block.text || ''"
            />

            <MarkdownRenderer
              v-else-if="block.type === 'text'"
              :content="block.text || ''"
              :latex-only="isUser"
              :is-streaming="isStreaming"
              class="content-text"
            />
            
            <!-- 工具调用块 -->
            <ToolMessage
              :message-backend-index="message.backendIndex"
              v-else-if="block.type === 'tool'"
              :tools="block.tools!"
            />
          </template>
        </template>
        
        <!-- 无 parts 但有 content 时：直接渲染 content -->
        <!-- 用户消息仅渲染 LaTeX，如果有上下文块则使用解析后的内容 -->
        <InlineContextMessage
          v-else-if="isUser && message.content && hasContextBlocks(message.content)"
          :content="message.content"
        />

        <MarkdownRenderer
          v-else-if="message.content"
          :content="message.content"
          :latex-only="isUser"
          :is-streaming="isStreaming"
          class="content-text"
        />

        <!-- 无内容兜底（模型返回空内容/仅返回签名等场景） -->
        <div v-else-if="!isStreaming" class="empty-response">
          {{ t('components.message.emptyResponse') }}
        </div>
        
        <!-- 流式指示器 - Loading 逐字波动 -->
        <span
          v-if="isStreaming"
          class="streaming-indicator"
          role="status"
          :aria-label="streamingIndicatorText"
          :style="{
            '--loading-duration': '2.8s',
            '--loading-idle-color': 'var(--vscode-descriptionForeground, #8a8a8a)',
            '--loading-active-color': 'var(--vscode-charts-blue, #0050b3)',
            '--loading-amp': '4px'
          }"
        >
          <span
            v-for="(ch, i) in streamingIndicatorChars"
            :key="i"
            class="streaming-indicator__char"
            :class="{
              'streaming-indicator__char--underline': true
            }"
            :style="{ '--loading-delay': `${i * 0.16}s` }"
          >
            {{ ch }}
          </span>
        </span>

        <!-- 消息底部信息：时间 + 响应时间 + Token 速率 + Token 统计 -->
        <div class="message-footer">
          <div class="message-footer-left">
            <span v-if="formattedTime" class="message-time">{{ formattedTime }}</span>
            
            <!-- 响应持续时间 -->
            <span v-if="responseDuration" class="response-duration" :title="t('components.message.stats.responseDuration')">
              <i class="codicon codicon-clock"></i>{{ responseDuration }}
            </span>
            
            <!-- Token 速率 -->
            <span v-if="tokenRate" class="token-rate" :title="t('components.message.stats.tokenRate')">
              <i class="codicon codicon-zap"></i>{{ tokenRate }} t/s
            </span>
          </div>
          
          <!-- Token 使用统计 -->
          <div v-if="hasUsage" class="token-usage">
            <span v-if="usageMetadata?.totalTokenCount" class="token-total">
              {{ usageMetadata.totalTokenCount }}
            </span>
            <span v-if="usageMetadata?.promptTokenCount" class="token-item token-prompt">
              <span class="token-arrow">↑</span>{{ usageMetadata.promptTokenCount }}
            </span>
            <span v-if="usageMetadata?.candidatesTokenCount" class="token-item token-candidates">
              <span class="token-arrow">↓</span>{{ usageMetadata.candidatesTokenCount }}
            </span>
          </div>
        </div>

        <!-- Cursor 风格任务卡片：Plan/SubAgent 缩略预览，放在消息内容下方 -->
        <MessageTaskCards
          v-if="!isUser && message.tools && message.tools.length > 0"
          :tools="message.tools"
          :message-model-version="modelVersion"
        />
        </div>

      </template>
    </div>
  </div>
</template>

<style scoped>
/* 消息项 - 扁平化设计，统一靠左 */
.message-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-md, 16px) var(--spacing-md, 16px);
  border-bottom: 1px solid var(--vscode-panel-border);
  transition: background-color var(--transition-fast, 0.1s);
  /* 性能优化：布局隔离 */
  contain: layout;
}

.message-item:last-child {
  border-bottom: none;
}

/* 所有消息统一靠左 */
.user-message,
.assistant-message {
  align-self: stretch;
  max-width: 100%;
}

/* 用户消息左侧蓝色竖条 — 滚动时快速定位 */
.user-message {
  border-left: 3px solid var(--vscode-textLink-foreground);
  background-color: color-mix(in srgb, var(--vscode-textLink-foreground) 6%, transparent);
}

/* 消息头部 */
.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm, 8px);
}

.message-role-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.role-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.user-message .role-label {
  color: var(--vscode-foreground);
}

.assistant-message .role-label {
  color: var(--vscode-descriptionForeground);
}

/* 工具消息标签 */
.message-item[class*="tool"] .role-label {
  color: var(--vscode-charts-blue);
}

/* 消息底部信息 */
.message-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--spacing-sm, 8px);
}

.message-footer-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
}

.message-time {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
}

/* 响应持续时间 */
.response-duration {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
}

.response-duration .codicon {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

/* Token 速率 */
.token-rate {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
}

.token-rate .codicon {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

/* 消息内容 */
.message-body {
  padding-left: 0;
}

.message-content {
  position: relative;
}

.todo-tool-blocks {
  margin-top: var(--spacing-sm, 8px);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.empty-response {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px dashed var(--vscode-panel-border);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  opacity: 0.85;
}

/* .content-text 样式由 MarkdownRenderer 组件内部处理 */

/* 流式指示器 - Loading 从左到右逐字波动 */
.streaming-indicator {
  display: inline-flex;
  align-items: flex-end;
  margin-left: 6px;
  line-height: 1;
  letter-spacing: 0.02em;
  user-select: none;
}

.streaming-indicator__char {
  position: relative;
  display: inline-block;
  padding: 0 0.5px;
  color: var(--loading-idle-color);
  opacity: 0.78;

  /* “播完停顿”的关键：每个字母在一整轮里只在前 22% 左右动，后面都静止 */
  animation: loading-wave var(--loading-duration) ease-in-out infinite;
  animation-delay: var(--loading-delay);
  will-change: transform, color, opacity;
}

/* 下划线胶囊：跟随每个字母的波动 */
.streaming-indicator__char--underline::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -4px;
  width: 10px;
  height: 2px;
  border-radius: 999px;
  background: var(--loading-active-color);

  opacity: 0;
  transform: translateX(-50%) scaleX(0.35);

  animation: loading-underline var(--loading-duration) ease-in-out infinite;
  animation-delay: var(--loading-delay);
  will-change: transform, opacity;
}

@keyframes loading-wave {
  /* 0~22%：完成一次“跳一下”；22%~100%：保持静止 */
  0%, 22%, 100% {
    transform: translateY(0) scale(1);
    color: var(--loading-idle-color);
    opacity: 0.78;
  }
  11% {
    transform: translateY(calc(var(--loading-amp) * -1)) scale(1.06);
    color: var(--loading-active-color);
    opacity: 1;
  }
}

@keyframes loading-underline {
  0%, 22%, 100% {
    opacity: 0;
    transform: translateX(-50%) scaleX(0.35);
  }
  11% {
    opacity: 0.9;
    transform: translateX(-50%) scaleX(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .streaming-indicator__char,
  .streaming-indicator__char--underline::after {
    animation: none;
    opacity: 1;
  }

  .streaming-indicator__char--underline::after {
    opacity: 0;
  }
}

/* Token 使用统计 */
.token-usage {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
}

.token-total {
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
}

.token-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.token-arrow {
  font-size: 10px;
  opacity: 0.8;
}

.token-prompt .token-arrow {
  color: var(--vscode-charts-green, #89d185);
}

.token-candidates .token-arrow {
  color: var(--vscode-charts-blue, #75beff);
}

/* 编辑模式 - 扁平化 */
.message-edit {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.edit-textarea {
  width: 100%;
  min-height: 60px;
  padding: var(--spacing-sm, 8px);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: var(--radius-sm, 2px);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
  overflow: hidden;
  transition: border-color var(--transition-fast, 0.1s);
}

.edit-textarea:focus {
  border-color: var(--vscode-focusBorder);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm, 8px);
}

.btn-cancel,
.btn-save {
  padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
  border-radius: var(--radius-sm, 2px);
  font-size: 12px;
  cursor: pointer;
  border: none;
  transition: background-color var(--transition-fast, 0.1s);
}

.btn-cancel {
  background: transparent;
  color: var(--vscode-foreground);
}

.btn-cancel:hover {
  background: var(--vscode-list-hoverBackground);
}

.btn-save {
  background: var(--vscode-foreground);
  color: var(--vscode-editor-background);
}

.btn-save:hover {
  opacity: 0.9;
}

/* 操作按钮淡入淡出效果 */
.message-header :deep(.message-actions) {
  opacity: 0;
  transition: opacity var(--transition-fast, 0.15s);
}

.message-header :deep(.message-actions.actions-visible) {
  opacity: 1;
}

/* 思考块样式 - 使用灰色调、斜体，保持简洁 */
.thought-block {
  /*
   * 思考内容（MarkdownRenderer）样式覆写：
   * - 以前通过 .thought-text（父组件 scoped）控制，但 scoped CSS 不会作用到子组件根节点
   * - 改为用 CSS 变量传递给 MarkdownRenderer（变量可跨组件继承）
   */
  --lim-md-font-size: 12px;
  --lim-md-line-height: 1.5;
  --lim-md-color: var(--vscode-descriptionForeground);
  --lim-md-font-style: italic;

  margin: 8px 0;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-textBlockQuote-background);
  overflow: hidden;
}

.thought-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s;
}

.thought-header:hover {
  background: var(--vscode-list-hoverBackground);
}

.thought-header .codicon {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.thought-icon {
  color: var(--vscode-descriptionForeground) !important;
}

/* 思考中灯泡闪烁动画 */
.thought-icon.thinking-pulse {
  color: var(--vscode-charts-yellow, #ddb92f) !important;
  animation: lightbulb-pulse 1.2s ease-in-out infinite;
}

@keyframes lightbulb-pulse {
  0%, 100% {
    opacity: 0.4;
    text-shadow: none;
  }
  50% {
    opacity: 1;
    text-shadow: 0 0 8px var(--vscode-charts-yellow, #ddb92f);
  }
}

.thought-label {
  font-size: 12px;
  font-weight: 500;
  font-style: italic;
  color: var(--vscode-descriptionForeground);
}

.thought-time {
  font-size: 11px;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-badge-background);
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 4px;
  transition: all 0.2s ease;
}

.thought-time.thinking-active {
  color: var(--vscode-charts-yellow, #ddb92f);
  animation: time-pulse 1.5s ease-in-out infinite;
}

@keyframes time-pulse {
  0%, 100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
}

.thought-preview {
  flex: 1;
  font-size: 11px;
  font-style: italic;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thought-content {
  padding: 0 12px 12px 12px;
  border-top: 1px solid var(--vscode-panel-border);
}

/*
 * 注意：.thought-text 是挂在 MarkdownRenderer 根节点上的 class。
 * 由于本文件是 scoped CSS，如需影响子组件内容，需要使用 :deep。
 * 这里保留段落间距微调。
 */
.thought-block :deep(.thought-text p) {
  margin: 0.5em 0;
}

.thought-block :deep(.thought-text p:first-child) {
  margin-top: 0.75em;
}

/* 总结消息样式 */
.summary-message {
  background: var(--vscode-textBlockQuote-background);
  border-left: 3px solid var(--vscode-textLink-foreground);
}

.summary-block {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-editor-background);
  overflow: hidden;
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s;
  background: var(--vscode-textBlockQuote-background);
}

.summary-header:hover {
  background: var(--vscode-list-hoverBackground);
}

.summary-header .codicon {
  font-size: 12px;
  color: var(--vscode-textLink-foreground);
}

.summary-icon {
  color: var(--vscode-textLink-foreground) !important;
}

.summary-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
}

.summary-count {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-left: 4px;
}

.summary-content {
  padding: 12px;
  border-top: 1px solid var(--vscode-panel-border);
}

.summary-text {
  font-size: 13px;
  color: var(--vscode-foreground);
  line-height: 1.5;
}

.summary-text :deep(p) {
  margin: 0.5em 0;
}

.summary-text :deep(p:first-child) {
  margin-top: 0;
}

</style>