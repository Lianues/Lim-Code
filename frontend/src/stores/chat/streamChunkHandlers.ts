/**
 * 流式 Chunk 处理器
 * 
 * 处理各种类型的 StreamChunk
 */

import type { Message, StreamChunk, ToolUsage, ToolExecutionResult } from '../../types'
import type { ChatStoreState, CheckpointRecord } from './types'
import { triggerRef } from 'vue'
import { generateId } from '../../utils/format'
import { contentToMessage, contentToMessageEnhanced } from './parsers'
import {
  addTextToMessage,
  processStreamingText,
  flushToolCallBuffer,
  handleFunctionCallPart
} from './streamHelpers'
import {
  appendMessage,
  getMessageIndexById,
  insertMessageAt,
  removeMessageAt,
  replaceMessageAt
} from './state'
import { syncTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'
import { getToolApprovalStopKind } from '../../utils/toolContinuations'
import { t } from '../../i18n'

function getNextBackendIndex(state: ChatStoreState): number {
  return state.windowStartIndex.value + state.allMessages.value.length
}

/**
 * 合并工具列表：以 incoming（按 AI 输出顺序）为基准，尽量保留 existing 中的运行态字段。
 *
 * 目标：避免 toolsExecuting/awaitingConfirmation/toolIteration 阶段用 contentToMessage 生成的
 * “queued” 覆盖掉 toolStatus 写入的真实状态/结果。
 */
function mergeToolsPreferExisting(
  existing: ToolUsage[] | undefined,
  incoming: ToolUsage[] | undefined
): ToolUsage[] | undefined {
  const a = existing || []
  const b = incoming || []
  if (a.length === 0) return b.length > 0 ? b : undefined
  if (b.length === 0) return a.length > 0 ? a : undefined

  const byId = new Map<string, ToolUsage>()
  const byItemId = new Map<string, ToolUsage>()
  const byIndex = new Map<number, ToolUsage>()
  for (const t of a) {
    if (!t) continue
    if (typeof t.id === 'string') byId.set(t.id, t)
    // 为什么 existing/incoming 不能只按 id 合并：Responses 流式早期可能只有 itemId/output_index，最终才稳定到 call_id。
    // 怎么改：把 itemId 和数字 index 都作为前端投影的内部合并键，且允许 index=0。
    // 目的：contentSnapshot 到达时替换“参数 0”的占位工具，而不是把它追加回工具列表末尾。
    if (typeof t.itemId === 'string' && t.itemId.trim()) byItemId.set(t.itemId, t)
    if (typeof t.index === 'number') byIndex.set(t.index, t)
  }

  const consumedExisting = new Set<ToolUsage>()
  const merged: ToolUsage[] = []
  for (const t of b) {
    const e = byId.get(t.id)
      || (typeof t.itemId === 'string' && t.itemId.trim() ? byItemId.get(t.itemId) : undefined)
      || (typeof t.index === 'number' ? byIndex.get(t.index) : undefined)
    if (!e) {
      merged.push(t)
      continue
    }

    consumedExisting.add(e)
    const incomingHasArgs = !!(t.args && Object.keys(t.args).length > 0)
    const partialArgs = typeof t.partialArgs === 'string'
      ? (typeof e.partialArgs === 'string' && e.partialArgs.length > t.partialArgs.length ? e.partialArgs : t.partialArgs)
      : (incomingHasArgs ? undefined : e.partialArgs)

    let status = e.status ?? t.status
    if (!partialArgs && incomingHasArgs && status === 'streaming') {
      status = 'queued'
    }

    // incoming 提供更完整的 name/args；existing 提供更可信的 status/result/error/duration
    merged.push({
      ...e,
      ...t,
      status,
      result: e.result ?? t.result,
      error: e.error ?? t.error,
      duration: e.duration ?? t.duration,
      awaitingConfirmation: e.awaitingConfirmation ?? t.awaitingConfirmation,
      itemId: t.itemId ?? e.itemId,
      index: typeof t.index === 'number' ? t.index : e.index,
      partialArgs
    })
  }

  // 兜底：append 可能存在但不在 incoming 中的 existing 工具（极端竞态）。
  // 为什么要用 consumedExisting 而不是 byId.delete：同一逻辑工具可能通过 itemId/index 匹配成功，id 却不同。
  // 怎么改：只追加完全没有被任何合并键消费过的旧工具。
  // 目的：避免 id 修正后，旧的 0 参数占位工具被当成“未出现在 incoming 中的工具”重新追加。
  for (const t of a) {
    if (!consumedExisting.has(t)) merged.push(t)
  }

  return merged.length > 0 ? merged : undefined
}

function normalizeStreamingToQueued(status?: ToolUsage['status']): ToolUsage['status'] | undefined {
  return status === 'streaming' ? 'queued' : status
}

function isToolArgsSnapshot(args: unknown): args is Record<string, unknown> {
  // 修改原因：toolStatus 现在可以携带完整 args，但旧后端或部分事件仍可能不带该字段。
  // 修改方式：集中判断 args 是否为对象快照，避免单条和批量 toolStatus 更新各自写一份判空逻辑。
  // 修改目的：只有收到权威参数快照时才覆盖 ToolUsage.args，并清理过期 partialArgs。
  return !!args && typeof args === 'object' && !Array.isArray(args)
}

function buildMessageFromContentSnapshot(currentMessage: Message, snapshotContent: NonNullable<StreamChunk['chunk']>['contentSnapshot']): Message {
  const existingModelVersion = currentMessage.metadata?.modelVersion
  const snapshotMessage = contentToMessageEnhanced(snapshotContent!, currentMessage.id)
  let mergedTools = mergeToolsPreferExisting(currentMessage.tools, snapshotMessage.tools)

  const updatedMessage: Message = {
    ...currentMessage,
    ...snapshotMessage,
    id: currentMessage.id,
    timestamp: currentMessage.timestamp,
    backendIndex: currentMessage.backendIndex,
    localOnly: currentMessage.localOnly,
    streaming: currentMessage.streaming,
    // 三级 fallback：合并结果 > snapshot 提取的 tools > 已有的 tools
    // 确保 snapshot 重建不会因为 merge 结果为空而丢失工具信息
    tools: (mergedTools && mergedTools.length > 0)
      ? mergedTools
      : (snapshotMessage.tools && snapshotMessage.tools.length > 0 ? snapshotMessage.tools : currentMessage.tools)
  }

  if (!updatedMessage.metadata) {
    updatedMessage.metadata = {}
  }

  if (existingModelVersion) {
    updatedMessage.metadata.modelVersion = existingModelVersion
  }

  return updatedMessage
}

/**
 * 根据工具响应推断前端统一状态机（与 ToolMessage 的逻辑对齐）。
 */
function deriveToolStatusFromResult(result: Record<string, unknown>): ToolUsage['status'] {
  const r = result as any

  // 明确的失败/取消/拒绝优先
  if (r?.cancelled || r?.rejected) return 'error'
  if (r?.success === false) return 'error'
  if (typeof r?.error === 'string' && r.error.trim()) return 'error'

  const data = r?.data
  if (data && typeof data === 'object') {
    // diff 等工具可能返回 data.status=pending 表示等待用户应用/审阅
    if ((data as any).status === 'pending') return 'awaiting_apply'

    const appliedCount = (data as any).appliedCount
    const failedCount = (data as any).failedCount
    if (typeof appliedCount === 'number' && typeof failedCount === 'number' && appliedCount > 0 && failedCount > 0) {
      return 'warning'
    }
  }

  return 'success'
}

/**
 * 处理 chunk 类型
 */
export function handleChunkType(chunk: StreamChunk, state: ChatStoreState): void {
  // 修改原因：chunk 增量是 WP32 的核心热路径，按 streamingMessageId 的定位不应反复 O(n) 扫描。
  // 修改方式：先查 messageIndexById；若索引缺失/过期，由 helper 回退到 findIndex 并回填。
  // 修改目的：保持 streamingMessageId -> assistant 消息的既有语义不变，同时把查找降为 O(1)。
  const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  if (messageIndex === -1 || !chunk.chunk) {
    return
  }

  const snapshotContent = chunk.chunk.contentSnapshot
  if (snapshotContent) {
    const updatedMessage = buildMessageFromContentSnapshot(state.allMessages.value[messageIndex], snapshotContent)
    replaceMessageAt(state, messageIndex, updatedMessage)
  }

  const message = state.allMessages.value[messageIndex]
  if (chunk.chunk.delta) {
    // 初始化 parts（如果不存在）
    if (!message.parts) {
      message.parts = []
    }
    
    // 没有快照时，按增量追加；有快照时，以快照为准，跳过旧的本地文本猜测逻辑
    if (!snapshotContent) {
      for (const part of chunk.chunk.delta) {
        if (part.text) {
          if (part.thought) {
            addTextToMessage(message, part.text, true)
          } else {
            processStreamingText(message, part.text, state)
          }
        }

        // 处理工具调用（原生 function call format）
        if (part.functionCall) {
          handleFunctionCallPart(part, message)
        }
      }
    }
    
    // 更新 token 信息和计时信息
    if (!message.metadata) {
      message.metadata = {}
    }
    
    // 如果 chunk 包含 thinkingStartTime，更新 metadata（用于实时显示思考时间）
    if ((chunk.chunk as any).thinkingStartTime) {
      message.metadata.thinkingStartTime = (chunk.chunk as any).thinkingStartTime
    }
    
    // 如果是最后一个 chunk（done=true），更新 token 信息
    // 注意：modelVersion 保持创建时的值，不从 API 响应更新
    if (chunk.chunk.done) {
      // 兜底：AI 输出结束，所有 streaming 工具应已完成参数输出
      if (message.tools) {
        for (const tool of message.tools) {
          if (tool.status === 'streaming') {
            tool.status = 'queued'
            // 清理流式预览状态
            delete tool.partialArgs
            // 从 parts 同步最终 args
            const matchingPart = message.parts?.find(
              p => p.functionCall && p.functionCall.id === tool.id
            )
            if (matchingPart?.functionCall?.args) {
              tool.args = matchingPart.functionCall.args
            }
          }
        }
      }

      if (chunk.chunk.usage) {
        message.metadata.usageMetadata = chunk.chunk.usage
        message.metadata.thoughtsTokenCount = chunk.chunk.usage.thoughtsTokenCount
        message.metadata.candidatesTokenCount = chunk.chunk.usage.candidatesTokenCount
      }
    }
  }
}

/**
 * 处理 toolsExecuting 类型
 */
export function handleToolsExecuting(chunk: StreamChunk, state: ChatStoreState): void {
  // 工具即将开始执行（不需要确认的工具，或用户已确认的工具）
  // 在工具执行前先更新消息的计时信息，让前端立即显示

  // 重要：将 isStreaming 设为 true，这样用户点击取消时会发送取消请求到后端
  // 这解决了用户确认工具后点击取消不生效的问题
  state.isStreaming.value = true

  // 修改原因：toolsExecuting 在工具批量推进期间可能频繁到达，属于高频状态更新路径。
  // 修改方式：通过 messageIndexById 直接命中当前 streaming assistant；helper 保留 fallback 兼容旧快照/失配索引。
  // 修改目的：去掉热路径 findIndex，但不改变 toolsExecuting 原有状态推进语义。
  const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)

  if (messageIndex !== -1 && chunk.content) {
    const message = state.allMessages.value[messageIndex]

    // 保存原有的 modelVersion 和 tools
    // 注意：必须保留原始 tools，因为 contentToMessage 会将工具状态设为 success
    const existingModelVersion = message.metadata?.modelVersion
    const existingTools = message.tools

    const finalMessage = contentToMessage(chunk.content, message.id)

    // 诊断日志
    const fcCount = finalMessage.parts?.filter(p => p.functionCall).length ?? 0
    console.debug(`[handleToolsExecuting] msgId=${message.id} existingTools=${existingTools?.length ?? 0} contentTools=${finalMessage.tools?.length ?? 0} fcParts=${fcCount}`)

    // 合并 tools：以 finalMessage.tools 的顺序为基准，保留 existingTools 的运行态字段
    const mergedTools = mergeToolsPreferExisting(existingTools, finalMessage.tools) || []

    // 创建更新后的消息对象
    const updatedMessage: Message = {
      ...message,
      ...finalMessage,
      streaming: false,
      // toolsExecuting 阶段的 content 已写入后端历史（模型消息已持久化）
      localOnly: false,
      // 优先使用合并结果，其次回退到已有 tools，避免 batch 跳过 chunk 导致 tools 丢失
      tools: mergedTools.length > 0 ? mergedTools : (existingTools || undefined)
    }

    // 恢复原有的 modelVersion，同时保留后端返回的计时信息
    if (updatedMessage.metadata) {
      if (existingModelVersion) {
        updatedMessage.metadata.modelVersion = existingModelVersion
      }
      delete updatedMessage.metadata.thinkingStartTime
    }

    // 标记工具为 executing/queued 状态（后一个工具必须等待前一个完成，因此同一批次只把队首标为 executing）
    if (updatedMessage.tools) {
      const pending = (chunk.pendingToolCalls || []) as Array<{ id: string }>
      const executingId = pending[0]?.id
      const queuedIds = new Set(pending.slice(1).map(t => t.id))

      updatedMessage.tools = updatedMessage.tools.map(tool => {
        // AI 输出完成后，工具如果还停留在 streaming，则进入 queued，并清理 partialArgs
        const isStreaming = tool.status === 'streaming'
        const baseStatus = isStreaming ? 'queued' : tool.status
        const baseTool = isStreaming ? { ...tool, partialArgs: undefined } : tool

        if (executingId && tool.id === executingId) {
          return { ...baseTool, status: 'executing' as const }
        }
        if (queuedIds.has(tool.id)) {
          return { ...baseTool, status: 'queued' as const }
        }
        return { ...baseTool, status: baseStatus as any }
      })
    }

    // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
    replaceMessageAt(state, messageIndex, updatedMessage)
  }
  // 注意：不改变 streaming 状态，工具还在执行中
}

