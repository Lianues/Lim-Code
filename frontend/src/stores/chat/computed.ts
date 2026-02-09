/**
 * Chat Store 计算属性
 */

import { computed } from 'vue'
import type { ChatStoreState, ChatStoreComputed } from './types'

/**
 * 创建 Chat Store 计算属性
 */
export function createChatComputed(state: ChatStoreState): ChatStoreComputed {
  /** 当前对话 */
  const currentConversation = computed(() => 
    state.conversations.value.find(c => c.id === state.currentConversationId.value) || null
  )
  
  /** 排序后的对话列表（按更新时间降序） */
  const sortedConversations = computed(() =>
    [...state.conversations.value].sort((a, b) => b.updatedAt - a.updatedAt)
  )
  
  /** 按工作区筛选后的对话列表 */
  const filteredConversations = computed(() => {
    if (state.workspaceFilter.value === 'all' || !state.currentWorkspaceUri.value) {
      return sortedConversations.value
    }
    // 筛选当前工作区的对话
    return sortedConversations.value.filter(c => c.workspaceUri === state.currentWorkspaceUri.value)
  })
  
  /**
   * 用于显示的消息列表（过滤掉纯 functionResponse 消息）
   */
  const messages = computed(() =>
    state.allMessages.value.filter(m => !m.isFunctionResponse)
  )
  
  /** 是否有消息 */
  const hasMessages = computed(() => state.allMessages.value.length > 0)
  
  /** 是否显示空状态 */
  const showEmptyState = computed(() => state.allMessages.value.length === 0 && !state.isLoading.value)
  
  /** 当前模型名称（用于显示） */
  const currentModelName = computed(() => state.currentConfig.value?.model || state.configId.value)
  
  /** 最大上下文 Tokens（从配置获取） */
  const maxContextTokens = computed(() => state.currentConfig.value?.maxContextTokens || 128000)
  
  /** 当前使用的 Tokens（从最后一条助手消息获取） */
  const usedTokens = computed(() => {
    // 从后往前找最后一条助手消息
    for (let i = state.allMessages.value.length - 1; i >= 0; i--) {
      const msg = state.allMessages.value[i]
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
   *
   * 例外：如果工具返回了 requiresUserConfirmation（如 create_plan），
   * 说明工具主动要求暂停循环等待用户操作（如点击"执行计划"），
   * 此时不应显示此提示。
   */
  const needsContinueButton = computed(() => {
    if (state.allMessages.value.length === 0) return false
    if (state.isStreaming.value || state.isWaitingForResponse.value) return false
    if (state.error.value) return false  // 有错误时显示错误面板，不显示继续按钮
    if (state.retryStatus.value?.isRetrying) return false  // 正在重试
    
    const lastMessage = state.allMessages.value[state.allMessages.value.length - 1]
    if (!lastMessage.isFunctionResponse) return false

    // 检查是否有工具要求暂停等待用户确认（如 create_plan 的 requiresUserConfirmation）
    // 此时计划卡片会显示"执行计划"按钮，不需要额外的"继续"提示
    if (lastMessage.parts?.some(p =>
      (p.functionResponse?.response as any)?.requiresUserConfirmation
    )) {
      return false
    }

    return true
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
    if (!state.isWaitingForResponse.value || state.isStreaming.value) return false

    // 从后往前找最后一条助手消息
    for (let i = state.allMessages.value.length - 1; i >= 0; i--) {
      const msg = state.allMessages.value[i]
      if (msg.role === 'assistant' && msg.tools && msg.tools.length > 0) {
        // 检查是否有 awaiting_approval 状态的工具
        return msg.tools.some(tool => tool.status === 'awaiting_approval')
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
    for (let i = state.allMessages.value.length - 1; i >= 0; i--) {
      const msg = state.allMessages.value[i]
      if (msg.role === 'assistant' && msg.tools && msg.tools.length > 0) {
        return msg.tools.filter(tool => tool.status === 'awaiting_approval')
      }
    }
    return []
  })

  return {
    currentConversation,
    sortedConversations,
    filteredConversations,
    messages,
    hasMessages,
    showEmptyState,
    currentModelName,
    maxContextTokens,
    usedTokens,
    tokenUsagePercent,
    needsContinueButton,
    hasPendingToolConfirmation,
    pendingToolCalls
  }
}
