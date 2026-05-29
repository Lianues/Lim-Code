<script setup lang="ts">
/**
 * MessageItem - 单条消息组件
 * 扁平化设计，所有消息统一靠左布局
 * 按 parts 原始顺序显示内容
 */

import { ref, computed, watch, onUnmounted } from 'vue'
import MessageActions from './MessageActions.vue'
import MessageAttachments from './MessageAttachments.vue'
import InlineContextMessage from './InlineContextMessage.vue'
import MessageTaskCards from './MessageTaskCards.vue'
import ResponseViewerDialog from './ResponseViewerDialog.vue'
import MessageRenderBlock from './MessageRenderBlock.vue'
import { buildResponseViewerData } from './responseViewer/buildResponseViewerData'
import { MarkdownRenderer, RetryDialog, EditDialog } from '../common'
import type { Message, ToolUsage, CheckpointRecord, Attachment } from '../../types'
import { calculateTokenRate, formatTokenRate } from '../../utils/tokenRate'
import { hasContextBlocks } from '../../types/contextParser'
import { formatNumber, formatTime } from '../../utils/format'
import { isPerfEnabled } from '../../utils/perf'
import { buildFunctionCallToolRenderEntry, upsertToolRenderEntry } from '../../utils/toolRenderEntries'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useI18n } from '../../i18n'
import { type RenderBlock, getRenderBlockKey, getRenderBlockMemoDeps } from './renderBlocks'

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
const showResponseDialog = ref(false)

// 消息角色判断
const isUser = computed(() => props.message.role === 'user')
const isTool = computed(() => props.message.role === 'tool')

// 是否为总结消息
const isSummary = computed(() => props.message.isSummary === true)

// 是否为流式消息
const isStreaming = computed(() => props.message.streaming === true)
const contextCommandPayload = computed(() => (props.message.metadata as any)?.contextCommand as any | undefined)


// 总结消息展开状态
const isSummaryExpanded = ref(false)

// 思考内容展开状态
const isThoughtExpanded = ref(false)


