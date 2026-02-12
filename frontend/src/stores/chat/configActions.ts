/**
 * Chat Store 配置操作
 * 
 * 包含配置的加载和切换
 */

import type { ChatStoreState } from './types'
import { sendToExtension } from '../../utils/vscode'

const CONVERSATION_MODEL_CONFIG_KEY = 'inputModelConfig'
const CONVERSATION_PROMPT_MODE_KEY = 'promptModeConfig'

const DEFAULT_PROMPT_MODE_ID = 'code'

interface ConversationModelConfig {
  configId?: string
  modelId?: string
}

function normalizeModelId(modelId: string | null | undefined): string { return (modelId || '').trim() }

/**
 * 加载当前配置详情
 */
export async function loadCurrentConfig(state: ChatStoreState): Promise<void> {
  try {
    const config = await sendToExtension<any>('config.getConfig', { configId: state.configId.value })
    if (config) {
      state.currentConfig.value = {
        id: config.id,
        name: config.name,
        model: config.model || config.id,
        type: config.type,
        maxContextTokens: config.maxContextTokens
      }

      if (!normalizeModelId(state.selectedModelId.value)) {
        state.selectedModelId.value = config.model || config.id
      }
    }
  } catch (err) {
    console.error('Failed to load current config:', err)
  }
}

/**
 * 持久化当前对话的渠道/模型选择
 */
export async function persistConversationModelConfig(state: ChatStoreState): Promise<void> {
  const conversationId = state.currentConversationId.value
  if (!conversationId) return

  const payload: ConversationModelConfig = {
    configId: state.configId.value,
    modelId: normalizeModelId(state.selectedModelId.value)
  }

  try {
    await sendToExtension('conversation.setCustomMetadata', {
      conversationId,
      key: CONVERSATION_MODEL_CONFIG_KEY,
      value: payload
    })
  } catch (error) {
    console.error('Failed to persist conversation model config:', error)
  }
}

/**
 * 应用对话保存的渠道/模型选择
 */
export async function applyConversationModelConfig(
  state: ChatStoreState,
  conversationId: string
): Promise<void> {
  try {
    const metadata = await sendToExtension<any>('conversation.getConversationMetadata', { conversationId })
    const stored = metadata?.custom?.[CONVERSATION_MODEL_CONFIG_KEY] as ConversationModelConfig | undefined

    const storedConfigId = typeof stored?.configId === 'string' ? stored.configId.trim() : ''
    const storedModelId = typeof stored?.modelId === 'string' ? stored.modelId.trim() : ''

    if (storedConfigId) {
      state.configId.value = storedConfigId
      await loadCurrentConfig(state)
      state.selectedModelId.value = storedModelId || state.currentConfig.value?.model || storedConfigId
      return
    }

    // 未存储对话级配置：至少确保 currentConfig 与 configId 对齐
    await loadCurrentConfig(state)
    state.selectedModelId.value = state.currentConfig.value?.model || state.configId.value
  } catch (error) {
    console.error('Failed to apply conversation model config:', error)
    // 兜底：确保 currentConfig / selectedModelId 不为空
    await loadCurrentConfig(state)
    state.selectedModelId.value = state.currentConfig.value?.model || state.configId.value
  }
}

/**
 * 设置当前对话的 Prompt 模式 ID（对话级隔离）
 *
 * 同时同步到后端全局设置（保持兼容），并持久化到对话元数据
 */
export async function setCurrentPromptModeId(state: ChatStoreState, modeId: string): Promise<void> {
  state.currentPromptModeId.value = modeId

  // 同步到后端全局设置（兼容：让后端当前全局 mode 也跟着切换）
  try {
    await sendToExtension('setCurrentPromptMode', { modeId })
  } catch (error) {
    console.error('Failed to sync prompt mode to backend:', error)
  }

  // 持久化到对话元数据
  await persistConversationPromptMode(state)
}

/**
 * 持久化当前对话的 Prompt 模式 ID 到对话元数据
 */
export async function persistConversationPromptMode(state: ChatStoreState): Promise<void> {
  const conversationId = state.currentConversationId.value
  if (!conversationId) return

  try {
    await sendToExtension('conversation.setCustomMetadata', {
      conversationId,
      key: CONVERSATION_PROMPT_MODE_KEY,
      value: { modeId: state.currentPromptModeId.value }
    })
  } catch (error) {
    console.error('Failed to persist conversation prompt mode:', error)
  }
}

/**
 * 从对话元数据恢复 Prompt 模式 ID
 *
 * 在切换对话时调用，从后端读取该对话保存的模式；
 * 如果没有保存过，使用默认 'code' 模式
 */
