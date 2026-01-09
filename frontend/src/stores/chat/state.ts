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
  ChatStoreState
} from './types'

/**
 * 创建 Chat Store 状态
 */
export function createChatState(): ChatStoreState {
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

  // ============ diff 确认/批注流程（旧版兼容） ============

  /** 等待后端确认的 diff 工具 ID 列表（apply_diff / write_file） */
  const pendingDiffToolIds = ref<string[]>([])

  /** 工具确认阶段的批注（当存在 diff 工具时，会被后端作为 pendingAnnotation 返回） */
  const pendingAnnotation = ref('')

  /** 已处理（保存/拒绝）的 diff 工具决策 */
  const processedDiffTools = ref<Map<string, 'accept' | 'reject'>>(new Map())

  /** 是否正在发送 diff 的 continueWithAnnotation（防止重复触发） */
  const isSendingDiffContinue = ref(false)

  /** diff 阶段的用户批注（由 ToolMessage 捕获） */
  const diffAnnotation = ref('')

  /** 已处理的 diffId（文件级） */
  const handledDiffIds = ref<Set<string>>(new Set())

  /** 已处理的文件路径（文件级） */
  const handledFilePaths = ref<Map<string, 'accept' | 'reject'>>(new Map())

  return {
    conversations,
    currentConversationId,
    allMessages,
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

    // diff 确认/批注流程（旧版兼容）
    pendingDiffToolIds,
    pendingAnnotation,
    processedDiffTools,
    isSendingDiffContinue,
    diffAnnotation,
    handledDiffIds,
    handledFilePaths
  }
}
