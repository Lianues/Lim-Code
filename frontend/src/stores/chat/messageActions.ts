/**
 * Chat Store 消息操作
 * 
 * 包含消息发送、重试、编辑、删除等操作
 */

import type { Message, Attachment, Content } from '../../types'
import type { ChatStoreState, ChatStoreComputed, AttachmentData } from './types'
import { sendToExtension } from '../../utils/vscode'
import { generateId } from '../../utils/format'
import { createAndPersistConversation } from './conversationActions'
import { clearCheckpointsFromIndex } from './checkpointActions'
import { contentToMessageEnhanced } from './parsers'

/**
 * 取消流式的回调类型
 */
export type CancelStreamCallback = () => Promise<void>

/**
 * 计算后端消息索引
 *
 * 当前实现：前端的 allMessages 会存储所有消息（包括 functionResponse 消息），
 * 并且通过 loadHistory() 从后端加载时保持与后端历史索引一一对应。
 *
 * 因此这里直接返回 frontendIndex。
 *
 * 注意：如果未来再次调整为“前端不存 functionResponse”，才需要在这里做映射。
 */
export function calculateBackendIndex(_messages: Message[], frontendIndex: number): number {
  return frontendIndex
}

/**
 * 发送消息
 */
export async function sendMessage(
  state: ChatStoreState,
  computed: ChatStoreComputed,
  messageText: string,
  attachments?: Attachment[]
): Promise<void> {
  if (!messageText.trim() && (!attachments || attachments.length === 0)) return
  
  state.error.value = null
  if (state.isWaitingForResponse.value) return
  
  state.isLoading.value = true
  state.isStreaming.value = true
  state.isWaitingForResponse.value = true
  
  try {
    if (!state.currentConversationId.value) {
      const newId = await createAndPersistConversation(state, messageText)
      if (!newId) {
        throw new Error('Failed to create conversation')
      }
    }
    
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined
    }
    state.allMessages.value.push(userMessage)
    
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
      metadata: {
        modelVersion: computed.currentModelName.value
      }
    }
    state.allMessages.value.push(assistantMessage)
    state.streamingMessageId.value = assistantMessageId
    
    const conv = state.conversations.value.find(c => c.id === state.currentConversationId.value)
    if (conv) {
      conv.updatedAt = Date.now()
      conv.messageCount = state.allMessages.value.length
      conv.preview = messageText.slice(0, 50)
    }
    
    state.toolCallBuffer.value = ''
    state.inToolCall.value = null
    
    const attachmentData: AttachmentData[] | undefined = attachments && attachments.length > 0
      ? attachments.map(att => ({
          id: att.id,
          name: att.name,
          type: att.type,
          size: att.size,
          mimeType: att.mimeType,
          data: att.data || '',
          thumbnail: att.thumbnail
        }))
      : undefined
    
    await sendToExtension('chatStream', {
      conversationId: state.currentConversationId.value,
      configId: state.configId.value,
      message: messageText,
      attachments: attachmentData
    })
    
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'SEND_ERROR',
        message: err.message || 'Failed to send message'
      }
      state.streamingMessageId.value = null
      state.isStreaming.value = false
      state.isWaitingForResponse.value = false
    }
  } finally {
    state.isLoading.value = false
  }
}

/**
 * 重试最后一条消息
 */
export async function retryLastMessage(
  state: ChatStoreState,
  computed: ChatStoreComputed,
  cancelStream: CancelStreamCallback
): Promise<void> {
  if (state.allMessages.value.length === 0) return
  let lastAssistantIndex = -1
  for (let i = state.allMessages.value.length - 1; i >= 0; i--) {
    if (state.allMessages.value[i].role === 'assistant') {
      lastAssistantIndex = i
      break
    }
  }
  if (lastAssistantIndex !== -1) {
    await retryFromMessage(state, computed, lastAssistantIndex, cancelStream)
  }
}

/**
 * 从指定消息重试
 */
