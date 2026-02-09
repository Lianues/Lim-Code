/**
 * Chat Store 检查点操作
 * 
 * 包含检查点的 CRUD 和恢复操作
 */

import type { Message, Attachment, CheckpointRecord } from '../../types'
import type { ChatStoreState, AttachmentData } from './types'
import { sendToExtension } from '../../utils/vscode'
import { generateId } from '../../utils/format'
import { calculateBackendIndex } from './messageActions'
import { syncTotalMessagesFromWindow, setTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'
import { refreshCurrentConversationBuildSession } from './conversationActions'

/**
 * 根据消息索引获取关联的检查点
 */
export function getCheckpointsForMessage(state: ChatStoreState, messageIndex: number): CheckpointRecord[] {
  return state.checkpoints.value.filter(cp => cp.messageIndex === messageIndex)
}

/**
 * 检查消息是否有关联的检查点
 */
export function hasCheckpoint(state: ChatStoreState, messageIndex: number): boolean {
  return state.checkpoints.value.some(cp => cp.messageIndex === messageIndex)
}

/**
 * 添加检查点
 */
export function addCheckpoint(state: ChatStoreState, checkpoint: CheckpointRecord): void {
  state.checkpoints.value.push(checkpoint)
}

/**
 * 清理指定索引及之后的检查点
 */
export function clearCheckpointsFromIndex(state: ChatStoreState, fromBackendIndex: number): void {
  // CheckpointRecord.messageIndex 是后端历史中的绝对索引
  state.checkpoints.value = state.checkpoints.value.filter(cp => cp.messageIndex < fromBackendIndex)
}

/**
 * 恢复到指定检查点
 */
export async function restoreCheckpoint(
  state: ChatStoreState,
  checkpointId: string
): Promise<{ success: boolean; restored: number; deleted?: number; error?: string }> {
  if (!state.currentConversationId.value) {
    return { success: false, restored: 0, error: 'No conversation selected' }
  }
  
  try {
    const result = await sendToExtension<{ success: boolean; restored: number; deleted?: number; error?: string }>(
      'checkpoint.restore',
      {
        conversationId: state.currentConversationId.value,
        checkpointId
      }
    )
    
    const normalized = result || { success: false, restored: 0, error: 'Unknown error' }
    if (normalized.success) {
      // 回退后同步会话元数据（activeBuild/todoList）到前端，避免继续显示旧的 Build 壳。
      await refreshCurrentConversationBuildSession(state)
    }
    return normalized
  } catch (err: any) {
    return { success: false, restored: 0, error: err.message || 'Restore failed' }
  }
}

/**
 * 回档并重试
 *
 * 先恢复到指定检查点，然后重试消息
 *
 * @param messageIndex allMessages 中的索引
 * @param checkpointId 检查点 ID
 * @param currentModelName 当前模型名称
 */
export async function restoreAndRetry(
  state: ChatStoreState,
  messageIndex: number,
  checkpointId: string,
  currentModelName: string,
  cancelStream: () => Promise<void>
): Promise<void> {
  if (!state.currentConversationId.value || messageIndex < 0 || messageIndex >= state.allMessages.value.length) {
    return
  }
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  state.error.value = null
  state.isLoading.value = true
  
  try {
    // 1. 先恢复检查点
    const restoreResult = await restoreCheckpoint(state, checkpointId)
    if (!restoreResult.success) {
      state.error.value = {
        code: 'RESTORE_ERROR',
        message: restoreResult.error || '恢复检查点失败'
      }
      state.isLoading.value = false
      return
    }
    
    // 2. 计算后端索引（在删除本地消息之前）
    const backendIndex = calculateBackendIndex(state.allMessages.value, messageIndex, state.windowStartIndex.value)
    
    // 3. 删除该消息及后续的本地消息和检查点
    state.allMessages.value = state.allMessages.value.slice(0, messageIndex)
    clearCheckpointsFromIndex(state, backendIndex)
    setTotalMessagesFromWindow(state)
    
    // 4. 删除后端的消息
    try {
      const resp = await sendToExtension<any>('deleteMessage', {
        conversationId: state.currentConversationId.value,
        targetIndex: backendIndex
      })
      if (!resp?.success) {
        console.error('[checkpointActions] restoreAndRetry: backend deleteMessage returned error:', resp)
      }
    } catch (err) {
      console.error('Failed to delete messages from backend:', err)
    }
    
    // 4. 重置工具调用缓冲区
    state.toolCallBuffer.value = ''
    state.inToolCall.value = null
    
    // 5. 开始流式重试
    state.isStreaming.value = true
    state.isWaitingForResponse.value = true
    
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      backendIndex: state.windowStartIndex.value + state.allMessages.value.length,
      streaming: true,
      localOnly: true,
      metadata: {
        modelVersion: currentModelName
      }
    }
    state.allMessages.value.push(assistantMessage)
    syncTotalMessagesFromWindow(state)
    trimWindowFromTop(state)
    state.streamingMessageId.value = assistantMessageId
    
    // 6. 调用后端重试
    await sendToExtension('retryStream', {
      conversationId: state.currentConversationId.value,
      configId: state.configId.value
    })
    
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'RESTORE_RETRY_ERROR',
        message: err.message || '回档并重试失败'
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
 * 回档并删除
 *
 * 先恢复到指定检查点，然后删除该消息及后续消息
 *
 * @param messageIndex allMessages 中的索引
 * @param checkpointId 检查点 ID
 */
export async function restoreAndDelete(
  state: ChatStoreState,
  messageIndex: number,
  checkpointId: string,
  cancelStream: () => Promise<void>
): Promise<void> {
  if (!state.currentConversationId.value || messageIndex < 0 || messageIndex >= state.allMessages.value.length) {
    return
  }
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  state.error.value = null
  state.isLoading.value = true
  
  try {
    // 1. 先恢复检查点
    const restoreResult = await restoreCheckpoint(state, checkpointId)
    if (!restoreResult.success) {
      state.error.value = {
        code: 'RESTORE_ERROR',
        message: restoreResult.error || '恢复检查点失败'
      }
      state.isLoading.value = false
      return
    }
    
    // 2. 计算后端索引（在删除本地消息之前）
    const backendIndex = calculateBackendIndex(state.allMessages.value, messageIndex, state.windowStartIndex.value)
    
    // 3. 删除该消息及后续的本地消息和检查点
    state.allMessages.value = state.allMessages.value.slice(0, messageIndex)
    clearCheckpointsFromIndex(state, backendIndex)
    setTotalMessagesFromWindow(state)
    
    // 4. 删除后端的消息
    try {
      const resp = await sendToExtension<any>('deleteMessage', {
        conversationId: state.currentConversationId.value,
        targetIndex: backendIndex
      })
      if (!resp?.success) {
        console.error('[checkpointActions] restoreAndDelete: backend deleteMessage returned error:', resp)
      } else {
        // 删除/回滚后刷新 activeBuild，避免展示旧的 Build 壳
        await refreshCurrentConversationBuildSession(state)
      }
    } catch (err) {
      console.error('Failed to delete messages from backend:', err)
    }
    
  } catch (err: any) {
    state.error.value = {
      code: err.code || 'RESTORE_DELETE_ERROR',
      message: err.message || '回档并删除失败'
    }
  } finally {
    state.isLoading.value = false
 }
}

/**
 * 回档并编辑
 *
 * 先恢复到指定检查点，然后编辑消息并重试
 *
 * @param messageIndex allMessages 中的索引
 * @param newContent 新的消息内容
 * @param attachments 附件列表（可选）
 * @param checkpointId 检查点 ID
 * @param currentModelName 当前模型名称
 */
export async function restoreAndEdit(
  state: ChatStoreState,
  messageIndex: number,
  newContent: string,
  attachments: Attachment[] | undefined,
  checkpointId: string,
  currentModelName: string,
  cancelStream: () => Promise<void>
): Promise<void> {
  if (!state.currentConversationId.value || messageIndex < 0 || messageIndex >= state.allMessages.value.length) {
    return
  }
  
  if (!newContent.trim() && (!attachments || attachments.length === 0)) {
    return
  }
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  state.error.value = null
  state.isLoading.value = true
  
  // 计算后端索引（在修改数组之前）
  const backendMessageIndex = calculateBackendIndex(state.allMessages.value, messageIndex, state.windowStartIndex.value)
  
  try {
    // 1. 先恢复检查点
    const restoreResult = await restoreCheckpoint(state, checkpointId)
    if (!restoreResult.success) {
      state.error.value = {
        code: 'RESTORE_ERROR',
        message: restoreResult.error || '恢复检查点失败'
      }
      state.isLoading.value = false
      return
    }
    
    // 2. 更新本地消息内容和附件
    const targetMessage = state.allMessages.value[messageIndex]
    targetMessage.content = newContent
    targetMessage.parts = [{ text: newContent }]
    targetMessage.attachments = attachments && attachments.length > 0 ? attachments : undefined
    
    // 3. 删除该消息之后的本地消息和该消息及之后的检查点（因为消息内容已变化）
    state.allMessages.value = state.allMessages.value.slice(0, messageIndex + 1)
    clearCheckpointsFromIndex(state, backendMessageIndex)
    setTotalMessagesFromWindow(state)
    
    // 4. 重置工具调用缓冲区
    state.toolCallBuffer.value = ''
    state.inToolCall.value = null
    
    // 5. 开始流式编辑重试
    state.isStreaming.value = true
    state.isWaitingForResponse.value = true
    
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      backendIndex: state.windowStartIndex.value + state.allMessages.value.length,
      streaming: true,
      localOnly: true,
      metadata: {
        modelVersion: currentModelName
      }
    }
    state.allMessages.value.push(assistantMessage)
    syncTotalMessagesFromWindow(state)
    trimWindowFromTop(state)
    state.streamingMessageId.value = assistantMessageId
    
    // 6. 准备附件数据（序列化为纯对象）
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
    
    // 7. 调用后端编辑并重试
    await sendToExtension('editAndRetryStream', {
      conversationId: state.currentConversationId.value,
      messageIndex: backendMessageIndex,
      newMessage: newContent,
      attachments: attachmentData,
      configId: state.configId.value
    })
    
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'RESTORE_EDIT_ERROR',
        message: err.message || '回档并编辑失败'
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
 * 总结上下文
 *
 * 将旧的对话历史压缩为一条总结消息
 * 所有参数（keepRecentRounds、summarizePrompt）从后端配置读取
 *
 * @returns 总结结果
 */
export async function summarizeContext(
  state: ChatStoreState,
  loadHistory: () => Promise<void>
): Promise<{
  success: boolean
  summarizedMessageCount?: number
  error?: string
}> {
  if (!state.currentConversationId.value) {
    return { success: false, error: 'No conversation selected' }
  }
  
  if (!state.configId.value) {
    return { success: false, error: 'No config selected' }
  }
  
  try {
    // 只传递必要参数，所有配置项从后端读取
    const result = await sendToExtension<{
      success: boolean
      summaryContent?: any
      summarizedMessageCount?: number
      error?: { code: string; message: string }
    }>('summarizeContext', {
      conversationId: state.currentConversationId.value,
      configId: state.configId.value
    })
    
    if (result.success && result.summaryContent) {
      // 重新加载历史以获取更新后的消息列表
      await loadHistory()
      
      return {
        success: true,
        summarizedMessageCount: result.summarizedMessageCount
      }
    } else {
      return {
        success: false,
        error: result.error?.message || 'Summarize failed'
      }
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Summarize failed'
    }
  }
}
