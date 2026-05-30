import { nextTick, watch, type WatchStopHandle } from 'vue'
import type { ErrorInfo, Message, ToolUsage, VSCodeRequestType } from '../types'
import { getSoundSettings, type NormalizedUISoundSettings } from './soundCues'
import {
  resolvePendingAgentAction,
  type PendingAgentAction,
  type PendingAgentActionType
} from '../utils/pendingAgentAction'

const LOG_PREFIX = '[agent-stop-notification][frontend]'

export type AgentStopNotificationReason = 'error' | 'awaiting_user_action' | 'continue_required'

export interface AgentStopNotificationPayload {
  reason: AgentStopNotificationReason
  dedupeKey: string
  createdAt: number
  conversationId?: string
  actionType?: PendingAgentActionType
  toolName?: string
  toolId?: string
  path?: string
  errorCode?: string
}

export interface AgentStopNotificationControllerChatStore {
  isStreaming: boolean
  isWaitingForResponse: boolean
  error: ErrorInfo | null
  retryStatus?: { isRetrying?: boolean } | null
  needsContinueButton: boolean
  hasPendingToolConfirmation: boolean
  pendingToolCalls: ToolUsage[]
  allMessages: Message[]
  currentConversationId: string | null
  currentConversation?: { title?: string } | null
}

export interface AgentStopNotificationControllerOptions {
  chatStore: AgentStopNotificationControllerChatStore
  sendToExtension: <T = any>(type: VSCodeRequestType, data: any) => Promise<T>
  getSoundSettings?: () => NormalizedUISoundSettings
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function findLatestMessage(messages: Message[], predicate?: (message: Message) => boolean): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    if (!predicate || predicate(message)) {
      return message
    }
  }
  return null
}

export class AgentStopNotificationController {
  private readonly chatStore: AgentStopNotificationControllerChatStore
  private readonly sendToExtension: <T = any>(type: VSCodeRequestType, data: any) => Promise<T>
  private readonly getRuntimeSoundSettings: () => NormalizedUISoundSettings
  private runningWatch?: WatchStopHandle
  private suppressNextStop = false
  private lastSentDedupeKey = ''

  constructor(options: AgentStopNotificationControllerOptions) {
    this.chatStore = options.chatStore
    this.sendToExtension = options.sendToExtension
    this.getRuntimeSoundSettings = options.getSoundSettings ?? getSoundSettings
    console.log(LOG_PREFIX, 'controller initialized')

    this.runningWatch = watch(
      () => this.isAgentRunning(),
      (isRunning, wasRunning) => {
        console.log(LOG_PREFIX, 'running state changed', {
          wasRunning,
          isRunning,
          isStreaming: this.chatStore.isStreaming,
          isWaitingForResponse: this.chatStore.isWaitingForResponse,
          hasError: !!this.chatStore.error,
          isRetrying: !!this.chatStore.retryStatus?.isRetrying,
          needsContinueButton: this.chatStore.needsContinueButton,
          hasPendingToolConfirmation: this.chatStore.hasPendingToolConfirmation
        })

        if (isRunning) {
          this.lastSentDedupeKey = ''
          console.log(LOG_PREFIX, 'agent entered running state, reset last dedupe key')
          return
        }

        if (wasRunning) {
          void this.handleAgentStopped()
        }
      },
      {
        flush: 'post'
      }
    )
  }

  markUserCancelled(): void {
    if (!this.isAgentRunning()) {
      console.log(LOG_PREFIX, 'markUserCancelled ignored because agent is not running')
      return
    }

    this.suppressNextStop = true
    console.log(LOG_PREFIX, 'marked next stop as user-cancelled')
  }

  clearUserCancelled(): void {
    this.suppressNextStop = false
    console.log(LOG_PREFIX, 'cleared user-cancel suppression flag')
  }

