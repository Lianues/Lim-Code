/**
 * Chat Store 标签页操作
 *
 * 管理多对话标签页的创建、切换、关闭和状态快照/恢复
 */

import type { ChatStoreState, ConversationSessionSnapshot, TabInfo } from './types'
import type { StreamChunk } from '../../types'
import type { StreamHandlerContext } from './streamHandler'
import { handleStreamChunk } from './streamHandler'

/** 最大标签页数量 */
const MAX_TABS = 100

/** 生成标签页 ID */
function generateTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 将当前活跃会话状态快照为一个 ConversationSessionSnapshot
 */
export function snapshotCurrentSession(state: ChatStoreState): ConversationSessionSnapshot {
  return {
    conversationId: state.currentConversationId.value,
    allMessages: [...state.allMessages.value],
    windowStartIndex: state.windowStartIndex.value,
    totalMessages: state.totalMessages.value,
    configId: state.configId.value,
    selectedModelId: state.selectedModelId.value,
    isLoadingMoreMessages: state.isLoadingMoreMessages.value,
    isStreaming: state.isStreaming.value,
    isLoading: state.isLoading.value,
    streamingMessageId: state.streamingMessageId.value,
    activeStreamId: state.activeStreamId.value,
    isWaitingForResponse: state.isWaitingForResponse.value,
    checkpoints: [...state.checkpoints.value],
    activeBuild: state.activeBuild.value ? { ...state.activeBuild.value } : null,
    error: state.error.value ? { ...state.error.value } : null,
    retryStatus: state.retryStatus.value ? { ...state.retryStatus.value } : null,
    autoSummaryStatus: state.autoSummaryStatus.value ? { ...state.autoSummaryStatus.value } : null,
    historyFolded: state.historyFolded.value,
    foldedMessageCount: state.foldedMessageCount.value,
    toolCallBuffer: state.toolCallBuffer.value,
    inToolCall: state.inToolCall.value,
    inputValue: state.inputValue.value,
    pendingModelOverride: state.pendingModelOverride.value,
    editorNodes: [...state.editorNodes.value],
    attachments: [...state.attachments.value],
    messageQueue: [...state.messageQueue.value],
    currentPromptModeId: state.currentPromptModeId.value
  }
}

/**
 * 从快照恢复会话状态到当前活跃 state
 */
export function restoreSessionFromSnapshot(
  state: ChatStoreState,
  snapshot: ConversationSessionSnapshot
): void {
  state.currentConversationId.value = snapshot.conversationId
  state.allMessages.value = [...snapshot.allMessages]
  state.windowStartIndex.value = snapshot.windowStartIndex
  state.totalMessages.value = snapshot.totalMessages
  state.configId.value = snapshot.configId
  state.selectedModelId.value = snapshot.selectedModelId
  state.isLoadingMoreMessages.value = snapshot.isLoadingMoreMessages
  state.isStreaming.value = snapshot.isStreaming
  state.isLoading.value = snapshot.isLoading
  state.streamingMessageId.value = snapshot.streamingMessageId
  state.activeStreamId.value = snapshot.activeStreamId ?? null
  state.isWaitingForResponse.value = snapshot.isWaitingForResponse
  state.checkpoints.value = [...snapshot.checkpoints]
  state.activeBuild.value = snapshot.activeBuild ? { ...snapshot.activeBuild } : null
  state.error.value = snapshot.error ? { ...snapshot.error } : null
  state.retryStatus.value = snapshot.retryStatus ? { ...snapshot.retryStatus } : null
  state.autoSummaryStatus.value = snapshot.autoSummaryStatus ? { ...snapshot.autoSummaryStatus } : null
  state.historyFolded.value = snapshot.historyFolded
  state.foldedMessageCount.value = snapshot.foldedMessageCount
  state.toolCallBuffer.value = snapshot.toolCallBuffer
  state.inToolCall.value = snapshot.inToolCall
  state.inputValue.value = snapshot.inputValue
  state.pendingModelOverride.value = snapshot.pendingModelOverride
  state.editorNodes.value = [...snapshot.editorNodes]
  state.attachments.value = [...snapshot.attachments]
  state.messageQueue.value = [...snapshot.messageQueue]
  state.currentPromptModeId.value = snapshot.currentPromptModeId
}

