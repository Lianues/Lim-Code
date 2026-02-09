/**
 * Chat Store 消息操作
 * 
 * 包含消息发送、重试、编辑、删除等操作
 */

import type { Message, Attachment, Content } from '../../types'
import type { ChatStoreState, ChatStoreComputed, AttachmentData } from './types'
import { sendToExtension } from '../../utils/vscode'
import { generateId } from '../../utils/format'
import { createAndPersistConversation, MESSAGES_PAGE_SIZE, loadCheckpoints, refreshCurrentConversationBuildSession } from './conversationActions'
import { updateTabConversationId, updateTabTitle } from './tabActions'
import { clearCheckpointsFromIndex } from './checkpointActions'
import { contentToMessageEnhanced } from './parsers'
import { syncTotalMessagesFromWindow, setTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'

/**
 * 取消流式的回调类型
 */
export type CancelStreamCallback = () => Promise<void>

/**
 * 隐藏发送（不创建可见 user 消息）时，写入的一条 functionResponse
 */
export interface HiddenFunctionResponsePayload {
  id?: string
  name: string
  response: Record<string, unknown>
}

export interface SendMessageOptions {
  modelOverride?: string
  hidden?: { functionResponse: HiddenFunctionResponsePayload }
}

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
export function calculateBackendIndex(messages: Message[], frontendIndex: number, windowStartIndex = 0): number {
  const msg = messages[frontendIndex]
  if (!msg) return -1
  if (typeof msg.backendIndex === 'number') return msg.backendIndex
  // 本地占位消息可能还没有 backendIndex：用窗口起点 + 本地偏移推导
  return windowStartIndex + frontendIndex
}

function getNextBackendIndex(state: ChatStoreState): number {
  return state.windowStartIndex.value + state.allMessages.value.length
}

function isEmptyAssistantPlaceholder(msg: Message | undefined): boolean {
  if (!msg) return false
  if (msg.role !== 'assistant') return false
  const hasContent = !!(msg.content && msg.content.trim())
  const hasTools = !!(msg.tools && msg.tools.length > 0)
  const hasPartsContent = !!msg.parts?.some(p => p.text || p.functionCall)
  return !hasContent && !hasTools && !hasPartsContent
}

function isLocalOnlyAssistant(msg: Message | undefined): boolean {
  return !!msg && msg.role === 'assistant' && msg.localOnly === true
}

/**
 * 发送消息
 */
function mergeResponseWithCleanup(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(patch || {})
  }
}

function upsertHiddenFunctionResponseMessage(
  state: ChatStoreState,
  payload: HiddenFunctionResponsePayload
): void {
  const all = state.allMessages.value

  // 1) 优先按 id 定位并替换已有 functionResponse（如 create_plan 的原始响应）
  if (payload.id) {
    for (let i = all.length - 1; i >= 0; i--) {
      const msg = all[i]
      if (!msg.isFunctionResponse || !msg.parts || msg.parts.length === 0) continue

      let matched = false
      const nextParts = msg.parts.map(part => {
        const fr = part.functionResponse
        if (!fr) return part
        if (fr.id !== payload.id) return part

        matched = true
        return {
          ...part,
          functionResponse: {
            ...fr,
            id: payload.id || fr.id,
            name: payload.name,
            response: mergeResponseWithCleanup(fr.response as Record<string, unknown> | undefined, payload.response)
          }
        }
      })

      if (matched) {
        state.allMessages.value = [
          ...all.slice(0, i),
          { ...msg, parts: nextParts },
          ...all.slice(i + 1)
        ]
        return
      }
    }
  }

  // 2) 如果未命中，追加一条隐藏 functionResponse 消息
  const responseMessage: Message = {
    id: generateId(),
    role: 'user',
    content: '',
    timestamp: Date.now(),
    backendIndex: getNextBackendIndex(state),
    isFunctionResponse: true,
    parts: [{
      functionResponse: {
        id: payload.id,
        name: payload.name,
        response: payload.response
      }
    }]
  }
  state.allMessages.value.push(responseMessage)
}

