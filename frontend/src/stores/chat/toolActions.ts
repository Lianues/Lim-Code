/**
 * Chat Store 工具操作
 * 
 * 包含工具确认、取消、响应查询等操作
 */

import type { Message } from '../../types'
import type { ChatStoreState, ChatStoreComputed } from './types'
import { sendToExtension } from '../../utils/vscode'
import { generateId } from '../../utils/format'
import { calculateBackendIndex } from './messageActions'
import { syncTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'

/**
 * 根据工具调用 ID 获取工具响应
 */
export function getToolResponseById(
  state: ChatStoreState,
  toolCallId: string
): Record<string, unknown> | null {
  // 从后往前找，优先使用最新的 functionResponse（便于覆盖/追加字段）
  for (let i = state.allMessages.value.length - 1; i >= 0; i--) {
    const message = state.allMessages.value[i]
    if (message.isFunctionResponse && message.parts) {
      for (let j = message.parts.length - 1; j >= 0; j--) {
        const part = message.parts[j]
        if (part.functionResponse && part.functionResponse.id === toolCallId) {
          return part.functionResponse.response
        }
      }
    }
  }
  return null
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
  return state.allMessages.value.findIndex(m => m.id === targetId)
}

/**
 * 将指定消息（或最后一条包含未完成工具的 assistant 消息）中的未完成工具标记为 error。
 *
 * 用于：用户取消请求 / 终止 diff 等场景。
 */
type IncompleteToolInfo = {
  messageIndex: number
  toolCalls: Array<{ id: string; name: string }>
}

/**
 * 将当前流式 assistant 消息的 streaming 标记置为 false，以便前端 Loading 动画立即消失。
 *
 * 注意：取消请求时不一定存在工具调用，因此不能依赖 markIncompleteToolsAsError。
 */
function stopStreamingMessage(state: ChatStoreState, messageId?: string | null): void {
  const all = state.allMessages.value

  // 1) 优先使用传入的 messageId
  let targetIndex = -1
  if (messageId) {
    const idx = all.findIndex(m => m.id === messageId)
    if (idx !== -1 && all[idx].role === 'assistant' && all[idx].streaming === true) {
      targetIndex = idx
    }
  }

  // 2) fallback：从后往前找最后一条 streaming 的 assistant 消息
  if (targetIndex === -1) {
    for (let i = all.length - 1; i >= 0; i--) {
      const msg = all[i]
      if (msg.role === 'assistant' && msg.streaming === true) {
        targetIndex = i
        break
      }
    }
  }

  if (targetIndex === -1) return

  const msg = all[targetIndex]
  state.allMessages.value = [
    ...all.slice(0, targetIndex),
    { ...msg, streaming: false },
    ...all.slice(targetIndex + 1)
  ]
}

/**
 * 删除“完全为空”的 assistant 占位消息。
 *
 * 背景：用户点击中断时，前端会先 stopStreamingMessage()，如果后端没有持久化该条消息，
 * 该占位消息会变成一个空的 assistant，并可能导致后续 delete/retry 使用错误索引。
 */
function removeEmptyAssistantPlaceholder(state: ChatStoreState, messageId?: string | null): void {
  const all = state.allMessages.value

  // 1) 优先用 messageId 定位
  let targetIndex = -1
  if (messageId) {
    const idx = all.findIndex(m => m.id === messageId)
    if (idx !== -1) targetIndex = idx
  }

  // 2) fallback：找最近一条“刚刚生成、已停止 streaming 的 assistant 空消息”
  if (targetIndex === -1) {
    const now = Date.now()
    for (let i = all.length - 1; i >= 0; i--) {
      const msg = all[i]
      if (msg.role !== 'assistant') continue
      if (msg.streaming === true) continue
      if (now - (msg.timestamp || 0) > 10_000) continue
      targetIndex = i
      break
    }
  }

  if (targetIndex === -1) return

  const msg = all[targetIndex]
  if (msg.role !== 'assistant') return

  const hasPartsContent = !!msg.parts?.some(p => p.text || p.functionCall)
  const hasTools = !!(msg.tools && msg.tools.length > 0)
  const hasContent = !!(msg.content && msg.content.trim())

  if (!hasContent && !hasTools && !hasPartsContent) {
    state.allMessages.value = [
      ...all.slice(0, targetIndex),
      ...all.slice(targetIndex + 1)
    ]
  }
}

function markIncompleteToolsAsError(state: ChatStoreState, messageId?: string | null): IncompleteToolInfo | null {
  const all = state.allMessages.value

  // 只要工具调用在历史中没有对应 functionResponse，就认为它“未完成”
  const isToolIncomplete = (toolId: string) => !hasToolResponse(state, toolId)

  // 1) 优先定位指定 messageId
  let targetIndex = -1
  if (messageId) {
    targetIndex = all.findIndex(m => m.id === messageId)

    // 重要：有些场景 streamingMessageId 指向的是“后续占位的 assistant 消息”，
    // 该消息本身可能没有工具调用（或没有未完成工具）。
    // 此时需要回退到“最近一条包含未完成工具的 assistant 消息”。
    if (targetIndex !== -1) {
      const msg = all[targetIndex]
      const hasIncomplete = !!msg.tools?.some(t => isToolIncomplete(t.id))
      if (!hasIncomplete) {
        targetIndex = -1
      }
    }
  }

  // 2) fallback：找最后一条包含“未完成工具”的 assistant 消息
  // 注意：有些场景 tool.status 可能被错误标记为 success（例如内容转换时），
  // 但只要没有 functionResponse，就仍然应该在 cancel 时标记为 error。
  if (targetIndex === -1) {
    for (let i = all.length - 1; i >= 0; i--) {
      const msg = all[i]
      if (msg.role === 'assistant' && msg.tools?.some(t => isToolIncomplete(t.id))) {
        targetIndex = i
        break
      }
    }
  }

  if (targetIndex === -1) {
    return null
  }

  const message = all[targetIndex]

  const toolCalls: Array<{ id: string; name: string }> = (message.tools || [])
    .filter(tool => isToolIncomplete(tool.id))
    .map(tool => ({ id: tool.id, name: tool.name }))

  const updatedTools = message.tools?.map(tool => {
    if (isToolIncomplete(tool.id)) {
      return { ...tool, status: 'error' as const }
    }
    return tool
  })

  const updatedMessage: Message = {
    ...message,
    streaming: false,
    tools: updatedTools
  }

  state.allMessages.value = [
    ...all.slice(0, targetIndex),
    updatedMessage,
    ...all.slice(targetIndex + 1)
  ]

  return {
    messageIndex: targetIndex,
    toolCalls
  }
}

/**
 * 确保“被拒绝/取消的工具”有对应的 functionResponse 消息，保证前后端历史索引一致。
 *
 * 背景：后端在 cancelStream / deleteToMessage 等场景会 rejectAllPendingToolCalls，
 * 并在工具调用消息后插入 functionResponse；前端如果不同步插入，会导致索引错位。
 */
function ensureFunctionResponseMessageForRejectedTools(state: ChatStoreState, info: IncompleteToolInfo | null): void {
  if (!info || info.toolCalls.length === 0) return

  const all = state.allMessages.value

  // 如果紧随其后已经是 functionResponse，认为已同步过，无需重复插入
  const nextMsg = all[info.messageIndex + 1]
  if (nextMsg?.isFunctionResponse) {
    return
  }

  // 如果这些 toolCallId 在历史中已经有 functionResponse，也不再插入（防止极端竞态重复）
  const respondedIds = new Set<string>()
  for (const msg of all) {
    if (msg.isFunctionResponse && msg.parts) {
      for (const p of msg.parts) {
        const id = (p as any)?.functionResponse?.id
        if (id) respondedIds.add(id)
      }
    }
  }
  const missingCalls = info.toolCalls.filter(c => !respondedIds.has(c.id))
  if (missingCalls.length === 0) {
    return
  }

  const responseBackendIndex = state.windowStartIndex.value + info.messageIndex + 1
  const responseMessage: Message = {
    id: generateId(),
    role: 'user',
    content: '',
    timestamp: Date.now(),
    backendIndex: responseBackendIndex,
    isFunctionResponse: true,
    parts: missingCalls.map(call => ({
      functionResponse: {
        id: call.id,
        name: call.name,
        response: {
          success: false,
          error: 'Cancelled by user',
          rejected: true
        }
      }
    }))
  }

  state.allMessages.value = [
    ...all.slice(0, info.messageIndex + 1),
    responseMessage,
    ...all.slice(info.messageIndex + 1)
  ]

  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)

}