const todoDebugPrinted = new Set<string>()
function debugTodoOnce(key: string, data: Record<string, unknown>) {
  if (!isPerfEnabled()) return
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
      const text = currentTextBlock.join('')
      if (text.trim()) {
        // 修改原因：流式正文每个 delta 都会改变 text.length；把长度/正文片段写进 key 会让 Vue 销毁重建 MarkdownRenderer，触发闪烁。
        // 修改方式：key 只表达结构身份（第几个 block + 类型），内容增长只通过 props 更新。
        // 修改目的：让主聊天与 Monitor 的流式文本块都复用同一组件实例，保留旧 HTML 直到新 HTML 渲染完成。
        blocks.push({ type: 'text', text, key: `${blocks.length}:text` })
      }
      currentTextBlock = []
    }
  }
  
  // 辅助函数：刷新工具块
  const flushTools = () => {
    if (currentToolBlock.length > 0) {
      blocks.push({
        type: 'tool',
        tools: [...currentToolBlock],
        key: `${blocks.length}:tool:${currentToolBlock.map(tool => tool.id).join('|')}`
      })
      currentToolBlock = []
    }
  }
  
  // 辅助函数：刷新思考块
  const flushThought = () => {
    if (currentThoughtBlock.length > 0) {
      const text = currentThoughtBlock.join('')
      if (text.trim()) {
        // 修改原因：thought 与正文共享同一 RenderBlock 身份契约；思考内容增长也不应改变组件身份。
        // 修改方式：移除 text.length/text.slice 这类内容派生 key，只保留结构位置和类型。
        // 修改目的：避免展开思考块接入流式渲染后重现正文闪烁问题。
        blocks.push({ type: 'thought', text, key: `${blocks.length}:thought` })
      }
      currentThoughtBlock = []
    }
  }

  const upsertToolAcrossRenderedBlocks = (entry: ToolUsage) => {
    const currentIndex = currentToolBlock.findIndex(tool => tool.id === entry.id)
    if (currentIndex !== -1) {
      upsertToolRenderEntry(currentToolBlock, entry)
      return
    }

    for (const block of blocks) {
      if (block.type !== 'tool' || !block.tools) continue
      if (block.tools.some(tool => tool.id === entry.id)) {
        // 为什么要跨 block 去重：流式快照/终结事件可能让同一逻辑工具的占位 part 和最终 part 中间夹着文本或思考片段，
        // 只在当前连续工具块里 upsert 仍会渲染成两张工具卡。
        // 怎么改：如果之前任意工具块里已经有同一 stable tool id，就更新那一项，不再创建新的工具块。
        // 目的：等待执行、MCP 请求中、diff 自动确认倒计时等 pending 阶段都只显示一张最后工具卡。
        upsertToolRenderEntry(block.tools, entry)
        return
      }
    }

    upsertToolRenderEntry(currentToolBlock, entry)
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
      
      // 为什么工具渲染不再只按 functionCall.id 解析：pending 阶段可能同时存在临时占位 part 和最终 call_id part，
      // 旧逻辑看到临时 id 后不会回退到 message.tools 的同序位真实工具，导致最后一个工具显示两次。
      // 怎么改：统一通过 toolRenderEntries 按 id -> itemId -> index -> 序位解析，并对同一 stable id 做 upsert。
      // 目的：让渲染层与流式合并层共享同一逻辑工具识别方式，pending/awaiting/complete 都只显示一张工具卡。
      const renderTool = buildFunctionCallToolRenderEntry({
        messageId: props.message.id,
        functionCall: part.functionCall,
        messageTools,
        functionCallOrdinal
      })
      const toolIdFromPart = typeof part.functionCall.id === 'string' ? part.functionCall.id : ''
      
      debugTodoOnce(`function-call-${props.message.id}-${functionCallOrdinal}-${renderTool.id}`, {
        messageId: props.message.id,
        messageBackendIndex: props.message.backendIndex,
        functionCallOrdinal,
        functionCallName: part.functionCall.name,
        functionCallIdFromPart: toolIdFromPart || null,
        resolvedToolId: renderTool.id,
        existingToolId: renderTool.id || null
      })

      upsertToolAcrossRenderedBlocks(renderTool)

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

interface ProviderUsageItem {
  key: string
  label: string
  icon: string
  value: number
  tone: 'total' | 'prompt' | 'cached' | 'candidates'
  description: string
}

function formatUsageValue(value: number): string {
  // 修改原因：provider usage 经常达到十万或百万级，完整数字在消息底部会挤压布局并贴边。
  // 修改方式：统一复用 formatNumber 做紧凑展示，完整值保留在 title/aria-label 里。
  // 修改目的：让统计区一眼可扫读，同时不丢失精确 token 数。
  return formatNumber(value)
}

const providerUsageItems = computed<ProviderUsageItem[]>(() => {
  const usage = usageMetadata.value
  if (!usage) return []
  const items: ProviderUsageItem[] = []

  // 修改原因：用户明确指出 provider token 统计不能继续用 in/out/cache 文字缩写，这些缩写会被误读成上下文状态。
  // 修改方式：把 total/input/cache/output 映射为统一 codicon 图标，文字只进入 tooltip 和可访问名称。
  // 修改目的：减少消息底部视觉噪音，并明确这是 provider usage 指标，不是 `/context-status` 的上下文健康诊断。
  if (usage.totalTokenCount) {
    items.push({
      key: 'total',
      label: 'Total provider tokens',
      icon: 'codicon-symbol-numeric',
      value: usage.totalTokenCount,
      tone: 'total',
      description: 'Total tokens reported by the provider for this response.'
    })
  }
  if (usage.promptTokenCount) {
    items.push({
      key: 'prompt',
      label: 'Input tokens',
      icon: 'codicon-arrow-down',
      value: usage.promptTokenCount,
      tone: 'prompt',
      description: 'Input prompt and context tokens sent to the provider.'
    })
  }
  if (usage.cachedContentTokenCount) {
    items.push({
      key: 'cached',
      label: 'Cached tokens',
      icon: 'codicon-database',
      value: usage.cachedContentTokenCount,
      tone: 'cached',
      description: 'Provider cache tokens. They are reuse/cost metadata, not extra context messages.'
    })
  }
  if (usage.candidatesTokenCount) {
    items.push({
      key: 'candidates',
      label: 'Output tokens',
      icon: 'codicon-arrow-up',
      value: usage.candidatesTokenCount,
      tone: 'candidates',
      description: 'Tokens generated by the model in this response.'
    })
  }
  return items
})

function providerUsageTitle(item: ProviderUsageItem): string {
  return `${item.label}: ${item.value.toLocaleString()} tokens. ${item.description}`
}

// 响应持续时间（从请求发送到响应结束，使用后端提供的数据）
const responseDuration = computed(() => {
  const duration = props.message.metadata?.responseDuration
  if (duration && duration > 0) {
    return formatDuration(duration)
  }
  return null
})

// Token 速率计算
// 修改原因：主聊天和 SubAgent Monitor 都复用 MessageItem，内联公式会让两个入口一起继承旧的首块到末块分母问题。
// 修改方式：调用公共 tokenRate 工具，统一使用完整响应耗时并保留 chunk/token 守卫。
// 修改目的：避免上游攒包后出现畸高速度，同时保证 Monitor 与主界面不分叉。
const tokenRate = computed(() => {
  const rate = calculateTokenRate(props.message.metadata)
  return typeof rate === 'number' ? formatTokenRate(rate) : null
})

// 消息类名

// 用户消息预览文本（供滚动条 marker tooltip 使用）
const previewText = computed(() => {
  if (!isUser.value) return ''
  const raw = props.message.content || ''
  // 去除 context 标签、多余空白，截断到 80 字符
  const cleaned = raw
    .replace(/<lim-context[\s\S]*?<\/lim-context>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 80 ? cleaned.slice(0, 80) + '…' : cleaned
})

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

function handleViewResponse() {
  showResponseDialog.value = true
}

const responseViewerData = computed(() => buildResponseViewerData(props.message, {
  allMessages: chatStore.allMessages
}))

function toggleThought() {
  isThoughtExpanded.value = !isThoughtExpanded.value
}

function handleRetry() {
  emit('retry', props.message.id)
}

function runContextAction(action: string) {
  const command = (action || '').trim()
  if (!command) return
  const [name] = command.toLowerCase().split(/\s+/)
  if (name === '/context-status') {
    // 修改原因：`/context-status` 已改为纯前端诊断窗口，不能从旧状态卡 next action 重新进入 chatStore.sendMessage。
    // 修改方式：派发本地窗口事件，由 InputArea 打开 ContextStatusDialog 并通过只读后端接口刷新状态。
    // 修改目的：即使用户点击旧卡片里的状态动作，也不会创建聊天消息或影响主上下文。
    window.dispatchEvent(new CustomEvent('limcode:open-context-status'))
    return
  }
  if (chatStore.isWaitingForResponse) return
  // 修改原因：context command 卡片里的 nextActions 只显示 code 会迫使用户复制命令，弱化“可执行恢复动作”的设计目标。
  // 修改方式：除纯诊断的 `/context-status` 外，仍把 mutating action 交给原 slash command 协议处理。
  // 修改目的：让确认命令和恢复命令保持显式聊天命令语义，同时避免状态诊断误入模型/聊天流。
  void chatStore.sendMessage(command)
}

function handleRestoreAndRetry(checkpointId: string) {
  emit('restoreAndRetry', props.message.id, checkpointId)
}

</script>

<template>
  <div
    :class="messageClass"
    :data-preview="isUser ? previewText : undefined"
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
        :can-view-response="!isUser"
        @edit="startEdit"
        @copy="handleCopy"
        @delete="handleDelete"
        @retry="handleRetryClick"
        @view-response="handleViewResponse"
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

    <!-- 回复查看 -->
    <ResponseViewerDialog
      v-model="showResponseDialog"
      :value="responseViewerData"
      :title="t('components.message.actions.viewResponse')"
      width="960px"
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
            v-memo="[message.content, false, false]"
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
        <div v-if="contextCommandPayload" class="context-command-card" :class="`context-command-card--${contextCommandPayload.kind}`">
          <!-- 修改原因：/context-* 命令需要用户可理解的状态卡片，不能只显示控制台式裸文本。
               修改方式：MessageItem 识别 metadata.contextCommand，渲染标题、说明、projection/ledger 和下一步动作；当前使用 codicon 矢量图标类，不使用 emoji。
               修改目的：让 slash command 结果在主聊天中可见、可确认、可恢复，并保留后续迁移到统一 Icon 组件的单一入口。 -->
          <div class="context-command-card__header">
            <i class="codicon" :class="contextCommandPayload.kind === 'error' ? 'codicon-error' : contextCommandPayload.kind === 'confirmation' ? 'codicon-warning' : 'codicon-info'"></i>
            <span>{{ contextCommandPayload.title }}</span>
          </div>
          <div class="context-command-card__description">{{ contextCommandPayload.description }}</div>
          <div v-if="contextCommandPayload.projectionId || contextCommandPayload.ledgerEntryId" class="context-command-card__meta">
            <!-- 修改原因：context command 卡片的字段标签属于用户可见文案，不能继续硬编码英文。
                 修改方式：用 components.message.contextCommand 下的通用标签渲染 projection/ledger/lossy/reversible。
                 修改目的：compact、summarize、status 等命令卡片在不同界面语言下保持一致。 -->
            <span v-if="contextCommandPayload.projectionId">{{ t('components.message.contextCommand.projection') }}: <code>{{ contextCommandPayload.projectionId }}</code></span>
            <span v-if="contextCommandPayload.ledgerEntryId">{{ t('components.message.contextCommand.ledger') }}: <code>{{ contextCommandPayload.ledgerEntryId }}</code></span>
          </div>
          <div class="context-command-card__flags">
            <span v-if="typeof contextCommandPayload.lossy === 'boolean'">{{ t('components.message.contextCommand.lossy') }}: {{ contextCommandPayload.lossy ? t('components.message.contextCommand.yes') : t('components.message.contextCommand.no') }}</span>
            <span v-if="typeof contextCommandPayload.reversible === 'boolean'">{{ t('components.message.contextCommand.reversible') }}: {{ contextCommandPayload.reversible ? t('components.message.contextCommand.yes') : t('components.message.contextCommand.no') }}</span>
          </div>
          <div v-if="contextCommandPayload.nextActions?.length" class="context-command-card__actions">
            <button
              v-for="action in contextCommandPayload.nextActions"
              :key="action"
              type="button"
              class="context-command-card__action-button"
              :disabled="chatStore.isWaitingForResponse"
              @click="runContextAction(action)"
            >
              <i class="codicon codicon-terminal"></i>
              <code>{{ action }}</code>
            </button>
          </div>
        </div>
        <!-- 有 parts 时渲染内容块（TODO 工具块会下沉到消息底部） -->
        <template v-else-if="renderBlocks.length > 0">
          <!--
            WP31 修复：v-memo 与 v-for 现在共处同一 MessageRenderBlock 组件元素上。
            修改原因：Vue 官方明确警告 v-memo 不能放在 v-for 内部子节点上。
            修改方式：通过组件提取 + 共享类型，让 v-memo 和 v-for 在同一元素。
            修改目的：符合 Vue 官方语义，同时保持完成态消息不重渲染的优化不变。
          -->
          <MessageRenderBlock
            v-for="block in contentRenderBlocks"
            :key="getRenderBlockKey(block)"
            :block="block"
            :message-role="isUser ? 'user' : 'assistant'"
            :message-backend-index="message.backendIndex"
            :is-streaming="isStreaming"
            :is-thought-expanded="isThoughtExpanded"
            :is-thinking="isThinking"
            :thinking-time-display="thinkingTimeDisplay"
            :toggle-thought="toggleThought"
            v-memo="getRenderBlockMemoDeps(block, isStreaming, isUser, isThoughtExpanded, isThinking, thinkingTimeDisplay)"
          />
        </template>
        
        <!-- 无 parts 但有 content 时：直接渲染 content -->
        <!-- 用户消息仅渲染 LaTeX，如果有上下文块则使用解析后的内容 -->
        <InlineContextMessage
          v-else-if="isUser && message.content && hasContextBlocks(message.content)"
          :content="message.content"
        />

        <MarkdownRenderer
          v-else-if="message.content"
          v-memo="[message.content, isUser, isStreaming]"
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
          <div v-if="hasUsage" class="token-usage" aria-label="Provider token usage">
            <span
              v-for="item in providerUsageItems"
              :key="item.key"
              class="token-item"
              :class="`token-item--${item.tone}`"
              :title="providerUsageTitle(item)"
              :aria-label="providerUsageTitle(item)"
            >
              <i class="codicon" :class="item.icon" aria-hidden="true"></i>
              <span class="token-value">{{ formatUsageValue(item.value) }}</span>
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

.context-command-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 88%, var(--vscode-textLink-foreground));
}

