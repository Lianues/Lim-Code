/**
 * WP20: AgentRunEvent 纯 reducer 最小核心。
 *
 * 为什么需要这个文件：WP15 已把 functionCall merge 收敛到唯一入口，但主聊天和 SubAgent Monitor
 * 仍未共享统一 reducer。本文件先建立一个不会接管热路径的 pure reducer draft，
 * 专注于 replay、一致性、幂等和 selector 可消费的数据形状。
 *
 * 怎么改：
 * - reducer 只做纯状态转换；
 * - function call 增量统一委托给 utils/functionCallMerge.ts；
 * - 不 import Vue / React / webview / postMessage；
 * - 不迁移 chatStore，也不替换现有 stream handlers。
 *
 * 目的：为未来把 Main Chat / SubAgent Monitor 收敛到 shared reducer 铺路，
 * 同时通过单元测试先固化 contract，而不是在热路径里边改边猜。
 */

import type { ContentPart, Message, ToolUsage } from '../../types'
import {
  type StreamFunctionCall,
  getFunctionCallMergeReason,
  hasNonEmptyArgs,
  mergeFunctionCall,
  normalizeNonEmptyString
} from '../../utils/functionCallMerge'
import {
  type AgentRunEvent,
  type AgentRunLifecycleStatus,
  type AgentRunState,
  type AgentRunToolExecutionState,
  getAgentRunEventId,
  getAgentRunToolMatchCandidates,
  getAgentRunToolStableId
} from './events'

const TERMINAL_TOOL_STATUSES = new Set<ToolUsage['status']>(['success', 'error', 'warning'])

/**
 * 为什么提供工厂函数：测试、replay 和未来 Repository 恢复都需要从统一初始态开始，
 * 不能每个调用点手写一份“差不多”的初值对象。
 */
export function createInitialAgentRunState(runId?: string): AgentRunState {
  return {
    runId: runId || null,
    source: null,
    status: 'idle',
    processedEventIds: {},
    eventOrder: [],
    messagesById: {},
    messageOrder: [],
    toolExecutionsByKey: {},
    toolExecutionOrder: []
  }
}

/**
 * 最小 replay 基础设施。
 *
 * 为什么需要：WP20 的核心承诺之一是“事件可重放且结果确定”。
 * 怎么改：把 reduce + fold 封装成显式 helper，让测试直接验证 replay 一致性。
 * 目的：后续无论来自 Main Chat 还是 SubAgent Monitor，只要事件序列一致，状态就应一致。
 */
export function replayAgentRunEvents(
  events: readonly AgentRunEvent[],
  initialState: AgentRunState = createInitialAgentRunState()
): AgentRunState {
  return events.reduce((state, event) => reduceAgentRunEvent(state, event), initialState)
}

export function reduceAgentRunEvent(state: AgentRunState, event: AgentRunEvent): AgentRunState {
  if (state.runId && state.runId !== event.envelope.runId) {
    // 为什么直接忽略不同 runId：本草案 reducer 以“单 run state”作为边界；
    // 把不同 run 的事件混进来会污染 replay 语义。
    return state
  }

  const eventId = getAgentRunEventId(event)
  if (state.processedEventIds[eventId]) {
    // 为什么 duplicate 直接返回原引用：幂等测试需要显式证明 reducer 对重复事件零副作用，
    // 并且保留结构共享（structural sharing）。
    return state
  }

  let nextState = stampProcessedEvent(state, eventId, event)

  switch (event.type) {
    case 'run_started':
      nextState = applyRunStarted(nextState, event)
      break
    case 'run_status_changed':
      nextState = applyRunStatus(nextState, event.payload.status, event.payload.error, event.envelope.timestamp)
      break
    case 'message_snapshot':
      nextState = upsertMessage(nextState, cloneMessage(event.payload.message))
      break
    case 'message_text_delta':
      nextState = applyMessageTextDelta(nextState, event)
      break
    case 'message_function_call_delta':
      nextState = applyFunctionCallDelta(nextState, event)
      break
    case 'tool_status':
      nextState = applyToolExecutionPatch(nextState, event.payload.messageId, event.payload.tool)
      break
    case 'tool_result':
      nextState = applyToolExecutionPatch(nextState, event.payload.messageId, {
        id: event.payload.toolId,
        itemId: event.payload.itemId,
        index: event.payload.index,
        name: event.payload.name,
        result: event.payload.result,
        error: event.payload.error,
        duration: event.payload.duration,
        status: event.payload.status || deriveToolResultStatus(event.payload.error, event.payload.result)
      })
      break
  }

  return nextState
}