/**
 * 取消当前流式请求并拒绝正在执行或等待确认的工具
 */
export async function cancelStreamAndRejectTools(
  state: ChatStoreState,
  _computed: ChatStoreComputed
): Promise<void> {
  if (!state.currentConversationId.value) return

  // 先让前端流式指示器立即消失（无论是否存在工具调用）
  stopStreamingMessage(state, state.streamingMessageId.value)
  // 如果是“完全空”的占位消息，立即删除，避免后续重试/删除产生索引错位
  removeEmptyAssistantPlaceholder(state, state.streamingMessageId.value)
  
  if (state.retryStatus.value) {
    state.retryStatus.value = null
  }
  
  if (state.streamingMessageId.value) {
    const messageIndex = state.allMessages.value.findIndex(m => m.id === state.streamingMessageId.value)
    if (messageIndex !== -1) {
      const message = state.allMessages.value[messageIndex]
      
      // 收集所有未完成的工具（没有 functionResponse 的都算）
      const incompleteToolIds = message.tools
        ?.filter(tool => !hasToolResponse(state, tool.id))
        ?.map(tool => tool.id) || []
      
      // 本地先更新工具状态（更健壮：即使 messageIndex 不准确也能 fallback）
      const info = markIncompleteToolsAsError(state, state.streamingMessageId.value)
      // 插入 functionResponse，保持前后端索引一致
      ensureFunctionResponseMessageForRejectedTools(state, info)
      
      // 计算后端索引
      const backendIndex = calculateBackendIndex(state.allMessages.value, messageIndex, state.windowStartIndex.value)
      if (backendIndex !== -1 && incompleteToolIds.length > 0) {
        try {
          await sendToExtension('conversation.rejectToolCalls', {
            conversationId: state.currentConversationId.value,
            messageIndex: backendIndex,
            toolCallIds: incompleteToolIds
          })
        } catch (err) {
          console.error('Failed to reject tool calls in backend:', err)
        }
      }
    }
  }
  
  if (state.isStreaming.value) {
    try {
      await sendToExtension('cancelStream', {
        conversationId: state.currentConversationId.value
      })
    } catch (err) {
      console.error('Failed to cancel stream:', err)
    }
  }
  
  state.streamingMessageId.value = null
  state.isStreaming.value = false
  state.isWaitingForResponse.value = false
}

