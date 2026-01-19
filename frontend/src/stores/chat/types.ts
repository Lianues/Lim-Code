/**
 * Chat Store 类型定义
 */

import type { Ref, ComputedRef } from 'vue'
import type { Message, ErrorInfo, CheckpointRecord } from '../../types'

// 重新导出类型以供其他模块使用
export type { CheckpointRecord } from '../../types'

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
 * 配置详情
 */
export interface ConfigInfo {
  id: string
  name: string
  model: string
  type: string
  maxContextTokens?: number
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
  /** 当前对话的所有消息列表（包括 functionResponse 消息） */
  allMessages: Ref<Message[]>
  /** 配置ID */
  configId: Ref<string>
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

// ============ 常量 ============

/** XML 工具调用开始标记 */
export const XML_TOOL_START = '<tool_use>'
/** XML 工具调用结束标记 */
export const XML_TOOL_END = '</tool_use>'
/** JSON 工具调用开始标记 */
export const JSON_TOOL_START = '<<<TOOL_CALL>>>'
/** JSON 工具调用结束标记 */
export const JSON_TOOL_END = '<<<END_TOOL_CALL>>>'