export async function retryFromMessage(
  state: ChatStoreState,
  computed: ChatStoreComputed,
  messageIndex: number,
  cancelStream: CancelStreamCallback
): Promise<void> {
  if (!state.currentConversationId.value || state.allMessages.value.length === 0) return
  if (messageIndex < 0 || messageIndex >= state.allMessages.value.length) return
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  state.error.value = null
  state.isLoading.value = true
  state.isStreaming.value = true
  state.isWaitingForResponse.value = true
  
  // 计算后端索引（在修改数组之前）
  const backendIndex = calculateBackendIndex(state.allMessages.value, messageIndex)
  
  state.allMessages.value = state.allMessages.value.slice(0, messageIndex)
  clearCheckpointsFromIndex(state, messageIndex)
  
  try {
    const resp = await sendToExtension<any>('deleteMessage', {
      conversationId: state.currentConversationId.value,
      targetIndex: backendIndex
    })

    if (!resp?.success) {
      console.error('[messageActions] retryFromMessage: backend deleteMessage returned error:', resp)
      const err = resp?.error
      state.error.value = {
        code: err?.code || 'DELETE_ERROR',
        message: err?.message || 'Failed to delete messages in backend'
      }

      // 尝试回滚：重新从后端拉取历史，避免前端与后端状态错位
      try {
        const history = await sendToExtension<Content[]>('conversation.getMessages', {
          conversationId: state.currentConversationId.value
        })
        state.allMessages.value = history.map(content => contentToMessageEnhanced(content))
      } catch (reloadErr) {
        console.error('[messageActions] retryFromMessage: failed to reload history after delete failure:', reloadErr)
      }

      state.streamingMessageId.value = null
      state.isStreaming.value = false
      state.isWaitingForResponse.value = false
      state.isLoading.value = false
      return
    }
  } catch (err) {
    console.error('Failed to delete messages from backend:', err)
  }
  
  state.toolCallBuffer.value = ''
  state.inToolCall.value = null
  
  const assistantMessageId = generateId()
  const assistantMessage: Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    streaming: true,
    metadata: {
      modelVersion: computed.currentModelName.value
    }
  }
  state.allMessages.value.push(assistantMessage)
  state.streamingMessageId.value = assistantMessageId
  
  try {
    await sendToExtension('retryStream', {
      conversationId: state.currentConversationId.value,
      configId: state.configId.value
    })
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'RETRY_ERROR',
        message: err.message || 'Retry failed'
      }
      state.streamingMessageId.value = null
      state.isStreaming.value = false
      state.isWaitingForResponse.value = false
    }
  } finally {
    state.isLoading.value = false
  }
}

/**
 * 错误后重试
 */
export async function retryAfterError(
  state: ChatStoreState,
  computed: ChatStoreComputed
): Promise<void> {
  if (!state.currentConversationId.value) return
  if (state.isLoading.value || state.isStreaming.value) return
  
  state.error.value = null
  state.isLoading.value = true
  state.isStreaming.value = true
  state.isWaitingForResponse.value = true
  
  state.toolCallBuffer.value = ''
  state.inToolCall.value = null
  
  const assistantMessageId = generateId()
  const assistantMessage: Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    streaming: true,
    metadata: {
      modelVersion: computed.currentModelName.value
    }
  }
  state.allMessages.value.push(assistantMessage)
  state.streamingMessageId.value = assistantMessageId
  
  try {
    await sendToExtension('retryStream', {
      conversationId: state.currentConversationId.value,
      configId: state.configId.value
    })
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'RETRY_ERROR',
        message: err.message || 'Retry failed'
      }
      state.streamingMessageId.value = null
      state.isStreaming.value = false
      state.isWaitingForResponse.value = false
    }
  } finally {
    state.isLoading.value = false
  }
}

/**
 * 编辑并重发消息
 */
