/**
 * WP20: AgentRunEvent + 统一 reducer 最小核心（事件契约草案）。
 *
 * 为什么需要这个文件：WP02 冻结了“统一事件 + 统一 reducer + selector 派生 UI”的方向，
 * 但当前主聊天和 SubAgent Monitor 仍然各自维护热路径状态。本文件只定义 canonical draft，
 * 不接管任何现有 hot path，也不修改 chatStore / webview 协议。
 *
 * 怎么改：把最小可重放（replayable）的 envelope、事件联合类型、稳定事件 ID 规则、
 * tool 匹配键规则，以及 reducer 所需的 AgentRunState 草案集中到单一模块。
 *
 * 目的：后续 WP21/WP22/WP23/WP24 可以围绕同一份事件边界继续抽象，
 * 同时让 Main Chat 与 SubAgent Monitor 最终都能通过 selector 派生 UI 数据，
 * 而不是继续发展出第二套 reducer / event model。
 *
 * 约束：
 * - 本文件只是草案与基础设施，不接管现有热路径。
 * - 不引入 provider / view / source 特判。
 * - 所有稳定 ID 都是“纯数据规则”，不依赖 Vue/React/webview runtime。
 */

import type { ErrorInfo, Message, ToolUsage } from '../../types'
import type { StreamFunctionCall } from '../../utils/functionCallMerge'

export type AgentRunEventSource = 'main_chat' | 'subagent_monitor' | 'replay'

export type AgentRunLifecycleStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'awaiting_monitor_action'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

/**
 * canonical event envelope。
 *
 * 为什么 eventId/sequence 同时保留：
 * - eventId 适合直接从未来的后端/桥接层透传；
 * - sequence 适合尚未拥有全局 eventId 的流式来源；
 * - 两者都缺失时，本文件提供 best-effort 的纯数据派生键，供本草案做 replay / idempotence 测试。
 */
export interface AgentRunEventEnvelope {
  runId: string
  source: AgentRunEventSource
  timestamp: number
  eventId?: string
  sequence?: number
}

export interface AgentRunStartedEvent {
  type: 'run_started'
  envelope: AgentRunEventEnvelope
  payload: {
    conversationId?: string
    status?: Exclude<AgentRunLifecycleStatus, 'idle'>
  }
}

export interface AgentRunStatusChangedEvent {
  type: 'run_status_changed'
  envelope: AgentRunEventEnvelope
  payload: {
    status: Exclude<AgentRunLifecycleStatus, 'idle'>
    error?: ErrorInfo
  }
}

export interface AgentRunMessageSnapshotEvent {
  type: 'message_snapshot'
  envelope: AgentRunEventEnvelope
  payload: {
    message: Message
  }
}

export interface AgentRunMessageTextDeltaEvent {
  type: 'message_text_delta'
  envelope: AgentRunEventEnvelope
  payload: {
    messageId: string
    role?: Message['role']
    text: string
    thought?: boolean
    timestamp?: number
  }
}

export interface AgentRunMessageFunctionCallDeltaEvent {
  type: 'message_function_call_delta'
  envelope: AgentRunEventEnvelope
  payload: {
    messageId: string
    role?: Extract<Message['role'], 'assistant'>
    call: StreamFunctionCall
    timestamp?: number
  }
}

export interface AgentRunToolStatusPatch {
  id?: string
  itemId?: string
  index?: number
  name?: string
  args?: Record<string, unknown>
  partialArgs?: string
  status?: ToolUsage['status']
  result?: Record<string, unknown>
  error?: string
  duration?: number
}

export interface AgentRunToolStatusEvent {
  type: 'tool_status'
  envelope: AgentRunEventEnvelope
  payload: {
    messageId: string
    tool: AgentRunToolStatusPatch
  }
}

export interface AgentRunToolResultEvent {
  type: 'tool_result'
  envelope: AgentRunEventEnvelope
  payload: {
    messageId: string
    toolId?: string
    itemId?: string
    index?: number
    name?: string
    result?: Record<string, unknown>
    error?: string
    duration?: number
    status?: ToolUsage['status']
  }
}

export type AgentRunEvent =
  | AgentRunStartedEvent
  | AgentRunStatusChangedEvent
  | AgentRunMessageSnapshotEvent
  | AgentRunMessageTextDeltaEvent
  | AgentRunMessageFunctionCallDeltaEvent
  | AgentRunToolStatusEvent
  | AgentRunToolResultEvent

export interface AgentRunToolExecutionState {
  stableId: string
  messageId: string
  toolId?: string
  itemId?: string
  index?: number
  name?: string
  args?: Record<string, unknown>
  partialArgs?: string
  status?: ToolUsage['status']
  result?: Record<string, unknown>
  error?: string
  duration?: number
}