/**
 * 处理 toolStatus 类型（用于实时排队推进）
 */
export function handleToolStatus(chunk: StreamChunk, state: ChatStoreState): void {
  if (!chunk.toolStatus || !chunk.tool) return

  const toolUpdate = chunk.tool
  const all = state.allMessages.value

  // 1) 优先更新当前 streamingMessageId 对应的消息（通常就是包含工具调用的 assistant 消息）
  let messageIndex = -1
  if (state.streamingMessageId.value) {
    // 修改原因：toolStatus 是最容易在长会话中反复触发的高频状态事件之一。
    // 修改方式：先用 messageIndexById 命中当前 streaming assistant；helper 内部保留 findIndex fallback 并回填索引。
    // 修改目的：在不改变 toolStatus 状态机条件的前提下，把首选定位从 O(n) 降为 O(1)。
    const idx = getMessageIndexById(state, state.streamingMessageId.value)
    if (idx !== -1) {
      const m = all[idx]
      if (m.role === 'assistant' && m.tools?.some(t => t.id === toolUpdate.id)) {
        messageIndex = idx
      }
    }
  }

  // 2) fallback：从后往前找最近一条包含该 toolId 的 assistant 消息
  if (messageIndex === -1) {
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i]
      if (m.role === 'assistant' && m.tools?.some(t => t.id === toolUpdate.id)) {
        messageIndex = i
        break
      }
    }
  }

  if (messageIndex === -1) return

  const message = all[messageIndex]
  const updatedTools = message.tools?.map(t => {
    if (t.id !== toolUpdate.id) return t

    const hasArgsSnapshot = isToolArgsSnapshot(toolUpdate.args)
    return {
      ...t,
      status: toolUpdate.status as any,
      // 修改原因：流式提前执行的 executing/toolStatus 可能早于前端完成 partialArgs 解析，旧逻辑只更新 status/result 会留下不完整卡片。
      // 修改方式：收到后端 args 快照时覆盖本地 args，并清掉 partialArgs，使描述和自定义工具组件立即使用完整参数。
      // 修改目的：统一修复所有提前执行工具 pending/executing 阶段显示不完整的问题。
      ...(hasArgsSnapshot ? { args: toolUpdate.args, partialArgs: undefined } : {}),
      // 允许后端在 end 事件里携带结果，让前端即时展示（不影响历史索引）
      result: (toolUpdate.result as any) ?? t.result
    }
  })

  const updatedMessage: Message = {
    ...message,
    tools: updatedTools
  }

  replaceMessageAt(state, messageIndex, updatedMessage)
}

