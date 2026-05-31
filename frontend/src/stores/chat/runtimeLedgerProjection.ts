/**
 * 主聊天 Runtime Ledger 投影消费入口。
 *
 * 修改原因：主聊天不能在 UI 侧拼接散乱事件或猜测 message/tool/content 归属。
 * 修改方式：消费后端随 stream transport 下发的 Runtime Ledger identity/projection。
 * 修改目的：把主聊天内容、工具、终态和 transcript mutation 收敛到统一 Runtime Ledger / Event Fabric projection。
 */

import type { CheckpointRecord, Content, Message, StreamChunk, ToolExecutionResult, ToolUsage } from '../../types'
import type { ChatStoreState } from './types'
import { triggerRef } from 'vue'
import { generateId } from '../../utils/format'
import { getToolApprovalStopKind } from '../../utils/toolContinuations'
import { appendMessage, getMessageIndexById, removeMessageAt, replaceAllMessages, replaceMessageAt } from './state'
import { addTextToMessage, handleFunctionCallPart, processStreamingText } from './streamHelpers'
import { contentToMessageEnhanced } from './parsers'
import { syncTotalMessagesFromWindow, trimWindowFromTop } from './windowUtils'

type RuntimeToolState = 'queued' | 'executing' | 'success' | 'error' | 'cancelled'
type RuntimeTerminalContentType = NonNullable<NonNullable<StreamChunk['runtimeLedger']>['ledger']>['terminalContent']['type']

export interface RuntimeLedgerMutationProjection {
  status?: 'ok' | 'degraded'
  identity?: {
    conversationId: string
    runId: string
  }
  ledger?: {
    mutation?: {
      type: string
      conversationId: string
      runId: string
      source?: string
      targetIndex?: number
      deletedCount?: number
      messageWindow?: {
        total: number
        startIndex: number
        messages: Content[]
      }
      checkpoints?: CheckpointRecord[]
      activeBuild?: Record<string, unknown> | null
      diagnostics?: string[]
    }
  }
}

const TOOL_STATUS_BY_RUNTIME_STATE: Record<RuntimeToolState, ToolUsage['status']> = {
  queued: 'queued',
  executing: 'executing',
  success: 'success',
  error: 'error',
  cancelled: 'error'
}

function runtimeToolCandidates(toolId: string): string[] {
  const normalized = typeof toolId === 'string' ? toolId.trim() : ''
  if (!normalized) return []
  return [
    normalized,
    `tool:chat:${normalizeRuntimeToolIdPart(normalized)}`,
    `tool:chat:${normalizeLegacyIdPart(normalized)}`,
    `tool:chat:${normalized}`
  ]
}

function normalizeLegacyIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown'
}

function stableIdHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalizeRuntimeToolIdPart(value: string): string {
  const normalized = normalizeLegacyIdPart(value)
  if (normalized === value && value.length <= 80) {
    return normalized
  }
  return `${normalized.slice(0, 64)}_${stableIdHash(value)}`
}

function hasUsableRuntimeLedgerProjection(chunk: StreamChunk): boolean {
  return chunk.runtimeLedger?.status !== 'degraded'
}

function getRuntimeToolSnapshot(chunk: StreamChunk): StreamChunk['runtimeLedger']['ledger']['toolSnapshotsByInvocationId'][string] | undefined {
  const toolId = chunk.tool?.id
  const snapshots = chunk.runtimeLedger?.ledger?.toolSnapshotsByInvocationId
  if (!snapshots) return undefined

  if (toolId) {
    for (const candidate of runtimeToolCandidates(toolId)) {
      const snapshot = snapshots[candidate]
      if (snapshot) return snapshot
    }
  }

  const snapshotValues = Object.values(snapshots)
  return snapshotValues.length === 1 ? snapshotValues[0] : undefined
}