/**
 * 重置当前会话状态为空白
 */
export function resetConversationState(state: ChatStoreState): void {
  state.currentConversationId.value = null
  state.allMessages.value = []
  state.windowStartIndex.value = 0
  state.totalMessages.value = 0
  state.isLoadingMoreMessages.value = false
  state.toolResponseCache.value = new Map()
  state.isStreaming.value = false
  state.isLoading.value = false
  state.streamingMessageId.value = null
  state.activeStreamId.value = null
  state._lastCancelledStreamId.value = null
  state.isWaitingForResponse.value = false
  state.checkpoints.value = []
  state.activeBuild.value = null
  state.error.value = null
  state.retryStatus.value = null
  state.autoSummaryStatus.value = null
  state.historyFolded.value = false
  state.foldedMessageCount.value = 0
  state.toolCallBuffer.value = ''
  state.inToolCall.value = null
  state.inputValue.value = ''
  state.pendingModelOverride.value = null
  state.selectedModelId.value = state.currentConfig.value?.model || ''
  state.editorNodes.value = []
  state.attachments.value = []
  state.messageQueue.value = []
  state.currentPromptModeId.value = 'code'
}

/**
 * 创建新标签页
 *
 * @returns 新标签页的 ID，如果超过上限则返回 null
 */
export function createTab(
  state: ChatStoreState,
  options?: {
    conversationId?: string | null
    title?: string
    switchTo?: boolean
  }
): string | null {
  // 检查上限
  if (state.openTabs.value.length >= MAX_TABS) {
    console.warn('[tabActions] 标签页数量已达上限', MAX_TABS)
    return null
  }

  const tabId = generateTabId()
  const convId = options?.conversationId ?? null

  // 如果目标对话已在某个标签页中打开，直接切换到那个标签页
  if (convId) {
    const existingTab = state.openTabs.value.find(t => t.conversationId === convId)
    if (existingTab) {
      return existingTab.id
    }
  }

  const tab: TabInfo = {
    id: tabId,
    conversationId: convId,
    title: options?.title || 'New Chat',
    isStreaming: false
  }

  state.openTabs.value = [...state.openTabs.value, tab]

  return tabId
}

/**
 * 关闭标签页
 *
 * 如果关闭的是当前激活的标签页，自动切换到相邻标签页
 */
export function closeTab(
  state: ChatStoreState,
  tabId: string,
  cancelStreamAndRejectTools: () => Promise<void>,
  streamHandlerCtx?: StreamHandlerContext
): void {
  const tabs = state.openTabs.value
  const tabIndex = tabs.findIndex(t => t.id === tabId)
  if (tabIndex === -1) return

  const tab = tabs[tabIndex]

  // 清理该标签页的快照
  state.sessionSnapshots.value.delete(tabId)

  // 清理该标签页对话的流式缓冲区
  if (tab.conversationId) {
    state.backgroundStreamBuffers.value.delete(tab.conversationId)
  }

  // 移除标签页
  const newTabs = tabs.filter(t => t.id !== tabId)
  state.openTabs.value = newTabs

  // 如果关闭的是当前活跃标签页
  if (state.activeTabId.value === tabId) {
    if (newTabs.length > 0) {
      // 切换到相邻标签页（优先右边，否则左边）
      const nextIndex = Math.min(tabIndex, newTabs.length - 1)
      const nextTab = newTabs[nextIndex]
      switchTab(state, nextTab.id, cancelStreamAndRejectTools, streamHandlerCtx)
    } else {
      // 没有剩余标签页，创建一个新的
      const newTabId = createTab(state, { title: 'New Chat', switchTo: false })
      if (newTabId) {
        resetConversationState(state)
        state.activeTabId.value = newTabId
      }
    }
  }
}

