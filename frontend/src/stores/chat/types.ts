/**
 * Chat Store 类型定义
 */

import type { Ref, ComputedRef } from 'vue'
import type { Message, ErrorInfo, CheckpointRecord, Attachment } from '../../types'
import type { EditorNode } from '../../types/editorNode'

// 重新导出类型以供其他模块使用
export type { CheckpointRecord, ErrorInfo } from '../../types'

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

/**
 * 附件数据类型（用于发送到后端）
 */
export interface AttachmentData {
  id: string
  name: string
  type: 'image' | 'video' | 'audio' | 'document' | 'code'
  size: number
  mimeType: string
  data: string
  thumbnail?: string
}

/**
 * 重试状态
 */
export interface RetryStatus {
  isRetrying: boolean
  attempt: number
  maxAttempts: number
  error?: string
  errorDetails?: any
  nextRetryIn?: number
}

/**
 * 自动总结提示状态
 */
export interface AutoSummaryStatus {
  isSummarizing: boolean
  /** 来源：自动触发或手动触发 */
  mode?: 'auto' | 'manual'
  message?: string
}

/**
 * 配置详情
 */
export interface ConfigInfo {
  id: string
  name: string
  model: string
  type: string
  maxContextTokens?: number
}

// ============ Build（Plan 执行）相关 ============

export type BuildStatus = 'running' | 'done'

export interface BuildSession {
  id: string
  conversationId: string
  title: string
  planContent: string
  planPath?: string
  channelId?: string
  modelId?: string
  startedAt: number
  anchorBackendIndex?: number
  status: BuildStatus
}

/**
 * 排队消息（候选区）
 */
export interface QueuedMessage {
  id: string
  /** 序列化后的编辑器内容（包含 @上下文标记） */
  content: string
  /** 附件 */
  attachments: Attachment[]
  /** 入队时间戳 */
  timestamp: number
}

/**
 * Chat Store 状态类型
 */
export interface ChatStoreState {
  /**
   * 已加载的对话摘要列表（仅元数据）
   *
   * 注意：为了提升大量历史对话时的启动速度，这里会分页加载。
   */
  conversations: Ref<Conversation[]>

  /** 所有已持久化对话 ID（用于分页加载） */
  persistedConversationIds: Ref<string[]>

  /** 已加载的持久化对话数量（游标/已加载条数） */
  persistedConversationsLoaded: Ref<number>

  /** 是否正在加载更多对话（滚动分页） */
  isLoadingMoreConversations: Ref<boolean>

  /** 当前对话ID */
  currentConversationId: Ref<string | null>
  /**
   * 当前对话的消息窗口（包括 functionResponse 消息）
   *
   * 注意：这是“窗口化”的消息列表，不保证从 0 开始，也不保证包含全量历史。
   * `Message.backendIndex`（绝对索引）用于与后端对齐。
   */
  allMessages: Ref<Message[]>
  /** 当前窗口的起始绝对索引（等于 allMessages[0].backendIndex） */
  windowStartIndex: Ref<number>
  /** 后端该对话的总消息数（绝对长度） */
  totalMessages: Ref<number>
  /** 是否正在上拉加载更早消息页 */
  isLoadingMoreMessages: Ref<boolean>
  /** 是否发生过“窗口折叠”（从顶部丢弃旧消息以释放资源） */
  historyFolded: Ref<boolean>
  /** 已折叠丢弃的消息条数（包含 functionResponse） */
  foldedMessageCount: Ref<number>
  /** 配置ID */
  configId: Ref<string>
  /** 当前会话选择的模型 ID（对话级隔离，不直接改全局渠道配置） */
  selectedModelId: Ref<string>
  /** 当前配置详情 */
  currentConfig: Ref<ConfigInfo | null>
  /** 加载状态 */
  isLoading: Ref<boolean>
  /** 流式响应状态 */
  isStreaming: Ref<boolean>
  /** 对话列表加载状态 */
  isLoadingConversations: Ref<boolean>
  /** 错误信息 */
  error: Ref<ErrorInfo | null>
  /** 当前流式消息ID */
  streamingMessageId: Ref<string | null>
  /** 等待AI响应状态 */
  isWaitingForResponse: Ref<boolean>
  /** 重试状态 */
  retryStatus: Ref<RetryStatus | null>
  /** 自动总结状态（用于显示“自动总结中”提示） */
  autoSummaryStatus: Ref<AutoSummaryStatus | null>
  /** 工具调用缓冲区 */
  toolCallBuffer: Ref<string>
  /** 当前是否在工具调用标记内 */
  inToolCall: Ref<'xml' | 'json' | null>
  /** 当前对话的检查点列表 */
  checkpoints: Ref<CheckpointRecord[]>
  /** 存档点配置：是否合并无变更的存档点 */
  mergeUnchangedCheckpoints: Ref<boolean>
  /** 正在删除的对话 ID 集合 */
  deletingConversationIds: Ref<Set<string>>
  /** 当前工作区 URI */
  currentWorkspaceUri: Ref<string | null>
  /** 输入框内容 */
  inputValue: Ref<string>
  /** 工作区筛选模式 */
  workspaceFilter: Ref<WorkspaceFilter>
  /** 编辑器节点数组（包含文本和上下文徽章，用于对话级输入状态隔离） */
  editorNodes: Ref<EditorNode[]>
  /** 当前对话的附件列表 */
  attachments: Ref<Attachment[]>
  /** 当前对话的 Prompt 模式 ID（对话级隔离） */
  currentPromptModeId: Ref<string>