/**
 * 批量处理多个 toolStatus 更新（性能优化）。
 * 将多个 toolStatus chunk 的更新合并后只替换一次 allMessages，
 * 避免 N 次数组展开复制和 N 次 Vue 响应式通知。
 */
export function handleToolStatusBatch(chunks: StreamChunk[], state: ChatStoreState): void {
  if (chunks.length === 0) return

  // 收集所有 tool 更新，按目标消息分组
  interface ToolUpdate {
    status: any
    result: any
    /**
     * 修改原因：批量 toolStatus 和单条 toolStatus 共享同一数据契约，都可能携带完整参数快照。
     * 修改方式：把 args 纳入批量更新缓存，稍后统一覆盖对应 ToolUsage.args。
     * 修改目的：避免 streamChunkBatch 路径仍然丢失提前执行工具的完整参数。
     */
    args?: Record<string, unknown>
  }
  const updatesByMessageIndex = new Map<number, Map<string, ToolUpdate>>()
  const all = state.allMessages.value

  for (const chunk of chunks) {
    if (!chunk.toolStatus || !chunk.tool) continue
    const toolUpdate = chunk.tool

    // 查找目标消息
    let messageIndex = -1
    if (state.streamingMessageId.value) {
      // 修改原因：toolStatusBatch 是专门的性能路径，内部不应继续保留按 id 的线性查找热点。
      // 修改方式：与单条 toolStatus 共享同一个 O(1)+fallback helper，保证两条路径语义一致。
      // 修改目的：批量状态更新时继续消除不必要的 allMessages.findIndex 扫描。
      const idx = getMessageIndexById(state, state.streamingMessageId.value)
      if (idx !== -1) {
        const m = all[idx]
        if (m.role === 'assistant' && m.tools?.some(t => t.id === toolUpdate.id)) {
          messageIndex = idx
        }
      }
    }
    if (messageIndex === -1) {
      for (let i = all.length - 1; i >= 0; i--) {
        const m = all[i]
        if (m.role === 'assistant' && m.tools?.some(t => t.id === toolUpdate.id)) {
          messageIndex = i
          break
        }
      }
    }
    if (messageIndex === -1) continue

    if (!updatesByMessageIndex.has(messageIndex)) {
      updatesByMessageIndex.set(messageIndex, new Map())
    }
    updatesByMessageIndex.get(messageIndex)!.set(toolUpdate.id, {
      status: toolUpdate.status,
      result: toolUpdate.result,
      args: isToolArgsSnapshot(toolUpdate.args) ? toolUpdate.args : undefined
    })
  }

  if (updatesByMessageIndex.size === 0) return

  for (const [msgIdx, toolUpdates] of updatesByMessageIndex) {
    const message = state.allMessages.value[msgIdx]
    if (!message) continue
    const updatedTools = message.tools?.map(t => {
      const update = toolUpdates.get(t.id)
      if (!update) return t
      const hasArgsSnapshot = isToolArgsSnapshot(update.args)
      return {
        ...t,
        status: update.status as any,
        // 修改原因：streamChunkBatch 会把多个 toolStatus 合并处理；如果这里不合并 args，批量路径仍会显示半截参数。
        // 修改方式：与单条路径相同，收到 args 快照后覆盖本地 args 并清理 partialArgs。
        // 修改目的：无论状态事件是单条还是批量到达，工具卡片都能立即完整显示。
        ...(hasArgsSnapshot ? { args: update.args, partialArgs: undefined } : {}),
        result: (update.result as any) ?? t.result
      }
    })
    replaceMessageAt(state, msgIdx, { ...message, tools: updatedTools })
  }
}

