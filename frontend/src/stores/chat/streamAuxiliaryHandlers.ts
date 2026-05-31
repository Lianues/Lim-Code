/**
 * 非核心流式辅助事件处理。
 *
 * 主聊天内容、工具和终态已经由 Runtime Ledger projection 接管；这里仅保留不属于
 * assistant 内容事实源的 UI 辅助信号。
 */

import type { ContextCommandPayload, Message, StreamChunk } from '../../types'
import type { ChatStoreState, CheckpointRecord } from './types'
import { generateId } from '../../utils/format'
import { contentToMessageEnhanced } from './parsers'
import { appendMessage, insertMessageAt } from './state'
import { syncTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'
import { t } from '../../i18n'

export function handleCheckpoints(
  chunk: StreamChunk,
  addCheckpoint: (checkpoint: CheckpointRecord) => void
): void {
  if (chunk.checkpoints && chunk.checkpoints.length > 0) {
    for (const checkpoint of chunk.checkpoints) {
      addCheckpoint(checkpoint)
    }
  }
}

export function handleAutoSummaryStatus(
  chunk: StreamChunk,
  state: ChatStoreState
): void {
  if (!chunk.autoSummaryStatus || !chunk.status) return

  if (chunk.status === 'started') {
    state.autoSummaryStatus.value = {
      isSummarizing: true,
      mode: 'auto',
      message: chunk.message
    }
    return
  }

  state.autoSummaryStatus.value = null
}

export function handleContextCommand(chunk: StreamChunk, state: ChatStoreState): void {
  if (!chunk.contextCommand || !chunk.payload) return

  const payload = chunk.payload as ContextCommandPayload
  const booleanLabel = (value: boolean) => value
    ? t('components.message.contextCommand.yes')
    : t('components.message.contextCommand.no')
  const lines = [`### ${payload.title}`, '', payload.description]
  if (payload.projectionId) lines.push('', `${t('components.message.contextCommand.projection')}: \`${payload.projectionId}\``)
  if (payload.ledgerEntryId) lines.push(`${t('components.message.contextCommand.ledger')}: \`${payload.ledgerEntryId}\``)
  if (typeof payload.lossy === 'boolean') lines.push(`${t('components.message.contextCommand.lossy')}: ${booleanLabel(payload.lossy)}`)
  if (typeof payload.reversible === 'boolean') lines.push(`${t('components.message.contextCommand.reversible')}: ${booleanLabel(payload.reversible)}`)
  if (payload.nextActions?.length) {
    lines.push('', `${t('components.message.contextCommand.nextActions')}:`, ...payload.nextActions.map(action => `- \`${action}\``))
  }

  appendMessage(state, {
    id: generateId(),
    role: 'assistant',
    content: lines.join('\n'),
    timestamp: Date.now(),
    streaming: false,
    localOnly: true,
    metadata: {
      contextCommand: payload
    }
  } as Message)

  state.isWaitingForResponse.value = false
  state.isStreaming.value = false
  state.streamingMessageId.value = null
  state.activeStreamId.value = null
  state.pendingModelOverride.value = null
}

export function handleAutoSummary(
  chunk: StreamChunk,
  state: ChatStoreState
): void {
  if (!chunk.summaryContent || typeof chunk.insertIndex !== 'number') return

  const insertIndex = chunk.insertIndex
  const exists = state.allMessages.value.some(
    message => message.isSummary && typeof message.backendIndex === 'number' && message.backendIndex === insertIndex
  )
  if (exists) return

  if (insertIndex < state.windowStartIndex.value) {
    state.windowStartIndex.value += 1
    for (const message of state.allMessages.value) {
      if (typeof message.backendIndex === 'number') {
        message.backendIndex += 1
      }
    }
    syncTotalMessagesFromWindow(state)
    return
  }

  for (const message of state.allMessages.value) {
    if (typeof message.backendIndex === 'number' && message.backendIndex >= insertIndex) {
      message.backendIndex += 1
    }
  }

  const summaryMessage = contentToMessageEnhanced(chunk.summaryContent)
  summaryMessage.backendIndex = insertIndex
  summaryMessage.timestamp = chunk.summaryContent.timestamp || Date.now()
  summaryMessage.localOnly = false
  summaryMessage.streaming = false

  const localInsertIndex = Math.min(
    Math.max(insertIndex - state.windowStartIndex.value, 0),
    state.allMessages.value.length
  )

  insertMessageAt(state, localInsertIndex, summaryMessage)
  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)
  state.autoSummaryStatus.value = null
}
