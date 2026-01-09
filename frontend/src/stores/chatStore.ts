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
 * 
 * 模块化结构：
 * - state.ts: 状态定义
 * - computed.ts: 计算属性
 * - streamHandler.ts: 流式响应处理
 * - conversationActions.ts: 对话操作
 * - messageActions.ts: 消息操作
 * - toolActions.ts: 工具操作
 * - checkpointActions.ts: 检查点操作
 * - configActions.ts: 配置操作
 * - parsers.ts: 解析器
 * - utils.ts: 工具函数
 */

import { defineStore } from 'pinia'
import type { Attachment, StreamChunk, Message } from '../types'
import { sendToExtension, onMessageFromExtension } from '../utils/vscode'
import { generateId } from '../utils/format'

// 导入模块
import { createChatState } from './chat/state'
import { createChatComputed } from './chat/computed'
import { handleStreamChunk } from './chat/streamHandler'
import { formatTime } from './chat/utils'

import {
  createNewConversation as createNewConvAction,
  loadConversations as loadConvsAction,
  loadHistory,
  loadCheckpoints,
  switchConversation as switchConvAction,
  deleteConversation as deleteConvAction,
  isDeletingConversation,
  updateConversationAfterMessage
} from './chat/conversationActions'

import {
  loadCurrentConfig,
  setConfigId as setConfigIdAction,
  loadSavedConfigId,
  loadCheckpointConfig,
  setMergeUnchangedCheckpoints,
  setCurrentWorkspaceUri,
  setWorkspaceFilter as setWorkspaceFilterAction,
  setInputValue as setInputValueAction,
  clearInputValue as clearInputValueAction,
  handleRetryStatus
} from './chat/configActions'

import {
  getCheckpointsForMessage as getCheckpointsFn,
  hasCheckpoint as hasCheckpointFn,
  addCheckpoint as addCheckpointFn,
  restoreCheckpoint as restoreCheckpointFn,
  restoreAndRetry as restoreAndRetryFn,
  restoreAndDelete as restoreAndDeleteFn,
  restoreAndEdit as restoreAndEditFn,
  summarizeContext as summarizeContextFn
} from './chat/checkpointActions'

import {
  getToolResponseById as getToolResponseByIdFn,
  hasToolResponse as hasToolResponseFn,
  getActualIndex as getActualIndexFn,
  cancelStream as cancelStreamFn,
  cancelStreamAndRejectTools as cancelStreamAndRejectToolsFn,
  rejectPendingToolsWithAnnotation as rejectPendingToolsWithAnnotationFn
} from './chat/toolActions'

import {
  sendMessage as sendMessageFn,
  retryLastMessage as retryLastMessageFn,
  retryFromMessage as retryFromMessageFn,
  retryAfterError as retryAfterErrorFn,
  editAndRetry as editAndRetryFn,
  deleteMessage as deleteMessageFn,
  deleteSingleMessage as deleteSingleMessageFn,
  clearMessages as clearMessagesFn
} from './chat/messageActions'

// 重新导出类型
export type { Conversation, WorkspaceFilter } from './chat/types'