/**
 * 处理 awaitingConfirmation 类型
 */
export function handleAwaitingConfirmation(
  chunk: StreamChunk,
  state: ChatStoreState,
  addCheckpoint: (checkpoint: CheckpointRecord) => void
): void {
  // 等待用户确认工具执行
  // 修改原因：awaitingConfirmation 是审批门闸 UX 红线区，不能改语义，但可以消除按 id 的线性热点。
  // 修改方式：通过 messageIndexById 获取当前 assistant 位置；若索引失配，helper 回退到 findIndex 并回填。
  // 修改目的：保持审批等待行为不变，同时减少长会话时的定位成本。
  const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  if (messageIndex !== -1 && chunk.content) {
    const message = state.allMessages.value[messageIndex]
    // 保存原有的 modelVersion
    const existingModelVersion = message.metadata?.modelVersion
    const existingTools = message.tools

    const finalMessage = contentToMessage(chunk.content, message.id)

    // 合并 tools：以 finalMessage.tools 的顺序为基准，保留 existingTools 的运行态字段
    const mergedTools = mergeToolsPreferExisting(existingTools, finalMessage.tools) || []

    // 创建更新后的消息对象
    const updatedMessage: Message = {
      ...message,
      ...finalMessage,
      streaming: false,
      // awaitingConfirmation 阶段的 content 已写入后端历史（模型消息已持久化）
      localOnly: false,
      tools: mergedTools.length > 0 ? mergedTools : undefined
    }

    // 恢复原有的 modelVersion，同时保留后端返回的计时信息
    if (updatedMessage.metadata) {
      // 恢复原有的 modelVersion
      if (existingModelVersion) {
        updatedMessage.metadata.modelVersion = existingModelVersion
      }
      // 确保计时信息从 chunk.content 正确传递
      // contentToMessage 已经从 chunk.content 提取了这些信息
      // 但如果原消息有 thinkingStartTime，需要清除（因为思考已完成）
      delete updatedMessage.metadata.thinkingStartTime
    }

    // 标记工具为等待确认状态，并同步已自动执行的工具结果（autoPrefix）
    if (updatedMessage.tools) {
      const pendingIds = new Set((chunk.pendingToolCalls || []).map((t: any) => t.id))
      const toolResults = chunk.toolResults || []
      const toolResultMap = new Map<string, ToolExecutionResult>()
      for (const tr of toolResults) {
        if (tr && typeof tr.id === 'string') {
          toolResultMap.set(tr.id, tr)
        }
      }

      // 使用 map 创建新数组
      updatedMessage.tools = updatedMessage.tools.map(tool => {
        // AI 输出完成后，工具如果还停留在 streaming，则进入 queued，并清理 partialArgs
        const isStreaming = tool.status === 'streaming'
        const baseStatus = (isStreaming ? 'queued' : tool.status) || 'queued'
        const baseTool = isStreaming ? { ...tool, partialArgs: undefined } : tool

        if (pendingIds.has(tool.id)) {
          // 轮到该工具，等待用户批准
          return { ...baseTool, status: 'awaiting_approval' as const }
        }
        
        // 如果有自动执行的结果，写回 result，并推断最终状态（success/error/warning/awaiting_apply）
        const tr = toolResultMap.get(tool.id)
        if (tr) {
          const result = tr.result as Record<string, unknown>
          const status = deriveToolStatusFromResult(result)
          const errFromResult =
            typeof (result as any)?.error === 'string' && (result as any).error.trim()
              ? String((result as any).error)
              : undefined
          return { ...baseTool, status, result, error: tool.error ?? errFromResult }
        }
        
        return { ...baseTool, status: baseStatus as any }
      })
    }

    // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
    replaceMessageAt(state, messageIndex, updatedMessage)
  }

  // 将 toolResults 也同步为一个隐藏的 functionResponse 消息（保持与 toolIteration 行为一致），
  // 这样 getToolResponseById / hasToolResponse 等逻辑可以正常工作。
  if (chunk.toolResults && chunk.toolResults.length > 0) {
    const existingResponseIds = new Set<string>()
    for (const m of state.allMessages.value) {
      if (m.isFunctionResponse && m.parts) {
        for (const p of m.parts) {
          if (p.functionResponse?.id) {
            existingResponseIds.add(p.functionResponse.id)
          }
        }
      }
    }

    const newParts = chunk.toolResults
      .filter(r => r.id && !existingResponseIds.has(r.id))
      .map(r => ({
        functionResponse: {
          name: r.name,
          response: r.result,
          id: r.id
        }
      }))

    if (newParts.length > 0) {
      const responseMessage: Message = {
        id: generateId(),
        role: 'user',
        content: '',
        timestamp: Date.now(),
        backendIndex: getNextBackendIndex(state),
        isFunctionResponse: true,
        parts: newParts
      }
      appendMessage(state, responseMessage)
      syncTotalMessagesFromWindow(state)
      trimWindowFromTop(state)

      // 同步填充工具响应缓存，加速后续 getToolResponseById 查询
      for (const p of newParts) {
        if (p.functionResponse.id && p.functionResponse.response) {
          state.toolResponseCache.value.set(
            p.functionResponse.id,
            p.functionResponse.response as Record<string, unknown>
          )
        }
      }
      // 手动触发 ref 更新，因为 Map.set() 不会被 Vue 的 ref 追踪
      triggerRef(state.toolResponseCache)
    }
  }

  // 处理可能包含的检查点
  if (chunk.checkpoints && chunk.checkpoints.length > 0) {
    for (const cp of chunk.checkpoints) {
      addCheckpoint(cp)
    }
  }

  // 注意：不结束 streaming 状态的等待标志，因为需要等用户确认
  // 但 isStreaming 设为 false 允许用户操作
  state.isStreaming.value = false
  state.activeStreamId.value = null
  state._lastApprovalGatedStreamId.value = null
  // isWaitingForResponse 保持 true 或设为特殊状态
}