export async function editAndRetry(
  state: ChatStoreState,
  computed: ChatStoreComputed,
  messageIndex: number,
  newMessage: string,
  attachments: Attachment[] | undefined,
  cancelStream: CancelStreamCallback
): Promise<void> {
  if ((!newMessage.trim() && (!attachments || attachments.length === 0)) || !state.currentConversationId.value) return
  if (messageIndex < 0 || messageIndex >= state.allMessages.value.length) return
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  state.error.value = null
  state.isLoading.value = true
  state.isStreaming.value = true
  state.isWaitingForResponse.value = true
  
  // 计算后端索引（在修改数组之前）
  const backendMessageIndex = calculateBackendIndex(state.allMessages.value, messageIndex)
  
  const targetMessage = state.allMessages.value[messageIndex]
  targetMessage.content = newMessage
  targetMessage.parts = [{ text: newMessage }]
  targetMessage.attachments = attachments && attachments.length > 0 ? attachments : undefined
  
  state.allMessages.value = state.allMessages.value.slice(0, messageIndex + 1)
  clearCheckpointsFromIndex(state, messageIndex)
  
  state.toolCallBuffer.value = ''
  state.inToolCall.value = null
  
  const assistantMessageId = generateId()
  const assistantMessage: Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    streaming: true,
    metadata: {
      modelVersion: computed.currentModelName.value
    }
  }
  state.allMessages.value.push(assistantMessage)
  state.streamingMessageId.value = assistantMessageId
  
  const attachmentData: AttachmentData[] | undefined = attachments && attachments.length > 0
    ? attachments.map(att => ({
        id: att.id,
        name: att.name,
        type: att.type,
        size: att.size,
        mimeType: att.mimeType,
        data: att.data || '',
        thumbnail: att.thumbnail
      }))
    : undefined
  
  try {
    await sendToExtension('editAndRetryStream', {
      conversationId: state.currentConversationId.value,
      messageIndex: backendMessageIndex,
      newMessage,
      attachments: attachmentData,
      configId: state.configId.value
    })
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'EDIT_RETRY_ERROR',
        message: err.message || 'Edit and retry failed'
      }
      state.streamingMessageId.value = null
      state.isStreaming.value = false
      state.isWaitingForResponse.value = false
    }
  } finally {
    state.isLoading.value = false
  }
}

/**
 * 删除消息
 */
export async function deleteMessage(
  state: ChatStoreState,
  targetIndex: number,
  cancelStream: CancelStreamCallback
): Promise<void> {
  if (!state.currentConversationId.value) return
  if (targetIndex < 0 || targetIndex >= state.allMessages.value.length) return
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  // 计算后端实际索引
  const backendIndex = calculateBackendIndex(state.allMessages.value, targetIndex)
  
  try {
    const response = await sendToExtension<any>('deleteMessage', {
      conversationId: state.currentConversationId.value,
      targetIndex: backendIndex
    })

    if (response?.success) {
      state.allMessages.value = state.allMessages.value.slice(0, targetIndex)
      clearCheckpointsFromIndex(state, targetIndex)
    } else {
      const err = response?.error
      state.error.value = {
        code: err?.code || 'DELETE_ERROR',
        message: err?.message || 'Delete failed'
      }
      console.error('[messageActions] deleteMessage failed:', response)
    }
  } catch (err: any) {
    state.error.value = {
      code: err.code || 'DELETE_ERROR',
      message: err.message || 'Delete failed'
    }
  }
}

/**
 * 删除单条消息（不删除后续消息）
 */
export async function deleteSingleMessage(
  state: ChatStoreState,
  targetIndex: number,
  cancelStream: CancelStreamCallback
): Promise<void> {
  if (!state.currentConversationId.value) return
  if (targetIndex < 0 || targetIndex >= state.allMessages.value.length) return
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  try {
    const response = await sendToExtension<{ success: boolean }>('deleteSingleMessage', {
      conversationId: state.currentConversationId.value,
      targetIndex
    })
    
    if (response.success) {
      state.allMessages.value = [
        ...state.allMessages.value.slice(0, targetIndex),
        ...state.allMessages.value.slice(targetIndex + 1)
      ]
    }
  } catch (err: any) {
    state.error.value = {
      code: err.code || 'DELETE_ERROR',
      message: err.message || 'Delete failed'
    }
  }
}

/**
 * 清空当前对话的消息
 */
export function clearMessages(state: ChatStoreState): void {
  state.allMessages.value = []
  state.error.value = null
  state.streamingMessageId.value = null
  state.isWaitingForResponse.value = false
}