function stampProcessedEvent(state: AgentRunState, eventId: string, event: AgentRunEvent): AgentRunState {
  const updatedAt = Math.max(state.updatedAt || 0, event.envelope.timestamp)

  return {
    ...state,
    runId: state.runId || event.envelope.runId,
    source: state.source || event.envelope.source,
    updatedAt,
    lastEventId: eventId,
    processedEventIds: {
      ...state.processedEventIds,
      [eventId]: true
    },
    eventOrder: [...state.eventOrder, eventId]
  }
}

function applyRunStarted(state: AgentRunState, event: Extract<AgentRunEvent, { type: 'run_started' }>): AgentRunState {
  const nextStatus = event.payload.status || 'running'
  const startedAt = state.startedAt || event.envelope.timestamp

  if (
    state.conversationId === event.payload.conversationId &&
    state.status === nextStatus &&
    state.startedAt === startedAt
  ) {
    return state
  }

  return {
    ...state,
    conversationId: event.payload.conversationId,
    startedAt,
    status: nextStatus
  }
}

function applyRunStatus(
  state: AgentRunState,
  status: Exclude<AgentRunLifecycleStatus, 'idle'>,
  error: AgentRunState['lastError'],
  timestamp: number
): AgentRunState {
  const finishedAt = status === 'running' ? state.finishedAt : (state.finishedAt || timestamp)

  if (state.status === status && state.lastError === error && state.finishedAt === finishedAt) {
    return state
  }

  return {
    ...state,
    status,
    lastError: error,
    finishedAt
  }
}

function applyMessageTextDelta(
  state: AgentRunState,
  event: Extract<AgentRunEvent, { type: 'message_text_delta' }>
): AgentRunState {
  const message = getOrCreateMessage(
    state,
    event.payload.messageId,
    event.payload.role || 'assistant',
    event.payload.timestamp || event.envelope.timestamp
  )

  const nextMessage = appendTextPart(
    message,
    event.payload.text,
    event.payload.thought === true,
    event.payload.timestamp || event.envelope.timestamp
  )

  return upsertMessage(state, nextMessage)
}

function applyFunctionCallDelta(
  state: AgentRunState,
  event: Extract<AgentRunEvent, { type: 'message_function_call_delta' }>
): AgentRunState {
  const timestamp = event.payload.timestamp || event.envelope.timestamp
  const message = getOrCreateMessage(state, event.payload.messageId, event.payload.role || 'assistant', timestamp)
  const result = appendOrMergeFunctionCall(message, event.payload.call, timestamp)

  let nextState = upsertMessage(state, result.message)

  // 为什么在 reducer 内同步登记 toolExecution stub：
  // selector 未来会统一从 state 派生 UI 数据；即使还没有 tool_status / tool_result 事件，
  // reducer 也需要保留一份可被 overlay 的稳定 tool identity。
  nextState = applyToolExecutionPatch(nextState, event.payload.messageId, {
    id: result.functionCall.id,
    itemId: result.functionCall.itemId,
    index: result.functionCall.index,
    name: result.functionCall.name,
    args: hasNonEmptyArgs(result.functionCall.args) ? result.functionCall.args : {},
    partialArgs: result.functionCall.partialArgs,
    status: typeof result.functionCall.partialArgs === 'string' ? 'streaming' : 'queued'
  }, result.ordinal)

  return nextState
}