export const useChatStore = defineStore('chat', () => {
  // ============ 状态 ============
  const state = createChatState()
  
  // ============ 计算属性 ============
  const computed = createChatComputed(state)
  
  // ============ 工具操作 ============
  
  const getToolResponseById = (toolCallId: string) => getToolResponseByIdFn(state, toolCallId)
  const hasToolResponse = (toolCallId: string) => hasToolResponseFn(state, toolCallId)
  const getActualIndex = (displayIndex: number) => getActualIndexFn(state, computed, displayIndex)
  
  const cancelStreamAndRejectTools = () => cancelStreamAndRejectToolsFn(state, computed)
  const cancelStream = () => cancelStreamFn(state, computed)
  const rejectPendingToolsWithAnnotation = (annotation: string) => 
    rejectPendingToolsWithAnnotationFn(state, computed, annotation)

  // ============ 消息操作 ============
  
  const sendMessage = (messageText: string, attachments?: Attachment[]) =>
    sendMessageFn(state, computed, messageText, attachments)
  
  const retryLastMessage = () => retryLastMessageFn(state, computed, cancelStream)
  const retryFromMessage = (messageIndex: number) => 
    retryFromMessageFn(state, computed, messageIndex, cancelStream)
  const retryAfterError = () => retryAfterErrorFn(state, computed)
  
  const editAndRetry = (messageIndex: number, newMessage: string, attachments?: Attachment[]) =>
    editAndRetryFn(state, computed, messageIndex, newMessage, attachments, cancelStream)
  
  const deleteMessage = (targetIndex: number) => deleteMessageFn(state, targetIndex, cancelStream)
  const deleteSingleMessage = (targetIndex: number) => deleteSingleMessageFn(state, targetIndex, cancelStream)
  const clearMessages = () => clearMessagesFn(state)

  // ============ 对话操作 ============
  
  const createNewConversation = () => createNewConvAction(state, cancelStreamAndRejectTools)
  const loadConversations = () => loadConvsAction(state)
  const switchConversation = (id: string) => switchConvAction(state, id, cancelStreamAndRejectTools)
  const deleteConversation = (id: string) => deleteConvAction(
    state,
    id,
    switchConversation,
    createNewConversation
  )
  
  // ============ 配置操作 ============
  
  const setConfigId = (newConfigId: string) => setConfigIdAction(state, newConfigId)
  const setWorkspaceFilter = (filter: 'current' | 'all') => setWorkspaceFilterAction(state, filter)
  const setInputValue = (value: string) => setInputValueAction(state, value)
  const clearInputValue = () => clearInputValueAction(state)
  
  // ============ 检查点操作 ============
  
  const getCheckpointsForMessage = (messageIndex: number) => getCheckpointsFn(state, messageIndex)
  const hasCheckpoint = (messageIndex: number) => hasCheckpointFn(state, messageIndex)
  const addCheckpoint = (checkpoint: any) => addCheckpointFn(state, checkpoint)
  const restoreCheckpoint = (checkpointId: string) => restoreCheckpointFn(state, checkpointId)
  const restoreAndRetry = (messageIndex: number, checkpointId: string) =>
    restoreAndRetryFn(state, messageIndex, checkpointId, computed.currentModelName.value, cancelStream)
  const restoreAndDelete = (messageIndex: number, checkpointId: string) =>
    restoreAndDeleteFn(state, messageIndex, checkpointId, cancelStream)
  const restoreAndEdit = (messageIndex: number, newContent: string, attachments: Attachment[] | undefined, checkpointId: string) =>
    restoreAndEditFn(state, messageIndex, newContent, attachments, checkpointId, computed.currentModelName.value, cancelStream)
  const summarizeContext = () => summarizeContextFn(state, () => loadHistory(state))

  // ============ 流式处理 ============
  
  function handleStreamChunkWrapper(chunk: StreamChunk): void {
    handleStreamChunk(chunk, {
      state,
      currentModelName: () => computed.currentModelName.value,
      addCheckpoint,
      updateConversationAfterMessage: () => updateConversationAfterMessage(state)
    })

    // 流式结束/取消/错误时，重置内部发送标记（避免后续 continueWithAnnotation 被误判为重复）
    if (chunk.type === 'complete' || chunk.type === 'cancelled' || chunk.type === 'error') {
      isSendingAnnotation = false
      state.isSendingDiffContinue.value = false
    }

    // diff 确认流程：当后端返回 pendingDiffToolIds 后，如果用户已提前处理完 diff，则自动继续
    if (chunk.type === 'toolIteration' && (chunk as any).needAnnotation) {
      // needAnnotation 的 toolIteration 代表后端已暂停当前流式请求
      // 无论是否由 continueWithAnnotation 触发，都应解除发送锁，允许用户再次继续
      isSendingAnnotation = false
      state.isSendingDiffContinue.value = false

      if (areAllRequiredDiffsProcessed() && !isSendingAnnotation) {
        void continueDiffWithAnnotation(getDiffAnnotation()).catch(console.error)
      }
    }
  }

  // ============ diff 确认/批注流程（旧版兼容） ============

  // 防止 continueWithAnnotation 重复发送（对应旧版 chatStore.ts 的竞态修复）
  let isSendingAnnotation = false

  /** 标记 diff 工具已处理 */
  function markDiffToolProcessed(toolId: string, decision: 'accept' | 'reject'): void {
    state.processedDiffTools.value.set(toolId, decision)
    // 确保响应式更新
    state.processedDiffTools.value = new Map(state.processedDiffTools.value)
  }

  /** diff 工具是否已处理 */
  function isDiffToolProcessed(toolId: string): boolean {
    return state.processedDiffTools.value.has(toolId)
  }

  /** 获取 diff 工具处理结果 */
  function getDiffToolDecision(toolId: string): 'accept' | 'reject' | undefined {
    return state.processedDiffTools.value.get(toolId)
  }

  /** 是否全部待确认的 diff 工具都已处理 */
  function areAllRequiredDiffsProcessed(): boolean {
    if (state.processedDiffTools.value.size === 0) return false
    if (state.pendingDiffToolIds.value.length === 0) return false

    for (const id of state.pendingDiffToolIds.value) {
      if (!state.processedDiffTools.value.has(id)) {
        return false
      }
    }
    return true
  }

  /** 是否仍有未处理的 diff（用于 UI 提示） */
  function hasRemainingRequiredDiffs(): boolean {
    if (state.processedDiffTools.value.size === 0) return false
    if (state.pendingDiffToolIds.value.length === 0) return false

    for (const id of state.pendingDiffToolIds.value) {
      if (!state.processedDiffTools.value.has(id)) {
        return true
      }
    }
    return false
  }

  function setDiffAnnotation(annotation: string): void {
    state.diffAnnotation.value = annotation
  }

  function getDiffAnnotation(): string {
    return state.diffAnnotation.value || ''
  }

  function addHandledDiffId(diffId: string): void {
    state.handledDiffIds.value.add(diffId)
    state.handledDiffIds.value = new Set(state.handledDiffIds.value)
  }

  function isHandledDiffId(diffId: string): boolean {
    return state.handledDiffIds.value.has(diffId)
  }

  function addHandledFilePath(filePath: string, decision: 'accept' | 'reject'): void {
    state.handledFilePaths.value.set(filePath, decision)
    state.handledFilePaths.value = new Map(state.handledFilePaths.value)
  }

  function getHandledFilePathsCount(paths: string[]): number {
    return paths.filter(p => state.handledFilePaths.value.has(p)).length
  }

  function getToolDecisionFromHandledPaths(paths: string[]): 'accept' | 'reject' | undefined {
    if (paths.length === 0) return undefined
    const handledCount = getHandledFilePathsCount(paths)
    if (handledCount < paths.length) return undefined
    return state.handledFilePaths.value.get(paths[0])
  }

  /**
   * diff 确认完成后继续对话（会发送 continueWithAnnotation 流请求）
   */
  async function continueDiffWithAnnotation(annotation: string): Promise<void> {
    if (isSendingAnnotation) return

    const conversationId = state.currentConversationId.value
    const configId = state.configId.value
    if (!conversationId || !configId) return

    // 同时检查 isSendingAnnotation（内部标志）
    isSendingAnnotation = true
    state.isSendingDiffContinue.value = true

    // 不要清空 processedDiffTools：否则 UI 会回退到 pending
    state.error.value = null
    state.isLoading.value = true
    state.pendingDiffToolIds.value = []
    state.toolCallBuffer.value = ''
    state.inToolCall.value = null

    // 合并 pendingAnnotation（工具确认阶段）和 diffAnnotation（diff 阶段）
    const storedAnnotation = state.pendingAnnotation.value
    const newAnnotation = (annotation || '').trim()

    let finalAnnotation = ''
    if (storedAnnotation && newAnnotation) {
      finalAnnotation = `${storedAnnotation}\n${newAnnotation}`
    } else {
      finalAnnotation = storedAnnotation || newAnnotation
    }

    // pendingAnnotation 已在 UI 中展示过，发送后清空
    state.pendingAnnotation.value = ''

    // 更新对话元数据（尽力而为）
    const conv = state.conversations.value.find(c => c.id === conversationId)
    if (conv) {
      conv.updatedAt = Date.now()
      // 如果 newAnnotation 存在且 storedAnnotation 不存在，则会新增一条用户消息 + 一条 assistant 占位消息
      conv.messageCount = state.allMessages.value.length + (newAnnotation && !storedAnnotation ? 2 : 1)
    }

    // 如果这是 diff 阶段新输入的批注，需要在 UI 中追加用户消息
    if (newAnnotation && !storedAnnotation) {
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: newAnnotation,
        timestamp: Date.now(),
        parts: [{ text: newAnnotation }]
      }
      state.allMessages.value.push(userMessage)
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
        modelVersion: computed.currentModelName.value
      }
    }

    state.allMessages.value.push(newAssistantMessage)
    state.streamingMessageId.value = newAssistantMessageId
    state.isStreaming.value = true
    state.isWaitingForResponse.value = true

    try {
      await sendToExtension('continueWithAnnotation', {
        conversationId,
        configId,
        annotation: finalAnnotation
      })
    } catch (err: any) {
      console.error('continueWithAnnotation failed:', err)
      state.error.value = {
        code: 'CONTINUE_WITH_ANNOTATION_ERROR',
        message: err?.message || String(err)
      }
      // 失败时解除锁，允许用户重试
      isSendingAnnotation = false
      state.isSendingDiffContinue.value = false
    } finally {
      state.isLoading.value = false
    }
  }

  // ============ 初始化 ============
  
  async function initialize(): Promise<void> {
    onMessageFromExtension((message) => {
      if (message.type === 'streamChunk') {
        handleStreamChunkWrapper(message.data)
      } else if (message.type === 'workspaceUri') {
        setCurrentWorkspaceUri(state, message.data)
      } else if (message.type === 'retryStatus') {
        handleRetryStatus(state, message.data)
      }
    })
    
    try {
      const uri = await sendToExtension<string | null>('getWorkspaceUri', {})
      setCurrentWorkspaceUri(state, uri)
    } catch {
      // 忽略错误
    }
    
    await loadSavedConfigId(state)
    await loadCurrentConfig(state)
    await loadCheckpointConfig(state)
    await loadConversations()
    
    state.currentConversationId.value = null
    state.allMessages.value = []
  }

  // ============ 返回 ============
  
  return {
    // 状态
    conversations: state.conversations,
    currentConversationId: state.currentConversationId,
    allMessages: state.allMessages,
    messages: computed.messages,
    configId: state.configId,
    currentConfig: state.currentConfig,
    isLoading: state.isLoading,
    isStreaming: state.isStreaming,
    isLoadingConversations: state.isLoadingConversations,
    isWaitingForResponse: state.isWaitingForResponse,
    retryStatus: state.retryStatus,
    error: state.error,

    // diff 确认/批注流程（旧版兼容）
    pendingDiffToolIds: state.pendingDiffToolIds,
    pendingAnnotation: state.pendingAnnotation,
    processedDiffTools: state.processedDiffTools,
    isSendingDiffContinue: state.isSendingDiffContinue,
    handledDiffIds: state.handledDiffIds,
    handledFilePaths: state.handledFilePaths,
    
    // 计算属性
    currentConversation: computed.currentConversation,
    sortedConversations: computed.sortedConversations,
    filteredConversations: computed.filteredConversations,
    hasMessages: computed.hasMessages,
    showEmptyState: computed.showEmptyState,
    currentModelName: computed.currentModelName,
    maxContextTokens: computed.maxContextTokens,
    usedTokens: computed.usedTokens,
    tokenUsagePercent: computed.tokenUsagePercent,
    needsContinueButton: computed.needsContinueButton,
    hasPendingToolConfirmation: computed.hasPendingToolConfirmation,
    pendingToolCalls: computed.pendingToolCalls,

    // 对话管理
    createNewConversation,
    loadConversations,
    switchConversation,
    deleteConversation,
    isDeletingConversation: (id: string) => isDeletingConversation(state, id),
    
    // 消息管理
    loadHistory: () => loadHistory(state),
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
    loadCurrentConfig: () => loadCurrentConfig(state),
    
    // 工具
    formatTime,
    getToolResponseById,
    hasToolResponse,
    getActualIndex,
    
    // 检查点
    checkpoints: state.checkpoints,
    mergeUnchangedCheckpoints: state.mergeUnchangedCheckpoints,
    getCheckpointsForMessage,
    hasCheckpoint,
    loadCheckpoints: () => loadCheckpoints(state),
    loadCheckpointConfig: () => loadCheckpointConfig(state),
    setMergeUnchangedCheckpoints: (value: boolean) => setMergeUnchangedCheckpoints(state, value),
    addCheckpoint,
    restoreCheckpoint,
    restoreAndRetry,
    restoreAndEdit,
    restoreAndDelete,
    
    // 工作区
    currentWorkspaceUri: state.currentWorkspaceUri,
    workspaceFilter: state.workspaceFilter,
    setCurrentWorkspaceUri: (uri: string | null) => setCurrentWorkspaceUri(state, uri),
    setWorkspaceFilter,
    
    // 输入框
    inputValue: state.inputValue,
    setInputValue,
    clearInputValue,

    // diff 确认/批注流程（旧版兼容）
    markDiffToolProcessed,
    isDiffToolProcessed,
    getDiffToolDecision,
    areAllRequiredDiffsProcessed,
    hasRemainingRequiredDiffs,
    setDiffAnnotation,
    getDiffAnnotation,
    continueDiffWithAnnotation,
    addHandledDiffId,
    isHandledDiffId,
    addHandledFilePath,
    getHandledFilePathsCount,
    getToolDecisionFromHandledPaths,
    
    // 上下文总结
    summarizeContext,
    
    // 初始化
    initialize
  }
})
