/**
 * Chat Store 工具操作
 * 
 * 包含工具确认、取消、响应查询等操作
 */

import type { Message } from '../../types'
import type { ChatStoreState, ChatStoreComputed } from './types'
import { triggerRef } from 'vue'
import { sendToExtension } from '../../utils/vscode'
import { generateId } from '../../utils/format'
import { isPerfEnabled } from '../../utils/perf'
import {
  appendMessage,
  getMessageIndexById,
  replaceMessageAt
} from './state'
import { syncTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'
import {
  applyRuntimeLedgerMutationProjection,
  type RuntimeLedgerMutationProjection
} from './runtimeLedgerProjection'

const duplicateFunctionResponseWarned = new Set<string>()

interface CancelStreamResponse {
  cancelled?: boolean
  runtimeLedger?: RuntimeLedgerMutationProjection
}

interface StreamStartResponse {
  started?: boolean
  streamId?: string
}

function bindAuthoritativeStreamId(state: ChatStoreState, response: StreamStartResponse | undefined): void {
  const streamId = typeof response?.streamId === 'string' ? response.streamId.trim() : ''
  if (streamId) {
    state.activeStreamId.value = streamId
  }
}

/**
 * 根据工具调用 ID 获取工具响应。
 * 优先从 toolResponseCache 中 O(1) 查询，cache miss 时从已投影消息中扫描并回填缓存。
 */
export function getToolResponseById(
  state: ChatStoreState,
  toolCallId: string
): Record<string, unknown> | null {
  // 1) 优先查缓存
  const cached = state.toolResponseCache.value.get(toolCallId)
  if (cached !== undefined) return cached

  // 2) 缓存未命中：线性扫描
  let latest: Record<string, unknown> | null = null
  let matchCount = 0
  for (let i = state.allMessages.value.length - 1; i >= 0; i--) {
    const message = state.allMessages.value[i]
    if (message.isFunctionResponse && message.parts) {
      for (let j = message.parts.length - 1; j >= 0; j--) {
        const part = message.parts[j]
        if (part.functionResponse && part.functionResponse.id === toolCallId) {
          matchCount += 1
          if (!latest) {
            latest = part.functionResponse.response
          }
        }
      }
    }
  }
  if (matchCount > 1 && !duplicateFunctionResponseWarned.has(toolCallId)) {
    duplicateFunctionResponseWarned.add(toolCallId)
    if (isPerfEnabled()) {
      console.warn('[todo-debug][toolActions] duplicate functionResponse id detected', {
        toolCallId,
        matchCount
      })
    }
  }

  // 3) 回填缓存，避免重复扫描
  if (latest !== null) {
    state.toolResponseCache.value.set(toolCallId, latest)
    // 手动触发 ref 更新，因为 Map.set() 不会被 Vue 的 ref 追踪
    triggerRef(state.toolResponseCache)
  }

  return latest
}

/**
 * 检查工具是否有响应
 */
export function hasToolResponse(state: ChatStoreState, toolCallId: string): boolean {
  return getToolResponseById(state, toolCallId) !== null
}

/**
 * 根据显示索引获取 allMessages 中的真实索引
 */
export function getActualIndex(
  state: ChatStoreState,
  computed: ChatStoreComputed,
  displayIndex: number
): number {
  const displayMessages = computed.messages.value
  if (displayIndex < 0 || displayIndex >= displayMessages.length) {
    return -1
  }
  const targetId = displayMessages[displayIndex].id
  // 修改原因：显示索引映射会频繁按消息 id 反查 allMessages，下钻到消息操作时不应每次线性扫描。
  // 修改方式：优先走 messageIndexById；索引缺失时由 helper 恢复索引并自动回填。
  // 修改目的：保持 displayMessages -> allMessages 的语义不变，同时把高频定位降为 O(1)。
  return getMessageIndexById(state, targetId)
}

function failMissingCancelProjection(state: ChatStoreState): void {
  state.error.value = {
    code: 'RUNTIME_LEDGER_PROJECTION_ERROR',
    message: 'Runtime Ledger mutation projection missing for cancelled stream'
  }
}

async function cancelStreamWithRuntimeLedgerProjection(state: ChatStoreState): Promise<boolean> {
  const response = await sendToExtension<CancelStreamResponse>('cancelStream', {
    conversationId: state.currentConversationId.value
  })
  if (!applyRuntimeLedgerMutationProjection(response?.runtimeLedger, state)) {
    failMissingCancelProjection(state)
    return false
  }
  return true
}

/**
 * 取消当前流式请求并拒绝正在执行或等待确认的工具
 */
export async function cancelStreamAndRejectTools(
  state: ChatStoreState,
  computed: ChatStoreComputed
): Promise<void> {
  await cancelStream(state, computed)
}

/**
 * 取消当前流式请求
 */
export async function cancelStream(
  state: ChatStoreState,
  _computed: ChatStoreComputed
): Promise<void> {
  const currentStreamingId = state.streamingMessageId.value

  // 仅在“真实流式生成中”才记录取消标记，避免非流式等待阶段残留旧标记。
  // 旧标记会让后续正常请求的 complete 被误判为 stale，导致 isWaitingForResponse 无法清理。
  state._lastCancelledStreamId.value = state.isStreaming.value && currentStreamingId ? currentStreamingId : null

  if (state.retryStatus.value) {
    state.retryStatus.value = null
  }

  if (!state.isWaitingForResponse.value || !state.currentConversationId.value) {
    return
  }

  try {
    await cancelStreamWithRuntimeLedgerProjection(state)
  } catch (err) {
    console.error('取消请求失败:', err)
    state.error.value = {
      code: 'CANCEL_STREAM_ERROR',
      message: err instanceof Error ? err.message : 'Cancel stream failed'
    }
  }

  state.streamingMessageId.value = null
  state.activeStreamId.value = null
  state.isLoading.value = false
  state.isStreaming.value = false
  state.isWaitingForResponse.value = false
}

/**
 * 发送带批注的工具确认响应
 */
export async function rejectPendingToolsWithAnnotation(
  state: ChatStoreState,
  computed: ChatStoreComputed,
  annotation: string
): Promise<void> {
  if (!computed.hasPendingToolConfirmation.value || !state.currentConversationId.value || !state.currentConfig.value?.id) {
    return
  }

  const toolResponses = computed.pendingToolCalls.value.map(tool => ({
    id: tool.id,
    name: tool.name,
    confirmed: false
  }))

  if (toolResponses.length === 0) return

  const trimmedAnnotation = annotation.trim()

  if (state.streamingMessageId.value) {
    // 修改原因：等待审批时输入批注会命中这里，属于用户高频交互路径。
    // 修改方式：使用 messageIndexById 直接定位当前 streaming assistant；helper 自带索引恢复。
    // 修改目的：避免每次批注拒绝都线性扫描 allMessages。
    const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
    if (messageIndex !== -1) {
      const message = state.allMessages.value[messageIndex]
      const updatedTools = message.tools?.map(tool => {
        if (tool.status === 'awaiting_approval') {
          // 已提交确认（这里是批量拒绝），进入“处理中”状态
          return { ...tool, status: 'executing' as const }
        }
        return tool
      })

      const updatedMessage: Message = {
        ...message,
        tools: updatedTools
      }

      replaceMessageAt(state, messageIndex, updatedMessage)
    }
  }

  if (trimmedAnnotation) {
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: trimmedAnnotation,
      timestamp: Date.now(),
      backendIndex: state.windowStartIndex.value + state.allMessages.value.length,
      parts: [{ text: trimmedAnnotation }]
    }
    appendMessage(state, userMessage)
    syncTotalMessagesFromWindow(state)
    trimWindowFromTop(state)
  }

  try {
    state.activeStreamId.value = null
    state._lastCancelledStreamId.value = null
    const startResponse = await sendToExtension<StreamStartResponse>('toolConfirmation', {
      conversationId: state.currentConversationId.value,
      configId: state.currentConfig.value.id,
      modelOverride: state.pendingModelOverride.value || undefined,
      toolResponses,
      annotation: trimmedAnnotation,
      promptModeId: state.currentPromptModeId.value
    })
    bindAuthoritativeStreamId(state, startResponse)
  } catch (error) {
    console.error('Failed to send tool confirmation with annotation:', error)
  }
}
