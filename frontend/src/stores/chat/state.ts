/**
 * Chat Store 状态定义
 */

import { ref } from 'vue'
import type { Message, ErrorInfo } from '../../types'
import type { CheckpointRecord } from '../../types'
import type { Attachment } from '../../types'
import type { StreamChunk } from '../../types'
import type { EditorNode } from '../../types/editorNode'
import type {
  Conversation,
  WorkspaceFilter,
  RetryStatus,
  AutoSummaryStatus,
  ConfigInfo,
  BuildSession,
  ChatStoreState,
  TabInfo,
  ConversationSessionSnapshot,
  QueuedMessage
} from './types'

export type MessageIndexState = Pick<ChatStoreState, 'allMessages' | 'messageIndexById'>
export type MessageIndexLookupState = Pick<ChatStoreState, 'allMessages'> & Partial<Pick<ChatStoreState, 'messageIndexById'>>

function hasMessageIndexState(state: MessageIndexLookupState): state is MessageIndexState {
  return state.messageIndexById?.value instanceof Map
}

type NodeLikeGlobal = typeof globalThis & {
  process?: {
    env?: {
      NODE_ENV?: string
    }
  }
}

const SHOULD_ASSERT_MESSAGE_INDEX_INVARIANT = (() => {
  const nodeEnv = (globalThis as NodeLikeGlobal).process?.env?.NODE_ENV
  return nodeEnv === 'development' || nodeEnv === 'test'
})()

function getMessageIndexMap(state: MessageIndexLookupState): Map<string, number> | null {
  return hasMessageIndexState(state) ? state.messageIndexById.value : null
}

function assertMessageIndexInvariant(state: MessageIndexLookupState): void {
  if (!SHOULD_ASSERT_MESSAGE_INDEX_INVARIANT || !hasMessageIndexState(state)) return

  const expected = buildMessageIndexById(state.allMessages.value)
  const actual = state.messageIndexById.value
  const isConsistent =
    expected.size === actual.size &&
    Array.from(expected.entries()).every(([messageId, index]) => actual.get(messageId) === index)

  console.assert(isConsistent, '[chat/state] messageIndexById invariant violated', {
    expected: Array.from(expected.entries()),
    actual: Array.from(actual.entries()),
    messageIds: state.allMessages.value.map(message => message.id)
  })
}

/** 为当前 allMessages 重建 message.id -> 首次出现位置 的索引，保持 findIndex 的首命中语义。 */
export function buildMessageIndexById(messages: Message[]): Map<string, number> {
  const indexById = new Map<string, number>()

  for (let i = 0; i < messages.length; i++) {
    const messageId = messages[i]?.id
    if (typeof messageId !== 'string' || messageId.length === 0) continue

    // 只记录第一次出现的位置，保持旧 findIndex 的首命中语义。
    if (!indexById.has(messageId)) {
      indexById.set(messageId, i)
    }
  }

  return indexById
}

/** 集中重建索引，供数组整体替换、tab restore、历史重载等路径校正 messageIndexById。 */
export function rebuildMessageIndexById(state: MessageIndexLookupState): void {
  if (!hasMessageIndexState(state)) return

  state.messageIndexById.value = buildMessageIndexById(state.allMessages.value)
  assertMessageIndexInvariant(state)
}

export function replaceAllMessages(state: MessageIndexLookupState, messages: Message[]): void {
  state.allMessages.value = messages
  rebuildMessageIndexById(state)
}

export function appendMessage(state: MessageIndexLookupState, message: Message): void {
  const nextIndex = state.allMessages.value.length
  state.allMessages.value.push(message)

  if (!hasMessageIndexState(state)) return

  const messageId = message?.id
  if (typeof messageId === 'string' && messageId.length > 0 && !state.messageIndexById.value.has(messageId)) {
    state.messageIndexById.value.set(messageId, nextIndex)
  }

  assertMessageIndexInvariant(state)
}

