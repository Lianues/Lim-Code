/**
 * VSCode API 通信工具
 */

import type { VSCodeMessage, VSCodeRequest, VSCodeRequestType } from '../types'
import { handleSoundEvent } from '../services/soundEventController'

const DEFAULT_WEBVIEW_CLIENT_ID = 'main-chat'

// 获取 VSCode API
declare function acquireVsCodeApi(): any

let vscodeApi: any = null

export function getVSCodeAPI() {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi()
  }
  return vscodeApi
}

export function getWebviewClientId(): string {
  const configured = (window as any).__LIMCODE_WEBVIEW_CLIENT_ID
  return typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : DEFAULT_WEBVIEW_CLIENT_ID
}

// 消息请求ID生成器
let requestIdCounter = 0
export function generateRequestId(): string {
  return `${getWebviewClientId()}_req_${Date.now()}_${++requestIdCounter}`
}

type IncomingExtensionMessage = VSCodeMessage & {
  success?: boolean
  error?: { message?: string } | string
  [key: string]: unknown
}

export type ExtensionMessageHandler<T extends VSCodeMessage = VSCodeMessage> = (message: T) => void

export interface MessageBusSubscription<T extends VSCodeMessage = VSCodeMessage> {
  handler: ExtensionMessageHandler<T>
  type?: string
  owner?: string
}

export interface ExtensionMessagePayloadSize {
  envelopeBytes: number
  dataBytes: number
  fieldBytes: Record<string, number>
}

export interface ExtensionMessageBudget {
  maxEnvelopeBytes?: number
  maxDataBytes?: number
  maxFieldBytes?: Record<string, number>
}

export interface ExtensionMessageBudgetEvaluation extends ExtensionMessagePayloadSize {
  ok: boolean
  violations: string[]
}

export interface ExtensionMessageMetric {
  type: string
  count: number
  totalEnvelopeBytes: number
  maxEnvelopeBytes: number
  totalDataBytes: number
  maxDataBytes: number
  lastAt: number
}

// 消息处理器映射
interface MessageHandler<T = any> {
  resolve: (data: T) => void
  reject: (error: Error) => void
}

const messageHandlers = new Map<string, MessageHandler>()
const messageSubscribers = new Set<MessageBusSubscription>()
const extensionMessageMetrics = new Map<string, ExtensionMessageMetric>()
let nativeMessageListener: ((event: MessageEvent) => void) | null = null

function stringifyForMeasurement(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : String(value)
  } catch {
    return String(value)
  }
}

export function getUtf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).byteLength
  }

  let bytes = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) bytes += 1
    else if (codePoint <= 0x7ff) bytes += 2
    else if (codePoint <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

export function getJsonUtf8ByteLength(value: unknown): number {
  return getUtf8ByteLength(stringifyForMeasurement(value))
}

export function measureExtensionMessagePayload(
  message: unknown,
  fields: string[] = ['data']
): ExtensionMessagePayloadSize {
  const envelopeBytes = getJsonUtf8ByteLength(message)
  const fieldBytes: Record<string, number> = {}

  if (message && typeof message === 'object') {
    const record = message as Record<string, unknown>
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(record, field)) {
        fieldBytes[field] = getJsonUtf8ByteLength(record[field])
      }
    }
  }

  return {
    envelopeBytes,
    dataBytes: fieldBytes.data ?? 0,
    fieldBytes
  }
}

export function evaluateExtensionMessageBudget(
  message: unknown,
  budget: ExtensionMessageBudget,
  fields: string[] = ['data']
): ExtensionMessageBudgetEvaluation {
  const measured = measureExtensionMessagePayload(message, fields)
  const violations: string[] = []

  if (typeof budget.maxEnvelopeBytes === 'number' && measured.envelopeBytes > budget.maxEnvelopeBytes) {
    violations.push(`envelopeBytes ${measured.envelopeBytes} > ${budget.maxEnvelopeBytes}`)
  }
  if (typeof budget.maxDataBytes === 'number' && measured.dataBytes > budget.maxDataBytes) {
    violations.push(`dataBytes ${measured.dataBytes} > ${budget.maxDataBytes}`)
  }
  if (budget.maxFieldBytes) {
    for (const [field, maxBytes] of Object.entries(budget.maxFieldBytes)) {
      const actual = measured.fieldBytes[field] ?? 0
      if (actual > maxBytes) {
        violations.push(`${field}Bytes ${actual} > ${maxBytes}`)
      }
    }
  }

  return {
    ...measured,
    ok: violations.length === 0,
    violations
  }
}

