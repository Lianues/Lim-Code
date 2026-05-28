import type { Message, ToolUsage } from '../types'
import { extractReviewCardData, isReviewToolName } from './reviewCards'
import { isDesignDocPath, isPlanDocPath } from './taskCards'
// WP14: 保留 null 返回值语义，使用 asRecordOrNull（兼容旧行为：不排除数组、返回 null）
import { asRecordOrNull as asRecord } from './typeGuards'
import {
  getPlanExecutionPrompt,
  getPlanGenerationPrompt,
  getPlanUpdateMode,
  isAwaitingToolUserConfirmation
} from './toolContinuations'

export type PendingAgentActionType = 'generate_plan' | 'execute_plan' | 'continue' | 'generic_confirmation'

export interface PendingAgentAction {
  type: PendingAgentActionType
  actionKey: string
  conversationId?: string
  toolName?: string
  toolId?: string
  path?: string
}

export interface ResolvePendingAgentActionInput {
  allMessages: Message[]
  hasPendingToolConfirmation?: boolean
  pendingToolCalls?: ToolUsage[]
  conversationId?: string | null
}

// WP14: asRecord 已从 typeGuards 通过 asRecordOrNull 别名导入，此处不再重复定义

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function buildActionKey(
  type: PendingAgentActionType,
  conversationId?: string | null,
  toolId?: string,
  toolName?: string,
  path?: string
): string {
  return [
    type,
    conversationId || '',
    toolId || '',
    toolName || '',
    path || ''
  ].join(':')
}

function getResultRecord(tool: ToolUsage): Record<string, unknown> | null {
  return asRecord(tool.result)
}

function resolvePathCandidates(tool: ToolUsage, result: Record<string, unknown> | null): string | undefined {
  const args = asRecord(tool.args)
  const data = asRecord(result?.data)

  return normalizeString(data?.path)
    || normalizeString(result?.path)
    || normalizeString(args?.path)
}

function resolveToolAwaitingAction(
  tool: ToolUsage,
  conversationId?: string | null
): PendingAgentAction | null {
  const result = getResultRecord(tool)
  if (!result) return null

  if (result.success === false) {
    return null
  }

  const path = resolvePathCandidates(tool, result)

  if (tool.name === 'create_design' || tool.name === 'update_design') {
    const continuationPrompt = getPlanGenerationPrompt(result)
    if (!isAwaitingToolUserConfirmation(result) || continuationPrompt) {
      return null
    }

    if (path && !isDesignDocPath(path)) {
      return null
    }

    return {
      type: 'generate_plan',
      actionKey: buildActionKey('generate_plan', conversationId, tool.id, tool.name, path),
      conversationId: conversationId || undefined,
      toolName: tool.name,
      toolId: tool.id,
      path
    }
  }

  if (tool.name === 'create_plan' || tool.name === 'update_plan') {
    if (tool.name === 'update_plan' && getPlanUpdateMode(result, tool.args) === 'progress_sync') {
      return null
    }

    const continuationPrompt = getPlanExecutionPrompt(result)
    if (!isAwaitingToolUserConfirmation(result) || continuationPrompt) {
      return null
    }

    if (path && !isPlanDocPath(path)) {
      return null
    }

    return {
      type: 'execute_plan',
      actionKey: buildActionKey('execute_plan', conversationId, tool.id, tool.name, path),
      conversationId: conversationId || undefined,
      toolName: tool.name,
      toolId: tool.id,
      path
    }
  }

  if (isReviewToolName(tool.name)) {
    const reviewCardData = extractReviewCardData(tool.name, asRecord(tool.args) || {}, result)
    const continuationPrompt = getPlanGenerationPrompt(result)

    if (!reviewCardData || reviewCardData.status !== 'completed' || continuationPrompt) {
      return null
    }

    if (!reviewCardData.path) {
      return null
    }

    return {
      type: 'generate_plan',
      actionKey: buildActionKey('generate_plan', conversationId, tool.id, tool.name, reviewCardData.path),
      conversationId: conversationId || undefined,
      toolName: tool.name,
      toolId: tool.id,
      path: reviewCardData.path
    }
  }

  return null
}

export function resolvePendingAgentAction(input: ResolvePendingAgentActionInput): PendingAgentAction | null {
  const conversationId = input.conversationId || undefined

  if (input.hasPendingToolConfirmation && Array.isArray(input.pendingToolCalls) && input.pendingToolCalls.length > 0) {
    const pendingTool = input.pendingToolCalls[0]
    return {
      type: 'generic_confirmation',
      actionKey: buildActionKey('generic_confirmation', conversationId, pendingTool.id, pendingTool.name),
      conversationId,
      toolName: pendingTool.name,
      toolId: pendingTool.id
    }
  }

  const messages = Array.isArray(input.allMessages) ? input.allMessages : []
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]

    if (message?.role === 'user' && !message.isFunctionResponse) {
      break
    }

    if (message?.role === 'assistant' && !message.isFunctionResponse && (!Array.isArray(message.tools) || message.tools.length === 0)) {
      break
    }

    if (!message || !Array.isArray(message.tools) || message.tools.length === 0) {
      continue
    }

    for (let toolIndex = message.tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = message.tools[toolIndex]
      const action = resolveToolAwaitingAction(tool, conversationId)
      if (action) {
        return action
      }
    }
  }

  return null
}