function getRuntimeToolState(toolId: string | undefined, chunk: StreamChunk): RuntimeToolState | undefined {
  if (!toolId) return undefined
  const states = chunk.runtimeLedger?.ledger?.toolStatesByInvocationId
  if (!states) return undefined

  for (const candidate of runtimeToolCandidates(toolId)) {
    const state = states[candidate]
    if (state) return state
  }
  return undefined
}

function hasArgsSnapshot(args: unknown): args is Record<string, unknown> {
  return !!args && typeof args === 'object' && !Array.isArray(args)
}

function getNextBackendIndex(state: ChatStoreState): number {
  return state.windowStartIndex.value + state.allMessages.value.length
}

function getRuntimeTerminalContent(
  chunk: StreamChunk,
  type: RuntimeTerminalContentType
): NonNullable<NonNullable<NonNullable<StreamChunk['runtimeLedger']>['ledger']>['terminalContent']> | undefined {
  if (!hasUsableRuntimeLedgerProjection(chunk)) return undefined
  const terminalContent = chunk.runtimeLedger?.ledger?.terminalContent
  if (!terminalContent || terminalContent.type !== type || !terminalContent.content) return undefined
  return terminalContent
}

function hasRuntimeTerminalState(chunk: StreamChunk, type: 'complete' | 'cancelled' | 'error'): boolean {
  if (!hasUsableRuntimeLedgerProjection(chunk)) return false
  return chunk.runtimeLedger?.ledger?.terminalState?.type === type
}