function deriveToolResultStatus(
  error: string | undefined,
  result: Record<string, unknown> | undefined
): ToolUsage['status'] {
  if (typeof error === 'string' && error.trim()) return 'error'
  if (result && result.success === false) return 'error'
  return 'success'
}

function getOrCreateMessage(
  state: AgentRunState,
  messageId: string,
  role: Message['role'],
  timestamp: number
): Message {
  return state.messagesById[messageId] || {
    id: messageId,
    role,
    content: '',
    timestamp,
    parts: []
  }
}

function appendTextPart(message: Message, text: string, thought: boolean, timestamp: number): Message {
  const existingParts = message.parts || []
  const nextParts = existingParts.slice()
  const lastPart = nextParts[nextParts.length - 1]
  const lastIsThought = lastPart?.thought === true

  if (lastPart && lastPart.text !== undefined && !lastPart.functionCall && lastIsThought === thought) {
    nextParts[nextParts.length - 1] = thought
      ? { ...lastPart, text: (lastPart.text || '') + text, thought: true }
      : { ...lastPart, text: (lastPart.text || '') + text }
  } else {
    nextParts.push(thought ? { text, thought: true } : { text })
  }

  return {
    ...message,
    timestamp: Math.max(message.timestamp || 0, timestamp),
    content: thought ? message.content : `${message.content || ''}${text}`,
    parts: nextParts
  }
}

function appendOrMergeFunctionCall(
  message: Message,
  incomingCall: StreamFunctionCall,
  timestamp: number
): { message: Message; functionCall: StreamFunctionCall; previousId?: string; ordinal: number } {
  const incoming: StreamFunctionCall = { ...incomingCall }
  const existingParts = message.parts || []
  let isLastFunctionCall = true

  for (let index = existingParts.length - 1; index >= 0; index -= 1) {
    const existingCall = existingParts[index].functionCall as StreamFunctionCall | undefined
    if (!existingCall) continue

    const reason = getFunctionCallMergeReason(incoming, existingCall, isLastFunctionCall)
    if (reason) {
      const nextParts = existingParts.slice()
      const nextFunctionCall = { ...existingCall }
      const previousId = mergeFunctionCall(nextFunctionCall, incoming)
      nextParts[index] = {
        ...existingParts[index],
        functionCall: nextFunctionCall as ContentPart['functionCall']
      }

      return {
        message: {
          ...message,
          timestamp: Math.max(message.timestamp || 0, timestamp),
          parts: nextParts
        },
        functionCall: nextFunctionCall,
        previousId,
        ordinal: countFunctionCallsBeforeIndex(nextParts, index)
      }
    }

    isLastFunctionCall = false
  }

  const nextParts = existingParts.slice()
  const nextFunctionCall: StreamFunctionCall = {
    ...incoming,
    name: incoming.name || '',
    args: hasNonEmptyArgs(incoming.args) ? incoming.args : {}
  }

  // 为什么对新建 functionCall 仍然调用统一 mergeFunctionCall：
  // finalArgs 覆盖、partialArgs 解析、args spread 等 contract 必须和 WP15 完全同源，
  // 不能在 WP20 里偷偷长出第二套初始化语义。
  mergeFunctionCall(nextFunctionCall, incoming)
  nextParts.push({ functionCall: nextFunctionCall as ContentPart['functionCall'] })

  return {
    message: {
      ...message,
      timestamp: Math.max(message.timestamp || 0, timestamp),
      parts: nextParts
    },
    functionCall: nextFunctionCall,
    ordinal: countFunctionCalls(nextParts) - 1
  }
}

function countFunctionCalls(parts: ReadonlyArray<ContentPart>): number {
  return parts.reduce((count, part) => count + (part.functionCall ? 1 : 0), 0)
}

function countFunctionCallsBeforeIndex(parts: ReadonlyArray<ContentPart>, targetIndex: number): number {
  let count = 0
  for (let index = 0; index < targetIndex; index += 1) {
    if (parts[index].functionCall) count += 1
  }
  return count
}