  /** 当前 Build 会话（用于 Plan 执行 UI 展示） */
  activeBuild: Ref<BuildSession | null>

  /**
   * 当前回合的模型覆盖（仅对本轮流式/工具确认生效）
   *
   * 用于：Plan 执行时选择“渠道 + 模型”，并在 toolConfirmation 时保持一致。
   */
  pendingModelOverride: Ref<string | null>

  /** 消息排队队列（候选区） */
  messageQueue: Ref<QueuedMessage[]>

  /** 上一次被 cancelStream 取消的 streamingMessageId（用于防止迟到的 cancelled/error chunk 误清新请求状态） */
  _lastCancelledStreamId: Ref<string | null>

  // ============ 多对话标签页 ============

  /** 当前打开的标签页列表（有序） */
  openTabs: Ref<TabInfo[]>

  /** 当前激活的标签页 ID */
  activeTabId: Ref<string | null>

  /** 后台标签页的会话快照（tabId -> snapshot） */
  sessionSnapshots: Ref<Map<string, ConversationSessionSnapshot>>

  /** 后台对话的流式缓冲区（conversationId -> chunks） */
  backgroundStreamBuffers: Ref<Map<string, import('../../types').StreamChunk[]>>

  /** 工具响应缓存：toolCallId -> response，避免 getToolResponseById 的 O(M) 线性扫描 */
  toolResponseCache: Ref<Map<string, Record<string, unknown>>>
}

/**
 * Chat Store 计算属性类型
 */
export interface ChatStoreComputed {
  /** 当前对话 */
  currentConversation: ComputedRef<Conversation | null>
  /** 排序后的对话列表 */
  sortedConversations: ComputedRef<Conversation[]>
  /** 按工作区筛选后的对话列表 */
  filteredConversations: ComputedRef<Conversation[]>
  /** 用于显示的消息列表（过滤掉纯 functionResponse 消息） */
  messages: ComputedRef<Message[]>
  /** 是否有消息 */
  hasMessages: ComputedRef<boolean>
  /** 是否显示空状态 */
  showEmptyState: ComputedRef<boolean>
  /** 当前模型名称 */
  currentModelName: ComputedRef<string>
  /** 最大上下文 Tokens */
  maxContextTokens: ComputedRef<number>
  /** 当前使用的 Tokens */
  usedTokens: ComputedRef<number>
  /** Token 使用百分比 */
  tokenUsagePercent: ComputedRef<number>
  /** 是否需要显示"继续对话"按钮 */
  needsContinueButton: ComputedRef<boolean>
  /** 是否有待确认的工具调用 */
  hasPendingToolConfirmation: ComputedRef<boolean>
  /** 待确认的工具列表 */
  pendingToolCalls: ComputedRef<import('../../types').ToolUsage[]>
}

// ============ 多对话标签页相关 ============

/**
 * 对话会话快照 - 切换标签页时保存/恢复的每对话状态
 */
export interface ConversationSessionSnapshot {
  /** 对话 ID */
  conversationId: string | null
  /** 消息列表 */
  allMessages: Message[]
  /** 窗口起始索引 */
  windowStartIndex: number
  /** 当前会话选择的配置 ID（渠道） */
  configId: string
  /** 当前会话选择的模型 ID */
  selectedModelId: string
  /** 总消息数 */
  totalMessages: number
  /** 是否正在加载更多消息 */
  isLoadingMoreMessages: boolean
  /** 是否流式中 */
  isStreaming: boolean
  /** 是否加载中 */
  isLoading: boolean
  /** 流式消息 ID */
  streamingMessageId: string | null
  /** 是否等待响应 */
  isWaitingForResponse: boolean
  /** 检查点列表 */
  checkpoints: CheckpointRecord[]
  /** Build 会话 */
  activeBuild: BuildSession | null
  /** 错误信息 */
  error: ErrorInfo | null
  /** 重试状态 */
  retryStatus: RetryStatus | null
  /** 自动总结状态 */
  autoSummaryStatus: AutoSummaryStatus | null
  /** 是否已折叠 */
  historyFolded: boolean
  /** 折叠消息数 */
  foldedMessageCount: number
  /** 工具调用缓冲区 */
  toolCallBuffer: string
  /** 工具调用标记 */
  inToolCall: 'xml' | 'json' | null
  /** 输入框内容 */
  inputValue: string
  /** 模型覆盖 */
  pendingModelOverride: string | null
  /** 编辑器节点（富文本状态，包含上下文徽章） */
  editorNodes: EditorNode[]
  /** 附件列表 */
  attachments: Attachment[]
  /** 消息排队队列 */
  messageQueue: QueuedMessage[]
  /** Prompt 模式 ID */
  currentPromptModeId: string
}

/**
 * 标签页信息
 */
export interface TabInfo {
  /** 标签页唯一 ID */
  id: string
  /** 关联的对话 ID（null 表示新空白对话） */
  conversationId: string | null
  /** 显示标题 */
  title: string
  /** 是否正在流式响应中 */
  isStreaming: boolean
}

// ============ 常量 ============

/** XML 工具调用开始标记 */
export const XML_TOOL_START = '<tool_use>'
/** XML 工具调用结束标记 */
export const XML_TOOL_END = '</tool_use>'
/** JSON 工具调用开始标记 */
export const JSON_TOOL_START = '<<<TOOL_CALL>>>'
/** JSON 工具调用结束标记 */
export const JSON_TOOL_END = '<<<END_TOOL_CALL>>>'