  dispose(): void {
    this.runningWatch?.()
    this.runningWatch = undefined
    this.suppressNextStop = false
    this.lastSentDedupeKey = ''
    console.log(LOG_PREFIX, 'controller disposed')
  }

  private isAgentRunning(): boolean {
    return !!(this.chatStore.isStreaming || this.chatStore.isWaitingForResponse)
  }

  private getNotificationSettings() {
    return this.getRuntimeSoundSettings().windowsAgentStopNotification
  }

  private shouldNotify(reason: AgentStopNotificationReason): boolean {
    const settings = this.getNotificationSettings()

    if (!settings.enabled) {
      console.log(LOG_PREFIX, 'skip notify because Windows notifications are disabled', {
        reason,
        settings
      })
      return false
    }

    const enabled = reason === 'error'
      ? settings.cases.error
      : reason === 'awaiting_user_action'
        ? settings.cases.awaitingUserAction
        : settings.cases.continueRequired

    if (!enabled) {
      console.log(LOG_PREFIX, 'skip notify because notification case is disabled', {
        reason,
        settings
      })
    }

    return enabled
  }

  private getCreatedAt(preferredMessage: Message | null): number {
    if (preferredMessage && Number.isFinite(preferredMessage.timestamp)) {
      return preferredMessage.timestamp
    }

    const latestMessage = findLatestMessage(this.chatStore.allMessages)
    if (latestMessage && Number.isFinite(latestMessage.timestamp)) {
      return latestMessage.timestamp
    }

    return Date.now()
  }

  private buildErrorPayload(): AgentStopNotificationPayload | null {
    const error = this.chatStore.error
    if (!error || !this.shouldNotify('error')) {
      return null
    }

    const conversationId = this.chatStore.currentConversationId || undefined
    const latestMessage = findLatestMessage(this.chatStore.allMessages)
    const messageKey = latestMessage?.id || String(latestMessage?.backendIndex || '')

    const payload: AgentStopNotificationPayload = {
      reason: 'error',
      dedupeKey: ['error', conversationId || '', error.code || '', error.message || '', messageKey].join(':'),
      createdAt: this.getCreatedAt(latestMessage),
      conversationId,
      errorCode: normalizeText(error.code)
    }

    console.log(LOG_PREFIX, 'built error payload', {
      reason: payload.reason,
      dedupeKey: payload.dedupeKey,
      errorCode: payload.errorCode,
      conversationId: payload.conversationId
    })
    return payload
  }

  private buildAwaitingUserActionPayload(action: PendingAgentAction): AgentStopNotificationPayload | null {
    if (!this.shouldNotify('awaiting_user_action')) {
      return null
    }

    const latestMessage = findLatestMessage(this.chatStore.allMessages)

    const payload: AgentStopNotificationPayload = {
      reason: 'awaiting_user_action',
      dedupeKey: action.actionKey,
      createdAt: this.getCreatedAt(latestMessage),
      conversationId: action.conversationId || this.chatStore.currentConversationId || undefined,
      actionType: action.type,
      toolName: action.toolName,
      toolId: action.toolId,
      path: action.path
    }

    console.log(LOG_PREFIX, 'built awaiting_user_action payload', {
      reason: payload.reason,
      dedupeKey: payload.dedupeKey,
      actionType: payload.actionType,
      toolName: payload.toolName,
      path: payload.path
    })
    return payload
  }

  private buildContinueRequiredPayload(): AgentStopNotificationPayload | null {
    if (!this.chatStore.needsContinueButton || !this.shouldNotify('continue_required')) {
      return null
    }

    const conversationId = this.chatStore.currentConversationId || undefined
    const latestFunctionResponse = findLatestMessage(this.chatStore.allMessages, (message) => message.isFunctionResponse === true)
    const latestMessage = latestFunctionResponse || findLatestMessage(this.chatStore.allMessages)
    const dedupeSource = latestFunctionResponse?.id || String(latestFunctionResponse?.backendIndex || latestMessage?.id || '')

    const payload: AgentStopNotificationPayload = {
      reason: 'continue_required',
      dedupeKey: ['continue_required', conversationId || '', dedupeSource].join(':'),
      createdAt: this.getCreatedAt(latestMessage),
      conversationId,
      actionType: 'continue'
    }

    console.log(LOG_PREFIX, 'built continue_required payload', {
      reason: payload.reason,
      dedupeKey: payload.dedupeKey,
      actionType: payload.actionType,
      conversationId: payload.conversationId
    })
    return payload
  }

