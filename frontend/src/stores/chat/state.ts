/**
 * Chat Store 状态定义
 */

import { ref } from 'vue'
import type { Message, ErrorInfo } from '../../types'
import type { CheckpointRecord } from '../../types'
import type {
  Conversation,
  WorkspaceFilter,
  RetryStatus,
  ConfigInfo,
  BuildSession,
  ChatStoreState
} from './types'

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
  
  /** 等待AI响应状态 - 用于显示等待动画 */
  const isWaitingForResponse = ref(false)
  
  /** 重试状态 */
  const retryStatus = ref<RetryStatus | null>(null)
  
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

  /** 当前 Build 会话（Plan 执行） */
  const activeBuild = ref<BuildSession | null>(null)

  /** 当前回合模型覆盖（用于 Plan 执行的“渠道 + 模型”选择） */
  const pendingModelOverride = ref<string | null>(null)

  return {
    conversations,
    persistedConversationIds,
    persistedConversationsLoaded,
    isLoadingMoreConversations,
    currentConversationId,
    allMessages,
    windowStartIndex,
    totalMessages,
    isLoadingMoreMessages,
    historyFolded,
    foldedMessageCount,
    configId,
    currentConfig,
    isLoading,
    isStreaming,
    isLoadingConversations,
    error,
    streamingMessageId,
    isWaitingForResponse,
    retryStatus,
    toolCallBuffer,
    inToolCall,
    checkpoints,
    mergeUnchangedCheckpoints,
    deletingConversationIds,
    currentWorkspaceUri,
    inputValue,
    workspaceFilter,
    activeBuild,
    pendingModelOverride
  }
}