/**
 * 处理 toolIteration 类型
 */
export function handleToolIteration(
  chunk: StreamChunk,
  state: ChatStoreState,
  currentModelName: () => string,
  addCheckpoint: (checkpoint: CheckpointRecord) => void
): void {
  // 工具迭代完成：当前消息包含工具调用
  // 修改原因：toolIteration 会在工具回合之间多次切换占位 assistant，属于热路径。
  // 修改方式：优先用 messageIndexById 命中当前流式消息；helper 提供 fallback，避免旧快照/迟到包造成行为变化。
  // 修改目的：把同一流式消息的重复定位从 O(n) 降为 O(1)。
  const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  
  // 检查是否有工具被取消或拒绝
  const cancelledToolIds = new Set<string>()
  const toolResultMap = new Map<string, ToolExecutionResult>()
  if (chunk.toolResults) {
    for (const r of chunk.toolResults) {
      if (r && typeof r.id === 'string') {
        toolResultMap.set(r.id, r)
      }
      if ((r.result as any).cancelled && r.id) {
        cancelledToolIds.add(r.id)
      }
    }
  }
  const hasCancelledTools = cancelledToolIds.size > 0

  // 检查是否有工具要求暂停循环（如 create_plan 要求用户确认执行）
  const hasUserConfirmation = chunk.toolResults?.some(
    r => (r.result as any)?.requiresUserConfirmation
  ) ?? false

  let restoredTools: ToolUsage[] | undefined

  if (messageIndex !== -1) {
    const message = state.allMessages.value[messageIndex]
    // 保存原有的 tools 信息和 modelVersion
    const existingTools = message.tools
    const existingModelVersion = message.metadata?.modelVersion
    
    const finalMessage = contentToMessage(chunk.content!, message.id)
    
    // 诊断日志
    const fcCount = finalMessage.parts?.filter(p => p.functionCall).length ?? 0
    console.debug(`[handleToolIteration] msgId=${message.id} existingTools=${existingTools?.length ?? 0} contentTools=${finalMessage.tools?.length ?? 0} fcParts=${fcCount}`)

    // 恢复原有的 modelVersion，同时保留后端返回的计时信息
    if (finalMessage.metadata) {
      if (existingModelVersion) {
        finalMessage.metadata.modelVersion = existingModelVersion
      }
      // 清除 thinkingStartTime（因为思考已完成，后端已返回 thinkingDuration）
      delete finalMessage.metadata.thinkingStartTime
    }
    
    // 合并 tools：以 finalMessage.tools 顺序为基准，保留 existingTools 的运行态字段
    restoredTools = mergeToolsPreferExisting(existingTools, finalMessage.tools)
    if (!restoredTools || restoredTools.length === 0) {
      restoredTools = existingTools
    }

    // 依据 toolResults 写回 result，并推断最终状态（避免默认全 success 覆盖失败/警告/awaiting_apply）
    if (restoredTools && restoredTools.length > 0) {
      restoredTools = restoredTools.map(tool => {
        const tr = toolResultMap.get(tool.id)
        if (tr) {
          const result = tr.result as Record<string, unknown>
          const status = deriveToolStatusFromResult(result)
          const errFromResult =
            typeof (result as any)?.error === 'string' && (result as any).error.trim()
              ? String((result as any).error)
              : undefined
          return { ...tool, status, result, error: tool.error ?? errFromResult }
        }
        // 极端兜底：无 toolResult 时，仅归一 streaming→queued，避免卡死在 streaming
        const baseStatus = normalizeStreamingToQueued(tool.status)
        return { ...tool, status: baseStatus as any }
      })
    }
    
    // 创建更新后的消息对象（确保 Vue 响应式更新）
    // 保护 parts：如果 finalMessage.parts 缺少 functionCall 但 restoredTools 存在，
    // 保留原始 parts 以确保渲染工具块
    const safePartsForToolIteration = (restoredTools && restoredTools.length > 0 &&
      finalMessage.parts && !finalMessage.parts.some(p => p.functionCall))
      ? message.parts
      : finalMessage.parts
    const updatedMessage: Message = {
      ...message,
      ...finalMessage,
      streaming: false,
      // toolIteration 阶段的 content 已写入后端历史（模型消息已持久化）
      localOnly: false,
      tools: restoredTools,
      parts: safePartsForToolIteration
    }
    
    // 用新对象替换数组中的旧对象
    replaceMessageAt(state, messageIndex, updatedMessage)
  }
  
  // 添加 functionResponse 消息（标记为隐藏）
  // 注意：在“自动执行 + 等待批准”混合场景下，部分 toolResults 可能已在 awaitingConfirmation 阶段被同步过。
  // 这里做一次去重，避免重复插入。
  if (chunk.toolResults && chunk.toolResults.length > 0) {
    const existingResponseIds = new Set<string>()
    for (const m of state.allMessages.value) {
      if (m.isFunctionResponse && m.parts) {
        for (const p of m.parts) {
          if (p.functionResponse?.id) {
            existingResponseIds.add(p.functionResponse.id)
          }
        }
      }
    }

    const parts = chunk.toolResults
      .filter(r => r.id && !existingResponseIds.has(r.id))
      .map(r => ({
        functionResponse: {
          name: r.name,
          response: r.result,
          id: r.id
        }
      }))

    if (parts.length > 0) {
      const responseMessage: Message = {
        id: generateId(),
        role: 'user',
        content: '',
        timestamp: Date.now(),
        backendIndex: getNextBackendIndex(state),
        isFunctionResponse: true,
        parts
      }
      appendMessage(state, responseMessage)
      syncTotalMessagesFromWindow(state)
      trimWindowFromTop(state)

      // 同步填充工具响应缓存
      for (const p of parts) {
        if (p.functionResponse.id && p.functionResponse.response) {
          state.toolResponseCache.value.set(
            p.functionResponse.id,
            p.functionResponse.response as Record<string, unknown>
          )
        }
      }
      // 手动触发 ref 更新，因为 Map.set() 不会被 Vue 的 ref 追踪
      triggerRef(state.toolResponseCache)
    }
  }
  
  // 处理新创建的检查点
  if (chunk.checkpoints && chunk.checkpoints.length > 0) {
    for (const cp of chunk.checkpoints) {
      addCheckpoint(cp)
    }
  }
  
  const toolArgsById = new Map<string, Record<string, unknown>>()
  for (const tool of restoredTools || []) {
    const args = tool.args && typeof tool.args === 'object'
      ? tool.args as Record<string, unknown>
      : {}
    toolArgsById.set(tool.id, args)
  }

  const hasApprovalStop = chunk.toolResults?.some(result => {
    const args = typeof result.id === 'string'
      ? toolArgsById.get(result.id)
      : undefined
    return getToolApprovalStopKind(result.name, result.result, args) !== null
  }) ?? false

  // 如果有工具被取消 或 有工具要求用户确认后再继续，结束 streaming 状态
  // requiresUserConfirmation: 工具执行后的门闸（如 create_plan）
  // hasApprovalStop: 覆盖 review -> plan 这类不依赖 requiresUserConfirmation 的宿主审批停止
  if (hasCancelledTools || hasUserConfirmation || hasApprovalStop) {
    state.streamingMessageId.value = null
    state.activeStreamId.value = null
    state.isStreaming.value = false
    state.isWaitingForResponse.value = false
    state._lastApprovalGatedStreamId.value = hasApprovalStop && chunk.streamId
      ? chunk.streamId
      : null
    return
  }

  state._lastApprovalGatedStreamId.value = null
  
  // 创建新的占位消息用于接收后续 AI 响应
  const newAssistantMessageId = generateId()
  const newAssistantMessage: Message = {
    id: newAssistantMessageId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    backendIndex: getNextBackendIndex(state),
    streaming: true,
    localOnly: true,
    metadata: {
      modelVersion: state.pendingModelOverride.value || currentModelName()
    }
  }
  appendMessage(state, newAssistantMessage)
  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)
  state.streamingMessageId.value = newAssistantMessageId
  
  // 确保状态正确设置，这样用户可以在后续 AI 响应期间点击取消按钮
  // 这对于非流式模式尤为重要，因为工具执行完毕后会自动发起新的 AI 请求
  state.isStreaming.value = true
  state.isWaitingForResponse.value = true
}