export async function applyConversationPromptMode(
  state: ChatStoreState,
  conversationId: string
): Promise<void> {
  try {
    const metadata = await sendToExtension<any>('conversation.getConversationMetadata', { conversationId })
    const stored = metadata?.custom?.[CONVERSATION_PROMPT_MODE_KEY] as { modeId?: string } | undefined
    const modeId = typeof stored?.modeId === 'string' ? stored.modeId.trim() : ''

    state.currentPromptModeId.value = modeId || DEFAULT_PROMPT_MODE_ID

    // 同步到后端全局设置
    try {
      await sendToExtension('setCurrentPromptMode', { modeId: state.currentPromptModeId.value })
    } catch {
      // 非致命，忽略
    }
  } catch (error) {
    console.error('Failed to apply conversation prompt mode:', error)
    state.currentPromptModeId.value = DEFAULT_PROMPT_MODE_ID
  }
}


/**
 * 设置当前会话模型
 */
export async function setSelectedModelId(state: ChatStoreState, modelId: string): Promise<void> {
  state.selectedModelId.value = normalizeModelId(modelId)
  await persistConversationModelConfig(state)
}

/**
 * 切换配置
 *
 * 同时保存到后端持久化存储
 */
export async function setConfigId(state: ChatStoreState, newConfigId: string): Promise<void> {
  state.configId.value = newConfigId
  await loadCurrentConfig(state)
  state.selectedModelId.value = state.currentConfig.value?.model || newConfigId
  
  // 保存到后端
  try {
    await sendToExtension('settings.setActiveChannelId', { channelId: newConfigId })
  } catch (error) {
    console.error('Failed to save active channel ID:', error)
  }

  await persistConversationModelConfig(state)
}

/**
 * 从后端加载保存的配置ID
 */
export async function loadSavedConfigId(state: ChatStoreState): Promise<void> {
  try {
    const response = await sendToExtension<{ channelId?: string }>('settings.getActiveChannelId', {})
    if (response?.channelId) {
      state.configId.value = response.channelId
    }

    await loadCurrentConfig(state)
    state.selectedModelId.value = state.currentConfig.value?.model || state.configId.value
  } catch (error) {
    console.error('Failed to load saved config ID:', error)
  }
}

/**
 * 加载存档点配置（合并设置）
 */
export async function loadCheckpointConfig(state: ChatStoreState): Promise<void> {
  try {
    const response = await sendToExtension<{ config: any }>('checkpoint.getConfig', {})
    if (response?.config?.messageCheckpoint) {
      state.mergeUnchangedCheckpoints.value = response.config.messageCheckpoint.mergeUnchangedCheckpoints ?? true
    }
  } catch (error) {
    console.error('Failed to load checkpoint config:', error)
  }
}

/**
 * 更新存档点合并设置
 */
export function setMergeUnchangedCheckpoints(state: ChatStoreState, value: boolean): void {
  state.mergeUnchangedCheckpoints.value = value
}

/**
 * 设置当前工作区 URI
 */
export function setCurrentWorkspaceUri(state: ChatStoreState, uri: string | null): void {
  state.currentWorkspaceUri.value = uri
}

/**
 * 设置工作区筛选模式
 */
export function setWorkspaceFilter(state: ChatStoreState, filter: 'current' | 'all'): void {
  state.workspaceFilter.value = filter
}

/**
 * 设置输入框内容
 */
export function setInputValue(state: ChatStoreState, value: string): void {
  state.inputValue.value = value
}

/**
 * 清空输入框
 */
export function clearInputValue(state: ChatStoreState): void {
  state.inputValue.value = ''
}

/**
 * 处理重试状态事件
 *
 * 如果 status 携带 conversationId 且不是当前活跃对话，
 * 则将重试状态写入该对话对应的标签页快照，避免跨对话状态泄漏。
 */
export function handleRetryStatus(
  state: ChatStoreState,
  status: {
    type: 'retrying' | 'retrySuccess' | 'retryFailed'
    attempt: number
    maxAttempts: number
    error?: string
    errorDetails?: any
    nextRetryIn?: number
    conversationId?: string
  }
): void {
  const targetConvId = status.conversationId
  const isCurrent = !targetConvId || targetConvId === state.currentConversationId.value

  if (status.type === 'retrying') {
    const retryValue = {
      isRetrying: true,
      attempt: status.attempt,
      maxAttempts: status.maxAttempts,
      error: status.error,
      errorDetails: status.errorDetails,
      nextRetryIn: status.nextRetryIn
    }

    if (isCurrent) {
      state.retryStatus.value = retryValue
    } else {
      // 非当前对话 -> 写入对应标签页的快照
      const tab = state.openTabs.value.find(t => t.conversationId === targetConvId)
      if (tab) {
        const snapshot = state.sessionSnapshots.value.get(tab.id)
        if (snapshot) {
          snapshot.retryStatus = retryValue
        }
      }
    }
  } else if (status.type === 'retrySuccess' || status.type === 'retryFailed') {
    if (isCurrent) {
      state.retryStatus.value = null
    } else {
      // 非当前对话 -> 清除对应快照中的重试状态
      const tab = state.openTabs.value.find(t => t.conversationId === targetConvId)
      if (tab) {
        const snapshot = state.sessionSnapshots.value.get(tab.id)
        if (snapshot) {
          snapshot.retryStatus = null
        }
      }
    }
  }
}