function upsertMessage(state: AgentRunState, message: Message): AgentRunState {
  const exists = !!state.messagesById[message.id]
  const current = state.messagesById[message.id]

  if (current === message) {
    return state
  }

  return {
    ...state,
    messagesById: {
      ...state.messagesById,
      [message.id]: message
    },
    messageOrder: exists ? state.messageOrder : [...state.messageOrder, message.id]
  }
}

type ToolExecutionPatch = Partial<AgentRunToolExecutionState> & {
  /**
   * 为什么允许额外的 id 别名：functionCall 增量与 tool_status 事件当前更自然地携带 call id / id，
   * 而内部存储字段叫 toolId。这里做一次纯类型层适配，避免调用点各写一遍映射样板。
   */
  id?: string
}

function applyToolExecutionPatch(
  state: AgentRunState,
  messageId: string,
  patch: ToolExecutionPatch,
  ordinal: number = 0
): AgentRunState {
  const key = resolveToolExecutionKey(state, messageId, patch, ordinal)
  const current = state.toolExecutionsByKey[key]
  const next: AgentRunToolExecutionState = {
    stableId: key,
    messageId,
    toolId: normalizeNonEmptyString(patch.toolId || patch.id) || current?.toolId || undefined,
    itemId: normalizeNonEmptyString(patch.itemId) || current?.itemId || undefined,
    index: typeof patch.index === 'number' ? patch.index : current?.index,
    name: normalizeNonEmptyString(patch.name) || current?.name || undefined,
    args: patch.args === undefined ? current?.args : patch.args,
    partialArgs: patch.partialArgs === undefined ? current?.partialArgs : patch.partialArgs,
    status: patch.status || current?.status,
    result: patch.result === undefined ? current?.result : patch.result,
    error: patch.error === undefined ? current?.error : patch.error,
    duration: patch.duration === undefined ? current?.duration : patch.duration
  }

  if (next.status && TERMINAL_TOOL_STATUSES.has(next.status)) {
    delete next.partialArgs
  }

  if (current && areToolExecutionStatesEqual(current, next)) {
    return state
  }

  return {
    ...state,
    toolExecutionsByKey: {
      ...state.toolExecutionsByKey,
      [key]: next
    },
    toolExecutionOrder: current ? state.toolExecutionOrder : [...state.toolExecutionOrder, key]
  }
}

function resolveToolExecutionKey(
  state: AgentRunState,
  messageId: string,
  patch: ToolExecutionPatch,
  ordinal: number
): string {
  const identity = {
    id: patch.toolId || patch.id,
    itemId: patch.itemId,
    index: patch.index
  }

  for (const candidate of getAgentRunToolMatchCandidates(messageId, identity, ordinal)) {
    if (state.toolExecutionsByKey[candidate]) {
      return candidate
    }
  }

  return getAgentRunToolStableId(messageId, identity, ordinal)
}

function areToolExecutionStatesEqual(
  left: AgentRunToolExecutionState,
  right: AgentRunToolExecutionState
): boolean {
  return (
    left.stableId === right.stableId &&
    left.messageId === right.messageId &&
    left.toolId === right.toolId &&
    left.itemId === right.itemId &&
    left.index === right.index &&
    left.name === right.name &&
    left.status === right.status &&
    left.error === right.error &&
    left.duration === right.duration &&
    left.partialArgs === right.partialArgs &&
    left.args === right.args &&
    left.result === right.result
  )
}

function cloneMessage(message: Message): Message {
  return {
    ...message,
    parts: message.parts?.map((part): ContentPart => {
      const clonedPart: ContentPart = { ...part }
      if (part.functionCall) clonedPart.functionCall = { ...(part.functionCall as ContentPart['functionCall']) }
      if (part.functionResponse) clonedPart.functionResponse = { ...part.functionResponse }
      if (part.inlineData) clonedPart.inlineData = { ...part.inlineData }
      if (part.fileData) clonedPart.fileData = { ...part.fileData }
      return clonedPart
    }),
    tools: message.tools?.map(tool => ({ ...tool })),
    attachments: message.attachments?.map(attachment => ({ ...attachment }))
  }
}