export function insertMessageAt(state: MessageIndexLookupState, index: number, message: Message): void {
  const boundedIndex = Math.max(0, Math.min(index, state.allMessages.value.length))
  state.allMessages.value.splice(boundedIndex, 0, message)
  rebuildMessageIndexById(state)
}

export function replaceMessageAt(state: MessageIndexLookupState, index: number, nextMessage: Message): void {
  if (index < 0 || index >= state.allMessages.value.length) return

  const currentMessage = state.allMessages.value[index]
  state.allMessages.value[index] = nextMessage

  if (currentMessage?.id !== nextMessage.id) {
    rebuildMessageIndexById(state)
    return
  }

  assertMessageIndexInvariant(state)
}

export function removeMessageAt(state: MessageIndexLookupState, index: number): void {
  if (index < 0 || index >= state.allMessages.value.length) return

  state.allMessages.value.splice(index, 1)
  rebuildMessageIndexById(state)
}

/**
 * messageIndexById 的唯一查询入口。
 * 主路径走 Map；索引缺失或失配时回退到 findIndex，并在真实 store 中重建整表索引修复不变式。
 */
export function getMessageIndexById(state: MessageIndexLookupState, messageId: string | null | undefined): number {
  if (!messageId) return -1

  const messages = state.allMessages.value
  const indexMap = getMessageIndexMap(state)
  const indexed = indexMap?.get(messageId)
  if (
    typeof indexed === 'number' &&
    indexed >= 0 &&
    indexed < messages.length &&
    messages[indexed]?.id === messageId
  ) {
    return indexed
  }

  const fallbackIndex = messages.findIndex(message => message.id === messageId)
  if (fallbackIndex === -1) {
    return -1
  }

  // 最小调用形状可能没有 messageIndexById；此时只返回 findIndex 结果，不强行绑定完整 store。
  if (!indexMap || !state.messageIndexById) {
    return fallbackIndex
  }

  // 走到 fallback 说明当前 Map 对本次查询不可信；重建整表，避免只修单 key 留下陈旧下标。
  rebuildMessageIndexById(state)
  return state.messageIndexById.value.get(messageId) ?? fallbackIndex
}

/**
 * 创建 Chat Store 状态
 */
