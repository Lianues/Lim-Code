import type { ChatStoreState } from './types'
import type { Message } from '../../types'
import { perfLog } from '../../utils/perf'
import { replaceAllMessages } from './state'
import { triggerRef } from 'vue'

/** 默认消息窗口上限（按可见消息预算计算，保留完整轮次） */
export const MAX_WINDOW_MESSAGES = 800

interface WindowRound {
  startIndex: number
  endIndex: number
  visibleCount: number
}

function isVisibleWindowMessage(message: Message): boolean {
  return message.isFunctionResponse !== true
}

function getMessageAbsoluteIndex(message: Message | undefined, fallbackIndex: number): number {
  if (typeof message?.backendIndex === 'number' && Number.isFinite(message.backendIndex)) {
    return message.backendIndex
  }
  return fallbackIndex
}

function collectToolResponseIds(messages: Message[]): Set<string> {
  const ids = new Set<string>()

  for (const message of messages) {
    for (const tool of message.tools || []) {
      if (typeof tool.id === 'string' && tool.id) ids.add(tool.id)
    }
    for (const toolCall of message.toolCalls || []) {
      if (typeof toolCall.id === 'string' && toolCall.id) ids.add(toolCall.id)
    }
    for (const toolResult of message.toolResults || []) {
      if (typeof toolResult.id === 'string' && toolResult.id) ids.add(toolResult.id)
    }
    for (const part of message.parts || []) {
      const functionCallId = part.functionCall?.id
      if (typeof functionCallId === 'string' && functionCallId) ids.add(functionCallId)
      const functionResponseId = part.functionResponse?.id
      if (typeof functionResponseId === 'string' && functionResponseId) ids.add(functionResponseId)
    }
  }

  return ids
}

export function pruneToolResponseCacheToWindow(state: ChatStoreState): number {
  const cache = state.toolResponseCache.value
  if (!(cache instanceof Map) || cache.size === 0) return 0

  const retainedToolIds = collectToolResponseIds(state.allMessages.value)
  let removed = 0
  for (const toolCallId of Array.from(cache.keys())) {
    if (!retainedToolIds.has(toolCallId)) {
      cache.delete(toolCallId)
      removed += 1
    }
  }

  if (removed > 0) {
    triggerRef(state.toolResponseCache)
  }
  return removed
}

function collectWindowRounds(messages: Message[]): WindowRound[] {
  const rounds: WindowRound[] = []
  let currentRoundStartIndex = -1
  let currentRoundVisibleCount = 0

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    const isRoundStart = message.role === 'user' && !message.isFunctionResponse

    if (isRoundStart) {
      if (currentRoundStartIndex !== -1) {
        rounds.push({
          startIndex: currentRoundStartIndex,
          endIndex: i,
          visibleCount: currentRoundVisibleCount
        })
      }
      currentRoundStartIndex = i
      currentRoundVisibleCount = 0
    }

    if (currentRoundStartIndex !== -1 && isVisibleWindowMessage(message)) {
      currentRoundVisibleCount += 1
    }
  }

  if (currentRoundStartIndex !== -1) {
    rounds.push({
      startIndex: currentRoundStartIndex,
      endIndex: messages.length,
      visibleCount: currentRoundVisibleCount
    })
  }

  if (rounds.length === 0 && messages.length > 0) {
    rounds.push({
      startIndex: 0,
      endIndex: messages.length,
      visibleCount: messages.filter(isVisibleWindowMessage).length
    })
  }

  return rounds
}

export function calculateTrimWindowStartIndex(messages: Message[], maxVisibleCount = MAX_WINDOW_MESSAGES): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0

  const rounds = collectWindowRounds(messages)
  if (rounds.length === 0) {
    return getMessageAbsoluteIndex(messages[0], 0)
  }

  let keepStartIndex = rounds[rounds.length - 1].startIndex
  let keptVisibleCount = 0

  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i]
    const nextVisibleCount = keptVisibleCount + round.visibleCount

    if (keptVisibleCount > 0 && nextVisibleCount > maxVisibleCount) {
      break
    }

    keepStartIndex = round.startIndex
    keptVisibleCount = nextVisibleCount
  }

  return getMessageAbsoluteIndex(messages[keepStartIndex], keepStartIndex)
}

/**
 * 用窗口推导并同步“已知总消息数”
 *
 * windowStartIndex 是绝对索引，因此 windowStartIndex + window.length 代表当前窗口覆盖到的末尾索引（近似总数）。
 */
export function syncTotalMessagesFromWindow(state: ChatStoreState): void {
  state.totalMessages.value = Math.max(state.totalMessages.value, state.windowStartIndex.value + state.allMessages.value.length)
}

/** 将 totalMessages 直接设置为当前窗口覆盖到的总数（用于 delete/回档等会减少历史长度的操作） */
export function setTotalMessagesFromWindow(state: ChatStoreState): void {
  state.totalMessages.value = Math.max(0, state.windowStartIndex.value + state.allMessages.value.length)
}

/**
 * 裁剪消息窗口（从顶部丢弃更早消息）
 *
 * 返回：被丢弃的消息条数（包含 functionResponse）。
 */
export function trimWindowFromTop(state: ChatStoreState, maxCount = MAX_WINDOW_MESSAGES): number {
  const all = state.allMessages.value
  if (!Array.isArray(all) || all.length === 0) return 0

  const currentWindowStartIndex = getMessageAbsoluteIndex(all[0], state.windowStartIndex.value)
  const nextWindowStartIndex = calculateTrimWindowStartIndex(all, maxCount)
  if (nextWindowStartIndex <= currentWindowStartIndex) return 0

  let removeCount = 0
  while (removeCount < all.length) {
    const absoluteIndex = getMessageAbsoluteIndex(all[removeCount], currentWindowStartIndex + removeCount)
    if (absoluteIndex >= nextWindowStartIndex) {
      break
    }
    removeCount += 1
  }

  if (removeCount <= 0) return 0

  // 修改原因：窗口顶部裁剪会整体左移所有消息下标，旧索引必须同步失效。
  // 修改方式：统一通过 helper 替换裁剪后的窗口，并在同一维护点重建索引。
  // 修改目的：保证 trimWindowFromTop 后，所有按 id 定位都与裁剪后的 allMessages 严格一致。
  replaceAllMessages(state, all.slice(removeCount))
  state.windowStartIndex.value = nextWindowStartIndex

  // 清理窗口外的检查点，避免长期累积
  state.checkpoints.value = state.checkpoints.value.filter(cp => cp.messageIndex >= state.windowStartIndex.value)
  const prunedToolResponses = pruneToolResponseCacheToWindow(state)

  // 标记已发生折叠（用于 UI 提示）
  state.historyFolded.value = true
  state.foldedMessageCount.value += removeCount

  syncTotalMessagesFromWindow(state)

  perfLog('conversation.window.trim', {
    removed: removeCount,
    start: state.windowStartIndex.value,
    count: state.allMessages.value.length,
    total: state.totalMessages.value,
    prunedToolResponses
  })

  return removeCount
}