export interface AgentRunState {
  runId: string | null
  source: AgentRunEventSource | null
  conversationId?: string
  status: AgentRunLifecycleStatus
  startedAt?: number
  updatedAt?: number
  finishedAt?: number
  lastEventId?: string
  lastError?: ErrorInfo
  /**
   * 为什么保留 processedEventIds：本草案要证明 reducer 可以 replay 且幂等；
   * 因此 reducer 需要一个纯数据 journal 来丢弃重复事件。
   */
  processedEventIds: Readonly<Record<string, true>>
  eventOrder: readonly string[]
  messagesById: Readonly<Record<string, Message>>
  messageOrder: readonly string[]
  toolExecutionsByKey: Readonly<Record<string, AgentRunToolExecutionState>>
  toolExecutionOrder: readonly string[]
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * 稳定 stringify。
 *
 * 为什么需要：eventId 缺失时，fallback 键不能直接依赖普通 JSON.stringify，
 * 否则对象 key 顺序变化会让“同语义重复事件”变成两个不同 ID。
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 事件稳定 ID 规则。
 *
 * 为什么把规则集中在这里：reducer 和 replay tests 必须共享同一套 envelope 解释，
 * 不能一边按 eventId 去重，另一边按 messageId/timestamp 去重。
 *
 * 说明：
 * - 推荐未来热路径显式提供 eventId 或 sequence。
 * - 当前 fallback 仅服务于 WP20 草案与测试基础设施，不声称已接管生产协议。
 */
export function getAgentRunEventId(event: AgentRunEvent): string {
  const explicitEventId = normalizeOptionalString(event.envelope.eventId)
  if (explicitEventId) {
    return explicitEventId
  }

  const envelopeBase = `${event.envelope.runId}|${event.type}|${event.envelope.source}|${event.envelope.sequence ?? 'seq:none'}|${event.envelope.timestamp}`

  switch (event.type) {
    case 'run_started':
      return `${envelopeBase}|conversation:${normalizeOptionalString(event.payload.conversationId)}|status:${event.payload.status || 'running'}`
    case 'run_status_changed':
      return `${envelopeBase}|status:${event.payload.status}|error:${stableStringify(event.payload.error || null)}`
    case 'message_snapshot':
      return `${envelopeBase}|message:${event.payload.message.id}`
    case 'message_text_delta':
      return `${envelopeBase}|message:${event.payload.messageId}|thought:${event.payload.thought === true ? '1' : '0'}|text:${stableStringify(event.payload.text)}`
    case 'message_function_call_delta':
      return `${envelopeBase}|message:${event.payload.messageId}|call:${stableStringify(event.payload.call)}`
    case 'tool_status':
      return `${envelopeBase}|message:${event.payload.messageId}|tool:${stableStringify(event.payload.tool)}`
    case 'tool_result':
      return `${envelopeBase}|message:${event.payload.messageId}|tool:${stableStringify(event.payload)}`
  }
}

export type AgentRunToolIdentity = Pick<StreamFunctionCall, 'id' | 'itemId' | 'index'>

/**
 * tool 稳定匹配键规则。
 *
 * 为什么优先级是 id > itemId > index > ordinal：
 * - 最终 tool result / tool status 仍以 call_id/id 为最稳；
 * - OpenAI Responses 在流式中经常先给 itemId / index，再晚些给最终 id；
 * - ordinal 只作为“完全没有定位字段”的最后兜底，不进入任何 provider 特判。
 */
export function getAgentRunToolStableId(
  messageId: string,
  identity: AgentRunToolIdentity,
  ordinal: number = 0
): string {
  const toolId = normalizeOptionalString(identity.id)
  if (toolId) return `message:${messageId}|tool:id:${toolId}`

  const itemId = normalizeOptionalString(identity.itemId)
  if (itemId) return `message:${messageId}|tool:item:${itemId}`

  if (typeof identity.index === 'number') {
    return `message:${messageId}|tool:index:${identity.index}`
  }

  return `message:${messageId}|tool:ordinal:${ordinal}`
}

/**
 * 返回一个 tool 可能匹配到的所有候选键。
 *
 * 为什么需要候选列表：流式过程中 tool 可能先只有 itemId/index，后面才补 final id。
 * selector / reducer 需要按同一优先级做匹配，但又不能复制第二份 merge 语义。
 */
export function getAgentRunToolMatchCandidates(
  messageId: string,
  identity: AgentRunToolIdentity,
  ordinal: number = 0
): string[] {
  const candidates = [
    getAgentRunToolStableId(messageId, { id: identity.id }, ordinal),
    getAgentRunToolStableId(messageId, { itemId: identity.itemId }, ordinal),
    getAgentRunToolStableId(messageId, { index: identity.index }, ordinal),
    getAgentRunToolStableId(messageId, identity, ordinal)
  ]

  return [...new Set(candidates)]
}