export function isExtensionMessageWithinBudget(
  message: unknown,
  budget: ExtensionMessageBudget,
  fields: string[] = ['data']
): boolean {
  return evaluateExtensionMessageBudget(message, budget, fields).ok
}

function recordExtensionMessageMetric(message: IncomingExtensionMessage): void {
  const type = typeof message.type === 'string' && message.type ? message.type : '__response__'
  const measured = measureExtensionMessagePayload(message)
  const existing = extensionMessageMetrics.get(type)
  const now = Date.now()

  if (!existing) {
    extensionMessageMetrics.set(type, {
      type,
      count: 1,
      totalEnvelopeBytes: measured.envelopeBytes,
      maxEnvelopeBytes: measured.envelopeBytes,
      totalDataBytes: measured.dataBytes,
      maxDataBytes: measured.dataBytes,
      lastAt: now
    })
    return
  }

  existing.count += 1
  existing.totalEnvelopeBytes += measured.envelopeBytes
  existing.maxEnvelopeBytes = Math.max(existing.maxEnvelopeBytes, measured.envelopeBytes)
  existing.totalDataBytes += measured.dataBytes
  existing.maxDataBytes = Math.max(existing.maxDataBytes, measured.dataBytes)
  existing.lastAt = now
}

export function getExtensionMessageMetricsSnapshot(): ExtensionMessageMetric[] {
  return Array.from(extensionMessageMetrics.values()).map(metric => ({ ...metric }))
}

export function resetExtensionMessageMetricsForTests(): void {
  extensionMessageMetrics.clear()
}

function getResponseError(message: IncomingExtensionMessage): Error {
  if (typeof message.error === 'string' && message.error.trim()) {
    return new Error(message.error)
  }
  if (message.error && typeof message.error === 'object' && typeof message.error.message === 'string' && message.error.message.trim()) {
    return new Error(message.error.message)
  }
  return new Error('Unknown error')
}

function dispatchPushMessage(message: IncomingExtensionMessage): void {
  if (!message.type) {
    return
  }

  for (const subscription of Array.from(messageSubscribers)) {
    if (subscription.type && subscription.type !== message.type) {
      continue
    }

    try {
      subscription.handler(message)
    } catch (err) {
      console.error('Extension message handler failed:', {
        owner: subscription.owner,
        type: message.type,
        error: err
      })
    }
  }
}

function handleIncomingExtensionMessage(rawMessage: unknown): void {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return
  }

  const message = rawMessage as IncomingExtensionMessage
  if (message.clientId && message.clientId !== getWebviewClientId()) {
    return
  }

  recordExtensionMessageMetric(message)

  if (message.requestId && messageHandlers.has(message.requestId)) {
    const responseHandler = messageHandlers.get(message.requestId)!
    messageHandlers.delete(message.requestId)

    if (message.success) {
      responseHandler.resolve(message.data)
    } else {
      responseHandler.reject(getResponseError(message))
    }
    maybeRemoveNativeMessageListener()
    return
  }

  dispatchPushMessage(message)
}

function ensureNativeMessageListener(): void {
  if (nativeMessageListener) {
    return
  }

  nativeMessageListener = (event: MessageEvent) => {
    handleIncomingExtensionMessage(event.data)
  }
  window.addEventListener('message', nativeMessageListener)
}

function maybeRemoveNativeMessageListener(): void {
  if (!nativeMessageListener || messageSubscribers.size > 0 || messageHandlers.size > 0) {
    return
  }

  window.removeEventListener('message', nativeMessageListener)
  nativeMessageListener = null
}

