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
import { computed as vueComputed } from 'vue'
import type { Attachment, StreamChunk } from '../types'
import { sendToExtension, onMessageFromExtension } from '../utils/vscode'
import { generateId } from '../utils/format'
import type { EditorNode } from '../types/editorNode'

// 导入模块
import { createChatState } from './chat/state'
import { createChatComputed } from './chat/computed'
import { handleStreamChunk, handleStreamChunkBatch } from './chat/streamHandler'
import { formatTime } from './chat/utils'

import {
  createNewConversation as createNewConvAction,
  loadConversations as loadConvsAction,
  loadMoreConversations as loadMoreConvsAction,
  loadHistory,
  loadOlderMessagesPage as loadOlderMessagesPageAction,
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
  setSelectedModelId as setSelectedModelIdAction,
  setMergeUnchangedCheckpoints,
  setCurrentWorkspaceUri,
  setWorkspaceFilter as setWorkspaceFilterAction,
  setInputValue as setInputValueAction,
  clearInputValue as clearInputValueAction,
  handleRetryStatus,
  setCurrentPromptModeId as setCurrentPromptModeIdAction,
  persistConversationPromptMode
} from './chat/configActions'

import {
  getCheckpointsForMessage as getCheckpointsFn,
  hasCheckpoint as hasCheckpointFn,
  addCheckpoint as addCheckpointFn,
  restoreCheckpoint as restoreCheckpointFn,
  restoreAndRetry as restoreAndRetryFn,
  restoreAndDelete as restoreAndDeleteFn,
  restoreAndEdit as restoreAndEditFn,
  summarizeContext as summarizeContextFn,
  cancelSummarizeRequest as cancelSummarizeRequestFn
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

import type { SendMessageOptions } from './chat/messageActions'
import type { BuildSession, QueuedMessage } from './chat/types'

import {
  createTab as createTabAction,
  closeTab as closeTabAction,
  switchTab as switchTabAction,
  findTabByConversationId,
  updateTabTitle,
  updateTabConversationId,
  reorderTab as reorderTabAction
} from './chat/tabActions'

import type { StreamHandlerContext } from './chat/streamHandler'

// 重新导出类型
export type { Conversation, WorkspaceFilter, TabInfo, QueuedMessage } from './chat/types'

export const useChatStore = defineStore('chat', () => {
  // ============ 状态 ============
  const state = createChatState()
  
  // ============ 计算属性 ============
  const computed = createChatComputed(state)

  /** 是否还有更多历史对话可加载（分页） */
  const hasMoreConversations = vueComputed(
    () => state.persistedConversationsLoaded.value < state.persistedConversationIds.value.length
  )
  
  // ============ 工具操作 ============
  
  const getToolResponseById = (toolCallId: string) => getToolResponseByIdFn(state, toolCallId)
  const hasToolResponse = (toolCallId: string) => hasToolResponseFn(state, toolCallId)
  const getActualIndex = (displayIndex: number) => getActualIndexFn(state, computed, displayIndex)
  
  const cancelStreamAndRejectTools = () => cancelStreamAndRejectToolsFn(state, computed)
  const cancelStream = () => cancelStreamFn(state, computed)
  const rejectPendingToolsWithAnnotation = (annotation: string) => 
    rejectPendingToolsWithAnnotationFn(state, computed, annotation)

  // ============ 消息操作 ============
  
  const sendMessage = (messageText: string, attachments?: Attachment[], options?: SendMessageOptions) =>
    sendMessageFn(state, computed, messageText, attachments, options)
  
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
  
  /**
   * 创建新对话 - 标签页感知
   *
   * 如果当前标签页是空白的（无对话），直接复用；否则创建新标签页
   */
  const createNewConversation = async () => {
    // 如果当前标签页已经是空白的，直接在当前标签页创建
    if (!state.currentConversationId.value && state.allMessages.value.length === 0) {
      await createNewConvAction(state, cancelStreamAndRejectTools)
      return
    }

    // 创建新标签页
    const tabId = createTabAction(state, { title: 'New Chat' })
    if (tabId) {
      // 如果该标签页已存在（重复对话），直接切换
      const existingTab = state.openTabs.value.find(t => t.id === tabId)
      if (existingTab && existingTab.conversationId) {
        switchTabWrapped(tabId)
        return
      }
      switchTabWrapped(tabId)
    }
  }

  const loadConversations = () => loadConvsAction(state)
  const loadMoreConversations = () => loadMoreConvsAction(state)
  const loadOlderMessagesPage = (options?: { pageSize?: number }) => loadOlderMessagesPageAction(state, options)

  /**
   * 切换对话 - 标签页感知
   *
   * 如果对话已在某个标签页中打开，切换到该标签页；
   * 否则在当前标签页中加载该对话
   */
  const switchConversation = async (id: string) => {
    // 检查对话是否已在某个标签页中打开
    const existingTab = findTabByConversationId(state, id)
    if (existingTab) {
      // 直接切换到已打开的标签页
      switchTabWrapped(existingTab.id)
      return
    }

    // 在当前标签页中加载该对话
    await switchConvAction(state, id, cancelStreamAndRejectTools)

    // 更新当前标签页的信息
    if (state.activeTabId.value) {
      updateTabConversationId(state, state.activeTabId.value, id)
      const conv = state.conversations.value.find(c => c.id === id)
      if (conv) {
        updateTabTitle(state, state.activeTabId.value, conv.title)
      }
    }
  }

  const deleteConversation = (id: string) => deleteConvAction(
    state,
    id,
    switchConversation,
    createNewConversation
  )
  
  // ============ 配置操作 ============
  
  const setConfigId = (newConfigId: string) => setConfigIdAction(state, newConfigId)
  const setSelectedModelId = (modelId: string) => setSelectedModelIdAction(state, modelId)
  const setWorkspaceFilter = (filter: 'current' | 'all') => setWorkspaceFilterAction(state, filter)
  const setInputValue = (value: string) => setInputValueAction(state, value)

  const setCurrentPromptModeId = (modeId: string) => setCurrentPromptModeIdAction(state, modeId)
  const clearInputValue = () => clearInputValueAction(state)

  // ============ 编辑器节点（对话级输入状态隔离） ============

  function setEditorNodes(nodes: EditorNode[]) {
    state.editorNodes.value = nodes
  }

  // ============ 附件管理（对话级隔离） ============

  function addStoreAttachment(att: Attachment) {
    state.attachments.value = [...state.attachments.value, att]
  }

  function removeStoreAttachment(id: string) {
    state.attachments.value = state.attachments.value.filter(a => a.id !== id)
  }

  function clearStoreAttachments() {
    state.attachments.value = []
  }

  // ============ 消息队列（候选区） ============

  /**
   * 将消息加入排队队列
   */
  function enqueueMessage(content: string, attachments: Attachment[] = []): void {
    const item: QueuedMessage = {
      id: generateId(),
      content,
      attachments: [...attachments],
      timestamp: Date.now()
    }
    state.messageQueue.value = [...state.messageQueue.value, item]
  }

  /**
   * 取出队列第一条消息
   */
  function dequeueMessage(): QueuedMessage | null {
    const queue = state.messageQueue.value
    if (queue.length === 0) return null
    const first = queue[0]
    state.messageQueue.value = queue.slice(1)
    return first
  }

  /**
   * 移除队列中指定消息
   */
  function removeQueuedMessage(id: string): void {
    state.messageQueue.value = state.messageQueue.value.filter(m => m.id !== id)
  }

  /**
   * 移动队列中的消息（拖拽排序）
   */
  function moveQueuedMessage(fromIndex: number, toIndex: number): void {
    const queue = [...state.messageQueue.value]
    if (fromIndex < 0 || fromIndex >= queue.length) return
    if (toIndex < 0 || toIndex >= queue.length) return
    if (fromIndex === toIndex) return

    const [item] = queue.splice(fromIndex, 1)
    queue.splice(toIndex, 0, item)
    state.messageQueue.value = queue
  }

  /**
   * 更新队列中指定消息的内容和附件（编辑）
   */
  function updateQueuedMessage(id: string, content: string, attachments: Attachment[]): void {
    state.messageQueue.value = state.messageQueue.value.map(m =>
      m.id === id
        ? { ...m, content, attachments: [...attachments] }
        : m
    )
  }

  /**
   * 立即发送队列中指定消息（若 AI 正在响应则先中断）
   */
  async function sendQueuedMessageNow(id: string): Promise<void> {
    const item = state.messageQueue.value.find(m => m.id === id)
    if (!item) return

    // 从队列中移除
    removeQueuedMessage(id)

    // 如果 AI 正在响应，先取消
    if (state.isWaitingForResponse.value) {
      await cancelStream()
    }

    // 发送消息
    await sendMessage(item.content, item.attachments)
  }

  /**
   * 处理队列：AI 响应结束后自动取出下一条消息发送
   *
   * 在 handleComplete / handleCancelled / handleError 中被调用
   */
  async function processQueue(): Promise<void> {
    // 如果仍在响应中，不处理
    if (state.isWaitingForResponse.value) return

    const next = dequeueMessage()
    if (!next) return

    // 发送下一条排队消息
    await sendMessage(next.content, next.attachments)
  }

  // ============ Build（Plan 执行）============

  async function setActiveBuild(
    build: BuildSession | null,
    options?: { persist?: boolean }
  ): Promise<void> {
    const conversationId = state.currentConversationId.value || ''
    const defaultAnchorBackendIndex = state.windowStartIndex.value + state.allMessages.value.length

    const normalizedBuild = build && conversationId
      ? {
          ...build,
          conversationId: build.conversationId || conversationId,
          anchorBackendIndex:
            typeof build.anchorBackendIndex === 'number'
              ? build.anchorBackendIndex
              : defaultAnchorBackendIndex
        }
      : build

    state.activeBuild.value = normalizedBuild

    if (options?.persist === false) return
    if (!conversationId) return

    // 防止把 A 对话的 Build 误写到 B 对话（切换竞态）
    if (normalizedBuild && normalizedBuild.conversationId !== conversationId) {
      return
    }

    try {
      await sendToExtension('conversation.setCustomMetadata', {
        conversationId,
        key: 'activeBuild',
        value: normalizedBuild
      })
    } catch (error) {
      console.error('[chatStore] Failed to persist activeBuild:', error)
    }
  }
  
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
  const cancelSummarizeRequest = () => cancelSummarizeRequestFn(state)

  // ============ 流式处理 ============

  /** 流式处理器上下文（供标签页切换时回放缓冲区使用） */
  const streamHandlerCtx: StreamHandlerContext = {
    state,
    currentModelName: () => computed.currentModelName.value,
    addCheckpoint,
    updateConversationAfterMessage: () => updateConversationAfterMessage(state),
    processQueue
  }
  
  function handleStreamChunkWrapper(chunk: StreamChunk): void {
    handleStreamChunk(chunk, streamHandlerCtx)
  }

  // ============ 标签页操作 ============

  /**
   * 创建新标签页
   */
  function createNewTab(): string | null {
    const tabId = createTabAction(state, { title: 'New Chat' })
    if (tabId) {
      switchTabWrapped(tabId)
    }
    return tabId
  }

  /**
   * 关闭标签页
   */
  function closeTabWrapped(tabId: string): void {
    closeTabAction(state, tabId, cancelStreamAndRejectTools, streamHandlerCtx)
  }

  /**
   * 切换标签页
   */
  function switchTabWrapped(tabId: string): void {
    switchTabAction(state, tabId, cancelStreamAndRejectTools, streamHandlerCtx)
    void loadCurrentConfig(state)
  }

  /**
   * 从历史打开对话（在新标签页或当前空白标签页中）
   */
  async function openConversationInTab(conversationId: string): Promise<void> {
    // 如果已在某个标签页中打开，直接切换
    const existingTab = findTabByConversationId(state, conversationId)
    if (existingTab) {
      switchTabWrapped(existingTab.id)
      return
    }

    // 如果当前标签页是空白的，在当前标签页中加载
    if (!state.currentConversationId.value && state.allMessages.value.length === 0) {
      await switchConversation(conversationId)
      return
    }

    // 创建新标签页并在其中加载对话
    const conv = state.conversations.value.find(c => c.id === conversationId)
    const tabId = createTabAction(state, {
      conversationId,
      title: conv?.title || 'Chat'
    })
    if (tabId) {
      switchTabWrapped(tabId)
      // 切换后需要从后端加载历史
      await switchConvAction(state, conversationId, cancelStreamAndRejectTools)
      // 更新标签页信息
      if (conv) {
        updateTabTitle(state, tabId, conv.title)
      }
    }
  }

  // ============ 初始化 ============
  
  async function initialize(): Promise<void> {
    onMessageFromExtension((message) => {
      if (message.type === 'streamChunk') {
        handleStreamChunkWrapper(message.data)
      } else if (message.type === 'streamChunkBatch') {
        // 批量处理：对连续 toolStatus 做合并优化，其余逐条处理。
        // 整个批量在同一同步上下文完成，Vue 自动合并响应式更新。
        handleStreamChunkBatch(message.data as StreamChunk[], streamHandlerCtx)
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
    state.windowStartIndex.value = 0
    state.totalMessages.value = 0
    state.isLoadingMoreMessages.value = false
    state.historyFolded.value = false
    state.foldedMessageCount.value = 0
    state.toolResponseCache.value = new Map()

    // 初始化标签页：创建第一个空白标签页
    const initialTabId = createTabAction(state, { title: 'New Chat' })
    if (initialTabId) {
      state.activeTabId.value = initialTabId
    }
  }

  // ============ 返回 ============
  
  return {
    // 状态
    conversations: state.conversations,
    currentConversationId: state.currentConversationId,
    allMessages: state.allMessages,
    windowStartIndex: state.windowStartIndex,
    totalMessages: state.totalMessages,
    isLoadingMoreMessages: state.isLoadingMoreMessages,
    historyFolded: state.historyFolded,
    foldedMessageCount: state.foldedMessageCount,
    messages: computed.messages,
    configId: state.configId,
    currentConfig: state.currentConfig,
    selectedModelId: state.selectedModelId,
    isLoading: state.isLoading,
    isStreaming: state.isStreaming,
    isLoadingConversations: state.isLoadingConversations,
    isLoadingMoreConversations: state.isLoadingMoreConversations,
    hasMoreConversations,
    activeStreamId: state.activeStreamId,
    isWaitingForResponse: state.isWaitingForResponse,
    retryStatus: state.retryStatus,
    autoSummaryStatus: state.autoSummaryStatus,
    error: state.error,
    
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
    loadMoreConversations,
    switchConversation,
    deleteConversation,
    isDeletingConversation: (id: string) => isDeletingConversation(state, id),
    
    // 消息管理
    loadHistory: () => loadHistory(state),
    loadOlderMessagesPage,
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
    setSelectedModelId,
    setCurrentPromptModeId,
    
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

    // 编辑器节点 & 附件（对话级隔离）
    editorNodes: state.editorNodes,
    setEditorNodes,
    currentPromptModeId: state.currentPromptModeId,
    persistConversationPromptMode: () => persistConversationPromptMode(state),

    storeAttachments: state.attachments,
    addStoreAttachment,
    removeStoreAttachment,
    clearStoreAttachments,

    // 消息队列（候选区）
    messageQueue: state.messageQueue,
    enqueueMessage,
    dequeueMessage,
    removeQueuedMessage,
    sendQueuedMessageNow,
    moveQueuedMessage,
    updateQueuedMessage,
    processQueue,

    // Build（Plan 执行）
    activeBuild: state.activeBuild,
    setActiveBuild,
    pendingModelOverride: state.pendingModelOverride,
    
    // 上下文总结
    summarizeContext,
    cancelSummarizeRequest,

    // 标签页
    openTabs: state.openTabs,
    activeTabId: state.activeTabId,
    createNewTab,
    closeTab: closeTabWrapped,
    switchTab: switchTabWrapped,
    openConversationInTab,
    reorderTab: (fromIndex: number, toIndex: number) => reorderTabAction(state, fromIndex, toIndex),
    
    // 初始化
    initialize
  }
})
