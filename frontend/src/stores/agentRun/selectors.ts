/**
 * WP20: AgentRun selector 草案。
 *
 * 为什么需要这个文件：WP20 的目标不是立刻迁移 UI，而是先证明同一份 AgentRunState
 * 可以派生出 Main Chat 和 SubAgent Monitor 所需的 UI 数据形状。
 *
 * 怎么改：selector 只读取纯 state，不依赖 Pinia / Vue / webview。这样后续无论接到 chatStore、
 * SubAgent Monitor 还是未来 TranscriptRepository，都能复用同一套派生规则。
 *
 * 目的：把“状态如何长成 UI”从热路径里抽出来，避免 Main Chat 与 Monitor 再各写一套 view model 逻辑。
 */

import type { Message, ToolUsage } from '../../types'
import { hasNonEmptyArgs, normalizeNonEmptyString, type StreamFunctionCall } from '../../utils/functionCallMerge'
import {
  type AgentRunState,
  type AgentRunToolExecutionState,
  getAgentRunToolMatchCandidates,
  getAgentRunToolStableId
} from './events'

export interface MainChatView {
  status: AgentRunState['status']
  allMessages: Message[]
  visibleMessages: Message[]
  pendingToolCalls: ToolUsage[]
  latestAssistantMessageId?: string
}

export interface SubAgentMonitorView {
  status: AgentRunState['status']
  allMessages: Message[]
  renderMessages: Message[]
  hiddenFunctionResponseMessages: Message[]
  latestMessageId?: string
  eventCount: number
}

export function selectMainChatView(state: AgentRunState): MainChatView {
  const allMessages = materializeMessages(state)
  const visibleMessages = allMessages.filter(message => message.isFunctionResponse !== true)
  const pendingToolCalls = visibleMessages
    .flatMap(message => message.tools || [])
    .filter(tool => tool.status !== 'success' && tool.status !== 'error' && tool.status !== 'warning')
  const latestAssistantMessageId = [...visibleMessages].reverse().find(message => message.role === 'assistant')?.id

  return {
    status: state.status,
    allMessages,
    visibleMessages,
    pendingToolCalls,
    latestAssistantMessageId
  }
}

export function selectSubAgentMonitorView(state: AgentRunState): SubAgentMonitorView {
  const allMessages = materializeMessages(state)
  const hiddenFunctionResponseMessages = allMessages.filter(message => message.isFunctionResponse === true)
  const renderMessages = allMessages.filter(message => message.isFunctionResponse !== true)

  return {
    status: state.status,
    allMessages,
    renderMessages,
    hiddenFunctionResponseMessages,
    latestMessageId: renderMessages[renderMessages.length - 1]?.id,
    eventCount: state.eventOrder.length
  }
}

function materializeMessages(state: AgentRunState): Message[] {
  return state.messageOrder.map(messageId => materializeMessage(state, state.messagesById[messageId]))
}

function materializeMessage(state: AgentRunState, message: Message | undefined): Message {
  if (!message) {
    return {
      id: 'missing-message',
      role: 'assistant',
      content: '',
      timestamp: 0,
      parts: []
    }
  }

  const toolsFromParts = buildToolsFromFunctionCallParts(state, message)
  if (toolsFromParts.length > 0) {
    return {
      ...message,
      tools: toolsFromParts
    }
  }

  if (message.tools && message.tools.length > 0) {
    return {
      ...message,
      tools: buildToolsFromExistingUsages(state, message)
    }
  }

  return message
}

function buildToolsFromFunctionCallParts(state: AgentRunState, message: Message): ToolUsage[] {
  const parts = message.parts || []
  let ordinal = 0
  const tools: ToolUsage[] = []

  for (const part of parts) {
    const functionCall = part.functionCall as StreamFunctionCall | undefined
    if (!functionCall) continue

    const overlay = findToolExecutionOverlay(state, message.id, functionCall, ordinal)
    const stableId = getAgentRunToolStableId(message.id, functionCall, ordinal)
    const partialArgs = overlay?.partialArgs ?? functionCall.partialArgs
    const args = overlay?.args ?? (hasNonEmptyArgs(functionCall.args) ? functionCall.args : {})

    tools.push({
      id: normalizeNonEmptyString(overlay?.toolId) || normalizeNonEmptyString(functionCall.id) || stableId,
      name: normalizeNonEmptyString(overlay?.name) || functionCall.name || '',
      args,
      itemId: overlay?.itemId || functionCall.itemId,
      index: typeof overlay?.index === 'number' ? overlay.index : functionCall.index,
      result: overlay?.result,
      error: overlay?.error,
      duration: overlay?.duration,
      partialArgs,
      status: overlay?.status || (typeof partialArgs === 'string' ? 'streaming' : 'queued')
    })

    ordinal += 1
  }

  return tools
}

function buildToolsFromExistingUsages(state: AgentRunState, message: Message): ToolUsage[] {
  return (message.tools || []).map((tool, ordinal) => {
    const overlay = findToolExecutionOverlay(state, message.id, tool, ordinal)
    const partialArgs = overlay?.partialArgs ?? tool.partialArgs

    return {
      ...tool,
      id: normalizeNonEmptyString(overlay?.toolId) || tool.id,
      name: normalizeNonEmptyString(overlay?.name) || tool.name,
      args: overlay?.args ?? tool.args,
      itemId: overlay?.itemId || tool.itemId,
      index: typeof overlay?.index === 'number' ? overlay.index : tool.index,
      result: overlay?.result ?? tool.result,
      error: overlay?.error ?? tool.error,
      duration: overlay?.duration ?? tool.duration,
      partialArgs,
      status: overlay?.status || tool.status || (typeof partialArgs === 'string' ? 'streaming' : 'queued')
    }
  })
}

function findToolExecutionOverlay(
  state: AgentRunState,
  messageId: string,
  identity: { id?: string; itemId?: string; index?: number },
  ordinal: number
): AgentRunToolExecutionState | undefined {
  for (const candidate of getAgentRunToolMatchCandidates(messageId, identity, ordinal)) {
    const matched = state.toolExecutionsByKey[candidate]
    if (matched) return matched
  }

  const fallbackStableId = getAgentRunToolStableId(messageId, identity, ordinal)
  return state.toolExecutionsByKey[fallbackStableId]
}
