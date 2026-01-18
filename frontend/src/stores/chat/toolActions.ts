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

/**
 * 根据工具调用 ID 获取工具响应
 */
export function getToolResponseById(
  state: ChatStoreState,
  toolCallId: string
): Record<string, unknown> | null {
  for (const message of state.allMessages.value) {
    if (message.isFunctionResponse && message.parts) {
      for (const part of message.parts) {
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

function markIncompleteToolsAsError(state: ChatStoreState, messageId?: string | null): IncompleteToolInfo | null {
  const all = state.allMessages.value

  // 1) 优先定位指定 messageId
  let targetIndex = -1
  if (messageId) {
    targetIndex = all.findIndex(m => m.id === messageId)
  }

  // 2) fallback：找最后一条包含 pending/running 工具的 assistant 消息
  if (targetIndex === -1) {
    for (let i = all.length - 1; i >= 0; i--) {
      const msg = all[i]
      if (msg.role === 'assistant' && msg.tools?.some(t => t.status === 'pending' || t.status === 'running')) {
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
    .filter(tool => tool.status === 'pending' || tool.status === 'running')
    .map(tool => ({ id: tool.id, name: tool.name }))

  const updatedTools = message.tools?.map(tool => {
    if (tool.status === 'pending' || tool.status === 'running') {
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

  const responseMessage: Message = {
    id: generateId(),
    role: 'user',
    content: '',
    timestamp: Date.now(),
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

}

/**
 * 取消当前流式请求并拒绝正在执行或等待确认的工具
 */
export async function cancelStreamAndRejectTools(
  state: ChatStoreState,
  _computed: ChatStoreComputed
): Promise<void> {
  if (!state.currentConversationId.value) return
  
  if (state.retryStatus.value) {
    state.retryStatus.value = null
  }
  
  if (state.streamingMessageId.value) {
    const messageIndex = state.allMessages.value.findIndex(m => m.id === state.streamingMessageId.value)
    if (messageIndex !== -1) {
      const message = state.allMessages.value[messageIndex]
      
      // 收集所有未完成的工具（pending 或 running）
      const incompleteToolIds = message.tools
        ?.filter(tool => tool.status === 'pending' || tool.status === 'running')
        ?.map(tool => tool.id) || []
      
      // 本地先更新工具状态（更健壮：即使 messageIndex 不准确也能 fallback）
      const info = markIncompleteToolsAsError(state, state.streamingMessageId.value)
      // 插入 functionResponse，保持前后端索引一致
      ensureFunctionResponseMessageForRejectedTools(state, info)
      
      // 计算后端索引
      const backendIndex = calculateBackendIndex(state.allMessages.value, messageIndex)
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
  // 先保存当前 streaming 消息 ID，因为 await 期间可能被其他事件清除
  const currentStreamingId = state.streamingMessageId.value

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
        if (tool.status === 'pending') {
          return { ...tool, status: 'running' as const }
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
      parts: [{ text: trimmedAnnotation }]
    }
    state.allMessages.value.push(userMessage)
  }

  try {
    await sendToExtension('toolConfirmation', {
      conversationId: state.currentConversationId.value,
      configId: state.currentConfig.value.id,
      toolResponses,
      annotation: trimmedAnnotation
    })
  } catch (error) {
    console.error('Failed to send tool confirmation with annotation:', error)
  }
}