export function subscribeExtensionMessage<T extends VSCodeMessage = VSCodeMessage>(
  subscription: MessageBusSubscription<T>
): () => void {
  messageSubscribers.add(subscription as MessageBusSubscription)
  ensureNativeMessageListener()

  return () => {
    messageSubscribers.delete(subscription as MessageBusSubscription)
    maybeRemoveNativeMessageListener()
  }
}

export function onExtensionMessageType<T = any>(
  type: string,
  handler: (message: VSCodeMessage<T> & Record<string, unknown>) => void,
  owner?: string
): () => void {
  return subscribeExtensionMessage({
    type,
    owner,
    handler: handler as ExtensionMessageHandler
  })
}

export interface WebviewVisibilityPayload {
  visible: boolean
  hidden: boolean
  visibilityState: string
  source: string
  updatedAt: number
}

function createWebviewVisibilityPayload(source: string): WebviewVisibilityPayload {
  const visibilityState = typeof document !== 'undefined'
    ? document.visibilityState
    : 'visible'
  const hidden = typeof document !== 'undefined'
    ? document.hidden || visibilityState === 'hidden'
    : false

  return {
    visible: !hidden,
    hidden,
    visibilityState,
    source,
    updatedAt: Date.now()
  }
}

export function reportWebviewVisibility(source = 'frontend'): Promise<unknown> {
  return sendToExtension('webview.visibilityChanged', createWebviewVisibilityPayload(source))
}

export function registerWebviewVisibilityReporter(source = 'frontend'): () => void {
  const report = () => {
    reportWebviewVisibility(source).catch(() => {})
  }

  report()

  if (typeof document === 'undefined') {
    return () => {}
  }

  document.addEventListener('visibilitychange', report)
  window.addEventListener('focus', report)
  window.addEventListener('blur', report)

  return () => {
    document.removeEventListener('visibilitychange', report)
    window.removeEventListener('focus', report)
    window.removeEventListener('blur', report)
  }
}

// 发送消息到插件
// 注意：不设置前端超时，后端渠道配置已有超时设置
export function sendToExtension<T = any>(type: VSCodeRequestType, data: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const clientId = getWebviewClientId()
    const requestId = generateRequestId()
    const vscode = getVSCodeAPI()
    ensureNativeMessageListener()
    
    // 注册响应处理器
    messageHandlers.set(requestId, {
      resolve: (data: T) => {
        resolve(data)
      },
      reject: (error: Error) => {
        reject(error)
      }
    })
    
    // 发送消息
    try {
      vscode.postMessage({
        type,
        clientId,
        requestId,
        data
      } as VSCodeRequest)
    } catch (err: any) {
      // 例如：payload 过大导致 structured clone / postMessage 失败
      messageHandlers.delete(requestId)
      maybeRemoveNativeMessageListener()
      const msg = typeof err?.message === 'string' && err.message.trim()
        ? err.message
        : 'Failed to post message to VS Code extension'
      reject(new Error(msg))
    }
  })
}

// 监听来自插件的消息
export function onMessageFromExtension(
  handler: (message: VSCodeMessage) => void
): () => void {
  return subscribeExtensionMessage({
    owner: 'legacy:onMessageFromExtension',
    handler
  })
}

/**
 * 监听来自插件的命令推送
 * 
 * @param command 命令名称
 * @param handler 处理器
 * @returns 取消监听函数
 */
export function onExtensionCommand<T = any>(
  command: string,
  handler: (data: T) => void
): () => void {
  return onMessageFromExtension((message: any) => {
    if (message.type === 'command' && message.command === command) {
      handler(message.data)
    }
  })
}

// 状态持久化
export function saveState(key: string, value: any) {
  const vscode = getVSCodeAPI()
  const state = vscode.getState() || {}
  state[key] = value
  vscode.setState(state)
}

export function loadState<T = any>(key: string, defaultValue?: T): T | undefined {
  const vscode = getVSCodeAPI()
  const state = vscode.getState() || {}
  return state[key] !== undefined ? state[key] : defaultValue
}

