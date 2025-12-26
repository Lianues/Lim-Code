/**
 * Chat Store - Pinia状态管理
 * 
 * 管理对话和消息状态：
 * - 当前对话ID
 * - 消息列表
 * - 对话列表
 * - 加载/流式状态
 * 
 * 逻辑说明：
 * 1. 打开时创建临时对话（不立即持久化）
 * 2. 用户发送第一条消息时才持久化对话
 * 3. 加载历史对话从后端获取
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { sendToExtension, onMessageFromExtension } from '../utils/vscode'
import { generateId } from '../utils/format'
import { translate } from '../composables/useI18n'
import { useSettingsStore } from './settingsStore'
import type { Message, Content, ErrorInfo, StreamChunk, CheckpointRecord, Attachment } from '../types'

/**
 * 对话摘要
 */
export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  preview?: string
  /** 是否已持久化到后端 */
  isPersisted: boolean
  /** 工作区 URI */
  workspaceUri?: string
}

/**
 * 工作区筛选模式
 */
export type WorkspaceFilter = 'current' | 'all'

/** XML 工具调用开始标记 */
const XML_TOOL_START = '<tool_use>'
/** XML 工具调用结束标记 */
const XML_TOOL_END = '</tool_use>'
/** JSON 工具调用开始标记 */
const JSON_TOOL_START = '<<<TOOL_CALL>>>'
/** JSON 工具调用结束标记 */
const JSON_TOOL_END = '<<<END_TOOL_CALL>>>'

/**
 * 解析 XML 工具调用
 */
function parseXMLToolCall(xmlContent: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const nameMatch = xmlContent.match(/<name>([\s\S]*?)<\/name>/)
    const argsMatch = xmlContent.match(/<args>([\s\S]*?)<\/args>/)
    
    if (nameMatch && argsMatch) {
      return {
        name: nameMatch[1].trim(),
        args: JSON.parse(argsMatch[1].trim())
      }
    }
  } catch {
    // 解析失败
  }
  return null
}

/**
 * 解析 JSON 工具调用
 */
function parseJSONToolCall(jsonContent: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(jsonContent.trim())
    if (parsed.tool && parsed.parameters) {
      return {
        name: parsed.tool,
        args: parsed.parameters
      }
    }
  } catch {
    // 解析失败
  }
  return null
}