/**
 * 处理 complete 类型
 */
export function handleComplete(
  chunk: StreamChunk,
  state: ChatStoreState,
  addCheckpoint: (checkpoint: CheckpointRecord) => void,
  updateConversationAfterMessage: () => Promise<void>
): void {
  // 竞态检测：如果 cancelStream 已清理旧请求，而新请求已开始，
  // 迟到的旧请求 complete chunk 不应该影响新请求的消息和状态
  const lastCancelledId = state._lastCancelledStreamId.value
  const isStaleCallback = !chunk.streamId && !!(
    lastCancelledId &&
    state.streamingMessageId.value &&
    state.streamingMessageId.value !== lastCancelledId
  )

  if (isStaleCallback) {
    state._lastCancelledStreamId.value = null
    return
  }

  // 修改原因：complete 是每次主响应结束都会命中的关键路径，不应继续依赖 findIndex 线性扫描。
  // 修改方式：使用 messageIndexById helper；若索引未命中，仍回退到 findIndex 并回填，保证旧行为兼容。
  // 修改目的：在不改变 complete 完成语义的前提下，降低消息定位复杂度。
  const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  if (messageIndex !== -1) {
    const message = state.allMessages.value[messageIndex]
    // 保存原有的 tools 信息（complete 阶段的 content 通常只含文本，不含 functionCall）
    const existingTools = message.tools
    // 刷新工具调用缓冲区
    flushToolCallBuffer(message, state)
    // 保存原有的 modelVersion（使用创建时的模型，不从 API 响应更新）
    const existingModelVersion = message.metadata?.modelVersion
    
    const finalMessage = contentToMessage(chunk.content!, message.id)
    
    // 诊断日志
    const fcCountComplete = finalMessage.parts?.filter(p => p.functionCall).length ?? 0
    console.debug(`[handleComplete] msgId=${message.id} existingTools=${existingTools?.length ?? 0} contentTools=${finalMessage.tools?.length ?? 0} fcParts=${fcCountComplete}`)

    // 恢复原有的 modelVersion
    if (existingModelVersion && finalMessage.metadata) {
      finalMessage.metadata.modelVersion = existingModelVersion
    }
    
    // 创建更新后的消息对象
    // 保护 parts：如果 finalMessage.parts 不含 functionCall 但旧消息有 tools，
    // 说明 complete 的 content 可能来自后续迭代（只有文本），不应覆盖工具调用的 parts
    const safePartsForComplete = (existingTools && existingTools.length > 0 &&
      finalMessage.parts && !finalMessage.parts.some(p => p.functionCall))
      ? message.parts
      : finalMessage.parts
    const updatedMessage: Message = {
      ...message,
      ...finalMessage,
      streaming: false,
      // complete 代表后端已持久化该模型消息
      localOnly: false,
      // 保留已有的 tools（finalMessage.tools 通常为 undefined，会覆盖已积累的工具信息）
      tools: finalMessage.tools && finalMessage.tools.length > 0
        ? finalMessage.tools
        : existingTools,
      parts: safePartsForComplete
    }
    
    // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
    replaceMessageAt(state, messageIndex, updatedMessage)
  }
  
  // 处理新创建的检查点
  if (chunk.checkpoints && chunk.checkpoints.length > 0) {
    for (const cp of chunk.checkpoints) {
      addCheckpoint(cp)
    }
  }
  
  state.streamingMessageId.value = null
  state.activeStreamId.value = null
  state.isStreaming.value = false
  state.isWaitingForResponse.value = false  // 结束等待
  state.autoSummaryStatus.value = null
  state.pendingModelOverride.value = null
  state._lastApprovalGatedStreamId.value = null
  state._lastCancelledStreamId.value = null
  
  // 流式完成后更新对话元数据
  updateConversationAfterMessage()
}