export function clearState() {
  const vscode = getVSCodeAPI()
  vscode.setState({})
}

/**
 * 显示 VSCode 通知
 *
 * @param message 通知消息
 * @param type 通知类型：'info' | 'warning' | 'error'
 */
export async function showNotification(
  message: string,
  type: 'info' | 'warning' | 'error' = 'info'
): Promise<void> {
  try {
    // 声音提醒（失败不影响通知本身）
    if (type === 'warning') {
      void handleSoundEvent({
        cue: 'warning',
        source: 'notification',
        createdAt: Date.now()
      })
    } else if (type === 'error') {
      void handleSoundEvent({
        cue: 'error',
        source: 'notification',
        createdAt: Date.now()
      })
    }

    await sendToExtension('showNotification', { message, type })
  } catch (err) {
    console.error('Failed to show notification:', err)
  }
}

/**
 * 加载 diff 内容（用于 apply_diff 工具的按需加载）
 *
 * @param diffContentId Diff 内容 ID
 * @returns Diff 内容或 null
 */
export async function loadDiffContent(diffContentId: string): Promise<{
  originalContent: string
  newContent: string
  filePath: string
} | null> {
  try {
    const result = await sendToExtension<{
      success: boolean
      originalContent?: string
      newContent?: string
      filePath?: string
      error?: string
    }>('diff.loadContent', { diffContentId })
    
    if (result.success && result.originalContent && result.newContent) {
      return {
        originalContent: result.originalContent,
        newContent: result.newContent,
        filePath: result.filePath || ''
      }
    }
    return null
  } catch (err) {
    console.error('Failed to load diff content:', err)
    return null
  }
}

export async function loadRuntimeLedgerTerminalContentWindow(refId: string, options: {
  startBytes?: number
  maxBytes?: number
  includePayload?: boolean
} = {}): Promise<{
  ref: {
    refId: string
    kind: 'content' | 'toolResult' | 'pendingToolCalls' | 'toolArgs' | 'toolStatusResult' | 'liveDeltaContentSnapshot'
    byteLength: number
    previewBytes: number
    truncated: boolean
    createdAt: number
  }
  payload?: unknown
  serializedWindow?: string
  window: {
    startBytes: number
    endBytes: number
    totalBytes: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
  }
} | null> {
  if (!refId.trim()) return null

  try {
    return await sendToExtension('runtimeLedger.getTerminalContentWindow', {
      refId,
      ...options
    })
  } catch (err) {
    console.error('Failed to load Runtime Ledger terminal content window:', err)
    return null
  }
}

export async function loadTerminalOutputWindow(refId: string, options: {
  startBytes?: number
  maxBytes?: number
  includePayload?: boolean
} = {}): Promise<{
  ref: {
    refId: string
    terminalId: string
    byteLength: number
    previewBytes: number
    truncated: boolean
    createdAt: number
  }
  data?: string
  window: {
    startBytes: number
    endBytes: number
    totalBytes: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
  }
} | null> {
  if (!refId.trim()) return null

  try {
    return await sendToExtension('terminal.getOutputWindow', {
      refId,
      ...options
    })
  } catch (err) {
    console.error('Failed to load terminal output window:', err)
    return null
  }
}

export async function loadSubAgentMonitorContentTextWindow(refId: string, options: {
  startBytes?: number
  maxBytes?: number
  includePayload?: boolean
} = {}): Promise<{
  ref: {
    refId: string
    runId: string
    contentIndex: number
    partIndex: number
    byteLength: number
    previewBytes: number
    truncated: boolean
  }
  text?: string
  window: {
    startBytes: number
    endBytes: number
    totalBytes: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
  }
} | null> {
  if (!refId.trim()) return null

  try {
    return await sendToExtension('subagents.monitor.getContentTextWindow', {
      refId,
      ...options
    })
  } catch (err) {
    console.error('Failed to load SubAgent Monitor content text window:', err)
    return null
  }
}
