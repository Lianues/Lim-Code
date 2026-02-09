/**
 * Chat Store 流式处理器 - 主入口
 * 
 * 将各种流式处理功能模块化：
 * - streamHelpers.ts: 辅助函数（消息操作、工具解析）
 * - streamChunkHandlers.ts: 各种 chunk 类型的处理函数
 */

import type { StreamChunk } from '../../types'
import type { ChatStoreState, CheckpointRecord } from './types'
import { nextTick } from 'vue'
import { bufferBackgroundChunk, updateTabStreamingStatus } from './tabActions'

import {
  handleChunkType,
  handleToolsExecuting,
  handleToolStatus,
  handleToolStatusBatch,
  handleAwaitingConfirmation,
  handleToolIteration,
  handleComplete,
  handleCheckpoints,
  handleCancelled,
  handleError
} from './streamChunkHandlers'

// 重新导出辅助函数，保持向后兼容
export {
  addFunctionCallToMessage,
  addTextToMessage,
  processStreamingText,
  flushToolCallBuffer
} from './streamHelpers'

/**
 * 创建流式处理器上下文
 */
export interface StreamHandlerContext {
  state: ChatStoreState
  currentModelName: () => string
  addCheckpoint: (checkpoint: CheckpointRecord) => void
  updateConversationAfterMessage: () => Promise<void>
  /** AI 响应结束后处理消息队列 */
  processQueue: () => Promise<void>
}

/**
 * 处理单条流式响应
 */
export function handleStreamChunk(
  chunk: StreamChunk,
  ctx: StreamHandlerContext
): void {
  const { state, currentModelName, addCheckpoint, updateConversationAfterMessage, processQueue } = ctx
  
  // 非当前活跃对话的流式响应 -> 缓冲到后台并更新标签页状态
  if (chunk.conversationId !== state.currentConversationId.value) {
    bufferBackgroundChunk(state, chunk)
    updateTabStreamingStatus(state, chunk)
    return
  }

  // 更新当前活跃标签页的流式状态
  updateTabStreamingStatus(state, chunk)
  
  switch (chunk.type) {
    case 'chunk':
      if (chunk.chunk && state.streamingMessageId.value) {
        handleChunkType(chunk, state)
      }
      break
      
    case 'toolsExecuting':
      handleToolsExecuting(chunk, state)
      break

    case 'toolStatus':
      handleToolStatus(chunk, state)
      break
      
    case 'awaitingConfirmation':
      handleAwaitingConfirmation(chunk, state, addCheckpoint)
      break
      
    case 'toolIteration':
      if (chunk.content) {
        handleToolIteration(chunk, state, currentModelName, addCheckpoint)
      }
      break
      
    case 'complete':
      if (chunk.content) {
        handleComplete(chunk, state, addCheckpoint, updateConversationAfterMessage)
        nextTick(() => processQueue())
      }
      break
      
    case 'checkpoints':
      handleCheckpoints(chunk, addCheckpoint)
      break
      
    case 'cancelled':
      handleCancelled(chunk, state)
      break
      
    case 'error':
      handleError(chunk, state)
      break
  }
}

/**
 * 批量处理多条流式响应（性能优化）。
 *
 * 将连续的 toolStatus chunk 合并为一次 allMessages 替换，
 * 其余类型仍逐条处理。整个批量在同一同步上下文中完成，
 * Vue 会自动将所有响应式变更合并为一次组件更新。
 */
export function handleStreamChunkBatch(
  chunks: StreamChunk[],
  ctx: StreamHandlerContext
): void {
  const { state } = ctx
  let i = 0
  while (i < chunks.length) {
    const chunk = chunks[i]

    // 对连续的 toolStatus chunk，收集为一组批量处理
    if (
      chunk.type === 'toolStatus' &&
      chunk.conversationId === state.currentConversationId.value
    ) {
      const batch: StreamChunk[] = [chunk]
      let j = i + 1
      while (
        j < chunks.length &&
        chunks[j].type === 'toolStatus' &&
        chunks[j].conversationId === state.currentConversationId.value
      ) {
        batch.push(chunks[j])
        j++
      }

      if (batch.length > 1) {
        // 批量标签页状态更新（只取最后一条）
        updateTabStreamingStatus(state, batch[batch.length - 1])
        handleToolStatusBatch(batch, state)
      } else {
        // 只有一条，走常规路径
        handleStreamChunk(chunk, ctx)
      }
      i = j
    } else {
      handleStreamChunk(chunk, ctx)
      i++
    }
  }
}