/**
 * 处理 checkpoints 类型
 */
export function handleCheckpoints(
  chunk: StreamChunk,
  addCheckpoint: (checkpoint: CheckpointRecord) => void
): void {
  // 立即收到的检查点（用户消息前后、模型消息前）
  if (chunk.checkpoints && chunk.checkpoints.length > 0) {
    for (const cp of chunk.checkpoints) {
      addCheckpoint(cp)
    }
  }
}

/**
 * 处理 autoSummaryStatus 类型
 */
export function handleAutoSummaryStatus(
  chunk: StreamChunk,
  state: ChatStoreState
): void {
  if (!chunk.autoSummaryStatus || !chunk.status) {
    return
  }

  if (chunk.status === 'started') {
    state.autoSummaryStatus.value = {
      isSummarizing: true,
      mode: 'auto',
      message: chunk.message
    }
    return
  }

  // completed / failed 都结束提示
  state.autoSummaryStatus.value = null
}


/**
 * 处理 autoSummary 类型
 *
 * 自动总结是在后端历史中直接 insertContent 的，
 * 前端需要同步插入一条总结消息，避免必须重载历史才能看到。
 */
export function handleContextCommand(chunk: StreamChunk, state: ChatStoreState): void {
  if (!chunk.contextCommand || !chunk.payload) return
  /**
   * 修改原因：context slash command 是本地协议结果，不应等待后端历史刷新后才可见，也不能当普通 LLM chunk 合并。
   * 修改方式：把结构化 payload 投影为一条 localOnly assistant 消息，metadata 保留原始 contextCommand payload 供后续卡片组件升级。
   * 修改目的：用户立即看到状态/确认/恢复边界，同时不把命令文本写入主模型上下文。
   */
  const payload = chunk.payload
  // 修改原因：localOnly 的 context command 内容虽然主要由卡片渲染，但复制、无 metadata 降级或调试时仍会显示 content。
  // 修改方式：把 Markdown fallback 的字段标签接入前端 i18n，命令文本本身保持原样以便用户执行。
  // 修改目的：避免 compact/summarize 卡片在中文界面中复制出英文标签。
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
  if (!chunk.summaryContent || typeof chunk.insertIndex !== 'number') {
    return
  }

  const insertIndex = chunk.insertIndex

  // 去重：避免重复插入同一个 summary
  const exists = state.allMessages.value.some(
    m => m.isSummary && typeof m.backendIndex === 'number' && m.backendIndex === insertIndex
  )
  if (exists) {
    return
  }

  // 如果插入位置在当前窗口之前，仅维护索引偏移即可
  if (insertIndex < state.windowStartIndex.value) {
    state.windowStartIndex.value += 1
    for (const msg of state.allMessages.value) {
      if (typeof msg.backendIndex === 'number') {
        msg.backendIndex += 1
      }
    }
    syncTotalMessagesFromWindow(state)
    return
  }

  // 先将当前窗口中插入点及之后的 backendIndex 后移 1
  for (const msg of state.allMessages.value) {
    if (typeof msg.backendIndex === 'number' && msg.backendIndex >= insertIndex) {
      msg.backendIndex += 1
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

/**
 * 处理 cancelled 类型
 */
export function handleCancelled(chunk: StreamChunk, state: ChatStoreState): void {
  // 竞态检测：判断这个 cancelled chunk 是否属于已被 cancelStream() 清理过的旧请求。
  // 如果 cancelStream() 已经清理了状态并且新请求已经开始（streamingMessageId 已变为新 ID），
  // 此时迟到的 cancelled chunk 不应该重置新请求的全局状态。
  const lastCancelledId = state._lastCancelledStreamId.value
  const isStaleCallback = !chunk.streamId && !!(
    lastCancelledId &&
    state.streamingMessageId.value &&
    state.streamingMessageId.value !== lastCancelledId
  )

  if (isStaleCallback) {
    // 迟到的旧请求 cancelled chunk：只尝试清理旧消息的元数据，不重置全局状态
    // 修改原因：迟到 cancelled 包的清理也会按旧 messageId 定位消息，长会话下同样会触发线性扫描。
    // 修改方式：复用 messageIndexById helper，保留 fallback 以兼容旧取消标记与快照恢复后的边界情况。
    // 修改目的：让 stale cancelled 清理与主流式路径共享同一 O(1) 定位机制。
    const oldMsgIndex = getMessageIndexById(state, lastCancelledId)
    if (oldMsgIndex !== -1) {
      const msg = state.allMessages.value[oldMsgIndex]
      if (msg.streaming) {
        replaceMessageAt(state, oldMsgIndex, { ...msg, streaming: false })
      }
    }
    state._lastCancelledStreamId.value = null
    return
  }

  // 正常的 cancelled 处理
  let messageIndex = -1
  if (state.streamingMessageId.value) {
    // 修改原因：cancelled 正常路径仍优先依赖 streamingMessageId 定位当前消息。
    // 修改方式：统一走 messageIndexById helper，索引失配时自动 fallback 到旧 findIndex。
    // 修改目的：减少取消完成时对 allMessages 的重复线性扫描，同时保持原有回退分支不变。
    messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  } else {
    // 兼容性处理：如果 streamingMessageId 已被 cancelStream 清除，则寻找最后一条助手消息
    // 仅当最后一条助手消息处于非流式状态（说明刚被 cancelStream 处理过）时才尝试更新其元数据
    const lastMsgIndex = state.allMessages.value.length - 1
    const lastMsg = state.allMessages.value[lastMsgIndex]
    if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.streaming) {
      messageIndex = lastMsgIndex
    }
  }

  if (messageIndex !== -1) {
    const message = state.allMessages.value[messageIndex]
    
    // 如果消息为空且没有工具调用，删除它
    // 注意：思考内容只存在于 parts 中，不在 content 中，需要检查 parts
    const hasPartsContent = message.parts && message.parts.some(p => p.text || p.functionCall)
    if (!message.content && !message.tools && !hasPartsContent) {
      removeMessageAt(state, messageIndex)
    } else {
      // 构建新的 metadata 对象
      const newMetadata = message.metadata ? { ...message.metadata } : {}
      
      // 从后端返回的 content 中提取计时信息（后端在取消时也会保存计时信息）
      if (chunk.content) {
        if (chunk.content.thinkingDuration !== undefined) {
          newMetadata.thinkingDuration = chunk.content.thinkingDuration
        }
        if (chunk.content.responseDuration !== undefined) {
          newMetadata.responseDuration = chunk.content.responseDuration
        }
        if (chunk.content.streamDuration !== undefined) {
          newMetadata.streamDuration = chunk.content.streamDuration
        }
        if (chunk.content.firstChunkTime !== undefined) {
          newMetadata.firstChunkTime = chunk.content.firstChunkTime
        }
        if (chunk.content.chunkCount !== undefined) {
          newMetadata.chunkCount = chunk.content.chunkCount
        }
      }
      
      // 更新工具状态
      const updatedTools = message.tools?.map(tool => {
        // 取消时，将所有非最终态工具标记为 error
        if (
          tool.status === 'streaming' ||
          tool.status === 'queued' ||
          tool.status === 'awaiting_approval' ||
          tool.status === 'executing' ||
          tool.status === 'awaiting_apply'
        ) {
          return { ...tool, status: 'error' as const }
        }
        return tool
      })
      
      // 创建更新后的消息对象
      const updatedMessage: Message = {
        ...message,
        streaming: false,
        // cancelled 场景：若消息非空，后端通常已持久化 partial（用户取消）。
        // 即使极端情况下未持久化，localOnly=false 也只会影响“是否走后端索引”的分支，
        // 但非空消息的 retry/delete 仍可由 error/reload 兜底。
        localOnly: false,
        metadata: newMetadata,
        tools: updatedTools
      }
      
      // 用新对象替换数组中的旧对象，确保 Vue 响应式更新
      replaceMessageAt(state, messageIndex, updatedMessage)
    }
  }
  state.streamingMessageId.value = null
  state.activeStreamId.value = null
  state.isStreaming.value = false
  state.isWaitingForResponse.value = false
  state.autoSummaryStatus.value = null
  state.pendingModelOverride.value = null
  state._lastApprovalGatedStreamId.value = null
  state._lastCancelledStreamId.value = null
}

/**
 * 处理 error 类型
 */
export function handleError(chunk: StreamChunk, state: ChatStoreState): void {
  // 竞态检测：与 handleCancelled 相同的逻辑
  const lastCancelledId = state._lastCancelledStreamId.value
  const isStaleCallback = !chunk.streamId && !!(
    lastCancelledId &&
    state.streamingMessageId.value &&
    state.streamingMessageId.value !== lastCancelledId
  )

  if (isStaleCallback) {
    // 迟到的旧请求 error chunk：不重置新请求的全局状态，仅记录错误
    state._lastCancelledStreamId.value = null
    console.warn('[streamChunkHandlers] Stale error chunk ignored (new request in progress)')
    return
  }

  state.error.value = chunk.error || {
    code: 'STREAM_ERROR',
    message: 'Stream error'
  }
  
  if (state.streamingMessageId.value) {
    const messageToRemove = state.allMessages.value.find(m => m.id === state.streamingMessageId.value)
    
    // 删除空的占位消息（不依赖 streaming 标记；网络中断等场景可能已被提前置为非 streaming）
    // 注意：思考内容只存在于 parts 中，不在 content 中，需要检查 parts
    const hasPartsContent = !!messageToRemove?.parts?.some(p => p.text || p.functionCall)
    if (messageToRemove && !messageToRemove.content && !messageToRemove.tools && !hasPartsContent) {
      // 修改原因：error 收尾删除空占位时再次按同一 id 线性查找没有必要。
      // 修改方式：通过 messageIndexById helper 获取删除下标，helper 负责 fallback 与索引回填。
      // 修改目的：在保持“仅删除空占位”语义不变的前提下，消除重复 findIndex。
      const removeIndex = getMessageIndexById(state, state.streamingMessageId.value)
      removeMessageAt(state, removeIndex)
    }
    state.streamingMessageId.value = null
  }
  
  state.activeStreamId.value = null
  state.isStreaming.value = false
  state.isWaitingForResponse.value = false  // 结束等待
  state.autoSummaryStatus.value = null
  state.pendingModelOverride.value = null
  state._lastApprovalGatedStreamId.value = null
  state._lastCancelledStreamId.value = null
}