/**
 * 取消当前流式请求
 */
export async function cancelStream(
  state: ChatStoreState,
  _computed: ChatStoreComputed
): Promise<void> {
  if (state.retryStatus.value) {
    state.retryStatus.value = null
  }

  if (!state.isWaitingForResponse.value || !state.currentConversationId.value) {
    return
  }

  // 先保存当前 streaming 消息 ID，因为后续 await / 事件可能会改变它
  const currentStreamingId = state.streamingMessageId.value

  // 先让前端流式指示器立即消失（无论是否存在工具调用）
  stopStreamingMessage(state, currentStreamingId)
  // 如果是“完全空”的占位消息，立即删除，避免残留空消息导致索引越界
  removeEmptyAssistantPlaceholder(state, currentStreamingId)
  
  // 等待工具确认状态（包括 diff 工具等待用户操作）
  if (!state.isStreaming.value) {
    // 先调用后端 cancelStream 来关闭 diff 编辑器并拒绝工具
    try {
      await sendToExtension('cancelStream', {
        conversationId: state.currentConversationId.value
      })
    } catch (err) {
      console.error('Failed to cancel stream:', err)
    }

    // 更新前端工具状态（更健壮：即使 streamingMessageId 丢失也能 fallback）
    const info = markIncompleteToolsAsError(state, state.streamingMessageId.value)
    // 插入 functionResponse，保持前后端索索引一致
    ensureFunctionResponseMessageForRejectedTools(state, info)

    state.streamingMessageId.value = null
    state.isLoading.value = false
    state.isWaitingForResponse.value = false
    return
  }
  
  // 正在流式响应
  try {
    await sendToExtension('cancelStream', {
      conversationId: state.currentConversationId.value
    })

    // 使用保存的 ID 来查找和更新消息（更健壮：即使找不到，也 fallback）
    const info = markIncompleteToolsAsError(state, currentStreamingId)
    // 插入 functionResponse，保持前后端索引一致
    ensureFunctionResponseMessageForRejectedTools(state, info)

    state.streamingMessageId.value = null
    state.isLoading.value = false
    state.isStreaming.value = false
    state.isWaitingForResponse.value = false
  } catch (err) {
    console.error('取消请求失败:', err)
    // 即使出错也要尝试更新本地状态
    const info = markIncompleteToolsAsError(state, currentStreamingId)
    ensureFunctionResponseMessageForRejectedTools(state, info)
    state.streamingMessageId.value = null
    state.isLoading.value = false
    state.isStreaming.value = false
    state.isWaitingForResponse.value = false
  }
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
    const messageIndex = state.allMessages.value.findIndex(m => m.id === state.streamingMessageId.value)
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

      state.allMessages.value = [
        ...state.allMessages.value.slice(0, messageIndex),
        updatedMessage,
        ...state.allMessages.value.slice(messageIndex + 1)
      ]
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
    state.allMessages.value.push(userMessage)
    syncTotalMessagesFromWindow(state)
    trimWindowFromTop(state)
  }

  try {
    await sendToExtension('toolConfirmation', {
      conversationId: state.currentConversationId.value,
      configId: state.currentConfig.value.id,
      modelOverride: state.pendingModelOverride.value || undefined,
      toolResponses,
      annotation: trimmedAnnotation
    })
  } catch (error) {
    console.error('Failed to send tool confirmation with annotation:', error)
  }
}
