/**
 * Chat Store 对话操作
 * 
 * 包含对话的 CRUD 操作
 */

import type { ChatStoreState, Conversation, CheckpointRecord, BuildSession } from './types'
import { sendToExtension } from '../../utils/vscode'
import { contentToMessageEnhanced } from './parsers'
import type { Content } from '../../types'
import { perfLog, perfMeasureAsync } from '../../utils/perf'
import { trimWindowFromTop, syncTotalMessagesFromWindow } from './windowUtils'

// ============ 对话列表分页加载配置 ============

/** 每次分页加载的对话数量 */
export const CONVERSATIONS_PAGE_SIZE = 30

/** 当前对话消息分页大小（窗口初始加载 / 上拉加载） */
export const MESSAGES_PAGE_SIZE = 120

/** 拉取元数据时的并发数（避免一次性打爆 IPC / IO） */
const METADATA_FETCH_CONCURRENCY = 30

function parseConversationIdTimestamp(id: string): number | null {
  // 默认创建 ID: conv_${Date.now()}_${random}
  const m = /^conv_(\d+)_/.exec(id)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function sortConversationIds(ids: string[]): string[] {
  // 尽量把“看起来较新的”对话排在前面：
  // 1) conv_{timestamp}_xxx 按 timestamp 倒序
  // 2) 其他按字符串倒序（尽量稳定）
  return [...ids].sort((a, b) => {
    const ta = parseConversationIdTimestamp(a)
    const tb = parseConversationIdTimestamp(b)
    if (ta != null && tb != null) return tb - ta
    if (ta != null) return -1
    if (tb != null) return 1
    return b.localeCompare(a)
  })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * 取消流式并拒绝工具的回调类型
 */
export type CancelStreamAndRejectToolsCallback = () => Promise<void>

function parsePersistedBuildSession(raw: any, conversationId: string): BuildSession | null {
  if (!raw || typeof raw !== 'object') return null

  const id = typeof raw.id === 'string' ? raw.id : ''
  const title = typeof raw.title === 'string' ? raw.title : ''
  const planContent = typeof raw.planContent === 'string' ? raw.planContent : ''
  const startedAt = typeof raw.startedAt === 'number' ? raw.startedAt : 0
  const status: BuildSession['status'] = raw.status === 'running' ? 'running' : 'done'

  if (!id || !title || !planContent || !startedAt) return null

  return {
    id,
    conversationId,
    title,
    planContent,
    planPath: typeof raw.planPath === 'string' ? raw.planPath : undefined,
    channelId: typeof raw.channelId === 'string' ? raw.channelId : undefined,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : undefined,
    startedAt,
    status
  }
}

async function loadConversationBuildSession(conversationId: string): Promise<BuildSession | null> {
  try {
    const metadata = await sendToExtension<any>('conversation.getConversationMetadata', {
      conversationId
    })
    return parsePersistedBuildSession(metadata?.custom?.activeBuild, conversationId)
  } catch (error) {
    console.error('[conversationActions] Failed to load activeBuild from metadata:', error)
    return null
  }
}

/**
 * 创建新对话（仅清空消息，不创建对话记录）
 *
 * 如果当前有正在进行的请求，会先取消并将工具标记为拒绝
 */
export async function createNewConversation(
  state: ChatStoreState,
  cancelStreamAndRejectTools: CancelStreamAndRejectToolsCallback
): Promise<void> {
  // 如果有正在进行的请求，先取消并拒绝工具
  if (state.isWaitingForResponse.value || state.isStreaming.value) {
    await cancelStreamAndRejectTools()
  }
  
  state.currentConversationId.value = null
  state.allMessages.value = []  // 清空消息
  state.windowStartIndex.value = 0
  state.totalMessages.value = 0
  state.isLoadingMoreMessages.value = false
  state.historyFolded.value = false
  state.foldedMessageCount.value = 0
  state.checkpoints.value = []  // 清空检查点
  state.error.value = null
  state.activeBuild.value = null
  
  // 清除所有加载和流式状态
  state.isLoading.value = false
  state.isStreaming.value = false
  state.streamingMessageId.value = null
  state.isWaitingForResponse.value = false
}

/**
 * 创建并持久化新对话到后端
 */
export async function createAndPersistConversation(
  state: ChatStoreState,
  firstMessage: string
): Promise<string | null> {
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  
  // 使用第一句话的前30个字符作为标题
  const title = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? '...' : '')
  
  try {
    // 创建对话时传递工作区 URI
    await sendToExtension('conversation.createConversation', {
      conversationId: id,
      title: title,
      workspaceUri: state.currentWorkspaceUri.value || undefined
    })
    
    // 添加到对话列表
    const newConversation: Conversation = {
      id,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      isPersisted: true,
      workspaceUri: state.currentWorkspaceUri.value || undefined
    }
    
    state.conversations.value.unshift(newConversation)
    state.currentConversationId.value = id

    // 同步分页列表（避免后续滚动加载重复 / 丢失）
    if (!state.persistedConversationIds.value.includes(id)) {
      state.persistedConversationIds.value.unshift(id)
      state.persistedConversationsLoaded.value += 1
    }
    
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
export async function loadConversations(state: ChatStoreState): Promise<void> {
  state.isLoadingConversations.value = true

  try {
    // 仅获取全部 ID（一次请求），实际元数据采用分页加载
    const ids = await sendToExtension<string[]>('conversation.listConversations', {})

    // 重置分页游标
    state.persistedConversationIds.value = sortConversationIds(ids)
    state.persistedConversationsLoaded.value = 0

    // 保留未持久化的对话
    const unpersistedConvs = state.conversations.value.filter(c => !c.isPersisted)
    state.conversations.value = [...unpersistedConvs]

    // 加载第一页
    await loadMoreConversations(state, { initial: true })
  } catch (err: any) {
    state.error.value = {
      code: err.code || 'LOAD_ERROR',
      message: err.message || 'Failed to load conversations'
    }
  } finally {
    state.isLoadingConversations.value = false
  }
}

/**
 * 分页加载更多对话（只加载元数据）
 *
 * - 初始加载：由 loadConversations 调用（initial=true），不占用底部加载状态
 * - 滚动加载：initial=false，会设置 isLoadingMoreConversations
 */
export async function loadMoreConversations(
  state: ChatStoreState,
  options: { pageSize?: number; initial?: boolean } = {}
): Promise<void> {
  const pageSize = options.pageSize ?? CONVERSATIONS_PAGE_SIZE
  const initial = options.initial ?? false

  if (!initial && state.isLoadingMoreConversations.value) return

  const allIds = state.persistedConversationIds.value
  const cursor = state.persistedConversationsLoaded.value
  if (cursor >= allIds.length) return

  const idsToLoad = allIds.slice(cursor, cursor + pageSize)
  if (idsToLoad.length === 0) return

  if (!initial) state.isLoadingMoreConversations.value = true

  try {
    const summaries = await mapWithConcurrency(
      idsToLoad,
      METADATA_FETCH_CONCURRENCY,
      async (id) => {
        try {
          // 只获取元信息，不获取消息内容
          const metadata = await sendToExtension<any>('conversation.getConversationMetadata', { conversationId: id })

          return {
            id,
            title: metadata?.title || `Chat ${id.slice(0, 8)}`,
            createdAt: metadata?.createdAt || Date.now(),
            updatedAt: metadata?.updatedAt || metadata?.custom?.updatedAt || Date.now(),
            // 消息数量从元信息获取（如果有），否则显示为 0，切换时再更新
            messageCount: metadata?.custom?.messageCount || 0,
            preview: metadata?.custom?.preview,
            isPersisted: true,
            workspaceUri: metadata?.workspaceUri
          } as Conversation
        } catch {
          return {
            id,
            title: `Chat ${id.slice(0, 8)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
            isPersisted: true
          } as Conversation
        }
      }
    )

    state.persistedConversationsLoaded.value = cursor + idsToLoad.length

    // 合并到现有列表（避免重复）
    const unpersisted = state.conversations.value.filter(c => !c.isPersisted)
    const persistedExisting = state.conversations.value.filter(c => c.isPersisted)
    const map = new Map<string, Conversation>()
    for (const c of persistedExisting) map.set(c.id, c)
    for (const c of summaries) map.set(c.id, c)

    state.conversations.value = [...unpersisted, ...Array.from(map.values())]
  } finally {
    if (!initial) state.isLoadingMoreConversations.value = false
  }
}

/**
 * 加载历史消息
 *
 * 存储所有消息，包括 functionResponse 消息
 * 前端索引与后端索引一一对应
 */
export async function loadHistory(state: ChatStoreState): Promise<void> {
  if (!state.currentConversationId.value) return
  
  try {
    // 重置折叠提示（重新加载最后一页）
    state.historyFolded.value = false
    state.foldedMessageCount.value = 0

    const result = await perfMeasureAsync('conversation.loadHistoryPaged', () =>
      sendToExtension<{ total: number; messages: Content[] }>('conversation.getMessagesPaged', {
        conversationId: state.currentConversationId.value,
        limit: MESSAGES_PAGE_SIZE
      })
    )

    const page = result?.messages || []
    state.totalMessages.value = result?.total ?? page.length

    // 转换所有消息，包括 functionResponse 消息
    state.allMessages.value = page.map(content => contentToMessageEnhanced(content))
    state.windowStartIndex.value = page[0]?.index ?? 0
    syncTotalMessagesFromWindow(state)

    perfLog('conversation.window', {
      start: state.windowStartIndex.value,
      count: state.allMessages.value.length,
      total: state.totalMessages.value
    })
  } catch (err: any) {
    state.error.value = {
      code: err.code || 'LOAD_ERROR',
      message: err.message || 'Failed to load history'
    }
  }
}

/**
 * 上拉加载更早消息（在当前窗口前追加一页）
 */
export async function loadOlderMessagesPage(
  state: ChatStoreState,
  options: { pageSize?: number } = {}
): Promise<boolean> {
  if (!state.currentConversationId.value) return false
  if (state.isLoadingMoreMessages.value) return false

  // 已经到头
  if (state.windowStartIndex.value <= 0) return false

  const pageSize = options.pageSize ?? MESSAGES_PAGE_SIZE
  state.isLoadingMoreMessages.value = true

  try {
    const beforeIndex = state.windowStartIndex.value
    const result = await perfMeasureAsync('conversation.loadOlderMessagesPage', () =>
      sendToExtension<{ total: number; messages: Content[] }>('conversation.getMessagesPaged', {
        conversationId: state.currentConversationId.value,
        beforeIndex,
        limit: pageSize
      })
    )

    const older = result?.messages || []
    if (older.length === 0) {
      state.windowStartIndex.value = 0
      state.totalMessages.value = result?.total ?? state.totalMessages.value
      return false
    }

    const olderMsgs = older.map(c => contentToMessageEnhanced(c))
    // 追加到窗口顶部
    state.allMessages.value = [...olderMsgs, ...state.allMessages.value]

    state.totalMessages.value = result?.total ?? state.totalMessages.value
    state.windowStartIndex.value = older[0]?.index ?? state.windowStartIndex.value

    // 超过窗口上限则裁剪（释放资源）
    trimWindowFromTop(state)

    perfLog('conversation.window', {
      start: state.windowStartIndex.value,
      count: state.allMessages.value.length,
      total: state.totalMessages.value
    })

    return true
  } catch (err) {
    console.error('[conversationActions] loadOlderMessagesPage failed:', err)
    return false
  } finally {
    state.isLoadingMoreMessages.value = false
  }
}

/**
 * 加载当前对话的检查点
 */
export async function loadCheckpoints(state: ChatStoreState): Promise<void> {
  if (!state.currentConversationId.value) {
    state.checkpoints.value = []
    return
  }
  
  try {
    const result = await sendToExtension<{ checkpoints: CheckpointRecord[] }>('checkpoint.getCheckpoints', {
      conversationId: state.currentConversationId.value
    })
    
    if (result?.checkpoints) {
      state.checkpoints.value = result.checkpoints
    } else {
      state.checkpoints.value = []
    }
  } catch (err) {
    console.error('Failed to load checkpoints:', err)
    state.checkpoints.value = []
  }
}

/**
 * 切换到指定对话
 *
 * 每次切换都会重新加载对话内容，确保数据最新
 * 如果当前有正在进行的请求，会先取消并将工具标记为拒绝
 */
export async function switchConversation(
  state: ChatStoreState,
  id: string,
  cancelStreamAndRejectTools: CancelStreamAndRejectToolsCallback
): Promise<void> {
  // 注意：即使是相同对话也允许重新加载（从历史记录进入时需要刷新）
  const conv = state.conversations.value.find(c => c.id === id)
  if (!conv) return
  
  // 如果有正在进行的请求，先取消并拒绝工具
  if (state.isWaitingForResponse.value || state.isStreaming.value) {
    await cancelStreamAndRejectTools()
  }
  
  // 清除状态
  state.activeBuild.value = null
  state.currentConversationId.value = id
  state.allMessages.value = []
  state.windowStartIndex.value = 0
  state.totalMessages.value = 0
  state.isLoadingMoreMessages.value = false
  state.historyFolded.value = false
  state.foldedMessageCount.value = 0
  state.checkpoints.value = []
  state.error.value = null
  state.isLoading.value = false
  state.isStreaming.value = false
  state.streamingMessageId.value = null
  state.isWaitingForResponse.value = false
  
  // 如果是已持久化的对话，从后端加载历史和检查点
  if (conv.isPersisted) {
    await loadHistory(state)
    await loadCheckpoints(state)
    
    // 更新对话的消息数量（在加载后才有准确数据）
    conv.messageCount = state.totalMessages.value || state.allMessages.value.length

    // 恢复该对话的 Build 会话（用于重进应用后显示顶部 Build 卡片）
    state.activeBuild.value = await loadConversationBuildSession(id)
  } else {
    state.activeBuild.value = null
  }
}

/**
 * 检查对话是否正在删除
 */
export function isDeletingConversation(state: ChatStoreState, id: string): boolean {
  return state.deletingConversationIds.value.has(id)
}

/**
 * 删除对话
 *
 * 使用锁机制防止快速连续删除时的竞态条件
 */
export async function deleteConversation(
  state: ChatStoreState,
  id: string,
  switchConversationFn: (id: string) => Promise<void>,
  createNewConversationFn: () => Promise<void>
): Promise<boolean> {
  const conv = state.conversations.value.find(c => c.id === id)
  if (!conv) return false
  
  // 如果正在删除，跳过
  if (state.deletingConversationIds.value.has(id)) {
    console.warn(`[chatStore] 对话 ${id} 正在删除中，跳过重复请求`)
    return false
  }
  
  // 标记为正在删除
  state.deletingConversationIds.value.add(id)
  
  try {
    // 如果是已持久化的，需要从后端删除
    if (conv.isPersisted) {
      await sendToExtension('conversation.deleteConversation', { conversationId: id })
    }
    
    // 后端删除成功后，再从前端移除
    state.conversations.value = state.conversations.value.filter(c => c.id !== id)

    // 同步分页列表游标
    if (conv.isPersisted) {
      const idx = state.persistedConversationIds.value.indexOf(id)
      if (idx >= 0) {
        state.persistedConversationIds.value.splice(idx, 1)
        if (idx < state.persistedConversationsLoaded.value) {
          state.persistedConversationsLoaded.value = Math.max(0, state.persistedConversationsLoaded.value - 1)
        }
      }
    }
    
    // 如果删除的是当前对话，切换或创建新对话
    if (state.currentConversationId.value === id) {
      if (state.conversations.value.length > 0) {
        await switchConversationFn(state.conversations.value[0].id)
      } else {
        await createNewConversationFn()
      }
    }
    
    return true
  } catch (err: any) {
    state.error.value = {
      code: err.code || 'DELETE_ERROR',
      message: err.message || 'Failed to delete conversation'
    }
    return false
  } finally {
    // 无论成功失败，都移除删除锁
    state.deletingConversationIds.value.delete(id)
  }
}

/**
 * 流式完成后更新对话元数据
 */
export async function updateConversationAfterMessage(state: ChatStoreState): Promise<void> {
  if (!state.currentConversationId.value) return
  
  const conv = state.conversations.value.find(c => c.id === state.currentConversationId.value)
  if (!conv) return
  
  const now = Date.now()
  // windowStartIndex 是绝对索引，windowStartIndex + window.length 近似代表“当前已知的总消息数”
  const messageCount = Math.max(
    state.totalMessages.value,
    state.windowStartIndex.value + state.allMessages.value.length
  )
  state.totalMessages.value = messageCount
  
  try {
    // 更新对话的updatedAt时间戳
    await sendToExtension('conversation.setCustomMetadata', {
      conversationId: state.currentConversationId.value,
      key: 'updatedAt',
      value: now
    })
    
    // 更新消息数量
    await sendToExtension('conversation.setCustomMetadata', {
      conversationId: state.currentConversationId.value,
      key: 'messageCount',
      value: messageCount
    })
    
    // 如果有消息，更新preview
    if (state.allMessages.value.length > 0) {
      const lastUserMsg = state.allMessages.value.filter(m => m.role === 'user' && !m.isFunctionResponse).pop()
      if (lastUserMsg) {
        await sendToExtension('conversation.setCustomMetadata', {
          conversationId: state.currentConversationId.value,
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