export async function sendMessage(
  state: ChatStoreState,
  computed: ChatStoreComputed,
  messageText: string,
  attachments?: Attachment[],
  options?: SendMessageOptions
): Promise<void> {
  const hiddenFunctionResponse = options?.hidden?.functionResponse
  const isHiddenSend = !!hiddenFunctionResponse
  if (!isHiddenSend && !messageText.trim() && (!attachments || attachments.length === 0)) return
  
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
      // 更新当前标签页的 conversationId 和标题
      if (state.activeTabId.value) {
        updateTabConversationId(state, state.activeTabId.value, newId)
        const title = messageText.slice(0, 30) + (messageText.length > 30 ? '...' : '')
        updateTabTitle(state, state.activeTabId.value, title)
      }
    }
    
    if (hiddenFunctionResponse) {
      // 隐藏模式：不创建可见 user 消息，改为 functionResponse（可用于计划确认等场景）
      upsertHiddenFunctionResponseMessage(state, hiddenFunctionResponse)
    } else {
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: messageText,
        timestamp: Date.now(),
        backendIndex: getNextBackendIndex(state),
        attachments: attachments && attachments.length > 0 ? attachments : undefined
      }
      state.allMessages.value.push(userMessage)
    }
    
    const assistantMessageId = generateId()
    const displayModelVersion = options?.modelOverride || computed.currentModelName.value
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      backendIndex: getNextBackendIndex(state),
      streaming: true,
      localOnly: true,
      metadata: {
        modelVersion: displayModelVersion
      }
    }
    state.allMessages.value.push(assistantMessage)
    state.streamingMessageId.value = assistantMessageId
    syncTotalMessagesFromWindow(state)
    trimWindowFromTop(state)
    
    const conv = state.conversations.value.find(c => c.id === state.currentConversationId.value)
    if (conv) {
      conv.updatedAt = Date.now()
      // 使用窗口推导的“已知总数”，避免窗口化后 messageCount 变小
      const knownTotal = Math.max(state.totalMessages.value, state.windowStartIndex.value + state.allMessages.value.length)
      state.totalMessages.value = knownTotal
      conv.messageCount = knownTotal
      if (!hiddenFunctionResponse) {
        conv.preview = messageText.slice(0, 50)
      }
    }
    
    state.toolCallBuffer.value = ''
    state.inToolCall.value = null
    state.pendingModelOverride.value = options?.modelOverride || null
    
    const attachmentData: AttachmentData[] | undefined = attachments && attachments.length > 0
      ? attachments.map(att => ({
          // 隐藏模式默认不带附件（这里保留原有结构以兼容调用）
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
      attachments: hiddenFunctionResponse ? undefined : attachmentData,
      modelOverride: options?.modelOverride,
      hiddenFunctionResponse
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

  // 如果目标是“本地空占位 assistant”（后端并不存在），不要调用 deleteMessage 到后端，
  // 否则会触发 messageIndexOutOfBounds。这里直接本地清理并走 retryStream。
  const target = state.allMessages.value[messageIndex]
  if (isLocalOnlyAssistant(target) || isEmptyAssistantPlaceholder(target)) {
    state.error.value = null
    state.isLoading.value = true
    state.isStreaming.value = true
    state.isWaitingForResponse.value = true

    const backendFrom = calculateBackendIndex(state.allMessages.value, messageIndex, state.windowStartIndex.value)
    state.allMessages.value = state.allMessages.value.slice(0, messageIndex)
    clearCheckpointsFromIndex(state, backendFrom)
    setTotalMessagesFromWindow(state)

    state.toolCallBuffer.value = ''
    state.inToolCall.value = null

    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      backendIndex: getNextBackendIndex(state),
      streaming: true,
      localOnly: true,
      metadata: {
        modelVersion: computed.currentModelName.value
      }
    }
    state.allMessages.value.push(assistantMessage)
    state.streamingMessageId.value = assistantMessageId
    syncTotalMessagesFromWindow(state)
    trimWindowFromTop(state)

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
    return
  }
  
  state.error.value = null
  state.isLoading.value = true
  state.isStreaming.value = true
  state.isWaitingForResponse.value = true
  
  // 计算后端索引（在修改数组之前）
  const backendIndex = calculateBackendIndex(state.allMessages.value, messageIndex, state.windowStartIndex.value)
  
  state.allMessages.value = state.allMessages.value.slice(0, messageIndex)
  clearCheckpointsFromIndex(state, backendIndex)
  setTotalMessagesFromWindow(state)
  
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

      // 尝试回滚：重新从后端拉取“最后一页”历史，避免前端与后端状态错位（避免全量拉取造成卡顿）
      try {
        const result = await sendToExtension<{ total: number; messages: Content[] }>('conversation.getMessagesPaged', {
          conversationId: state.currentConversationId.value,
          limit: MESSAGES_PAGE_SIZE
        })
        const page = result?.messages || []
        state.totalMessages.value = result?.total ?? page.length
        state.windowStartIndex.value = page[0]?.index ?? 0
        state.allMessages.value = page.map(content => contentToMessageEnhanced(content))
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
    backendIndex: getNextBackendIndex(state),
    streaming: true,
    localOnly: true,
    metadata: {
      modelVersion: computed.currentModelName.value
    }
  }
  state.allMessages.value.push(assistantMessage)
  state.streamingMessageId.value = assistantMessageId
  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)
  
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
    backendIndex: getNextBackendIndex(state),
    streaming: true,
    localOnly: true,
    metadata: {
      modelVersion: computed.currentModelName.value
    }
  }
  state.allMessages.value.push(assistantMessage)
  state.streamingMessageId.value = assistantMessageId
  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)
  
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
  const backendMessageIndex = calculateBackendIndex(state.allMessages.value, messageIndex, state.windowStartIndex.value)
  
  const targetMessage = state.allMessages.value[messageIndex]
  targetMessage.content = newMessage
  targetMessage.parts = [{ text: newMessage }]
  targetMessage.attachments = attachments && attachments.length > 0 ? attachments : undefined
  
  state.allMessages.value = state.allMessages.value.slice(0, messageIndex + 1)
  clearCheckpointsFromIndex(state, backendMessageIndex)
  setTotalMessagesFromWindow(state)
  
  state.toolCallBuffer.value = ''
  state.inToolCall.value = null
  
  const assistantMessageId = generateId()
  const assistantMessage: Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    backendIndex: getNextBackendIndex(state),
    streaming: true,
    localOnly: true,
    metadata: {
      modelVersion: computed.currentModelName.value
    }
  }
  state.allMessages.value.push(assistantMessage)
  state.streamingMessageId.value = assistantMessageId
  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)
  
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

  // 如果删除目标是“本地空占位 assistant”（后端并不存在），只做本地删除，避免后端索引越界。
  const target = state.allMessages.value[targetIndex]
  if (isLocalOnlyAssistant(target) || isEmptyAssistantPlaceholder(target)) {
    const msgId = state.allMessages.value[targetIndex]?.id
    const backendFrom = calculateBackendIndex(state.allMessages.value, targetIndex, state.windowStartIndex.value)
    state.allMessages.value = state.allMessages.value.slice(0, targetIndex)
    clearCheckpointsFromIndex(state, backendFrom)
    setTotalMessagesFromWindow(state)
    if (state.streamingMessageId.value && msgId && state.streamingMessageId.value === msgId) {
      state.streamingMessageId.value = null
    }
    state.isStreaming.value = false
    state.isWaitingForResponse.value = false

    // 本地占位删除后也刷新一次 activeBuild，避免残留旧 Build 壳
    await refreshCurrentConversationBuildSession(state)
    return
  }
  
  // 计算后端实际索引
  const backendIndex = calculateBackendIndex(state.allMessages.value, targetIndex, state.windowStartIndex.value)
  
  try {
    const response = await sendToExtension<any>('deleteMessage', {
      conversationId: state.currentConversationId.value,
      targetIndex: backendIndex
    })

    if (response?.success) {
      state.allMessages.value = state.allMessages.value.slice(0, targetIndex)
      clearCheckpointsFromIndex(state, backendIndex)
      setTotalMessagesFromWindow(state)
      await refreshCurrentConversationBuildSession(state)
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
  // 注意：deleteSingleMessage 会导致后续消息索引整体前移。
  // 因此这里把 targetIndex 视为“后端绝对索引（backendIndex）”，并在成功后重新加载窗口，避免索引错位。
  const backendIndex = targetIndex
  if (backendIndex < 0) return
  
  // 如果正在流式响应或等待工具确认，先取消
  if (state.isStreaming.value || state.isWaitingForResponse.value) {
    await cancelStream()
  }
  
  try {
    const response = await sendToExtension<{ success: boolean }>('deleteSingleMessage', {
      conversationId: state.currentConversationId.value,
      targetIndex: backendIndex
    })
    
    if (response.success) {
      // 重新加载最后一页，确保 backendIndex 与 checkpoints 的 messageIndex 不错位
      const result = await sendToExtension<{ total: number; messages: Content[] }>('conversation.getMessagesPaged', {
        conversationId: state.currentConversationId.value,
        limit: MESSAGES_PAGE_SIZE
      })
      const page = result?.messages || []
      state.totalMessages.value = result?.total ?? page.length
      state.windowStartIndex.value = page[0]?.index ?? 0
      state.allMessages.value = page.map(content => contentToMessageEnhanced(content))

      state.isLoadingMoreMessages.value = false
      state.historyFolded.value = false
      state.foldedMessageCount.value = 0

      await loadCheckpoints(state)
      await refreshCurrentConversationBuildSession(state)
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
  state.windowStartIndex.value = 0
  state.totalMessages.value = 0
  state.isLoadingMoreMessages.value = false
  state.toolResponseCache.value = new Map()
  state.historyFolded.value = false
  state.foldedMessageCount.value = 0
  state.activeBuild.value = null
  state.error.value = null
  state.streamingMessageId.value = null
  state.isWaitingForResponse.value = false
}