/**
 * Runtime Ledger 终态投影仍要合并旧 UI 正在显示的工具运行态。
 *
 * 这里复制的是本投影层自己的 merge rule：incoming content snapshot 提供后端权威结构，
 * existing tools 保留已经由 Runtime Ledger toolStatus/functionResponse 投影得到的状态、结果和错误。
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
  for (const tool of a) {
    if (!tool) continue
    if (typeof tool.id === 'string') byId.set(tool.id, tool)
    if (typeof tool.itemId === 'string' && tool.itemId.trim()) byItemId.set(tool.itemId, tool)
    if (typeof tool.index === 'number') byIndex.set(tool.index, tool)
  }

  const consumedExisting = new Set<ToolUsage>()
  const merged: ToolUsage[] = []
  for (const incomingTool of b) {
    const existingTool = byId.get(incomingTool.id)
      || (typeof incomingTool.itemId === 'string' && incomingTool.itemId.trim() ? byItemId.get(incomingTool.itemId) : undefined)
      || (typeof incomingTool.index === 'number' ? byIndex.get(incomingTool.index) : undefined)
    if (!existingTool) {
      merged.push(incomingTool)
      continue
    }

    consumedExisting.add(existingTool)
    const incomingHasArgs = !!(incomingTool.args && Object.keys(incomingTool.args).length > 0)
    const partialArgs = typeof incomingTool.partialArgs === 'string'
      ? (typeof existingTool.partialArgs === 'string' && existingTool.partialArgs.length > incomingTool.partialArgs.length
        ? existingTool.partialArgs
        : incomingTool.partialArgs)
      : (incomingHasArgs ? undefined : existingTool.partialArgs)
    let status = existingTool.status ?? incomingTool.status
    if (!partialArgs && incomingHasArgs && status === 'streaming') {
      status = 'queued'
    }

    merged.push({
      ...existingTool,
      ...incomingTool,
      status,
      result: existingTool.result ?? incomingTool.result,
      error: existingTool.error ?? incomingTool.error,
      duration: existingTool.duration ?? incomingTool.duration,
      awaitingConfirmation: existingTool.awaitingConfirmation ?? incomingTool.awaitingConfirmation,
      itemId: incomingTool.itemId ?? existingTool.itemId,
      index: typeof incomingTool.index === 'number' ? incomingTool.index : existingTool.index,
      partialArgs
    })
  }

  for (const tool of a) {
    if (!consumedExisting.has(tool)) merged.push(tool)
  }
  return merged.length > 0 ? merged : undefined
}

function normalizeStreamingToQueued(status?: ToolUsage['status']): ToolUsage['status'] | undefined {
  return status === 'streaming' ? 'queued' : status
}

function deriveToolStatusFromResult(result: Record<string, unknown>): ToolUsage['status'] {
  const r = result as any
  if (r?.cancelled || r?.rejected) return 'error'
  if (r?.success === false) return 'error'
  if (typeof r?.error === 'string' && r.error.trim()) return 'error'

  const data = r?.data
  if (data && typeof data === 'object') {
    if ((data as any).status === 'pending') return 'awaiting_apply'

    const appliedCount = (data as any).appliedCount
    const failedCount = (data as any).failedCount
    if (typeof appliedCount === 'number' && typeof failedCount === 'number' && appliedCount > 0 && failedCount > 0) {
      return 'warning'
    }
  }

  return 'success'
}

function getToolResultMap(toolResults: ToolExecutionResult[] | undefined): Map<string, ToolExecutionResult> {
  const map = new Map<string, ToolExecutionResult>()
  for (const result of toolResults || []) {
    if (result && typeof result.id === 'string') {
      map.set(result.id, result)
    }
  }
  return map
}

function collectExistingFunctionResponseIds(state: ChatStoreState): Set<string> {
  const ids = new Set<string>()
  for (const message of state.allMessages.value) {
    if (!message.isFunctionResponse || !message.parts) continue
    for (const part of message.parts) {
      if (part.functionResponse?.id) {
        ids.add(part.functionResponse.id)
      }
    }
  }
  return ids
}

function appendRuntimeFunctionResponses(
  toolResults: ToolExecutionResult[] | undefined,
  state: ChatStoreState
): void {
  if (!toolResults || toolResults.length === 0) return

  const existingResponseIds = collectExistingFunctionResponseIds(state)
  const parts = toolResults
    .filter(result => result.id && !existingResponseIds.has(result.id))
    .map(result => ({
      functionResponse: {
        name: result.name,
        response: result.result,
        id: result.id
      }
    }))

  if (parts.length === 0) return

  appendMessage(state, {
    id: generateId(),
    role: 'user',
    content: '',
    timestamp: Date.now(),
    backendIndex: getNextBackendIndex(state),
    isFunctionResponse: true,
    parts
  })
  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)

  for (const part of parts) {
    if (part.functionResponse.id && part.functionResponse.response) {
      state.toolResponseCache.value.set(
        part.functionResponse.id,
        part.functionResponse.response as Record<string, unknown>
      )
    }
  }
  triggerRef(state.toolResponseCache)
}

function addRuntimeCheckpoints(
  checkpoints: CheckpointRecord[] | undefined,
  addCheckpoint: (checkpoint: CheckpointRecord) => void
): void {
  for (const checkpoint of checkpoints || []) {
    addCheckpoint(checkpoint)
  }
}

function rebuildToolResponseCacheFromMessages(state: ChatStoreState): void {
  const cache = new Map<string, Record<string, unknown>>()
  for (const message of state.allMessages.value) {
    for (const part of message.parts || []) {
      const response = part.functionResponse
      if (!response?.id || !response.response || typeof response.response !== 'object' || Array.isArray(response.response)) {
        continue
      }
      cache.set(response.id, response.response as Record<string, unknown>)
    }
  }
  state.toolResponseCache.value = cache
  triggerRef(state.toolResponseCache)
}

export function applyRuntimeLedgerMutationProjection(
  runtimeLedger: RuntimeLedgerMutationProjection | undefined,
  state: ChatStoreState
): boolean {
  if (!runtimeLedger || runtimeLedger.status === 'degraded') return false
  const mutation = runtimeLedger.ledger?.mutation
  const window = mutation?.messageWindow
  if (!mutation || !window || !Array.isArray(window.messages)) return false
  if (typeof window.total !== 'number' || typeof window.startIndex !== 'number') return false

  const messages = window.messages.map(content => contentToMessageEnhanced(content))
  state.windowStartIndex.value = window.startIndex
  state.totalMessages.value = window.total
  replaceAllMessages(state, messages)
  state.isLoadingMoreMessages.value = false
  state.historyFolded.value = false
  state.foldedMessageCount.value = 0

  if (Array.isArray(mutation.checkpoints)) {
    state.checkpoints.value = mutation.checkpoints
  }
  if (Object.prototype.hasOwnProperty.call(mutation, 'activeBuild')) {
    state.activeBuild.value = mutation.activeBuild as any
  }

  rebuildToolResponseCacheFromMessages(state)
  return true
}

function shouldPreserveToolParts(existingTools: ToolUsage[] | undefined, finalMessage: Message): boolean {
  return !!(
    existingTools &&
    existingTools.length > 0 &&
    finalMessage.parts &&
    !finalMessage.parts.some(part => part.functionCall)
  )
}

function applyRuntimeTerminalContentSnapshot(
  terminalContent: NonNullable<NonNullable<NonNullable<StreamChunk['runtimeLedger']>['ledger']>['terminalContent']>,
  state: ChatStoreState,
  options: {
    preserveExistingTools?: boolean
    transformTools?: (tools: ToolUsage[] | undefined) => ToolUsage[] | undefined
  } = {}
): { applied: boolean; messageIndex: number; tools?: ToolUsage[] } {
  const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  if (messageIndex === -1 || !terminalContent.content) {
    return { applied: false, messageIndex: -1 }
  }

  const message = state.allMessages.value[messageIndex]
  const existingModelVersion = message.metadata?.modelVersion
  const existingTools = message.tools
  const finalMessage = contentToMessageEnhanced(terminalContent.content, message.id)
  let tools = mergeToolsPreferExisting(existingTools, finalMessage.tools)
  if (!tools || tools.length === 0) {
    tools = options.preserveExistingTools ? existingTools : finalMessage.tools
  }
  if (options.transformTools) {
    tools = options.transformTools(tools)
  }

  const updatedMessage: Message = {
    ...message,
    ...finalMessage,
    id: message.id,
    timestamp: message.timestamp,
    backendIndex: message.backendIndex,
    streaming: false,
    localOnly: false,
    tools: tools && tools.length > 0 ? tools : undefined,
    parts: shouldPreserveToolParts(existingTools, finalMessage) ? message.parts : finalMessage.parts
  }

  if (!updatedMessage.metadata) updatedMessage.metadata = {}
  if (existingModelVersion) updatedMessage.metadata.modelVersion = existingModelVersion
  delete updatedMessage.metadata.thinkingStartTime

  replaceMessageAt(state, messageIndex, updatedMessage)
  return { applied: true, messageIndex, tools: updatedMessage.tools }
}

function buildMessageFromRuntimeContentSnapshot(currentMessage: Message, snapshotContent: NonNullable<StreamChunk['chunk']>['contentSnapshot']): Message {
  const existingModelVersion = currentMessage.metadata?.modelVersion
  const snapshotMessage = contentToMessageEnhanced(snapshotContent!, currentMessage.id)
  const mergedTools = mergeToolsPreferExisting(currentMessage.tools, snapshotMessage.tools)
  const updatedMessage: Message = {
    ...currentMessage,
    ...snapshotMessage,
    id: currentMessage.id,
    timestamp: currentMessage.timestamp,
    backendIndex: currentMessage.backendIndex,
    localOnly: currentMessage.localOnly,
    streaming: currentMessage.streaming,
    tools: mergedTools && mergedTools.length > 0
      ? mergedTools
      : (snapshotMessage.tools && snapshotMessage.tools.length > 0 ? snapshotMessage.tools : currentMessage.tools)
  }

  if (!updatedMessage.metadata) updatedMessage.metadata = {}
  if (existingModelVersion) updatedMessage.metadata.modelVersion = existingModelVersion
  return updatedMessage
}

export function applyRuntimeLedgerChunkProjection(chunk: StreamChunk, state: ChatStoreState): boolean {
  const liveDelta = chunk.runtimeLedger?.ledger?.liveDelta
  if (!hasUsableRuntimeLedgerProjection(chunk) || chunk.type !== 'chunk' || liveDelta?.type !== 'chunk' || !liveDelta.payload) return false
  const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  if (messageIndex === -1) return false

  const payload = liveDelta.payload
  const snapshotContent = payload.contentSnapshot
  if (snapshotContent) {
    replaceMessageAt(state, messageIndex, buildMessageFromRuntimeContentSnapshot(state.allMessages.value[messageIndex], snapshotContent))
  }

  const message = state.allMessages.value[messageIndex]
  if (!message.parts) message.parts = []

  if (payload.delta && !snapshotContent) {
    for (const part of payload.delta) {
      if (part.text) {
        if (part.thought) addTextToMessage(message, part.text, true)
        else processStreamingText(message, part.text, state)
      }
      if (part.functionCall) {
        handleFunctionCallPart(part, message)
      }
    }
  }

  if (!message.metadata) message.metadata = {}
  if ((payload as any).thinkingStartTime) {
    message.metadata.thinkingStartTime = (payload as any).thinkingStartTime
  }
  if (payload.done) {
    for (const tool of message.tools || []) {
      if (tool.status === 'streaming') {
        tool.status = 'queued'
        delete tool.partialArgs
        const matchingPart = message.parts?.find(part => part.functionCall?.id === tool.id)
        if (matchingPart?.functionCall?.args) {
          tool.args = matchingPart.functionCall.args
        }
      }
    }
    if (payload.usage) {
      message.metadata.usageMetadata = payload.usage
      message.metadata.thoughtsTokenCount = payload.usage.thoughtsTokenCount
      message.metadata.candidatesTokenCount = payload.usage.candidatesTokenCount
    }
  }

  return true
}

function applyRuntimeToolSnapshotToMessage(message: Message, chunk: StreamChunk): Message | undefined {
  const snapshot = getRuntimeToolSnapshot(chunk)
  if (!snapshot?.id || !message.tools?.some(tool => tool.id === snapshot.id)) return undefined
  const runtimeState = getRuntimeToolState(snapshot.id, chunk) || snapshot.status
  const status = TOOL_STATUS_BY_RUNTIME_STATE[runtimeState] || 'error'
  const updatedTools = message.tools.map(tool => {
    if (tool.id !== snapshot.id) return tool
    return {
      ...tool,
      name: snapshot.name || tool.name,
      status,
      ...(hasArgsSnapshot(snapshot.args) ? { args: snapshot.args, partialArgs: undefined } : {}),
      result: snapshot.result ?? tool.result
    }
  })
  return { ...message, tools: updatedTools }
}

export function applyRuntimeLedgerToolStatusProjection(chunk: StreamChunk, state: ChatStoreState): boolean {
  if (!hasUsableRuntimeLedgerProjection(chunk) || chunk.type !== 'toolStatus') return false
  const snapshot = getRuntimeToolSnapshot(chunk)
  if (!snapshot?.id) return false

  let messageIndex = -1
  if (state.streamingMessageId.value) {
    const idx = getMessageIndexById(state, state.streamingMessageId.value)
    if (idx !== -1 && state.allMessages.value[idx]?.tools?.some(tool => tool.id === snapshot.id)) {
      messageIndex = idx
    }
  }
  if (messageIndex === -1) {
    for (let index = state.allMessages.value.length - 1; index >= 0; index--) {
      if (state.allMessages.value[index]?.tools?.some(tool => tool.id === snapshot.id)) {
        messageIndex = index
        break
      }
    }
  }
  if (messageIndex === -1) return false

  const updatedMessage = applyRuntimeToolSnapshotToMessage(state.allMessages.value[messageIndex], chunk)
  if (!updatedMessage) return false
  replaceMessageAt(state, messageIndex, updatedMessage)
  return true
}

export function applyRuntimeLedgerToolStatusBatchProjection(chunks: StreamChunk[], state: ChatStoreState): StreamChunk[] {
  const unhandled: StreamChunk[] = []
  for (const chunk of chunks) {
    if (!applyRuntimeLedgerToolStatusProjection(chunk, state)) {
      unhandled.push(chunk)
    }
  }
  return unhandled
}

export function applyRuntimeLedgerToolsExecutingProjection(chunk: StreamChunk, state: ChatStoreState): boolean {
  if (chunk.type !== 'toolsExecuting') return false
  const terminalContent = getRuntimeTerminalContent(chunk, 'toolsExecuting')
  if (!terminalContent) return false

  state.isStreaming.value = true
  return applyRuntimeTerminalContentSnapshot(terminalContent, state, {
    preserveExistingTools: true,
    transformTools: tools => {
      if (!tools) return tools
      const pending = terminalContent.pendingToolCalls || []
      const executingId = typeof pending[0]?.id === 'string' ? pending[0].id : undefined
      const queuedIds = new Set(
        pending.slice(1).map(tool => typeof tool.id === 'string' ? tool.id : undefined).filter(Boolean) as string[]
      )

      return tools.map(tool => {
        const isStreaming = tool.status === 'streaming'
        const baseStatus = isStreaming ? 'queued' : tool.status
        const baseTool = isStreaming ? { ...tool, partialArgs: undefined } : tool
        if (executingId && tool.id === executingId) return { ...baseTool, status: 'executing' as const }
        if (queuedIds.has(tool.id)) return { ...baseTool, status: 'queued' as const }
        return { ...baseTool, status: baseStatus as any }
      })
    }
  }).applied
}

export function applyRuntimeLedgerAwaitingConfirmationProjection(
  chunk: StreamChunk,
  state: ChatStoreState,
  addCheckpoint: (checkpoint: CheckpointRecord) => void
): boolean {
  if (chunk.type !== 'awaitingConfirmation') return false
  const terminalContent = getRuntimeTerminalContent(chunk, 'awaitingConfirmation')
  if (!terminalContent) return false

  const pendingIds = new Set(
    (terminalContent.pendingToolCalls || [])
      .map(tool => typeof tool.id === 'string' ? tool.id : undefined)
      .filter(Boolean) as string[]
  )
  const toolResultMap = getToolResultMap(terminalContent.toolResults)

  const applied = applyRuntimeTerminalContentSnapshot(terminalContent, state, {
    preserveExistingTools: true,
    transformTools: tools => tools?.map(tool => {
      const isStreaming = tool.status === 'streaming'
      const baseStatus = (isStreaming ? 'queued' : tool.status) || 'queued'
      const baseTool = isStreaming ? { ...tool, partialArgs: undefined } : tool

      if (pendingIds.has(tool.id)) {
        return { ...baseTool, status: 'awaiting_approval' as const }
      }

      const toolResult = toolResultMap.get(tool.id)
      if (toolResult) {
        const result = toolResult.result as Record<string, unknown>
        const status = deriveToolStatusFromResult(result)
        const errFromResult =
          typeof (result as any)?.error === 'string' && (result as any).error.trim()
            ? String((result as any).error)
            : undefined
        return { ...baseTool, status, result, error: tool.error ?? errFromResult }
      }

      return { ...baseTool, status: baseStatus as any }
    })
  }).applied
  if (!applied) return false

  appendRuntimeFunctionResponses(terminalContent.toolResults, state)
  addRuntimeCheckpoints(chunk.checkpoints, addCheckpoint)

  state.isStreaming.value = false
  state.activeStreamId.value = null
  state._lastApprovalGatedStreamId.value = null
  return true
}

export function applyRuntimeLedgerToolIterationProjection(
  chunk: StreamChunk,
  state: ChatStoreState,
  currentModelName: () => string,
  addCheckpoint: (checkpoint: CheckpointRecord) => void
): boolean {
  if (chunk.type !== 'toolIteration') return false
  const terminalContent = getRuntimeTerminalContent(chunk, 'toolIteration')
  if (!terminalContent) return false

  const toolResultMap = getToolResultMap(terminalContent.toolResults)
  const cancelledToolIds = new Set<string>()
  for (const result of terminalContent.toolResults || []) {
    if ((result.result as any)?.cancelled && result.id) {
      cancelledToolIds.add(result.id)
    }
  }
  const hasUserConfirmation = terminalContent.toolResults?.some(
    result => (result.result as any)?.requiresUserConfirmation
  ) ?? false

  const applied = applyRuntimeTerminalContentSnapshot(terminalContent, state, {
    preserveExistingTools: true,
    transformTools: tools => tools?.map(tool => {
      const toolResult = toolResultMap.get(tool.id)
      if (toolResult) {
        const result = toolResult.result as Record<string, unknown>
        const status = deriveToolStatusFromResult(result)
        const errFromResult =
          typeof (result as any)?.error === 'string' && (result as any).error.trim()
            ? String((result as any).error)
            : undefined
        return { ...tool, status, result, error: tool.error ?? errFromResult }
      }
      return { ...tool, status: normalizeStreamingToQueued(tool.status) as any }
    })
  })
  if (!applied.applied) return false

  appendRuntimeFunctionResponses(terminalContent.toolResults, state)
  addRuntimeCheckpoints(chunk.checkpoints, addCheckpoint)

  const toolArgsById = new Map<string, Record<string, unknown>>()
  for (const tool of applied.tools || []) {
    const args = tool.args && typeof tool.args === 'object'
      ? tool.args as Record<string, unknown>
      : {}
    toolArgsById.set(tool.id, args)
  }

  const hasApprovalStop = terminalContent.toolResults?.some(result => {
    const args = typeof result.id === 'string' ? toolArgsById.get(result.id) : undefined
    return getToolApprovalStopKind(result.name, result.result, args) !== null
  }) ?? false

  if (cancelledToolIds.size > 0 || hasUserConfirmation || hasApprovalStop) {
    state.streamingMessageId.value = null
    state.activeStreamId.value = null
    state.isStreaming.value = false
    state.isWaitingForResponse.value = false
    state._lastApprovalGatedStreamId.value = hasApprovalStop && chunk.streamId ? chunk.streamId : null
    return true
  }

  state._lastApprovalGatedStreamId.value = null

  const newAssistantMessageId = generateId()
  appendMessage(state, {
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
  })
  syncTotalMessagesFromWindow(state)
  trimWindowFromTop(state)
  state.streamingMessageId.value = newAssistantMessageId
  state.isStreaming.value = true
  state.isWaitingForResponse.value = true
  return true
}

export function applyRuntimeLedgerCompleteProjection(
  chunk: StreamChunk,
  state: ChatStoreState,
  addCheckpoint: (checkpoint: CheckpointRecord) => void,
  updateConversationAfterMessage: () => Promise<void>
): boolean {
  if (chunk.type !== 'complete' || !hasRuntimeTerminalState(chunk, 'complete')) return false
  const terminalContent = getRuntimeTerminalContent(chunk, 'complete')
  if (!terminalContent) return false

  const lastCancelledId = state._lastCancelledStreamId.value
  const isStaleCallback = !chunk.streamId && !!(
    lastCancelledId &&
    state.streamingMessageId.value &&
    state.streamingMessageId.value !== lastCancelledId
  )
  if (isStaleCallback) {
    state._lastCancelledStreamId.value = null
    return true
  }

  const applied = applyRuntimeTerminalContentSnapshot(terminalContent, state, { preserveExistingTools: true }).applied
  if (!applied) return false

  addRuntimeCheckpoints(chunk.checkpoints, addCheckpoint)
  state.streamingMessageId.value = null
  state.activeStreamId.value = null
  state.isStreaming.value = false
  state.isWaitingForResponse.value = false
  state.autoSummaryStatus.value = null
  state.pendingModelOverride.value = null
  state._lastApprovalGatedStreamId.value = null
  state._lastCancelledStreamId.value = null
  void updateConversationAfterMessage()
  return true
}

export function applyRuntimeLedgerCancelledProjection(chunk: StreamChunk, state: ChatStoreState): boolean {
  if (chunk.type !== 'cancelled' || !hasRuntimeTerminalState(chunk, 'cancelled')) return false

  const lastCancelledId = state._lastCancelledStreamId.value
  const isStaleCallback = !chunk.streamId && !!(
    lastCancelledId &&
    state.streamingMessageId.value &&
    state.streamingMessageId.value !== lastCancelledId
  )

  if (isStaleCallback) {
    const oldMsgIndex = getMessageIndexById(state, lastCancelledId)
    if (oldMsgIndex !== -1) {
      const message = state.allMessages.value[oldMsgIndex]
      if (message.streaming) {
        replaceMessageAt(state, oldMsgIndex, { ...message, streaming: false })
      }
    }
    state._lastCancelledStreamId.value = null
    return true
  }

  let messageIndex = -1
  if (state.streamingMessageId.value) {
    messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
  } else {
    const lastMsgIndex = state.allMessages.value.length - 1
    const lastMessage = state.allMessages.value[lastMsgIndex]
    if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.streaming) {
      messageIndex = lastMsgIndex
    }
  }

  if (messageIndex !== -1) {
    const message = state.allMessages.value[messageIndex]
    const hasPartsContent = message.parts && message.parts.some(part => part.text || part.functionCall)
    if (!message.content && !message.tools && !hasPartsContent) {
      removeMessageAt(state, messageIndex)
    } else {
      const newMetadata = message.metadata ? { ...message.metadata } : {}
      const content = chunk.runtimeLedger?.ledger?.terminalContent?.content
      if (content) {
        if (content.thinkingDuration !== undefined) newMetadata.thinkingDuration = content.thinkingDuration
        if (content.responseDuration !== undefined) newMetadata.responseDuration = content.responseDuration
        if (content.streamDuration !== undefined) newMetadata.streamDuration = content.streamDuration
        if (content.firstChunkTime !== undefined) newMetadata.firstChunkTime = content.firstChunkTime
        if (content.chunkCount !== undefined) newMetadata.chunkCount = content.chunkCount
      }

      const updatedTools = message.tools?.map(tool => {
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

      replaceMessageAt(state, messageIndex, {
        ...message,
        streaming: false,
        localOnly: false,
        metadata: newMetadata,
        tools: updatedTools
      })
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
  return true
}

export function applyRuntimeLedgerErrorProjection(chunk: StreamChunk, state: ChatStoreState): boolean {
  if (chunk.type !== 'error' || !hasRuntimeTerminalState(chunk, 'error')) return false

  const lastCancelledId = state._lastCancelledStreamId.value
  const isStaleCallback = !chunk.streamId && !!(
    lastCancelledId &&
    state.streamingMessageId.value &&
    state.streamingMessageId.value !== lastCancelledId
  )

  if (isStaleCallback) {
    state._lastCancelledStreamId.value = null
    console.warn('[runtimeLedgerProjection] Stale error chunk ignored (new request in progress)')
    return true
  }

  state.error.value = chunk.runtimeLedger?.ledger?.terminalState?.error || chunk.error || {
    code: 'STREAM_ERROR',
    message: 'Stream error'
  }

  if (state.streamingMessageId.value) {
    const messageIndex = getMessageIndexById(state, state.streamingMessageId.value)
    const messageToRemove = messageIndex !== -1 ? state.allMessages.value[messageIndex] : undefined
    const hasPartsContent = !!messageToRemove?.parts?.some(part => part.text || part.functionCall)
    if (messageToRemove && !messageToRemove.content && !messageToRemove.tools && !hasPartsContent) {
      removeMessageAt(state, messageIndex)
    }
    state.streamingMessageId.value = null
  }

  state.activeStreamId.value = null
  state.isStreaming.value = false
  state.isWaitingForResponse.value = false
  state.autoSummaryStatus.value = null
  state.pendingModelOverride.value = null
  state._lastApprovalGatedStreamId.value = null
  state._lastCancelledStreamId.value = null
  return true
}
