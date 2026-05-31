/**
 * useChat - 聊天逻辑 Composable
 * 
 * 功能：
 * - 发送消息
 * - 重试消息
 * - 编辑并重发消息
 * - 删除消息
 * - 流式响应处理
 */

import { ref, computed, onBeforeUnmount } from 'vue'
import { sendToExtension, onExtensionMessageType } from '../utils/vscode'
import type {
  Message,
  Content,
  ChatRequest,
  RetryRequest,
  EditAndRetryRequest,
  DeleteMessageRequest,
  StreamChunk,
  ErrorInfo
} from '../types'
import { generateId } from '../utils/format'
import { useI18n } from './useI18n'

export function useChat(conversationId: string, configId: string) {
  // i18n
  const { t } = useI18n()
  
  // 状态
  const messages = ref<Message[]>([])
  const isLoading = ref(false)
  const isStreaming = ref(false)
  const error = ref<ErrorInfo | null>(null)
  const streamingMessageId = ref<string | null>(null)

  // 计算属性
  const hasMessages = computed(() => messages.value.length > 0)
  const lastMessage = computed(() => 
    messages.value.length > 0 
      ? messages.value[messages.value.length - 1] 
      : null
  )

  /**
   * 将 Content 转换为 Message
   */
  function contentToMessage(content: Content, id?: string): Message {
    // 提取文本内容
    const textParts = content.parts.filter(p => p.text && !p.thought)
    const text = textParts.map(p => p.text).join('\n')
    
    return {
      id: id || generateId(),
      role: content.role === 'model' ? 'assistant' : 'user',
      content: text,
      timestamp: Date.now(),
      parts: content.parts,
      metadata: {
        thoughtsTokenCount: content.thoughtsTokenCount,
        candidatesTokenCount: content.candidatesTokenCount
      }
    }
  }

  /**
   * 发送消息（流式）
   */
  async function sendMessage(message: string): Promise<void> {
    if (!message.trim() || isLoading.value) return

    error.value = null
    isLoading.value = true
    isStreaming.value = true

    // 添加用户消息
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now()
    }
    messages.value.push(userMessage)

    // 创建临时的 AI 消息用于流式显示
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true
    }
    messages.value.push(assistantMessage)
    streamingMessageId.value = assistantMessageId

    try {
      const request: ChatRequest = {
        conversationId,
        configId,
        message
      }

      // 发送流式请求
      await sendToExtension('chatStream', request)

      // 流式响应将通过 message 事件处理
    } catch (err: any) {
      error.value = {
        code: err.code || 'SEND_ERROR',
        message: err.message || t('composables.useChat.errors.sendFailed')
      }
      
      // 移除失败的消息
      messages.value = messages.value.filter(m => m.id !== assistantMessageId)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 重试最后一条消息
   */
  async function retryLastMessage(): Promise<void> {
    if (isLoading.value || messages.value.length === 0) return

    error.value = null
    isLoading.value = true
    isStreaming.value = true

    // 创建临时的 AI 消息
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true
    }
    messages.value.push(assistantMessage)
    streamingMessageId.value = assistantMessageId

    try {
      const request: RetryRequest = {
        conversationId,
        configId
      }

      await sendToExtension('retryStream', request)
    } catch (err: any) {
      error.value = {
        code: err.code || 'RETRY_ERROR',
        message: err.message || t('composables.useChat.errors.retryFailed')
      }
      
      messages.value = messages.value.filter(m => m.id !== assistantMessageId)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 编辑并重发消息
   *
   * 注意：前端消息索引和后端历史索引可能不一致
   */
  async function editAndRetry(messageIndex: number, newMessage: string): Promise<void> {
    if (isLoading.value || !newMessage.trim()) return

    error.value = null
    isLoading.value = true
    isStreaming.value = true

    // 计算后端实际的消息索引
    let backendIndex = 0
    for (let i = 0; i < messageIndex && i < messages.value.length; i++) {
      const msg = messages.value[i]
      backendIndex++
      
      // 如果是助手消息且包含工具调用，后端还有一条工具响应
      if (msg.role === 'assistant' && msg.parts?.some(p => p.functionCall)) {
        backendIndex++
      }
    }
    
    // 更新本地消息
    if (messageIndex >= 0 && messageIndex < messages.value.length) {
      messages.value[messageIndex].content = newMessage
    }

    // 删除该消息之后的所有消息
    messages.value = messages.value.slice(0, messageIndex + 1)

    // 创建临时的 AI 消息
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true
    }
    messages.value.push(assistantMessage)
    streamingMessageId.value = assistantMessageId

    try {
      const request: EditAndRetryRequest = {
        conversationId,
        messageIndex: backendIndex,  // 使用计算后的后端索引
        newMessage,
        configId
      }

      await sendToExtension('editAndRetryStream', request)
    } catch (err: any) {
      error.value = {
        code: err.code || 'EDIT_RETRY_ERROR',
        message: err.message || t('composables.useChat.errors.editRetryFailed')
      }
      
      messages.value = messages.value.filter(m => m.id !== assistantMessageId)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 删除到指定消息
   *
   * 注意：前端消息索引和后端历史索引可能不一致
   * 当有工具调用时，后端会有额外的工具响应消息
   *
   * 删除后可能留下孤立的 functionCall（没有对应的 functionResponse），
   * 后端在重试时会自动检测并重新执行这些孤立的函数调用
   */
  async function deleteToMessage(targetIndex: number): Promise<void> {
    if (isLoading.value) return

    try {
      // 计算后端实际需要删除到的索引
      // 遍历前端消息，计算后端历史的实际索引
      let backendIndex = 0
      for (let i = 0; i < targetIndex && i < messages.value.length; i++) {
        const msg = messages.value[i]
        backendIndex++
        
        // 如果是助手消息且包含工具调用，后端还有一条工具响应
        if (msg.role === 'assistant' && msg.parts?.some(p => p.functionCall)) {
          backendIndex++ // 工具响应消息
        }
      }
      
      const request: DeleteMessageRequest = {
        conversationId,
        targetIndex: backendIndex  // 使用计算后的后端索引
      }

      const response = await sendToExtension<{ success: boolean; deletedCount: number }>('deleteMessage', request)
      
      if (response.success) {
        // 删除本地消息
        // 注意：可能会留下孤立的 functionCall，但重试时后端会自动处理
        messages.value = messages.value.slice(0, targetIndex)
      } else {
        throw new Error(t('composables.useChat.errors.deleteFailed'))
      }
    } catch (err: any) {
      error.value = {
        code: err.code || 'DELETE_ERROR',
        message: err.message || t('composables.useChat.errors.deleteFailed')
      }
    }
  }

  /**
   * 处理流式响应
   */
  function handleStreamChunk(chunk: StreamChunk): void {
    if (chunk.type === 'chunk' && chunk.chunk && streamingMessageId.value) {
      // 更新流式消息内容
      const message = messages.value.find(m => m.id === streamingMessageId.value)
      if (message && chunk.chunk.delta) {
        // 从 delta 中提取文本内容
        for (const part of chunk.chunk.delta) {
          if (part.text) {
            message.content += part.text
          }
        }
      }
    } else if (chunk.type === 'complete' && chunk.content) {
      // 流式完成，更新最终内容
      const message = messages.value.find(m => m.id === streamingMessageId.value)
      if (message) {
        const finalMessage = contentToMessage(chunk.content, message.id)
        Object.assign(message, finalMessage)
        message.streaming = false
      }
      
      streamingMessageId.value = null
      isStreaming.value = false
    } else if (chunk.type === 'error') {
      // 流式错误
      error.value = chunk.error || {
        code: 'STREAM_ERROR',
        message: t('composables.useChat.errors.streamError')
      }
      
      // 移除失败的消息
      if (streamingMessageId.value) {
        messages.value = messages.value.filter(m => m.id !== streamingMessageId.value)
        streamingMessageId.value = null
      }
      
      isStreaming.value = false
    }
  }

  /**
   * 清空消息
   */
  function clearMessages(): void {
    messages.value = []
    error.value = null
    streamingMessageId.value = null
  }

  /**
   * 加载历史消息
   */
  async function loadHistory(): Promise<void> {
    try {
      const history = await sendToExtension<Content[]>('getHistory', { conversationId })
      messages.value = history.map(content => contentToMessage(content))
    } catch (err: any) {
      error.value = {
        code: err.code || 'LOAD_ERROR',
        message: err.message || t('composables.useChat.errors.loadHistoryFailed')
      }
    }
  }

  // 监听来自插件的消息
  const disposeStreamChunkListener = onExtensionMessageType('streamChunk', message => {
    if (message.data.conversationId === conversationId) {
      handleStreamChunk(message.data)
    }
  }, 'useChat.streamChunk')

  onBeforeUnmount(() => {
    disposeStreamChunkListener()
  })

  return {
    // 状态
    messages,
    isLoading,
    isStreaming,
    error,
    hasMessages,
    lastMessage,

    // 方法
    sendMessage,
    retryLastMessage,
    editAndRetry,
    deleteToMessage,
    clearMessages,
    loadHistory
  }
}