export function createChatState(): ChatStoreState {
  /**
   * 已加载的对话摘要列表（仅元数据）
   *
   * 注意：为了提升大量历史对话时的启动速度，这里会分页加载。
   */
  const conversations = ref<Conversation[]>([])

  /** 所有已持久化对话 ID（用于分页加载） */
  const persistedConversationIds = ref<string[]>([])

  /** 已加载的持久化对话数量（游标/已加载条数） */
  const persistedConversationsLoaded = ref(0)

  /** 是否正在加载更多对话（滚动分页） */
  const isLoadingMoreConversations = ref(false)
  
  /** 当前对话ID */
  const currentConversationId = ref<string | null>(null)
  
  /**
   * 当前对话的消息窗口（包括 functionResponse 消息）
   *
   * 注意：为降低超长历史带来的卡顿，前端只保留一个“窗口”。
   * 每条消息的绝对索引通过 Message.backendIndex 对齐后端历史。
   */
  const allMessages = ref<Message[]>([])

  /**
   * message.id -> allMessages 数组下标。
   * allMessages 仍是唯一消息真源；该 Map 只服务高频按 id 定位，并维持首命中不变式。
   */
  const messageIndexById = ref<Map<string, number>>(new Map())

  /** 当前窗口的起始绝对索引（对应 allMessages[0].backendIndex） */
  const windowStartIndex = ref(0)

  /** 后端该对话的总消息数（用于判断是否还能加载更早消息） */
  const totalMessages = ref(0)

  /** 是否正在上拉加载更早消息页 */
  const isLoadingMoreMessages = ref(false)

  /** 是否发生过“窗口折叠”（用于 UI 提示） */
  const historyFolded = ref(false)

  /** 已折叠丢弃的消息条数（包含 functionResponse） */
  const foldedMessageCount = ref(0)
  
  /** 配置ID */
  const configId = ref('gemini-pro')

  /** 当前会话选择的模型 ID（对话级隔离） */
  const selectedModelId = ref('')
  
  /** 当前配置详情（包含模型名称） */
  const currentConfig = ref<ConfigInfo | null>(null)
  
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

  /** 当前流式请求 ID（用于过滤迟到/过期 chunk） */
  const activeStreamId = ref<string | null>(null)
  
  /** 等待AI响应状态 - 用于显示等待动画 */
  const isWaitingForResponse = ref(false)
  
  /** 重试状态 */
  const retryStatus = ref<RetryStatus | null>(null)

  /** 自动总结/手动压缩状态（用于显示“自动总结中”提示） */
  const autoSummaryStatus = ref<AutoSummaryStatus | null>(null)

  /** 手动 compact/summarize 后的即时上下文用量覆盖值，用于在下一次 provider usage 返回前刷新环状指示灯 */
  const contextUsageOverride = ref<{ conversationId: string; usedTokens: number; updatedAt: number } | null>(null)
  
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

  /** 当前 Build 会话（Plan 执行） */
  const activeBuild = ref<BuildSession | null>(null)

  /** 当前回合模型覆盖（用于 Plan 执行的“渠道 + 模型”选择） */
  const pendingModelOverride = ref<string | null>(null)

  /** 消息排队队列（候选区） */
  const messageQueue = ref<QueuedMessage[]>([])

  /** 上一次被 cancelStream 取消的 streamingMessageId */
  const _lastCancelledStreamId = ref<string | null>(null)

  /** 最近一个因审批门闸停止的 streamId */
  const _lastApprovalGatedStreamId = ref<string | null>(null)

  /** 编辑器节点数组（包含文本和上下文徽章，用于对话级输入状态隔离） */
  const editorNodes = ref<EditorNode[]>([])

  /** 当前对话的附件列表 */
  const attachments = ref<Attachment[]>([])

  /** 当前对话的 Prompt 模式 ID（对话级隔离，默认 'code'） */
  const currentPromptModeId = ref('code')

  // ============ 多对话标签页 ============

  /** 当前打开的标签页列表 */
  const openTabs = ref<TabInfo[]>([])

  /** 当前激活的标签页 ID */
  const activeTabId = ref<string | null>(null)

  /** 后台标签页的会话快照 */
  const sessionSnapshots = ref<Map<string, ConversationSessionSnapshot>>(new Map())

  /** 后台对话的流式缓冲区 */
  const backgroundStreamBuffers = ref<Map<string, StreamChunk[]>>(new Map())

  /** 工具响应缓存：toolCallId -> response，避免 O(M) 线性扫描 */
  const toolResponseCache = ref<Map<string, Record<string, unknown>>>(new Map())

  return {
    conversations,
    persistedConversationIds,
    persistedConversationsLoaded,
    isLoadingMoreConversations,
    currentConversationId,
    allMessages,
    messageIndexById,
    windowStartIndex,
    totalMessages,
    isLoadingMoreMessages,
    historyFolded,
    foldedMessageCount,
    configId,
    selectedModelId,
    currentConfig,
    isLoading,
    isStreaming,
    isLoadingConversations,
    error,
    streamingMessageId,
    activeStreamId,
    isWaitingForResponse,
    retryStatus,
    autoSummaryStatus,
    contextUsageOverride,
    checkpoints,
    mergeUnchangedCheckpoints,
    deletingConversationIds,
    currentWorkspaceUri,
    inputValue,
    workspaceFilter,
    activeBuild,
    editorNodes,
    attachments,
    currentPromptModeId,
    pendingModelOverride,
    messageQueue,
    _lastCancelledStreamId,
    _lastApprovalGatedStreamId,
    openTabs,
    activeTabId,
    sessionSnapshots,
    backgroundStreamBuffers,
    toolResponseCache
  }
}
