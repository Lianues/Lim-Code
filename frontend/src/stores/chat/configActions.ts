/**
 * Chat Store 配置操作
 * 
 * 包含配置的加载和切换
 */

import type { ChatStoreState } from './types'
import { sendToExtension } from '../../utils/vscode'

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
    }
  } catch (err) {
    console.error('Failed to load current config:', err)
  }
}

/**
 * 切换配置
 *
 * 同时保存到后端持久化存储
 */
export async function setConfigId(state: ChatStoreState, newConfigId: string): Promise<void> {
  state.configId.value = newConfigId
  await loadCurrentConfig(state)
  
  // 保存到后端
  try {
    await sendToExtension('settings.setActiveChannelId', { channelId: newConfigId })
  } catch (error) {
    console.error('Failed to save active channel ID:', error)
  }
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