/**
 * 切换到指定标签页
 *
 * 快照当前活跃标签页的状态 -> 恢复目标标签页状态 -> 应用缓冲的流式数据
 */
export function switchTab(
  state: ChatStoreState,
  targetTabId: string,
  _cancelStreamAndRejectTools: () => Promise<void>,
  streamHandlerCtx?: StreamHandlerContext
): void {
  const currentTabId = state.activeTabId.value
  if (currentTabId === targetTabId) return

  // 确认目标标签页存在
  const targetTab = state.openTabs.value.find(t => t.id === targetTabId)
  if (!targetTab) return

  // 1. 快照当前活跃标签页的状态
  if (currentTabId) {
    // 更新当前标签页的 conversationId（可能已通过发送消息创建了新对话）
    const currentTab = state.openTabs.value.find(t => t.id === currentTabId)
    if (currentTab) {
      currentTab.conversationId = state.currentConversationId.value
      currentTab.isStreaming = state.isStreaming.value
      // 更新标题
      const conv = state.conversations.value.find(c => c.id === state.currentConversationId.value)
      if (conv) {
        currentTab.title = conv.title
      }
    }

    const snapshot = snapshotCurrentSession(state)
    state.sessionSnapshots.value.set(currentTabId, snapshot)
  }

  // 2. 恢复目标标签页状态
  const targetSnapshot = state.sessionSnapshots.value.get(targetTabId)
  if (targetSnapshot) {
    restoreSessionFromSnapshot(state, targetSnapshot)
    state.sessionSnapshots.value.delete(targetTabId)
  } else {
    // 新标签页 - 重置为空白状态
    resetConversationState(state)
    // 如果标签页关联了 conversationId 但没有快照，这意味着尚未加载
    if (targetTab.conversationId) {
      state.currentConversationId.value = targetTab.conversationId
    }
  }

  // 3. 应用缓冲的后台流式数据
  const convId = state.currentConversationId.value
  if (convId && streamHandlerCtx && state.backgroundStreamBuffers.value.has(convId)) {
    const buffered = state.backgroundStreamBuffers.value.get(convId)!
    state.backgroundStreamBuffers.value.delete(convId)
    for (const chunk of buffered) {
      handleStreamChunk(chunk, streamHandlerCtx)
    }
  }

  // 4. 更新激活标签页 ID
  state.activeTabId.value = targetTabId
}

/**
 * 将流式 chunk 缓冲到后台对话的缓冲区
 */
export function bufferBackgroundChunk(
  state: ChatStoreState,
  chunk: StreamChunk
): void {
  const convId = chunk.conversationId
  if (!convId) return

  const buffers = state.backgroundStreamBuffers.value
  if (!buffers.has(convId)) {
    buffers.set(convId, [])
  }

  // 同时更新对应快照中的流式状态
  // 找到该 conversationId 对应的标签页
  const tab = state.openTabs.value.find(t => t.conversationId === convId)
  if (!tab) {
    buffers.get(convId)!.push(chunk)
    return
  }

  const snapshot = state.sessionSnapshots.value.get(tab.id)

  // 若快照已绑定 activeStreamId，则过滤掉旧流的迟到 chunk
  if (
    snapshot?.activeStreamId &&
    chunk.streamId &&
    chunk.streamId !== snapshot.activeStreamId
  ) {
    return
  }

  // 快照当前并不处于等待/流式阶段时，收到带 streamId 的 chunk 视为迟到包，直接忽略。
  if (
    snapshot &&
    !snapshot.activeStreamId &&
    chunk.streamId &&
    !snapshot.isWaitingForResponse &&
    !snapshot.isStreaming
  ) {
    return
  }

  // 快照尚未绑定时，首次收到带 streamId 的 chunk 即建立绑定
  if (snapshot && !snapshot.activeStreamId && chunk.streamId) {
    snapshot.activeStreamId = chunk.streamId
  }

  buffers.get(convId)!.push(chunk)

  if (snapshot) {
    switch (chunk.type) {
      case 'complete':
      case 'error':
      case 'cancelled':
        snapshot.isStreaming = false
        snapshot.isWaitingForResponse = false
        snapshot.activeStreamId = null
        break
      case 'awaitingConfirmation':
        snapshot.isStreaming = false
        snapshot.isWaitingForResponse = true
        snapshot.activeStreamId = null
        break
      case 'chunk':
      case 'toolsExecuting':
      case 'toolStatus':
      case 'toolIteration':
        snapshot.isStreaming = true
        snapshot.isWaitingForResponse = true
        break
      default:
        break
    }
  }
}