  private buildPayload(): AgentStopNotificationPayload | null {
    if (this.chatStore.retryStatus?.isRetrying) {
      console.log(LOG_PREFIX, 'skip notification because retrying is active')
      return null
    }

    const errorPayload = this.buildErrorPayload()
    if (errorPayload) {
      console.log(LOG_PREFIX, 'selected error payload')
      return errorPayload
    }

    const pendingAction = resolvePendingAgentAction({
      allMessages: this.chatStore.allMessages,
      hasPendingToolConfirmation: this.chatStore.hasPendingToolConfirmation,
      pendingToolCalls: this.chatStore.pendingToolCalls,
      conversationId: this.chatStore.currentConversationId
    })

    console.log(LOG_PREFIX, 'resolved pending action', pendingAction)

    if (pendingAction) {
      const payload = this.buildAwaitingUserActionPayload(pendingAction)
      if (payload) {
        console.log(LOG_PREFIX, 'selected awaiting_user_action payload')
      }
      return payload
    }

    const continuePayload = this.buildContinueRequiredPayload()
    if (continuePayload) {
      console.log(LOG_PREFIX, 'selected continue_required payload')
      return continuePayload
    }

    console.log(LOG_PREFIX, 'no notification payload matched current stop state', {
      hasError: !!this.chatStore.error,
      needsContinueButton: this.chatStore.needsContinueButton,
      hasPendingToolConfirmation: this.chatStore.hasPendingToolConfirmation,
      messages: this.chatStore.allMessages.length
    })

    return null
  }

  private async handleAgentStopped(): Promise<void> {
    await nextTick()
    await Promise.resolve()

    console.log(LOG_PREFIX, 'handling agent stopped event after state settled', {
      isStreaming: this.chatStore.isStreaming,
      isWaitingForResponse: this.chatStore.isWaitingForResponse,
      hasError: !!this.chatStore.error,
      isRetrying: !!this.chatStore.retryStatus?.isRetrying,
      needsContinueButton: this.chatStore.needsContinueButton,
      hasPendingToolConfirmation: this.chatStore.hasPendingToolConfirmation
    })

    if (this.isAgentRunning()) {
      console.log(LOG_PREFIX, 'stop handling aborted because agent resumed running')
      return
    }

    if (this.suppressNextStop) {
      this.suppressNextStop = false
      console.log(LOG_PREFIX, 'skip notification because stop was marked as user-cancelled')
      return
    }

    const payload = this.buildPayload()
    if (!payload) {
      console.log(LOG_PREFIX, 'skip notification because no payload was produced')
      return
    }

    if (payload.dedupeKey === this.lastSentDedupeKey) {
      console.log(LOG_PREFIX, 'skip notification because dedupe key already sent in current stop cycle', {
        dedupeKey: payload.dedupeKey
      })
      return
    }

    this.lastSentDedupeKey = payload.dedupeKey

    try {
      console.log(LOG_PREFIX, 'sending notification payload to extension', payload)
      const result = await this.sendToExtension('notifications.agentStop', payload)
      console.log(LOG_PREFIX, 'extension responded to notification payload', result)
    } catch (error) {
      console.error('[agent-stop-notification] Failed to send notification payload:', error)
    }
  }
}

export function createAgentStopNotificationController(
  options: AgentStopNotificationControllerOptions
): AgentStopNotificationController {
  return new AgentStopNotificationController(options)
}