export const useChatStore = defineStore('chat', () => {
  // ============ 状态 ============
  
  /** 所有对话列表 */
  const conversations = ref<Conversation[]>([])
  
  /** 当前对话ID */
  const currentConversationId = ref<string | null>(null)
  
  /**
   * 当前对话的所有消息列表（包括 functionResponse 消息）
   *
   * 这是完整的消息列表，与后端索引一一对应
   */
  const allMessages = ref<Message[]>([])
  
  /** 配置ID */
  const configId = ref('gemini-pro')
  
  /** 当前配置详情（包含模型名称） */
  const currentConfig = ref<{
    id: string
    name: string
    model: string
    type: string
    maxContextTokens?: number
  } | null>(null)
  
  /** 加载状态 */
  const isLoading = ref(false)
  
  /** 流式响应状态 */
  const isStreaming = ref(false)
  
  /** 对话列表加载状态 */
  const isLoadingConversations = ref(false)
  
  /** 错误信息 */
  const error = ref<ErrorInfo | null>(null)
  
  /** 当前流式消息ID */
  const streamingMessageId = ref<string | null>(null)
  
  /** 等待AI响应状态 - 用于显示等待动画 */
  const isWaitingForResponse = ref(false)
  
  /** 重试状态 */
  const retryStatus = ref<{
    isRetrying: boolean
    attempt: number
    maxAttempts: number
    error?: string
    errorDetails?: any  // 完整的错误详情（如 API 响应体）
    nextRetryIn?: number
  } | null>(null)
  
  /** 工具调用缓冲区（用于检测流式中的 XML/JSON 工具调用） */
  const toolCallBuffer = ref('')
  
  /** 当前是否在工具调用标记内 */
  const inToolCall = ref<'xml' | 'json' | null>(null)
  
  /** 当前对话的检查点列表 */
  const checkpoints = ref<CheckpointRecord[]>([])
  
  /** 存档点配置：是否合并无变更的存档点 */
  const mergeUnchangedCheckpoints = ref(true)
  
  /** 正在删除的对话 ID 集合（用于防止重复删除） */
  const deletingConversationIds = ref<Set<string>>(new Set())
  
  /** 当前工作区 URI */
  const currentWorkspaceUri = ref<string | null>(null)
  
  /** 输入框内容（跨视图保持） */
  const inputValue = ref('')
  
  /** 工作区筛选模式（默认当前工作区） */
  const workspaceFilter = ref<WorkspaceFilter>('current')

  // ============ 辅助函数 ============
  
  /**
   * 添加 functionCall 到消息
   */
  function addFunctionCallToMessage(
    message: Message,
    call: { 
      id: string; 
      name: string; 
      args: Record<string, unknown>; 
      partialArgs?: string; 
      index?: number 
    }
  ): void {
    // 更新 tools 数组
    if (!message.tools) {
      message.tools = []
    }
    message.tools.push({
      id: call.id,
      name: call.name,
      args: call.args,
      status: 'running'
    })
    
    // 更新 parts（用于渲染）
    if (!message.parts) {
      message.parts = []
    }
    message.parts.push({
      functionCall: {
        id: call.id,
        name: call.name,
        args: call.args,
        partialArgs: call.partialArgs,
        index: call.index
      }
    })
  }
  
  /**
   * 添加文本到消息（合并连续的文本 part）
   */
  function addTextToMessage(message: Message, text: string, isThought: boolean = false): void {
    // 普通文本才累加到 content
    if (!isThought) {
      message.content += text
    }
    
    if (!message.parts) {
      message.parts = []
    }
    
    const lastPart = message.parts[message.parts.length - 1]
    // 只有相同类型（都是思考或都不是思考）才合并
    const lastIsThought = lastPart?.thought === true
    if (lastPart && lastPart.text !== undefined && !lastPart.functionCall && lastIsThought === isThought) {
      lastPart.text += text
    } else {
      message.parts.push(isThought ? { text, thought: true } : { text })
    }
  }
  
  /**
   * 处理流式文本，检测 XML/JSON 工具调用标记
   */
  function processStreamingText(message: Message, text: string): void {
    let remainingText = text
    
    while (remainingText.length > 0) {
      if (inToolCall.value === null) {
        // 不在工具调用中，检测开始标记
        const xmlStartIdx = remainingText.indexOf(XML_TOOL_START)
        const jsonStartIdx = remainingText.indexOf(JSON_TOOL_START)
        
        let startIdx = -1
        let startType: 'xml' | 'json' | null = null
        let startMarker = ''
        
        if (xmlStartIdx !== -1 && (jsonStartIdx === -1 || xmlStartIdx < jsonStartIdx)) {
          startIdx = xmlStartIdx
          startType = 'xml'
          startMarker = XML_TOOL_START
        } else if (jsonStartIdx !== -1) {
          startIdx = jsonStartIdx
          startType = 'json'
          startMarker = JSON_TOOL_START
        }
        
        if (startIdx !== -1 && startType) {
          // 找到开始标记，输出标记前的文本
          const textBefore = remainingText.substring(0, startIdx)
          if (textBefore) {
            addTextToMessage(message, textBefore)
          }
          
          // 进入工具调用状态
          inToolCall.value = startType
          toolCallBuffer.value = startMarker
          remainingText = remainingText.substring(startIdx + startMarker.length)
        } else {
          // 没有找到开始标记，检查是否有部分匹配
          // 为了简化，如果文本末尾可能是开始标记的前缀，暂存
          const possiblePrefixes = [
            XML_TOOL_START.substring(0, Math.min(remainingText.length, XML_TOOL_START.length - 1)),
            JSON_TOOL_START.substring(0, Math.min(remainingText.length, JSON_TOOL_START.length - 1))
          ]
          
          let foundPartial = false
          for (const prefix of possiblePrefixes) {
            if (prefix && remainingText.endsWith(prefix.substring(0, remainingText.length))) {
              // 可能是部分匹配，但为简化处理，直接输出全部文本
              // 完整的部分匹配检测会很复杂
            }
          }
          
          if (!foundPartial) {
            // 输出全部文本
            addTextToMessage(message, remainingText)
            remainingText = ''
          }
        }
      } else {
        // 在工具调用中，查找结束标记
        const endMarker = inToolCall.value === 'xml' ? XML_TOOL_END : JSON_TOOL_END
        toolCallBuffer.value += remainingText
        
        const endIdx = toolCallBuffer.value.indexOf(endMarker)
        if (endIdx !== -1) {
          // 找到结束标记，解析工具调用
          const toolContent = toolCallBuffer.value.substring(
            inToolCall.value === 'xml' ? XML_TOOL_START.length : JSON_TOOL_START.length,
            endIdx
          )
          
          const parsed = inToolCall.value === 'xml'
            ? parseXMLToolCall(toolContent)
            : parseJSONToolCall(toolContent)
          
          if (parsed) {
            // 成功解析，添加 functionCall
            addFunctionCallToMessage(message, {
              id: generateId(),
              name: parsed.name,
              args: parsed.args
            })
          } else {
            // 解析失败，作为普通文本输出
            addTextToMessage(message, toolCallBuffer.value.substring(0, endIdx + endMarker.length))
          }
          
          // 重置状态，处理剩余文本
          const afterEnd = toolCallBuffer.value.substring(endIdx + endMarker.length)
          inToolCall.value = null
          toolCallBuffer.value = ''
          remainingText = afterEnd
        } else {
          // 未找到结束标记，继续累积
          remainingText = ''
        }
      }
    }
  }
  
  /**
   * 完成流式时清理工具调用缓冲区
   */
  function flushToolCallBuffer(message: Message): void {
    if (toolCallBuffer.value) {
      // 如果有未完成的工具调用内容，作为普通文本输出
      addTextToMessage(message, toolCallBuffer.value)
      toolCallBuffer.value = ''
      inToolCall.value = null
    }
  }

  // ============ 计算属性 ============
  
  /** 当前对话 */
  const currentConversation = computed(() => 
    conversations.value.find(c => c.id === currentConversationId.value) || null
  )
  
  /** 排序后的对话列表（按更新时间降序） */
  const sortedConversations = computed(() =>
    [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt)
  )
  
  /** 按工作区筛选后的对话列表 */
  const filteredConversations = computed(() => {
    if (workspaceFilter.value === 'all' || !currentWorkspaceUri.value) {
      return sortedConversations.value
    }
    // 筛选当前工作区的对话
    return sortedConversations.value.filter(c => c.workspaceUri === currentWorkspaceUri.value)
  })
  
  /**
   * 用于显示的消息列表（过滤掉纯 functionResponse 消息）
   */
  const messages = computed(() =>
    allMessages.value.filter(m => !m.isFunctionResponse)
  )
  
  /** 是否有消息 */
  const hasMessages = computed(() => allMessages.value.length > 0)
  
  /** 是否显示空状态 */
  const showEmptyState = computed(() => allMessages.value.length === 0 && !isLoading.value)
  
  /** 当前模型名称（用于显示） */
  const currentModelName = computed(() => currentConfig.value?.model || configId.value)
  
  /** 最大上下文 Tokens（从配置获取） */
  const maxContextTokens = computed(() => currentConfig.value?.maxContextTokens || 128000)
  
  /** 当前使用的 Tokens（从最后一条助手消息获取） */
  const usedTokens = computed(() => {
    // 从后往前找最后一条助手消息
    for (let i = allMessages.value.length - 1; i >= 0; i--) {
      const msg = allMessages.value[i]
      if (msg.role === 'assistant' && msg.metadata?.usageMetadata) {
        return msg.metadata.usageMetadata.totalTokenCount || 0
      }
    }
    return 0
  })
  
  /**
   * 检测是否需要显示"继续对话"按钮
   *
   * 当最后一条消息是 functionResponse（工具执行结果），
   * 且不在流式响应状态、没有错误、没有正在重试时，
   * 说明对话被中断，需要显示继续按钮
   */
  const needsContinueButton = computed(() => {
    if (allMessages.value.length === 0) return false
    if (isStreaming.value || isWaitingForResponse.value) return false
    if (error.value) return false  // 有错误时显示错误面板，不显示继续按钮
    if (retryStatus.value?.isRetrying) return false  // 正在重试
    
    const lastMessage = allMessages.value[allMessages.value.length - 1]
    return lastMessage.isFunctionResponse === true
  })
  
  /** Token 使用百分比 */
  const tokenUsagePercent = computed(() => {
    if (maxContextTokens.value === 0) return 0
    return Math.min(100, (usedTokens.value / maxContextTokens.value) * 100)
  })

  /**
   * 检测是否有待确认的工具调用
   *
   * 当 isWaitingForResponse = true 且 isStreaming = false 时，
   * 检查最后一条助手消息中是否有 status = 'pending' 的工具
   */
  const hasPendingToolConfirmation = computed(() => {
    // 必须在等待响应但不在流式状态
    if (!isWaitingForResponse.value || isStreaming.value) return false

    // 从后往前找最后一条助手消息
    for (let i = allMessages.value.length - 1; i >= 0; i--) {
      const msg = allMessages.value[i]
      if (msg.role === 'assistant' && msg.tools && msg.tools.length > 0) {
        // 检查是否有 pending 状态的工具
        return msg.tools.some(tool => tool.status === 'pending')
      }
    }
    return false
  })

  /**
   * 获取待确认的工具列表
   */
  const pendingToolCalls = computed(() => {
    if (!hasPendingToolConfirmation.value) return []

    // 从后往前找最后一条助手消息
    for (let i = allMessages.value.length - 1; i >= 0; i--) {
      const msg = allMessages.value[i]
      if (msg.role === 'assistant' && msg.tools && msg.tools.length > 0) {
        return msg.tools.filter(tool => tool.status === 'pending')
      }
    }
    return []
  })

  // ============ 工具函数 ============
  
  /**
   * 将 Content 转换为 Message
   */
  function contentToMessage(content: Content, id?: string): Message {
    const textParts = content.parts.filter(p => p.text && !p.thought)
    const text = textParts.map(p => p.text).join('\n')
    
    // 提取工具调用信息
    const toolUsages: import('../types').ToolUsage[] = []
    for (const part of content.parts) {
      if (part.functionCall) {
        toolUsages.push({
          id: part.functionCall.id || generateId(),
          name: part.functionCall.name,
          args: part.functionCall.args,
          status: 'success'  // 已完成的响应
        })
      }
    }
    
    // 确定消息角色：有工具调用时角色仍为 assistant
    const role = content.role === 'model' ? 'assistant' : 'user'
    
    return {
      id: id || generateId(),
      role,
      content: text,
      timestamp: Date.now(),
      parts: content.parts,
      tools: toolUsages.length > 0 ? toolUsages : undefined,
      metadata: {
        // 存储模型版本（仅 model 消息有值）
        modelVersion: content.modelVersion,
        // 存储完整的 usageMetadata（仅 model 消息有值）
        usageMetadata: content.usageMetadata,
        // 计时信息（从后端获取）
        thinkingDuration: content.thinkingDuration,
        responseDuration: content.responseDuration,
        streamDuration: content.streamDuration,
        firstChunkTime: content.firstChunkTime,
        chunkCount: content.chunkCount,
        // 保留向后兼容
        thoughtsTokenCount: content.usageMetadata?.thoughtsTokenCount ?? content.thoughtsTokenCount,
        candidatesTokenCount: content.usageMetadata?.candidatesTokenCount ?? content.candidatesTokenCount
      }
    }
  }
  
  /**
   * 格式化时间
   */
  function formatTime(timestamp: number): string {
    const settingsStore = useSettingsStore()
    const lang = settingsStore.language || 'zh-CN'
    
    const now = Date.now()
    const diff = now - timestamp
    
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    
    if (diff < minute) {
      return translate(lang, 'stores.chatStore.relativeTime.justNow')
    } else if (diff < hour) {
      const minutes = Math.floor(diff / minute)
      return translate(lang, 'stores.chatStore.relativeTime.minutesAgo', { minutes })
    } else if (diff < day) {
      const hours = Math.floor(diff / hour)
      return translate(lang, 'stores.chatStore.relativeTime.hoursAgo', { hours })
    } else if (diff < 7 * day) {
      const days = Math.floor(diff / day)
      return translate(lang, 'stores.chatStore.relativeTime.daysAgo', { days })
    } else {
      return new Date(timestamp).toLocaleDateString()
    }
  }

  // ============ 对话管理 ============
  
  /**
   * 创建新对话（仅清空消息，不创建对话记录）
   *
   * 如果当前有正在进行的请求，会先取消并将工具标记为拒绝
   */
  async function createNewConversation(): Promise<void> {
    // 如果有正在进行的请求，先取消并拒绝工具
    if (isWaitingForResponse.value || isStreaming.value) {
      await cancelStreamAndRejectTools()
    }
    
    currentConversationId.value = null
    allMessages.value = []  // 清空消息
    checkpoints.value = []  // 清空检查点
    error.value = null
    
    // 清除所有加载和流式状态
    isLoading.value = false
    isStreaming.value = false
    streamingMessageId.value = null
    isWaitingForResponse.value = false
  }
  
  /**
   * 创建并持久化新对话到后端
   */
  async function createAndPersistConversation(firstMessage: string): Promise<string | null> {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    // 使用第一句话的前30个字符作为标题
    const title = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? '...' : '')
    
    try {
      // 创建对话时传递工作区 URI
      await sendToExtension('conversation.createConversation', {
        conversationId: id,
        title: title,
        workspaceUri: currentWorkspaceUri.value || undefined
      })
      
      // 添加到对话列表
      const newConversation: Conversation = {
        id,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        isPersisted: true,
        workspaceUri: currentWorkspaceUri.value || undefined
      }
      
      conversations.value.unshift(newConversation)
      currentConversationId.value = id
      
      return id
    } catch (err) {
      console.error('Failed to create conversation:', err)
      return null
    }
  }
  
  /**
   * 加载对话列表
   *
   * 优化：只获取元信息，不加载具体消息内容
   * 消息内容在用户点击对话时才延迟加载
   */
  async function loadConversations(): Promise<void> {
    isLoadingConversations.value = true
    
    try {
      const ids = await sendToExtension<string[]>('conversation.listConversations', {})
      
      const summaries: Conversation[] = []
      for (const id of ids) {
        try {
          // 只获取元信息，不获取消息内容
          const metadata = await sendToExtension<any>('conversation.getConversationMetadata', { conversationId: id })
          
          summaries.push({
            id,
            title: metadata?.title || `Chat ${id.slice(0, 8)}`,
            createdAt: metadata?.createdAt || Date.now(),
            updatedAt: metadata?.updatedAt || metadata?.custom?.updatedAt || Date.now(),
            // 消息数量从元信息获取（如果有），否则显示为 0，切换时再更新
            messageCount: metadata?.custom?.messageCount || 0,
            preview: metadata?.custom?.preview,
            isPersisted: true,  // 从后端加载的都是已持久化的
            workspaceUri: metadata?.workspaceUri
          })
        } catch {
          summaries.push({
            id,
            title: `Chat ${id.slice(0, 8)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
            isPersisted: true
          })
        }
      }
      
      // 保留未持久化的对话
      const unpersistedConvs = conversations.value.filter(c => !c.isPersisted)
      conversations.value = [...unpersistedConvs, ...summaries]
    } catch (err: any) {
      error.value = {
        code: err.code || 'LOAD_ERROR',
        message: err.message || 'Failed to load conversations'
      }
    } finally {
      isLoadingConversations.value = false
    }
  }
  
  /**
   * 切换到指定对话
   *
   * 每次切换都会重新加载对话内容，确保数据最新
   * 如果当前有正在进行的请求，会先取消并将工具标记为拒绝
   */
  async function switchConversation(id: string): Promise<void> {
    // 注意：即使是相同对话也允许重新加载（从历史记录进入时需要刷新）
    const conv = conversations.value.find(c => c.id === id)
    if (!conv) return
    
    // 如果有正在进行的请求，先取消并拒绝工具
    if (isWaitingForResponse.value || isStreaming.value) {
      await cancelStreamAndRejectTools()
    }
    
    // 清除状态
    currentConversationId.value = id
    allMessages.value = []
    checkpoints.value = []
    error.value = null
    isLoading.value = false
    isStreaming.value = false
    streamingMessageId.value = null
    isWaitingForResponse.value = false
    
    // 如果是已持久化的对话，从后端加载历史和检查点
    if (conv.isPersisted) {
      await loadHistory()
      await loadCheckpoints()
      
      // 更新对话的消息数量（在加载后才有准确数据）
      conv.messageCount = allMessages.value.length
    }
  }
  
  /**
   * 检查对话是否正在删除
   */
  function isDeletingConversation(id: string): boolean {
    return deletingConversationIds.value.has(id)
  }
  
  /**
   * 删除对话
   *
   * 使用锁机制防止快速连续删除时的竞态条件
   */
  async function deleteConversation(id: string): Promise<boolean> {
    const conv = conversations.value.find(c => c.id === id)
    if (!conv) return false
    
    // 如果正在删除，跳过
    if (deletingConversationIds.value.has(id)) {
      console.warn(`[chatStore] 对话 ${id} 正在删除中，跳过重复请求`)
      return false
    }
    
    // 标记为正在删除
    deletingConversationIds.value.add(id)
    
    try {
      // 如果是已持久化的，需要从后端删除
      if (conv.isPersisted) {
        await sendToExtension('conversation.deleteConversation', { conversationId: id })
      }
      
      // 后端删除成功后，再从前端移除
      conversations.value = conversations.value.filter(c => c.id !== id)
      
      // 如果删除的是当前对话，切换或创建新对话
      if (currentConversationId.value === id) {
        if (conversations.value.length > 0) {
          await switchConversation(conversations.value[0].id)
        } else {
          createNewConversation()
        }
      }
      
      return true
    } catch (err: any) {
      error.value = {
        code: err.code || 'DELETE_ERROR',
        message: err.message || 'Failed to delete conversation'
      }
      return false
    } finally {
      // 无论成功失败，都移除删除锁
      deletingConversationIds.value.delete(id)
    }
  }

  // ============ 消息管理 ============
  
  /**
   * 检查 Content 是否只包含 functionResponse（工具执行结果）
   */
  function isOnlyFunctionResponse(content: Content): boolean {
    return content.parts.every(p => p.functionResponse !== undefined)
  }
  
  /**
   * 从 MIME 类型获取附件类型
   */
  function getAttachmentTypeFromMime(mimeType: string): 'image' | 'video' | 'audio' | 'document' | 'code' {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType.includes('javascript') || mimeType.includes('json') ||
        mimeType.includes('xml') || mimeType.includes('html') ||
        mimeType.includes('css') || mimeType.includes('typescript')) return 'code'
    return 'document'
  }
  
  /**
   * 从 MIME 类型获取文件扩展名
   */
  function getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'audio/mp3': '.mp3',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/json': '.json'
    }
    return mimeToExt[mimeType] || ''
  }
  
  /**
   * 将 Content 转换为 Message（增强版）
   *
   * 现在不再预先匹配工具响应，而是在显示时通过 getToolResponseMessage 获取
   * 同时会从 inlineData 中提取附件信息
   */
  function contentToMessageEnhanced(content: Content, id?: string): Message {
    const textParts = content.parts.filter(p => p.text && !p.thought)
    const text = textParts.map(p => p.text).join('\n')
    
    // 提取工具调用信息（不预先匹配响应）
    const toolUsages: import('../types').ToolUsage[] = []
    // 提取附件信息（从 inlineData）
    const attachments: Attachment[] = []
    
    for (const part of content.parts) {
      if (part.functionCall) {
        // 检查是否被拒绝（用户在等待确认时点击了终止按钮）
        const isRejected = part.functionCall.rejected === true
        toolUsages.push({
          id: part.functionCall.id || generateId(),
          name: part.functionCall.name,
          args: part.functionCall.args,
          status: isRejected ? 'error' : 'pending'  // 被拒绝的工具显示为 error
        })
      }
      
      // 从 inlineData 提取附件
      if (part.inlineData) {
        const attType = getAttachmentTypeFromMime(part.inlineData.mimeType)
        const ext = getExtensionFromMime(part.inlineData.mimeType)
        
        // 优先使用存储的 id 和 name，否则使用默认值
        const inlineData = part.inlineData as { mimeType: string; data: string; id?: string; name?: string }
        const attId = inlineData.id || generateId()
        const attName = inlineData.name || `attachment${ext || ''}`
        
        // 计算大小（Base64 字符串解码后的大约大小）
        const base64Length = part.inlineData.data.length
        const size = Math.floor(base64Length * 0.75)
        
        // 生成缩略图（对于图片，直接使用 data URL）
        let thumbnail: string | undefined
        if (attType === 'image') {
          thumbnail = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
        }
        
        attachments.push({
          id: attId,
          name: attName,
          type: attType,
          size,
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
          thumbnail
        })
      }
    }
    
    const role = content.role === 'model' ? 'assistant' : 'user'
    // 优先使用后端传递的 isFunctionResponse 标志，否则通过 parts 判断
    // 这样可以正确处理包含多模态附件的函数响应消息
    const isFunctionResponse = content.isFunctionResponse === true || isOnlyFunctionResponse(content)
    
    return {
      id: id || generateId(),
      role,
      content: text,
      // 使用后端存储的时间戳，如果没有则为 0（前端会判断不显示）
      timestamp: content.timestamp || 0,
      parts: content.parts,
      tools: toolUsages.length > 0 ? toolUsages : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      isFunctionResponse,  // 标记是否为纯 functionResponse 消息
      isSummary: content.isSummary,  // 标记是否为总结消息
      summarizedMessageCount: content.summarizedMessageCount,  // 总结消息覆盖的消息数量
      metadata: {
        modelVersion: content.modelVersion,
        usageMetadata: content.usageMetadata,
        // 从后端加载的思考持续时间
        thinkingDuration: content.thinkingDuration,
        // 从后端加载的计时信息
        responseDuration: content.responseDuration,
        firstChunkTime: content.firstChunkTime,
        streamDuration: content.streamDuration,
        chunkCount: content.chunkCount,
        thoughtsTokenCount: content.usageMetadata?.thoughtsTokenCount ?? content.thoughtsTokenCount,
        candidatesTokenCount: content.usageMetadata?.candidatesTokenCount ?? content.candidatesTokenCount
      }
    }
  }
  
  /**
   * 根据工具调用 ID 获取工具响应
   *
   * 后端保证每个 functionCall 都有唯一 id（Gemini 格式会自动生成，OAI 格式使用原有 id）
   * functionResponse 使用相同的 id 与 functionCall 关联
   *
   * @param toolCallId 工具调用的 id
   */
  function getToolResponseById(toolCallId: string): Record<string, unknown> | null {
    // 遍历所有消息，查找匹配的 functionResponse
    for (const message of allMessages.value) {
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
  function hasToolResponse(toolCallId: string): boolean {
    return getToolResponseById(toolCallId) !== null
  }
  
  /**
   * 加载历史消息
   *
   * 存储所有消息，包括 functionResponse 消息
   * 前端索引与后端索引一一对应
   */
  async function loadHistory(): Promise<void> {
    if (!currentConversationId.value) return
    
    try {
      const history = await sendToExtension<Content[]>('conversation.getMessages', {
        conversationId: currentConversationId.value
      })
      
      // 转换所有消息，包括 functionResponse 消息
      const loadedMessages: Message[] = history.map(content =>
        contentToMessageEnhanced(content)
      )
      
      allMessages.value = loadedMessages
    } catch (err: any) {
      error.value = {
        code: err.code || 'LOAD_ERROR',
        message: err.message || 'Failed to load history'
      }
    }
  }
  
  /**
   * 附件数据类型（用于发送到后端）
   */
  interface AttachmentData {
    id: string
    name: string
    type: 'image' | 'video' | 'audio' | 'document' | 'code'
    size: number
    mimeType: string
    data: string
    thumbnail?: string
  }
  
  /**
   * 发送消息
   *
   * @param messageText 消息文本
   * @param attachments 附件列表（可选）
   */
  async function sendMessage(messageText: string, attachments?: Attachment[]): Promise<void> {
    if (!messageText.trim() && (!attachments || attachments.length === 0)) return
    
    // 清除之前的错误状态（如果有）
    error.value = null
    
    // 如果正在等待响应，不允许发送
    if (isWaitingForResponse.value) return
    
    isLoading.value = true
    isStreaming.value = true
    isWaitingForResponse.value = true  // 开始等待
    
    try {
      // 1. 如果没有当前对话，创建新对话
      if (!currentConversationId.value) {
        const newId = await createAndPersistConversation(messageText)
        if (!newId) {
          throw new Error('Failed to create conversation')
        }
      }
      
      // 2. 添加用户消息到本地（包含附件）
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: messageText,
        timestamp: Date.now(),
        attachments: attachments && attachments.length > 0 ? attachments : undefined
      }
      allMessages.value.push(userMessage)
      
      // 3. 创建占位的AI消息（使用当前配置的模型名称）
      const assistantMessageId = generateId()
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
        metadata: {
          modelVersion: currentModelName.value
        }
      }
      allMessages.value.push(assistantMessage)
      streamingMessageId.value = assistantMessageId
      
      // 4. 更新对话信息
      const conv = conversations.value.find(c => c.id === currentConversationId.value)
      if (conv) {
        conv.updatedAt = Date.now()
        conv.messageCount = allMessages.value.length
        conv.preview = messageText.slice(0, 50)
      }
      
      // 5. 重置工具调用缓冲区
      toolCallBuffer.value = ''
      inToolCall.value = null
      
      // 6. 准备附件数据（转换为后端格式）
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
      
      // 7. 发送到后端
      await sendToExtension('chatStream', {
        conversationId: currentConversationId.value,
        configId: configId.value,
        message: messageText,
        attachments: attachmentData
      })
      
      // 流式响应通过消息事件处理
    } catch (err: any) {
      // 消息删除由 handleStreamChunk 的 error 分支统一处理
      // 如果 handleStreamChunk 没有收到 error（极端情况），才清理状态
      if (isStreaming.value) {
        error.value = {
          code: err.code || 'SEND_ERROR',
          message: err.message || 'Failed to send message'
        }
        streamingMessageId.value = null
        isStreaming.value = false
        isWaitingForResponse.value = false
      }
    } finally {
      isLoading.value = false
    }
  }
  
  /**
   * 处理流式响应
   */
  function handleStreamChunk(chunk: StreamChunk): void {
    // 只处理当前对话的流式响应
    if (chunk.conversationId !== currentConversationId.value) {
      return
    }
    
    if (chunk.type === 'chunk' && chunk.chunk && streamingMessageId.value) {
      const message = allMessages.value.find(m => m.id === streamingMessageId.value)
      if (message && chunk.chunk.delta) {
        // 初始化 parts（如果不存在）
        if (!message.parts) {
          message.parts = []
        }
        
        // chunk.chunk 是 BackendStreamChunk，包含 delta 数组
        // delta 是 ContentPart 数组，每个元素可能包含 text 或 functionCall
        for (const part of chunk.chunk.delta) {
          if (part.text) {
            if (part.thought) {
              // 思考内容：直接添加，不检测工具调用
              addTextToMessage(message, part.text, true)
            } else {
              // 普通文本：处理文本，检测 XML/JSON 工具调用标记
              processStreamingText(message, part.text)
            }
          }
          
          // 处理工具调用（原生 function call format）
          if (part.functionCall) {
            const fc = part.functionCall
            const lastPart = message.parts[message.parts.length - 1]
            
            // 尝试合并到最后一个工具调用块
            let merged = false
            if (lastPart && lastPart.functionCall) {
              const lastFc = lastPart.functionCall
              
              // OpenAI 模式：使用 index 匹配，或者如果没有 index 且是增量
              const canMerge = (fc.index !== undefined && lastFc.index === fc.index) ||
                               (fc.index === undefined && !fc.id && fc.partialArgs !== undefined)
              
              if (canMerge) {
                // 合并名称和 ID
                if (fc.name && !lastFc.name) lastFc.name = fc.name
                if (fc.id && !lastFc.id) lastFc.id = fc.id
                
                // 合并参数
                if (fc.partialArgs !== undefined) {
                  lastFc.partialArgs = (lastFc.partialArgs || '') + fc.partialArgs
                  // 尝试更新解析后的 args 用于预览
                  if (lastFc.partialArgs.trim()) {
                    try {
                      lastFc.args = JSON.parse(lastFc.partialArgs)
                    } catch (e) { /* 继续累积 */ }
                  }
                } else if (fc.args && Object.keys(fc.args).length > 0) {
                  lastFc.args = { ...lastFc.args, ...fc.args }
                }
                
                merged = true
              }
            }
            
            if (!merged) {
              // 找不到可合并的，添加新块
              addFunctionCallToMessage(message, {
                id: fc.id || generateId(),
                name: fc.name || '',
                args: fc.args || {},
                partialArgs: fc.partialArgs,
                index: fc.index
              })
            }
          }
        }
        
        // 更新 token 信息和计时信息
        if (!message.metadata) {
          message.metadata = {}
        }
        
        // 如果 chunk 包含 thinkingStartTime，更新 metadata（用于实时显示思考时间）
        if ((chunk.chunk as any).thinkingStartTime) {
          message.metadata.thinkingStartTime = (chunk.chunk as any).thinkingStartTime
        }
        
        // 如果是最后一个 chunk（done=true），更新 token 信息
        // 注意：modelVersion 保持创建时的值，不从 API 响应更新
        if (chunk.chunk.done) {
          if (chunk.chunk.usage) {
            message.metadata.usageMetadata = chunk.chunk.usage
            message.metadata.thoughtsTokenCount = chunk.chunk.usage.thoughtsTokenCount
            message.metadata.candidatesTokenCount = chunk.chunk.usage.candidatesTokenCount
          }
        }
      }
    } else if (chunk.type === 'toolsExecuting') {
      // 工具即将开始执行（不需要确认的工具，或用户已确认的工具）
      // 在工具执行前先更新消息的计时信息，让前端立即显示
      
      // 重要：将 isStreaming 设为 true，这样用户点击取消时会发送取消请求到后端
      // 这解决了用户确认工具后点击取消不生效的问题
      isStreaming.value = true
      
      const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
      
      if (messageIndex !== -1 && chunk.content) {
        const message = allMessages.value[messageIndex]
        // 保存原有的 modelVersion 和 tools
        // 注意：必须保留原始 tools，因为 contentToMessage 会将工具状态设为 success
        const existingModelVersion = message.metadata?.modelVersion
        const existingTools = message.tools
        
        const finalMessage = contentToMessage(chunk.content, message.id)
        
        // 创建更新后的消息对象
        // 注意：使用 existingTools 而不是 finalMessage.tools，因为后者状态是 success
        const updatedMessage: Message = {
          ...message,
          ...finalMessage,
          streaming: false,
          tools: existingTools  // 保留原始 tools，避免被 finalMessage 覆盖
        }
        
        // 恢复原有的 modelVersion，同时保留后端返回的计时信息
        if (updatedMessage.metadata) {
          if (existingModelVersion) {
            updatedMessage.metadata.modelVersion = existingModelVersion
          }
          delete updatedMessage.metadata.thinkingStartTime
        }
        
        // 标记工具为 running 状态
        if (updatedMessage.tools) {
          const pendingIds = new Set((chunk.pendingToolCalls || []).map((t: any) => t.id))
          
          updatedMessage.tools = updatedMessage.tools.map(tool => {
            if (pendingIds.has(tool.id)) {
              return { ...tool, status: 'running' as const }
            }
            return tool
          })
        }
        
        // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
        allMessages.value = [
          ...allMessages.value.slice(0, messageIndex),
          updatedMessage,
          ...allMessages.value.slice(messageIndex + 1)
        ]
      }
      // 注意：不改变 streaming 状态，工具还在执行中
    } else if (chunk.type === 'awaitingConfirmation') {
      // 等待用户确认工具执行
      const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
      if (messageIndex !== -1 && chunk.content) {
        const message = allMessages.value[messageIndex]
        // 保存原有的 modelVersion
        const existingModelVersion = message.metadata?.modelVersion
        
        const finalMessage = contentToMessage(chunk.content, message.id)
        
        // 创建更新后的消息对象
        const updatedMessage: Message = {
          ...message,
          ...finalMessage,
          streaming: false
        }
        
        // 恢复原有的 modelVersion，同时保留后端返回的计时信息
        if (updatedMessage.metadata) {
          // 恢复原有的 modelVersion
          if (existingModelVersion) {
            updatedMessage.metadata.modelVersion = existingModelVersion
          }
          // 确保计时信息从 chunk.content 正确传递
          // contentToMessage 已经从 chunk.content 提取了这些信息
          // 但如果原消息有 thinkingStartTime，需要清除（因为思考已完成）
          delete updatedMessage.metadata.thinkingStartTime
        }
        
        // 标记工具为等待确认状态
        if (updatedMessage.tools) {
          const pendingIds = new Set((chunk.pendingToolCalls || []).map((t: any) => t.id))
          
          // 使用 map 创建新数组
          updatedMessage.tools = updatedMessage.tools.map(tool => {
            if (pendingIds.has(tool.id)) {
              return { ...tool, status: 'pending' as const }
            }
            return tool
          })
        }
        
        // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
        allMessages.value = [
          ...allMessages.value.slice(0, messageIndex),
          updatedMessage,
          ...allMessages.value.slice(messageIndex + 1)
        ]
      }
      
      // 注意：不结束 streaming 状态的等待标志，因为需要等用户确认
      // 但 isStreaming 设为 false 允许用户操作
      isStreaming.value = false
      // isWaitingForResponse 保持 true 或设为特殊状态
    } else if (chunk.type === 'toolIteration' && chunk.content) {
      // 工具迭代完成：当前消息包含工具调用
      const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
      
      // 检查是否有工具被取消或拒绝
      const cancelledToolIds = new Set<string>()
      const rejectedToolIds = new Set<string>()
      if (chunk.toolResults) {
        for (const r of chunk.toolResults) {
          if ((r.result as any).cancelled && r.id) {
            cancelledToolIds.add(r.id)
          }
          if ((r.result as any).rejected && r.id) {
            rejectedToolIds.add(r.id)
          }
        }
      }
      const hasCancelledTools = cancelledToolIds.size > 0
      
      if (messageIndex !== -1) {
        const message = allMessages.value[messageIndex]
        // 保存原有的 tools 信息和 modelVersion
        const existingTools = message.tools
        const existingModelVersion = message.metadata?.modelVersion
        
        const finalMessage = contentToMessage(chunk.content, message.id)
        
        // 恢复原有的 modelVersion，同时保留后端返回的计时信息
        if (finalMessage.metadata) {
          if (existingModelVersion) {
            finalMessage.metadata.modelVersion = existingModelVersion
          }
          // 清除 thinkingStartTime（因为思考已完成，后端已返回 thinkingDuration）
          delete finalMessage.metadata.thinkingStartTime
        }
        
        // 恢复 tools 信息
        let restoredTools = finalMessage.tools
        if (existingTools && (!restoredTools || restoredTools.length === 0)) {
          restoredTools = existingTools
        }
        
        // 更新工具状态：被取消或拒绝的工具标记为 error，其他标记为 success
        if (restoredTools) {
          restoredTools = restoredTools.map(tool => ({
            ...tool,
            status: (cancelledToolIds.has(tool.id) || rejectedToolIds.has(tool.id)) ? 'error' as const : 'success' as const
          }))
        }
        
        // 创建更新后的消息对象（确保 Vue 响应式更新）
        const updatedMessage: Message = {
          ...message,
          ...finalMessage,
          streaming: false,
          tools: restoredTools
        }
        
        // 用新对象替换数组中的旧对象
        allMessages.value = [
          ...allMessages.value.slice(0, messageIndex),
          updatedMessage,
          ...allMessages.value.slice(messageIndex + 1)
        ]
      }
      
      // 添加 functionResponse 消息（标记为隐藏）
      if (chunk.toolResults && chunk.toolResults.length > 0) {
        const responseMessage: Message = {
          id: generateId(),
          role: 'user',
          content: '',
          timestamp: Date.now(),
          isFunctionResponse: true,
          parts: chunk.toolResults.map(r => ({
            functionResponse: {
              name: r.name,
              response: r.result,
              id: r.id
            }
          }))
        }
        allMessages.value.push(responseMessage)
      }
      
      // 处理新创建的检查点
      if (chunk.checkpoints && chunk.checkpoints.length > 0) {
        for (const cp of chunk.checkpoints) {
          addCheckpoint(cp)
        }
      }
      
      // 如果有工具被取消，结束 streaming 状态，不继续后续 AI 响应
      if (hasCancelledTools) {
        streamingMessageId.value = null
        isStreaming.value = false
        isWaitingForResponse.value = false
        return
      }
      
      // 创建新的占位消息用于接收后续 AI 响应
      const newAssistantMessageId = generateId()
      const newAssistantMessage: Message = {
        id: newAssistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
        metadata: {
          modelVersion: currentModelName.value
        }
      }
      allMessages.value.push(newAssistantMessage)
      streamingMessageId.value = newAssistantMessageId
      
      // 确保状态正确设置，这样用户可以在后续 AI 响应期间点击取消按钮
      // 这对于非流式模式尤为重要，因为工具执行完毕后会自动发起新的 AI 请求
      isStreaming.value = true
      isWaitingForResponse.value = true
    } else if (chunk.type === 'complete' && chunk.content) {
      const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
      if (messageIndex !== -1) {
        const message = allMessages.value[messageIndex]
        // 刷新工具调用缓冲区
        flushToolCallBuffer(message)
        // 保存原有的 modelVersion（使用创建时的模型，不从 API 响应更新）
        const existingModelVersion = message.metadata?.modelVersion
        
        const finalMessage = contentToMessage(chunk.content, message.id)
        
        // 恢复原有的 modelVersion
        if (existingModelVersion && finalMessage.metadata) {
          finalMessage.metadata.modelVersion = existingModelVersion
        }
        
        // 创建更新后的消息对象
        const updatedMessage: Message = {
          ...message,
          ...finalMessage,
          streaming: false
        }
        
        // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
        allMessages.value = [
          ...allMessages.value.slice(0, messageIndex),
          updatedMessage,
          ...allMessages.value.slice(messageIndex + 1)
        ]
      }
      
      // 处理新创建的检查点
      if (chunk.checkpoints && chunk.checkpoints.length > 0) {
        for (const cp of chunk.checkpoints) {
          addCheckpoint(cp)
        }
      }
      
      streamingMessageId.value = null
      isStreaming.value = false
      isWaitingForResponse.value = false  // 结束等待
      
      // 流式完成后更新对话元数据
      updateConversationAfterMessage()
    } else if (chunk.type === 'checkpoints') {
      // 立即收到的检查点（用户消息前后、模型消息前）
      if (chunk.checkpoints && chunk.checkpoints.length > 0) {
        for (const cp of chunk.checkpoints) {
          addCheckpoint(cp)
        }
      }
    } else if (chunk.type === 'cancelled') {
      // 用户取消了请求
      // 尝试获取目标消息：优先使用 streamingMessageId，如果已清除则尝试寻找最后一条助手消息
      let messageIndex = -1
      if (streamingMessageId.value) {
        messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
      } else {
        // 兼容性处理：如果 streamingMessageId 已被 cancelStream 清除，则寻找最后一条助手消息
        // 仅当最后一条助手消息处于非流式状态（说明刚被 cancelStream 处理过）时才尝试更新其元数据
        const lastMsgIndex = allMessages.value.length - 1
        const lastMsg = allMessages.value[lastMsgIndex]
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.streaming) {
          messageIndex = lastMsgIndex
        }
      }

      if (messageIndex !== -1) {
        const message = allMessages.value[messageIndex]
        
        // 如果消息为空且没有工具调用，删除它
        // 注意：思考内容只存在于 parts 中，不在 content 中，需要检查 parts
        const hasPartsContent = message.parts && message.parts.some(p => p.text || p.functionCall)
        if (!message.content && !message.tools && !hasPartsContent) {
          allMessages.value = allMessages.value.filter((_, i) => i !== messageIndex)
        } else {
          // 构建新的 metadata 对象
          const newMetadata = message.metadata ? { ...message.metadata } : {}
          
          // 从后端返回的 content 中提取计时信息（后端在取消时也会保存计时信息）
          if (chunk.content) {
            if (chunk.content.thinkingDuration !== undefined) {
              newMetadata.thinkingDuration = chunk.content.thinkingDuration
            }
            if (chunk.content.responseDuration !== undefined) {
              newMetadata.responseDuration = chunk.content.responseDuration
            }
            if (chunk.content.streamDuration !== undefined) {
              newMetadata.streamDuration = chunk.content.streamDuration
            }
            if (chunk.content.firstChunkTime !== undefined) {
              newMetadata.firstChunkTime = chunk.content.firstChunkTime
            }
            if (chunk.content.chunkCount !== undefined) {
              newMetadata.chunkCount = chunk.content.chunkCount
            }
          }
          
          // 更新工具状态
          const updatedTools = message.tools?.map(tool => {
            if (tool.status === 'running' || tool.status === 'pending') {
              return { ...tool, status: 'error' as const }
            }
            return tool
          })
          
          // 创建更新后的消息对象
          const updatedMessage: Message = {
            ...message,
            streaming: false,
            metadata: newMetadata,
            tools: updatedTools
          }
          
          // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
          allMessages.value = [
            ...allMessages.value.slice(0, messageIndex),
            updatedMessage,
            ...allMessages.value.slice(messageIndex + 1)
          ]
        }
      }
      streamingMessageId.value = null
      isStreaming.value = false
      isWaitingForResponse.value = false
    } else if (chunk.type === 'error') {
      error.value = chunk.error || {
        code: 'STREAM_ERROR',
        message: 'Stream error'
      }
      
      if (streamingMessageId.value) {
        // 只删除正在流式处理的空消息
        const messageToRemove = allMessages.value.find(m => m.id === streamingMessageId.value)
        
        // 只删除空的流式消息
        if (messageToRemove && messageToRemove.streaming && !messageToRemove.content && !messageToRemove.tools) {
          allMessages.value = allMessages.value.filter(m => m.id !== streamingMessageId.value)
        }
        streamingMessageId.value = null
      }
      
      isStreaming.value = false
      isWaitingForResponse.value = false  // 结束等待
    }
  }
  
  /**
   * 流式完成后更新对话元数据
   */
  async function updateConversationAfterMessage(): Promise<void> {
    if (!currentConversationId.value) return
    
    const conv = conversations.value.find(c => c.id === currentConversationId.value)
    if (!conv) return
    
    const now = Date.now()
    const messageCount = allMessages.value.length
    
    try {
      // 更新对话的updatedAt时间戳
      await sendToExtension('conversation.setCustomMetadata', {
        conversationId: currentConversationId.value,
        key: 'updatedAt',
        value: now
      })
      
      // 更新消息数量
      await sendToExtension('conversation.setCustomMetadata', {
        conversationId: currentConversationId.value,
        key: 'messageCount',
        value: messageCount
      })
      
      // 如果有消息，更新preview
      if (allMessages.value.length > 0) {
        const lastUserMsg = allMessages.value.filter(m => m.role === 'user' && !m.isFunctionResponse).pop()
        if (lastUserMsg) {
          await sendToExtension('conversation.setCustomMetadata', {
            conversationId: currentConversationId.value,
            key: 'preview',
            value: lastUserMsg.content.slice(0, 50)
          })
          conv.preview = lastUserMsg.content.slice(0, 50)
        }
      }
      
      conv.updatedAt = now
      conv.messageCount = messageCount
    } catch (err) {
      console.error('Failed to update conversation metadata:', err)
    }
  }
  
  /**
   * 重试最后一条消息（保持向后兼容）
   */
  async function retryLastMessage(): Promise<void> {
    if (allMessages.value.length === 0) return
    // 找到最后一条助手消息的索引（在 allMessages 中）
    let lastAssistantIndex = -1
    for (let i = allMessages.value.length - 1; i >= 0; i--) {
      if (allMessages.value[i].role === 'assistant') {
        lastAssistantIndex = i
        break
      }
    }
    if (lastAssistantIndex !== -1) {
      await retryFromMessage(lastAssistantIndex)
    }
  }
  
  /**
   * 清理指定索引及之后的检查点
   */
  function clearCheckpointsFromIndex(fromIndex: number): void {
    checkpoints.value = checkpoints.value.filter(cp => cp.messageIndex < fromIndex)
  }
  
  /**
   * 从指定消息重试（删除该消息及后续，然后重新请求）
   *
   * @param messageIndex allMessages 中的索引（与后端索引一致）
   */
  async function retryFromMessage(messageIndex: number): Promise<void> {
    if (!currentConversationId.value || allMessages.value.length === 0) return
    if (messageIndex < 0 || messageIndex >= allMessages.value.length) return
    
    // 如果正在流式响应，先取消
    if (isStreaming.value) {
      await cancelStream()
    }
    
    error.value = null
    isLoading.value = true
    isStreaming.value = true
    isWaitingForResponse.value = true
    
    // 1. 删除该消息及后续的本地消息和检查点
    allMessages.value = allMessages.value.slice(0, messageIndex)
    clearCheckpointsFromIndex(messageIndex)
    
    // 2. 删除后端的消息（前端索引就是后端索引，后端也会清理检查点）
    try {
      await sendToExtension('deleteMessage', {
        conversationId: currentConversationId.value,
        targetIndex: messageIndex
      })
    } catch (err) {
      console.error('Failed to delete messages from backend:', err)
      // 即使删除失败，也继续尝试重试
    }
    
    // 3. 重置工具调用缓冲区
    toolCallBuffer.value = ''
    inToolCall.value = null
    
    // 4. 创建新的占位消息
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
      metadata: {
        modelVersion: currentModelName.value
      }
    }
    allMessages.value.push(assistantMessage)
    streamingMessageId.value = assistantMessageId
    
    // 5. 调用后端重试
    try {
      await sendToExtension('retryStream', {
        conversationId: currentConversationId.value,
        configId: configId.value
      })
    } catch (err: any) {
      // 消息删除由 handleStreamChunk 的 error 分支统一处理
      // 如果 handleStreamChunk 没有收到 error（极端情况），才清理状态
      if (isStreaming.value) {
        error.value = {
          code: err.code || 'RETRY_ERROR',
          message: err.message || 'Retry failed'
        }
        streamingMessageId.value = null
        isStreaming.value = false
        isWaitingForResponse.value = false
      }
    } finally {
      isLoading.value = false
    }
  }
  
  /**
   * 编辑并重发消息
   *
   * @param messageIndex allMessages 中的索引（与后端索引一致）
   * @param newMessage 新的消息内容
   * @param attachments 附件列表（可选）
   */
  async function editAndRetry(messageIndex: number, newMessage: string, attachments?: Attachment[]): Promise<void> {
    if ((!newMessage.trim() && (!attachments || attachments.length === 0)) || !currentConversationId.value) return
    if (messageIndex < 0 || messageIndex >= allMessages.value.length) return
    
    // 如果正在流式响应，先取消
    if (isStreaming.value) {
      await cancelStream()
    }
    
    error.value = null
    isLoading.value = true
    isStreaming.value = true
    isWaitingForResponse.value = true
    
    // 更新本地消息（同时更新 content、parts 和 attachments）
    const targetMessage = allMessages.value[messageIndex]
    targetMessage.content = newMessage
    // 同步更新 parts（用户消息通常只有一个 text part）
    targetMessage.parts = [{ text: newMessage }]
    targetMessage.attachments = attachments && attachments.length > 0 ? attachments : undefined
    
    // 删除后续消息和检查点（包括该消息自身的检查点，因为消息内容已变化）
    allMessages.value = allMessages.value.slice(0, messageIndex + 1)
    clearCheckpointsFromIndex(messageIndex)
    
    // 重置工具调用缓冲区
    toolCallBuffer.value = ''
    inToolCall.value = null
    
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
      metadata: {
        modelVersion: currentModelName.value
      }
    }
    allMessages.value.push(assistantMessage)
    streamingMessageId.value = assistantMessageId
    
    // 准备附件数据（序列化为纯对象）
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
        conversationId: currentConversationId.value,
        messageIndex,  // 前端索引就是后端索引
        newMessage,
        attachments: attachmentData,
        configId: configId.value
      })
    } catch (err: any) {
      // 消息删除由 handleStreamChunk 的 error 分支统一处理
      // 如果 handleStreamChunk 没有收到 error（极端情况），才清理状态
      if (isStreaming.value) {
        error.value = {
          code: err.code || 'EDIT_RETRY_ERROR',
          message: err.message || 'Edit and retry failed'
        }
        streamingMessageId.value = null
        isStreaming.value = false
        isWaitingForResponse.value = false
      }
    } finally {
      isLoading.value = false
    }
  }
  
  /**
   * 删除消息
   *
   * @param targetIndex allMessages 中的索引（与后端索引一致）
   */
  async function deleteMessage(targetIndex: number): Promise<void> {
    if (!currentConversationId.value) return
    if (targetIndex < 0 || targetIndex >= allMessages.value.length) return
    
    // 如果正在流式响应，先取消
    if (isStreaming.value) {
      await cancelStream()
    }
    
    try {
      const response = await sendToExtension<{ success: boolean; deletedCount: number }>('deleteMessage', {
        conversationId: currentConversationId.value,
        targetIndex  // 前端索引就是后端索引
      })
      
      if (response.success) {
        allMessages.value = allMessages.value.slice(0, targetIndex)
        clearCheckpointsFromIndex(targetIndex)
      }
    } catch (err: any) {
      error.value = {
        code: err.code || 'DELETE_ERROR',
        message: err.message || 'Delete failed'
      }
    }
  }
  
  /**
   * 删除单条消息（不删除后续消息）
   *
   * 用于删除总结消息等特殊消息
   *
   * @param targetIndex allMessages 中的索引
   */
  async function deleteSingleMessage(targetIndex: number): Promise<void> {
    if (!currentConversationId.value) return
    if (targetIndex < 0 || targetIndex >= allMessages.value.length) return
    
    // 如果正在流式响应，先取消
    if (isStreaming.value) {
      await cancelStream()
    }
    
    try {
      const response = await sendToExtension<{ success: boolean }>('deleteSingleMessage', {
        conversationId: currentConversationId.value,
        targetIndex
      })
      
      if (response.success) {
        // 只删除单条消息，不影响后续消息
        allMessages.value = [
          ...allMessages.value.slice(0, targetIndex),
          ...allMessages.value.slice(targetIndex + 1)
        ]
      }
    } catch (err: any) {
      error.value = {
        code: err.code || 'DELETE_ERROR',
        message: err.message || 'Delete failed'
      }
    }
  }
  
  /**
   * 清空当前对话的消息
   */
  function clearMessages(): void {
    allMessages.value = []
    error.value = null
    streamingMessageId.value = null
    isWaitingForResponse.value = false
  }
  
  /**
   * 设置输入框内容
   */
  function setInputValue(value: string): void {
    inputValue.value = value
  }
  
  /**
   * 清空输入框
   */
  function clearInputValue(): void {
    inputValue.value = ''
  }
  
  /**
   * 取消当前流式请求并拒绝正在执行或等待确认的工具
   *
   * 这是内部方法，用于在切换对话或创建新对话时调用
   * 会将 running 和 pending 状态的工具标记为拒绝
   */
  async function cancelStreamAndRejectTools(): Promise<void> {
    if (!currentConversationId.value) return
    
    // 先清除重试状态
    if (retryStatus.value) {
      retryStatus.value = null
    }
    
    // 收集需要拒绝的工具
    if (streamingMessageId.value) {
      const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
      if (messageIndex !== -1) {
        const message = allMessages.value[messageIndex]
        
        // 收集正在执行或等待确认的工具 ID
        const pendingToolIds = message.tools
          ?.filter(tool => tool.status === 'pending' || tool.status === 'running')
          ?.map(tool => tool.id) || []
        
        // 更新工具状态为 error
        const updatedTools = message.tools?.map(tool => {
          if (tool.status === 'pending' || tool.status === 'running') {
            return { ...tool, status: 'error' as const }
          }
          return tool
        })
        
        // 创建更新后的消息对象
        const updatedMessage: Message = {
          ...message,
          streaming: false,
          tools: updatedTools
        }
        
        // 用新对象替换数组中的旧对象
        allMessages.value = [
          ...allMessages.value.slice(0, messageIndex),
          updatedMessage,
          ...allMessages.value.slice(messageIndex + 1)
        ]
        
        // 通知后端将工具标记为拒绝状态（持久化）
        const actualIndex = getActualIndex(messages.value.findIndex(m => m.id === streamingMessageId.value))
        if (actualIndex !== -1 && pendingToolIds.length > 0) {
          try {
            await sendToExtension('conversation.rejectToolCalls', {
              conversationId: currentConversationId.value,
              messageIndex: actualIndex,
              toolCallIds: pendingToolIds
            })
          } catch (err) {
            console.error('Failed to reject tool calls in backend:', err)
          }
        }
      }
    }
    
    // 如果正在流式响应，发送取消请求到后端
    if (isStreaming.value) {
      try {
        await sendToExtension('cancelStream', {
          conversationId: currentConversationId.value
        })
      } catch (err) {
        console.error('Failed to cancel stream:', err)
      }
    }
    
    // 清理状态
    streamingMessageId.value = null
    isStreaming.value = false
    isWaitingForResponse.value = false
  }
  
  /**
   * 取消当前流式请求
   *
   * 处理两种情况：
   * 1. 正在流式响应（isStreaming = true）：发送取消请求到后端
   * 2. 等待工具确认（isStreaming = false, isWaitingForResponse = true）：直接在前端清理状态
   *
   * 取消后会添加一条取消消息通知助手
   * 同时清除重试状态（如果有）
   */
  async function cancelStream(): Promise<void> {
    // 先清除重试状态（即使不在流式中也要清除）
    if (retryStatus.value) {
      retryStatus.value = null
    }
    
    if (!isWaitingForResponse.value || !currentConversationId.value) {
      return
    }
    
    // 情况2：等待工具确认状态（isStreaming = false, isWaitingForResponse = true）
    // 此时后端没有活跃的流（handleChatStream 已经 yield awaitingConfirmation 后返回）
    // 直接在前端清理状态，同时通知后端将工具标记为拒绝
    if (!isStreaming.value) {
      if (streamingMessageId.value) {
        const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
        if (messageIndex !== -1) {
          const message = allMessages.value[messageIndex]
          
          // 收集等待确认的工具 ID
          const pendingToolIds = message.tools
            ?.filter(tool => tool.status === 'pending')
            ?.map(tool => tool.id) || []
          
          // 更新工具状态为 error
          const updatedTools = message.tools?.map(tool => {
            if (tool.status === 'pending') {
              return { ...tool, status: 'error' as const }
            }
            return tool
          })
          
          // 创建更新后的消息对象
          const updatedMessage: Message = {
            ...message,
            streaming: false,
            tools: updatedTools
          }
          
          // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
          allMessages.value = [
            ...allMessages.value.slice(0, messageIndex),
            updatedMessage,
            ...allMessages.value.slice(messageIndex + 1)
          ]
          
          // 通知后端将工具标记为拒绝状态（持久化）
          // 使用 getActualIndex 获取后端索引
          const actualIndex = getActualIndex(messages.value.findIndex(m => m.id === streamingMessageId.value))
          if (actualIndex !== -1 && pendingToolIds.length > 0) {
            try {
              await sendToExtension('conversation.rejectToolCalls', {
                conversationId: currentConversationId.value,
                messageIndex: actualIndex,
                toolCallIds: pendingToolIds
              })
            } catch (err) {
              console.error('Failed to reject tool calls in backend:', err)
              // 即使后端更新失败，前端状态已更新，不影响用户体验
            }
          }
        }
        streamingMessageId.value = null
      }
      
      isWaitingForResponse.value = false
      return
    }
    
    // 情况1：正在流式响应，发送取消请求到后端
    try {
      // 发送取消请求到后端
      await sendToExtension('cancelStream', {
        conversationId: currentConversationId.value
      })
      
      // 主动清理前端状态，不依赖后端的 cancelled chunk
      // 这解决了工具迭代后新 AI 请求阶段取消时，后端可能不发送 cancelled chunk 的问题
      if (streamingMessageId.value) {
        const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
        if (messageIndex !== -1) {
          const message = allMessages.value[messageIndex]
          
          const hasPartsContent = message.parts && message.parts.some(p => p.text || p.functionCall)
          if (!message.content && !message.tools && !hasPartsContent) {
            // 空消息直接删除
            allMessages.value = allMessages.value.filter(m => m.id !== streamingMessageId.value)
          } else {
            // 非空消息更新状态
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
            
            allMessages.value = [
              ...allMessages.value.slice(0, messageIndex),
              updatedMessage,
              ...allMessages.value.slice(messageIndex + 1)
            ]
          }
        }
      }
      isStreaming.value = false
      isWaitingForResponse.value = false
    } catch (err) {
      console.error('取消请求失败:', err)
      // 发送失败时也清理状态
      if (streamingMessageId.value) {
        const message = allMessages.value.find(m => m.id === streamingMessageId.value)
        if (message) {
          message.streaming = false
          const hasPartsContent = message.parts && message.parts.some(p => p.text || p.functionCall)
          if (!message.content && !message.tools && !hasPartsContent) {
            allMessages.value = allMessages.value.filter(m => m.id !== streamingMessageId.value)
          }
        }
        streamingMessageId.value = null
      }
      isStreaming.value = false
      isWaitingForResponse.value = false
    }
  }

  /**
   * 发送带批注的工具确认响应
   *
   * 当用户在有待确认工具时输入内容并发送，会调用此方法：
   * - 所有待确认的工具都会被拒绝
   * - 用户输入的内容作为批注发送给 AI
   * - 在聊天流中显示用户的批注消息
   *
   * @param annotation 用户的批注内容
   */
  async function rejectPendingToolsWithAnnotation(annotation: string): Promise<void> {
    if (!hasPendingToolConfirmation.value || !currentConversationId.value || !currentConfig.value?.id) {
      return
    }

    // 构建拒绝所有待确认工具的响应
    const toolResponses = pendingToolCalls.value.map(tool => ({
      id: tool.id,
      name: tool.name,
      confirmed: false
    }))

    if (toolResponses.length === 0) return

    const trimmedAnnotation = annotation.trim()

    // 更新本地工具状态为 running（表示正在处理）
    if (streamingMessageId.value) {
      const messageIndex = allMessages.value.findIndex(m => m.id === streamingMessageId.value)
      if (messageIndex !== -1) {
        const message = allMessages.value[messageIndex]
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

        allMessages.value = [
          ...allMessages.value.slice(0, messageIndex),
          updatedMessage,
          ...allMessages.value.slice(messageIndex + 1)
        ]
      }
    }

    // 先在聊天流中添加用户的批注消息（确保显示顺序正确：用户消息在前，AI回答在后）
    if (trimmedAnnotation) {
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: trimmedAnnotation,
        timestamp: Date.now(),
        parts: [{ text: trimmedAnnotation }]
      }
      allMessages.value.push(userMessage)
    }

    // 发送到后端（带批注）
    try {
      await sendToExtension('toolConfirmation', {
        conversationId: currentConversationId.value,
        configId: currentConfig.value.id,
        toolResponses,
        annotation: trimmedAnnotation
      })
    } catch (error) {
      console.error('Failed to send tool confirmation with annotation:', error)
    }
  }

  /**
   * 错误后重试（直接调用 retryStream，不删除消息）
   */
  async function retryAfterError(): Promise<void> {
    if (!currentConversationId.value) return
    if (isLoading.value || isStreaming.value) return
    
    error.value = null  // 清除错误
    isLoading.value = true
    isStreaming.value = true
    isWaitingForResponse.value = true
    
    // 重置工具调用缓冲区
    toolCallBuffer.value = ''
    inToolCall.value = null
    
    // 创建新的占位消息
    const assistantMessageId = generateId()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
      metadata: {
        modelVersion: currentModelName.value
      }
    }
    allMessages.value.push(assistantMessage)
    streamingMessageId.value = assistantMessageId
    
    try {
      await sendToExtension('retryStream', {
        conversationId: currentConversationId.value,
        configId: configId.value
      })
    } catch (err: any) {
      if (isStreaming.value) {
        error.value = {
          code: err.code || 'RETRY_ERROR',
          message: err.message || 'Retry failed'
        }
        streamingMessageId.value = null
        isStreaming.value = false
        isWaitingForResponse.value = false
      }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 加载当前配置详情
   */
  async function loadCurrentConfig(): Promise<void> {
    try {
      const config = await sendToExtension<any>('config.getConfig', { configId: configId.value })
      if (config) {
        currentConfig.value = {
          id: config.id,
          name: config.name,
          model: config.model || config.id,
          type: config.type,
          maxContextTokens: config.maxContextTokens
        }
      }
    } catch (err) {
      console.error('Failed to load current config:', err)
    }
  }
  
  /**
   * 切换配置
   *
   * 同时保存到后端持久化存储
   */
  async function setConfigId(newConfigId: string): Promise<void> {
    configId.value = newConfigId
    await loadCurrentConfig()
    
    // 保存到后端
    try {
      await sendToExtension('settings.setActiveChannelId', { channelId: newConfigId })
    } catch (error) {
      console.error('Failed to save active channel ID:', error)
    }
  }
  
  /**
   * 从后端加载保存的配置ID
   */
  async function loadSavedConfigId(): Promise<void> {
    try {
      const response = await sendToExtension<{ channelId?: string }>('settings.getActiveChannelId', {})
      if (response?.channelId) {
        configId.value = response.channelId
      }
    } catch (error) {
      console.error('Failed to load saved config ID:', error)
    }
  }
  
  // ============ 初始化 ============
  
  /**
   * 设置当前工作区 URI
   */
  function setCurrentWorkspaceUri(uri: string | null): void {
    currentWorkspaceUri.value = uri
  }
  
  /**
   * 设置工作区筛选模式
   */
  function setWorkspaceFilter(filter: WorkspaceFilter): void {
    workspaceFilter.value = filter
  }
  
  /**
   * 处理重试状态事件
   */
  function handleRetryStatus(status: {
    type: 'retrying' | 'retrySuccess' | 'retryFailed'
    attempt: number
    maxAttempts: number
    error?: string
    errorDetails?: any
    nextRetryIn?: number
  }): void {
    if (status.type === 'retrying') {
      retryStatus.value = {
        isRetrying: true,
        attempt: status.attempt,
        maxAttempts: status.maxAttempts,
        error: status.error,
        errorDetails: status.errorDetails,
        nextRetryIn: status.nextRetryIn
      }
    } else if (status.type === 'retrySuccess' || status.type === 'retryFailed') {
      // 清除重试状态
      retryStatus.value = null
    }
  }
  
  /**
   * 初始化store
   */
  async function initialize(): Promise<void> {
    // 注册流式消息监听
    onMessageFromExtension((message) => {
      if (message.type === 'streamChunk') {
        handleStreamChunk(message.data)
      } else if (message.type === 'workspaceUri') {
        // 接收后端发来的工作区 URI
        setCurrentWorkspaceUri(message.data)
      } else if (message.type === 'retryStatus') {
        // 处理重试状态
        handleRetryStatus(message.data)
      }
    })
    
    // 请求当前工作区 URI
    try {
      const uri = await sendToExtension<string | null>('getWorkspaceUri', {})
      setCurrentWorkspaceUri(uri)
    } catch {
      // 忽略错误
    }
    
    // 先加载保存的配置ID，再加载配置详情
    await loadSavedConfigId()
    await loadCurrentConfig()
    
    // 加载存档点配置
    await loadCheckpointConfig()
    
    // 加载对话列表
    await loadConversations()
    
    // 不自动切换到对话，显示空白状态，等用户选择或创建新对话
    currentConversationId.value = null
    allMessages.value = []
  }
  
  /**
   * 根据显示索引获取 allMessages 中的真实索引
   */
  function getActualIndex(displayIndex: number): number {
    const displayMessages = messages.value
    if (displayIndex < 0 || displayIndex >= displayMessages.length) {
      return -1
    }
    const targetId = displayMessages[displayIndex].id
    return allMessages.value.findIndex(m => m.id === targetId)
  }
  
  // ============ 检查点管理 ============
  
  /**
   * 根据消息索引获取关联的检查点
   */
  function getCheckpointsForMessage(messageIndex: number): CheckpointRecord[] {
    return checkpoints.value.filter(cp => cp.messageIndex === messageIndex)
  }
  
  /**
   * 检查消息是否有关联的检查点
   */
  function hasCheckpoint(messageIndex: number): boolean {
    return checkpoints.value.some(cp => cp.messageIndex === messageIndex)
  }
  
  /**
   * 加载当前对话的检查点
   */
  async function loadCheckpoints(): Promise<void> {
    if (!currentConversationId.value) {
      checkpoints.value = []
      return
    }
    
    try {
      const result = await sendToExtension<{ checkpoints: CheckpointRecord[] }>('checkpoint.getCheckpoints', {
        conversationId: currentConversationId.value
      })
      
      if (result?.checkpoints) {
        checkpoints.value = result.checkpoints
      } else {
        checkpoints.value = []
      }
    } catch (err) {
      console.error('Failed to load checkpoints:', err)
      checkpoints.value = []
    }
  }
  
  /**
   * 加载存档点配置（合并设置）
   */
  async function loadCheckpointConfig(): Promise<void> {
    try {
      const response = await sendToExtension<{ config: any }>('checkpoint.getConfig', {})
      if (response?.config?.messageCheckpoint) {
        mergeUnchangedCheckpoints.value = response.config.messageCheckpoint.mergeUnchangedCheckpoints ?? true
      }
    } catch (error) {
      console.error('Failed to load checkpoint config:', error)
    }
  }
  
  /**
   * 更新存档点合并设置
   */
  function setMergeUnchangedCheckpoints(value: boolean): void {
    mergeUnchangedCheckpoints.value = value
  }
  
  /**
   * 添加检查点
   */
  function addCheckpoint(checkpoint: CheckpointRecord): void {
    checkpoints.value.push(checkpoint)
  }
  
  /**
   * 恢复到指定检查点
   */
  async function restoreCheckpoint(checkpointId: string): Promise<{ success: boolean; restored: number; deleted?: number; error?: string }> {
    if (!currentConversationId.value) {
      return { success: false, restored: 0, error: 'No conversation selected' }
    }
    
    try {
      const result = await sendToExtension<{ success: boolean; restored: number; deleted?: number; error?: string }>(
        'checkpoint.restore',
        {
          conversationId: currentConversationId.value,
          checkpointId
        }
      )
      
      return result || { success: false, restored: 0, error: 'Unknown error' }
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
   */
  async function restoreAndRetry(messageIndex: number, checkpointId: string): Promise<void> {
    if (!currentConversationId.value || messageIndex < 0 || messageIndex >= allMessages.value.length) {
      return
    }
    
    // 如果正在流式响应，先取消
    if (isStreaming.value) {
      await cancelStream()
    }
    
    error.value = null
    isLoading.value = true
    
    try {
      // 1. 先恢复检查点
      const restoreResult = await restoreCheckpoint(checkpointId)
      if (!restoreResult.success) {
        error.value = {
          code: 'RESTORE_ERROR',
          message: restoreResult.error || '恢复检查点失败'
        }
        isLoading.value = false
        return
      }
      
      // 2. 删除该消息及后续的本地消息和检查点
      allMessages.value = allMessages.value.slice(0, messageIndex)
      clearCheckpointsFromIndex(messageIndex)
      
      // 3. 删除后端的消息
      try {
        await sendToExtension('deleteMessage', {
          conversationId: currentConversationId.value,
          targetIndex: messageIndex
        })
      } catch (err) {
        console.error('Failed to delete messages from backend:', err)
      }
      
      // 4. 重置工具调用缓冲区
      toolCallBuffer.value = ''
      inToolCall.value = null
      
      // 5. 开始流式重试
      isStreaming.value = true
      isWaitingForResponse.value = true
      
      const assistantMessageId = generateId()
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
        metadata: {
          modelVersion: currentModelName.value
        }
      }
      allMessages.value.push(assistantMessage)
      streamingMessageId.value = assistantMessageId
      
      // 6. 调用后端重试
      await sendToExtension('retryStream', {
        conversationId: currentConversationId.value,
        configId: configId.value
      })
      
    } catch (err: any) {
      if (isStreaming.value) {
        error.value = {
          code: err.code || 'RESTORE_RETRY_ERROR',
          message: err.message || '回档并重试失败'
        }
        streamingMessageId.value = null
        isStreaming.value = false
        isWaitingForResponse.value = false
      }
    } finally {
      isLoading.value = false
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
  async function restoreAndDelete(messageIndex: number, checkpointId: string): Promise<void> {
    if (!currentConversationId.value || messageIndex < 0 || messageIndex >= allMessages.value.length) {
      return
    }
    
    // 如果正在流式响应，先取消
    if (isStreaming.value) {
      await cancelStream()
    }
    
    error.value = null
    isLoading.value = true
    
    try {
      // 1. 先恢复检查点
      const restoreResult = await restoreCheckpoint(checkpointId)
      if (!restoreResult.success) {
        error.value = {
          code: 'RESTORE_ERROR',
          message: restoreResult.error || '恢复检查点失败'
        }
        isLoading.value = false
        return
      }
      
      // 2. 删除该消息及后续的本地消息和检查点
      allMessages.value = allMessages.value.slice(0, messageIndex)
      clearCheckpointsFromIndex(messageIndex)
      
      // 3. 删除后端的消息
      try {
        await sendToExtension('deleteMessage', {
          conversationId: currentConversationId.value,
          targetIndex: messageIndex
        })
      } catch (err) {
        console.error('Failed to delete messages from backend:', err)
      }
      
    } catch (err: any) {
      error.value = {
        code: err.code || 'RESTORE_DELETE_ERROR',
        message: err.message || '回档并删除失败'
      }
    } finally {
      isLoading.value = false
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
  async function summarizeContext(): Promise<{
    success: boolean
    summarizedMessageCount?: number
    error?: string
  }> {
    if (!currentConversationId.value) {
      return { success: false, error: 'No conversation selected' }
    }
    
    if (!configId.value) {
      return { success: false, error: 'No config selected' }
    }
    
    try {
      // 只传递必要参数，所有配置项从后端读取
      const result = await sendToExtension<{
        success: boolean
        summaryContent?: Content
        summarizedMessageCount?: number
        error?: { code: string; message: string }
      }>('summarizeContext', {
        conversationId: currentConversationId.value,
        configId: configId.value
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
  
  /**
   * 回档并编辑
   *
   * 先恢复到指定检查点，然后编辑消息并重试
   *
   * @param messageIndex allMessages 中的索引
   * @param newContent 新的消息内容
   * @param attachments 附件列表（可选）
   * @param checkpointId 检查点 ID
   */
  async function restoreAndEdit(messageIndex: number, newContent: string, attachments: Attachment[] | undefined, checkpointId: string): Promise<void> {
    if (!currentConversationId.value || messageIndex < 0 || messageIndex >= allMessages.value.length) {
      return
    }
    
    if (!newContent.trim() && (!attachments || attachments.length === 0)) {
      return
    }
    
    // 如果正在流式响应，先取消
    if (isStreaming.value) {
      await cancelStream()
    }
    
    error.value = null
    isLoading.value = true
    
    try {
      // 1. 先恢复检查点
      const restoreResult = await restoreCheckpoint(checkpointId)
      if (!restoreResult.success) {
        error.value = {
          code: 'RESTORE_ERROR',
          message: restoreResult.error || '恢复检查点失败'
        }
        isLoading.value = false
        return
      }
      
      // 2. 更新本地消息内容和附件
      const targetMessage = allMessages.value[messageIndex]
      targetMessage.content = newContent
      targetMessage.parts = [{ text: newContent }]
      targetMessage.attachments = attachments && attachments.length > 0 ? attachments : undefined
      
      // 3. 删除该消息之后的本地消息和该消息及之后的检查点（因为消息内容已变化）
      allMessages.value = allMessages.value.slice(0, messageIndex + 1)
      clearCheckpointsFromIndex(messageIndex)
      
      // 4. 重置工具调用缓冲区
      toolCallBuffer.value = ''
      inToolCall.value = null
      
      // 5. 开始流式编辑重试
      isStreaming.value = true
      isWaitingForResponse.value = true
      
      const assistantMessageId = generateId()
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
        metadata: {
          modelVersion: currentModelName.value
        }
      }
      allMessages.value.push(assistantMessage)
      streamingMessageId.value = assistantMessageId
      
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
      
      // 6. 调用后端编辑并重试
      await sendToExtension('editAndRetryStream', {
        conversationId: currentConversationId.value,
        messageIndex,
        newMessage: newContent,
        attachments: attachmentData,
        configId: configId.value
      })
      
    } catch (err: any) {
      if (isStreaming.value) {
        error.value = {
          code: err.code || 'RESTORE_EDIT_ERROR',
          message: err.message || '回档并编辑失败'
        }
        streamingMessageId.value = null
        isStreaming.value = false
        isWaitingForResponse.value = false
      }
    } finally {
      isLoading.value = false
    }
  }

  return {
    // 状态
    conversations,
    currentConversationId,
    allMessages,
    messages,  // 计算属性，用于显示
    configId,
    currentConfig,
    isLoading,
    isStreaming,
    isLoadingConversations,
    isWaitingForResponse,
    retryStatus,
    error,
    
    // 计算属性
    currentConversation,
    sortedConversations,
    filteredConversations,
    hasMessages,
    showEmptyState,
    currentModelName,
    maxContextTokens,
    usedTokens,
    tokenUsagePercent,
    needsContinueButton,
    hasPendingToolConfirmation,
    pendingToolCalls,

    // 对话管理
    createNewConversation,
    loadConversations,
    switchConversation,
    deleteConversation,
    isDeletingConversation,
    
    // 消息管理
    loadHistory,
    sendMessage,
    retryLastMessage,
    retryFromMessage,
    retryAfterError,
    cancelStream,
    rejectPendingToolsWithAnnotation,
    editAndRetry,
    deleteMessage,
    deleteSingleMessage,
    clearMessages,
    
    // 配置管理
    setConfigId,
    loadCurrentConfig,
    
    // 工具
    formatTime,
    getToolResponseById,
    hasToolResponse,
    getActualIndex,
    
    // 检查点
    checkpoints,
    mergeUnchangedCheckpoints,
    getCheckpointsForMessage,
    hasCheckpoint,
    loadCheckpoints,
    loadCheckpointConfig,
    setMergeUnchangedCheckpoints,
    addCheckpoint,
    restoreCheckpoint,
    restoreAndRetry,
    restoreAndEdit,
    restoreAndDelete,
    
    // 工作区
    currentWorkspaceUri,
    workspaceFilter,
    setCurrentWorkspaceUri,
    setWorkspaceFilter,
    
    // 输入框
    inputValue,
    setInputValue,
    clearInputValue,
    
    // 上下文总结
    summarizeContext,
    
    // 初始化
    initialize
  }
})