/**
 * 更新标签页的流式状态指示器
 */
export function updateTabStreamingStatus(
  state: ChatStoreState,
  chunk: StreamChunk
): void {
  const convId = chunk.conversationId
  if (!convId) return

  const tab = state.openTabs.value.find(t => t.conversationId === convId)
  if (!tab) return

  // 根据“当前会话状态 / 后台快照状态”过滤旧流的迟到 chunk，避免标签页状态闪回。
  const expectedStreamId = convId === state.currentConversationId.value
    ? state.activeStreamId.value
    : state.sessionSnapshots.value.get(tab.id)?.activeStreamId || null

  // 没有预期 streamId 时，不接收带 streamId 的 chunk（通常是迟到包）
  if (chunk.streamId && !expectedStreamId) {
    return
  }

  if (
    expectedStreamId &&
    chunk.streamId &&
    chunk.streamId !== expectedStreamId
  ) {
    return
  }

  switch (chunk.type) {
    // 明确结束流式状态
    case 'complete':
    case 'error':
    case 'cancelled':
    case 'awaitingConfirmation':
      tab.isStreaming = false
      break

    // 明确处于流式/工具执行推进中
    case 'chunk':
    case 'toolsExecuting':
    case 'toolStatus':
    case 'toolIteration':
      tab.isStreaming = true
      break

    // 与主响应流无关的信号（如 checkpoints / autoSummaryStatus / autoSummary）
    // 不应覆盖标签页当前流式状态，避免“已完成后又被重置为加载中”的竞态。
    default:
      break
  }
}

/**
 * 通过 conversationId 查找已打开的标签页
 */
export function findTabByConversationId(
  state: ChatStoreState,
  conversationId: string
): TabInfo | undefined {
  return state.openTabs.value.find(t => t.conversationId === conversationId)
}

/**
 * 更新标签页标题
 */
export function updateTabTitle(
  state: ChatStoreState,
  tabId: string,
  title: string
): void {
  const tab = state.openTabs.value.find(t => t.id === tabId)
  if (tab) {
    tab.title = title
  }
}

/**
 * 更新标签页关联的 conversationId（创建新对话后更新）
 */
export function updateTabConversationId(
  state: ChatStoreState,
  tabId: string,
  conversationId: string
): void {
  const tab = state.openTabs.value.find(t => t.id === tabId)
  if (tab) {
    tab.conversationId = conversationId
  }
}

/**
 * 重新排列标签页顺序（拖拽排序）
 *
 * 将 fromIndex 处的标签页移动到 toIndex 位置
 */
export function reorderTab(
  state: ChatStoreState,
  fromIndex: number,
  toIndex: number
): void {
  const tabs = [...state.openTabs.value]
  if (
    fromIndex < 0 || fromIndex >= tabs.length ||
    toIndex < 0 || toIndex >= tabs.length ||
    fromIndex === toIndex
  ) {
    return
  }

  const [moved] = tabs.splice(fromIndex, 1)
  tabs.splice(toIndex, 0, moved)
  state.openTabs.value = tabs
}
