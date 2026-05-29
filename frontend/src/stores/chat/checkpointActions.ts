/**
 * Chat Store 检查点操作
 * 
 * 包含检查点的 CRUD 和恢复操作
 */

import type { ContextCommandPayload, Message, Attachment, CheckpointRecord } from '../../types'
import type { ChatStoreState, AttachmentData } from './types'
import { sendToExtension } from '../../utils/vscode'
import { generateId } from '../../utils/format'
import { calculateBackendIndex } from './messageActions'
import { appendMessage, replaceAllMessages } from './state'
import { syncTotalMessagesFromWindow, setTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'
import { loadCheckpoints, refreshCurrentConversationBuildSession } from './conversationActions'

function resolveConversationModelOverride(state: ChatStoreState): string | undefined {
  const selected = (state.selectedModelId.value || '').trim()
  const configModel = (state.currentConfig.value?.model || '').trim()
  return selected && selected !== configModel ? selected : undefined
}

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
): Promise<{
  success: boolean
  restored: number
  deleted?: number
  skipped?: number
  error?: string
  missingBackupDirs?: string[]
  autoPrunedCheckpointCount?: number
}> {
  if (!state.currentConversationId.value) {
    return { success: false, restored: 0, error: 'No conversation selected' }
  }
  
  try {
    const result = await sendToExtension<{
      success: boolean
      restored: number
      deleted?: number
      skipped?: number
      error?: string
      missingBackupDirs?: string[]
      autoPrunedCheckpointCount?: number
    }>(
      'checkpoint.restore',
      {
        conversationId: state.currentConversationId.value,
        checkpointId
      }
    )
    
    const normalized = result || { success: false, restored: 0, error: 'Unknown error' }
    if ((normalized.autoPrunedCheckpointCount || 0) > 0) {
      try {
        await loadCheckpoints(state)
      } catch (error) {
        console.error('[checkpointActions] Failed to refresh checkpoints after auto prune:', error)
      }
    }
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
    // 修改原因：checkpoint 回档会截断消息窗口，旧 id 下标整体失效。
    // 修改方式：统一通过 helper 截断消息窗口，并在同一维护点刷新索引。
    // 修改目的：保证 restoreAndRetry 之后所有基于 id 的定位都与截断后的窗口一致。
    replaceAllMessages(state, state.allMessages.value.slice(0, messageIndex))
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
    appendMessage(state, assistantMessage)
    syncTotalMessagesFromWindow(state)
    trimWindowFromTop(state)
    state.streamingMessageId.value = assistantMessageId
    
    // 6. 调用后端重试
    const modelOverride = resolveConversationModelOverride(state)
    const streamId = generateId()
    state.activeStreamId.value = streamId
    state._lastCancelledStreamId.value = null
    await sendToExtension('retryStream', {
      conversationId: state.currentConversationId.value,
      configId: state.configId.value,
      modelOverride,
      streamId
    })
    
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'RESTORE_RETRY_ERROR',
        message: err.message || '回档并重试失败'
      }
      state.streamingMessageId.value = null
      state.isStreaming.value = false
      state.activeStreamId.value = null
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
    // 修改原因：restoreAndDelete 同样会裁剪消息窗口，必须同步刷新派生索引。
    // 修改方式：统一通过 helper 截断 allMessages，并在同一维护点刷新索引。
    // 修改目的：避免删除后继续使用旧下标映射造成 id 定位失配。
    replaceAllMessages(state, state.allMessages.value.slice(0, messageIndex))
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
    // 修改原因：restoreAndEdit 会保留被编辑消息、裁掉其后的所有消息，索引需要同步收敛。
    // 修改方式：统一通过 helper 截断消息窗口，并在同一维护点刷新索引，再继续插入新的 assistant 占位。
    // 修改目的：保证 edit/retry 之后新的 streamingMessageId 定位不会混用旧窗口下标。
    replaceAllMessages(state, state.allMessages.value.slice(0, messageIndex + 1))
    clearCheckpointsFromIndex(state, backendMessageIndex)
    setTotalMessagesFromWindow(state)

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
    appendMessage(state, assistantMessage)
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
    const modelOverride = resolveConversationModelOverride(state)
    const streamId = generateId()
    state.activeStreamId.value = streamId
    state._lastCancelledStreamId.value = null
    await sendToExtension('editAndRetryStream', {
      conversationId: state.currentConversationId.value,
      messageIndex: backendMessageIndex,
      newMessage: newContent,
      attachments: attachmentData,
      configId: state.configId.value,
      modelOverride,
      streamId
    })
    
  } catch (err: any) {
    if (state.isStreaming.value) {
      state.error.value = {
        code: err.code || 'RESTORE_EDIT_ERROR',
        message: err.message || '回档并编辑失败'
      }
      state.streamingMessageId.value = null
      state.isStreaming.value = false
      state.activeStreamId.value = null
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
export async function compactContext(
  state: ChatStoreState,
  loadHistory: () => Promise<void>
): Promise<{
  success: boolean
  kind?: ContextCommandPayload['kind']
  title?: string
  message?: string
  tokenAfter?: number
  errorCode?: string
  error?: string
}> {
  const originConversationId = state.currentConversationId.value
  if (!originConversationId) {
    return { success: false, errorCode: 'NO_CONVERSATION', error: 'No conversation selected' }
  }
  if (!state.configId.value) {
    return { success: false, errorCode: 'NO_CONFIG', error: 'No config selected' }
  }

  const setCompactStatusForConversation = (
    status: { isSummarizing: boolean; mode?: 'auto' | 'manual'; message?: string } | null
  ) => {
    // 修改原因：compact 是异步操作，用户可能在执行期间切换会话；直接写全局 autoSummaryStatus 会污染当前 tab 或让原 tab 卡住 loading。
    // 修改方式：复用 summarize 的对话隔离模式，当前仍是原对话则写全局，否则写回原 tab snapshot。
    // 修改目的：压缩按钮 loading 状态与触发会话绑定，不影响其他会话。
    if (!originConversationId || originConversationId === state.currentConversationId.value) {
      state.autoSummaryStatus.value = status
      return
    }
    const tab = state.openTabs.value.find(t => t.conversationId === originConversationId)
    if (!tab) return
    const snapshot = state.sessionSnapshots.value.get(tab.id)
    if (snapshot) {
      snapshot.autoSummaryStatus = status ? { ...status } : null
    }
  }

  setCompactStatusForConversation({ isSummarizing: true, mode: 'manual' })
  try {
    // 修改原因：主界面“压缩上下文”必须与 slash /compact 共享按策略 compact 的后端语义，不能继续直连 summarizeContext。
    // 修改方式：调用 context.compact 普通 handler，返回 UiStatusPayload 后刷新历史和 contextUsageOverride。
    // 修改目的：compact 成功后 ledger/projection 生效，右下角环状指示灯立即显示 tokenAfter。
    const payload = await sendToExtension<ContextCommandPayload>('context.compact', {
      conversationId: originConversationId,
      configId: state.configId.value
    })

    if (typeof payload.tokenAfter === 'number') {
      state.contextUsageOverride.value = {
        conversationId: originConversationId,
        usedTokens: Math.max(0, payload.tokenAfter),
        updatedAt: Date.now()
      }
    }

    if (originConversationId === state.currentConversationId.value) {
      await loadHistory()
    }

    return {
      success: payload.kind !== 'error',
      kind: payload.kind,
      title: payload.title,
      message: payload.description,
      tokenAfter: payload.tokenAfter,
      error: payload.kind === 'error' ? payload.description : undefined
    }
  } catch (err: any) {
    return {
      success: false,
      errorCode: err?.code,
      error: err.message || 'Compact failed'
    }
  } finally {
    setCompactStatusForConversation(null)
  }
}

export async function summarizeContext(
  state: ChatStoreState,
  loadHistory: () => Promise<void>
): Promise<{
  success: boolean
  summarizedMessageCount?: number
  errorCode?: string
  error?: string
}> {
  const originConversationId = state.currentConversationId.value

  const setManualSummaryStatusForConversation = (
    status: { isSummarizing: boolean; mode?: 'auto' | 'manual'; message?: string } | null
  ) => {
    // 当前仍是原对话，直接更新当前状态
    if (!originConversationId || originConversationId === state.currentConversationId.value) {
      state.autoSummaryStatus.value = status
      return
    }

    // 对话已切换，更新原对话对应标签页快照，避免跨对话污染
    const tab = state.openTabs.value.find(t => t.conversationId === originConversationId)
    if (!tab) return

    const snapshot = state.sessionSnapshots.value.get(tab.id)
    if (snapshot) {
      snapshot.autoSummaryStatus = status ? { ...status } : null
    }
  }

  if (!originConversationId) {
    return { success: false, errorCode: 'NO_CONVERSATION', error: 'No conversation selected' }
  }
  
  if (!state.configId.value) {
    return { success: false, errorCode: 'NO_CONFIG', error: 'No config selected' }
  }

  // 显示底部提示（对话级隔离）
  setManualSummaryStatusForConversation({
    isSummarizing: true,
    mode: 'manual'
  })
  
  try {
    // 只传递必要参数，所有配置项从后端读取
    const result = await sendToExtension<({
      success: boolean
      summaryContent?: any
      summarizedMessageCount?: number
      afterTokenCount?: number
      error?: { code: string; message: string }
    } | ContextCommandPayload)>('summarizeContext', {
      conversationId: originConversationId,
      configId: state.configId.value
    })

    if ('kind' in result) {
      if (typeof result.tokenAfter === 'number') {
        state.contextUsageOverride.value = {
          conversationId: originConversationId,
          usedTokens: Math.max(0, result.tokenAfter),
          updatedAt: Date.now()
        }
      }
      if (originConversationId === state.currentConversationId.value) {
        await loadHistory()
      }
      return {
        success: result.kind !== 'error',
        summarizedMessageCount: undefined,
        errorCode: result.kind === 'error' ? result.command : undefined,
        error: result.kind === 'error' ? result.description : undefined
      }
    }
    
    if (result.success && result.summaryContent) {
      if (typeof result.afterTokenCount === 'number') {
        // 修改原因：强制 summarize 也是一次手动压缩操作，成功后不会产生新的 assistant usageMetadata。
        // 修改方式：用后端返回的 afterTokenCount 暂时覆盖 usedTokens，直到下一轮 provider usage 返回。
        // 修改目的：让主界面环状指示灯在 summarize 成功后实时刷新。
        state.contextUsageOverride.value = {
          conversationId: originConversationId,
          usedTokens: Math.max(0, result.afterTokenCount),
          updatedAt: Date.now()
        }
      }
      // 重新加载历史以获取更新后的消息列表；如果用户已切到其他会话，避免刷新错会话。
      if (originConversationId === state.currentConversationId.value) {
        await loadHistory()
      }
      
      return {
        success: true,
        summarizedMessageCount: result.summarizedMessageCount
      }
    } else {
      return {
        success: false,
        errorCode: result.error?.code,
        error: result.error?.message || 'Summarize failed'
      }
    }
  } catch (err: any) {
    return {
      success: false,
      errorCode: err?.code,
      error: err.message || 'Summarize failed'
    }
  } finally {
    // 结束提示（对话级隔离）
    setManualSummaryStatusForConversation(null)
  }
}

/**
 * 取消当前对话的总结请求（仅取消总结 API，不影响后续 AI 响应）
 */
export async function cancelSummarizeRequest(state: ChatStoreState): Promise<void> {
  const conversationId = state.currentConversationId.value
  if (!conversationId) return

  try {
    await sendToExtension('cancelSummarizeRequest', { conversationId })
  } catch (error) {
    console.error('[checkpointActions] Failed to cancel summarize request:', error)
  }
}