.context-command-card--error {
  border-color: var(--vscode-errorForeground);
}

.context-command-card--confirmation,
.context-command-card--warning {
  border-color: var(--vscode-editorWarning-foreground);
}

.context-command-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.context-command-card__description {
  color: var(--vscode-foreground);
  line-height: 1.5;
}

.context-command-card__meta,
.context-command-card__flags,
.context-command-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.context-command-card code {
  font-family: var(--vscode-editor-font-family), monospace;
  color: var(--vscode-textLink-foreground);
}

/* Context command actions
   修改原因：nextActions 只显示为 code 时不可直接操作，用户需要复制命令，容易误以为命令只是说明文字。
   修改方式：把每个 action 渲染为按钮，但点击仍调用同一 slash command 协议。
   修改目的：把状态卡变成可执行恢复入口，不为按钮单独创造第二套业务逻辑。 */
.context-command-card__action-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
  border-radius: 4px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  cursor: pointer;
}

.context-command-card__action-button:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.context-command-card__action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.context-command-card__action-button code {
  color: inherit;
}

/* 所有消息统一靠左 */
.user-message,
.assistant-message {
  align-self: stretch;
  max-width: 100%;
}

/* 用户消息淡蓝色背景 — 滚动时快速定位 */
.user-message {
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
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: var(--spacing-sm, 8px);
}

.message-footer-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
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

/* Token 使用统计
   修改原因：provider usage 是辅助工程指标，旧版 in/cache/out 文本在窄宽度下拥挤且容易被误读为上下文健康状态。
   修改方式：使用可换行的图标 + 紧凑数字，详细含义放入 title/aria-label，并使用 VS Code 主题色适配深浅色。
   修改目的：让消息底部保持低噪音，同时仍能解释 total/input/cache/output 四类 provider token。 */
.token-usage {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  min-width: 0;
  gap: 4px 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.78;
}

.token-item {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}

.token-item .codicon {
  font-size: 10px;
  line-height: 1;
}

.token-value {
  font-family: var(--vscode-editor-font-family), monospace;
  font-size: 10px;
}

.token-item--total .codicon {
  color: var(--vscode-descriptionForeground);
}

.token-item--prompt .codicon {
  color: var(--vscode-charts-green, #388a34);
}

.token-item--candidates .codicon {
  color: var(--vscode-charts-blue, #0066cc);
}

.token-item--cached .codicon {
  color: var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground, #b8860b));
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
