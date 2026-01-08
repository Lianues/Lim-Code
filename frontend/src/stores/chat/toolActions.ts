/**
 * Chat Store 工具操作
 * 
 * 包含工具确认、取消、响应查询等操作
 */

import type { Message } from '../../types'
import type { ChatStoreState, ChatStoreComputed } from './types'
import { sendToExtension } from '../../utils/vscode'
import { generateId } from '../../utils/format'

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
 * 取消当前流式请求并拒绝正在执行或等待确认的工具
 */
export async function cancelStreamAndRejectTools(
  state: ChatStoreState,
  computed: ChatStoreComputed
): Promise<void> {
  if (!state.currentConversationId.value) return
  
  if (state.retryStatus.value) {
    state.retryStatus.value = null
  }
  
  if (state.streamingMessageId.value) {
    const messageIndex = state.allMessages.value.findIndex(m => m.id === state.streamingMessageId.value)
    if (messageIndex !== -1) {
      const message = state.allMessages.value[messageIndex]
      
      const pendingToolIds = message.tools
        ?.filter(tool => tool.status === 'pending' || tool.status === 'running')
        ?.map(tool => tool.id) || []
      
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
        ...state.allMessages.value.slice(0, messageIndex),
        updatedMessage,
        ...state.allMessages.value.slice(messageIndex + 1)
      ]
      
      const actualIndex = getActualIndex(state, computed, computed.messages.value.findIndex(m => m.id === state.streamingMessageId.value))
      if (actualIndex !== -1 && pendingToolIds.length > 0) {
        try {
          await sendToExtension('conversation.rejectToolCalls', {
            conversationId: state.currentConversationId.value,
            messageIndex: actualIndex,
            toolCallIds: pendingToolIds
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
  computed: ChatStoreComputed
): Promise<void> {
  if (state.retryStatus.value) {
    state.retryStatus.value = null
  }
  
  if (!state.isWaitingForResponse.value || !state.currentConversationId.value) {
    return
  }
  
  // 等待工具确认状态
  if (!state.isStreaming.value) {
    if (state.streamingMessageId.value) {
      const messageIndex = state.allMessages.value.findIndex(m => m.id === state.streamingMessageId.value)
      if (messageIndex !== -1) {
        const message = state.allMessages.value[messageIndex]
        
        const pendingToolIds = message.tools
          ?.filter(tool => tool.status === 'pending')
          ?.map(tool => tool.id) || []
        
        const updatedTools = message.tools?.map(tool => {
          if (tool.status === 'pending') {
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
          ...state.allMessages.value.slice(0, messageIndex),
          updatedMessage,
          ...state.allMessages.value.slice(messageIndex + 1)
        ]
        
        const actualIndex = getActualIndex(state, computed, computed.messages.value.findIndex(m => m.id === state.streamingMessageId.value))
        if (actualIndex !== -1 && pendingToolIds.length > 0) {
          try {
            await sendToExtension('conversation.rejectToolCalls', {
              conversationId: state.currentConversationId.value,
              messageIndex: actualIndex,
              toolCallIds: pendingToolIds
            })
          } catch (err) {
            console.error('Failed to reject tool calls in backend:', err)
          }
        }
      }
      state.streamingMessageId.value = null
    }
    
    state.isLoading.value = false
    state.isWaitingForResponse.value = false
    return
  }
  
  // 正在流式响应
  try {
    await sendToExtension('cancelStream', {
      conversationId: state.currentConversationId.value
    })
    
    if (state.streamingMessageId.value) {
      const messageIndex = state.allMessages.value.findIndex(m => m.id === state.streamingMessageId.value)
      if (messageIndex !== -1) {
        const message = state.allMessages.value[messageIndex]
        
        const hasPartsContent = message.parts && message.parts.some(p => p.text || p.functionCall)
        if (!message.content && !message.tools && !hasPartsContent) {
          state.allMessages.value = state.allMessages.value.filter(m => m.id !== state.streamingMessageId.value)
        } else {
          const updatedTools = message.tools?.map(tool => {
            if (tool.status === 'running' || tool.status === 'pending') {
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
            ...state.allMessages.value.slice(0, messageIndex),
            updatedMessage,
            ...state.allMessages.value.slice(messageIndex + 1)
          ]
        }
      }
    }
    state.streamingMessageId.value = null
    state.isLoading.value = false
    state.isStreaming.value = false
    state.isWaitingForResponse.value = false
  } catch (err) {
    console.error('取消请求失败:', err)
    if (state.streamingMessageId.value) {
      const message = state.allMessages.value.find(m => m.id === state.streamingMessageId.value)
      if (message) {
        message.streaming = false
        const hasPartsContent = message.parts && message.parts.some(p => p.text || p.functionCall)
        if (!message.content && !message.tools && !hasPartsContent) {
          state.allMessages.value = state.allMessages.value.filter(m => m.id !== state.streamingMessageId.value)
        }
      }
      state.streamingMessageId.value = null
    }
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
