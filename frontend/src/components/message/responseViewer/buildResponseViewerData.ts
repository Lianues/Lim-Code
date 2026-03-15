import type {
  Attachment,
  ContentPart,
  Message,
  MessageMetadata,
  ToolUsage,
  UsageMetadata
} from '../../../types'

export type ResponseViewerMode = 'common' | 'advanced'
export type ResponseViewerPartType =
  | 'text'
  | 'thought'
  | 'functionCall'
  | 'functionResponse'
  | 'inlineData'
  | 'fileData'
  | 'unknown'

export type ResponseViewerToolResultSource = 'tool' | 'partFunctionResponse' | 'hiddenFunctionResponse'

export interface BuildResponseViewerDataOptions {
  allMessages?: Message[]
}

export interface ResponseViewerResolvedFunctionResponse {
  name: string
  id?: string
  response: Record<string, unknown>
  preview: string
  source: Exclude<ResponseViewerToolResultSource, 'tool'>
  sourceMessageId?: string
  sourceBackendIndex?: number
  hasLargeResponse: boolean
}

export interface ResponseViewerToolPreview {
  id: string
  name: string
  status?: ToolUsage['status']
  args: Record<string, unknown>
  argsSummary: string
  partialArgs?: string
  result?: unknown
  resultSummary?: string
  resultSource?: ResponseViewerToolResultSource
  sourceMessageId?: string
  sourceBackendIndex?: number
  error?: string
  duration?: number
  hasLargeArgs: boolean
  hasLargeResult: boolean
}

export interface ResponseViewerAttachmentPreview {
  id: string
  name: string
  type: string
  size: number
  mimeType: string
  url?: string
  hasData: boolean
  dataSize: number
  hasThumbnail: boolean
  thumbnailSize: number
  metadata?: Record<string, unknown>
  metadataSummary?: string
  hasLargeMetadata: boolean
}

export interface ResponseViewerPartPreview {
  index: number
  type: ResponseViewerPartType
  title?: string
  preview?: string
  text?: string
  functionCall?: ContentPart['functionCall']
  functionResponse?: ContentPart['functionResponse']
  responseSummary?: string
  hasLargeResponse?: boolean
  pairedFunctionResponse?: ResponseViewerResolvedFunctionResponse
  inlineData?: {
    mimeType: string
    dataSize: number
  }
  fileData?: {
    mimeType: string
    fileUri: string
    displayName?: string
  }
  raw: unknown
}

export interface ResponseViewerData {
  basic: {
    id: string
    role: Message['role']
    timestamp?: number
    backendIndex?: number
    modelVersion?: string
    isFunctionResponse?: boolean
    isSummary?: boolean
  }
  common: {
    answerText: string
    thoughtText: string
    tools: ResponseViewerToolPreview[]
    usage?: UsageMetadata
    timing: {
      thinkingDuration?: number
      responseDuration?: number
      streamDuration?: number
      chunkCount?: number
      tokenRate?: number
    }
  }
  advanced: {
    content: string
    answerText: string
    thoughtText: string
    parts: ResponseViewerPartPreview[]
    tools: ResponseViewerToolPreview[]
    metadata?: MessageMetadata
    attachments: ResponseViewerAttachmentPreview[]
  }
  rawJson: unknown
}

interface FunctionResponseMatch {
  response: NonNullable<ContentPart['functionResponse']>
  source: Exclude<ResponseViewerToolResultSource, 'tool'>
  sourceMessageId?: string
  sourceBackendIndex?: number
}

const TOOL_CALL_START = '<<<TOOL_CALL>>>'
const TOOL_CALL_END = '<<<END_TOOL_CALL>>>'
const XML_TOOL_START = '<tool_use>'
const XML_TOOL_END = '</tool_use>'
const MAX_PREVIEW_LENGTH = 220
const MAX_SAFE_STRING = 12_000
const MAX_SAFE_DEPTH = 6
const LARGE_VALUE_LENGTH = 2_400
const LARGE_LINE_COUNT = 24

export function buildResponseViewerData(
  message: Message,
  options: BuildResponseViewerDataOptions = {}
): ResponseViewerData {
  const metadata = message.metadata
  const modelVersion = metadata?.modelVersion || metadata?.model
  const usage = getUsageMetadata(metadata)
  const answerText = extractAnswerText(message)
  const thoughtText = extractThoughtText(message.parts)
  const partResponseMatches = collectPartFunctionResponseMatches(message.parts)
  const hiddenResponseMatches = collectHiddenFunctionResponseMatches(options.allMessages, message.id)
  const responseMatches = mergeFunctionResponseMatches(hiddenResponseMatches, partResponseMatches)
  const tools = buildToolPreviews(message.tools, message.parts, responseMatches)
  const attachments = buildAttachmentPreviews(message.attachments)
  const parts = buildPartPreviews(message.parts, responseMatches)

  return {
    basic: {
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      backendIndex: message.backendIndex,
      modelVersion,
      isFunctionResponse: message.isFunctionResponse,
      isSummary: message.isSummary
    },
    common: {
      answerText,
      thoughtText,
      tools,
      usage,
      timing: {
        thinkingDuration: metadata?.thinkingDuration,
        responseDuration: metadata?.responseDuration,
        streamDuration: metadata?.streamDuration,
        chunkCount: metadata?.chunkCount,
        tokenRate: getTokenRate(metadata, usage)
      }
    },
    advanced: {
      content: message.content || '',
      answerText,
      thoughtText,
      parts,
      tools,
      metadata,
      attachments
    },
    rawJson: sanitizeForViewer({
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      backendIndex: message.backendIndex,
      modelVersion,
      content: message.content,
      parts: message.parts || [],
      tools: tools.map(tool => ({
        id: tool.id,
        name: tool.name,
        status: tool.status,
        args: tool.args,
        partialArgs: tool.partialArgs,
        result: tool.result,
        resultSource: tool.resultSource,
        sourceMessageId: tool.sourceMessageId,
        sourceBackendIndex: tool.sourceBackendIndex,
        error: tool.error,
        duration: tool.duration
      })),
      attachments: attachments.map(attachment => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        mimeType: attachment.mimeType,
        url: attachment.url,
        hasData: attachment.hasData,
        dataSize: attachment.dataSize,
        hasThumbnail: attachment.hasThumbnail,
        thumbnailSize: attachment.thumbnailSize,
        metadata: attachment.metadata
      })),
      metadata,
      isFunctionResponse: message.isFunctionResponse,
      isSummary: message.isSummary,
      summarizedMessageCount: message.summarizedMessageCount,
      isAutoSummary: message.isAutoSummary
    })
  }
}

function extractAnswerText(message: Message): string {
  const fromContent = filterToolCallMarkers(message.content || '').trim()
  if (fromContent) {
    return fromContent
  }

  const fromParts = (message.parts || [])
    .filter(part => part.text && !part.thought)
    .map(part => part.text || '')
    .join('')

  return filterToolCallMarkers(fromParts).trim()
}

function extractThoughtText(parts?: ContentPart[]): string {
  if (!parts || parts.length === 0) {
    return ''
  }

  return parts
    .filter(part => part.thought && typeof part.text === 'string')
    .map(part => part.text || '')
    .join('')
    .trim()
}

function buildToolPreviews(
  tools?: ToolUsage[],
  parts?: ContentPart[],
  responseMatches = new Map<string, FunctionResponseMatch>()
): ResponseViewerToolPreview[] {
  if (tools && tools.length > 0) {
    return tools.map(tool => {
      const resolvedMatch = tool.id ? responseMatches.get(tool.id) : undefined
      const resolvedResult = resolveToolResult(tool.result, resolvedMatch)
      const resolvedError = tool.error || extractErrorMessage(resolvedResult.result)
      const baseStatus = tool.status || (tool.awaitingConfirmation ? 'awaiting_approval' : undefined)
      const status = resolveToolStatus(baseStatus, resolvedResult.result, resolvedError)
      const displayedArgs = tool.partialArgs && status === 'streaming'
        ? tool.partialArgs
        : tool.args || {}
      const argsSummary = typeof displayedArgs === 'string'
        ? summarizeText(displayedArgs, MAX_PREVIEW_LENGTH)
        : summarizeValue(displayedArgs, MAX_PREVIEW_LENGTH)

      return {
        id: tool.id,
        name: tool.name,
        status,
        args: tool.args || {},
        argsSummary,
        partialArgs: tool.partialArgs,
        result: resolvedResult.result,
        resultSummary: summarizeResult(resolvedResult.result, resolvedError),
        resultSource: resolvedResult.resultSource,
        sourceMessageId: resolvedResult.sourceMessageId,
        sourceBackendIndex: resolvedResult.sourceBackendIndex,
        error: resolvedError,
        duration: tool.duration,
        hasLargeArgs: isLargeValue(displayedArgs),
        hasLargeResult: isLargeValue(resolvedError || resolvedResult.result)
      }
    })
  }

  return (parts || [])
    .filter(part => part.functionCall)
    .map((part, index) => {
      const functionCall = part.functionCall!
      const resolvedMatch = functionCall.id ? responseMatches.get(functionCall.id) : undefined
      const resolvedResult = resolveToolResult(undefined, resolvedMatch)
      const resolvedError = extractErrorMessage(resolvedResult.result)
      const status = functionCall.rejected
        ? 'warning'
        : resolveToolStatus(undefined, resolvedResult.result, resolvedError)
      const displayedArgs = functionCall.partialArgs || functionCall.args || {}
      const argsSummary = typeof displayedArgs === 'string'
        ? summarizeText(displayedArgs, MAX_PREVIEW_LENGTH)
        : summarizeValue(displayedArgs, MAX_PREVIEW_LENGTH)

      return {
        id: functionCall.id || `${functionCall.name}-${index}`,
        name: functionCall.name,
        status,
        args: functionCall.args || {},
        argsSummary,
        partialArgs: functionCall.partialArgs,
        result: resolvedResult.result,
        resultSummary: summarizeResult(resolvedResult.result, resolvedError),
        resultSource: resolvedResult.resultSource,
        sourceMessageId: resolvedResult.sourceMessageId,
        sourceBackendIndex: resolvedResult.sourceBackendIndex,
        error: resolvedError,
        duration: undefined,
        hasLargeArgs: isLargeValue(displayedArgs),
        hasLargeResult: isLargeValue(resolvedError || resolvedResult.result)
      }
    })
}

function buildAttachmentPreviews(attachments?: Attachment[]): ResponseViewerAttachmentPreview[] {
  return (attachments || []).map(attachment => ({
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    mimeType: attachment.mimeType,
    url: attachment.url,
    hasData: typeof attachment.data === 'string' && attachment.data.length > 0,
    dataSize: attachment.data?.length || 0,
    hasThumbnail: typeof attachment.thumbnail === 'string' && attachment.thumbnail.length > 0,
    thumbnailSize: attachment.thumbnail?.length || 0,
    metadata: attachment.metadata,
    metadataSummary: attachment.metadata ? summarizeValue(attachment.metadata, MAX_PREVIEW_LENGTH) : undefined,
    hasLargeMetadata: isLargeValue(attachment.metadata)
  }))
}

function buildPartPreviews(
  parts?: ContentPart[],
  responseMatches = new Map<string, FunctionResponseMatch>()
): ResponseViewerPartPreview[] {
  return (parts || []).map((part, index) => {
    if (part.thought && part.text) {
      return {
        index,
        type: 'thought',
        preview: summarizeText(part.text, MAX_PREVIEW_LENGTH),
        text: part.text,
        raw: sanitizeForViewer(part)
      }
    }

    if (part.text) {
      return {
        index,
        type: 'text',
        preview: summarizeText(filterToolCallMarkers(part.text), MAX_PREVIEW_LENGTH),
        text: part.text,
        raw: sanitizeForViewer(part)
      }
    }

    if (part.functionCall) {
      const pairedFunctionResponse = part.functionCall.id
        ? resolveFunctionResponsePreview(responseMatches.get(part.functionCall.id))
        : undefined

      return {
        index,
        type: 'functionCall',
        title: part.functionCall.name,
        preview: summarizeValue(part.functionCall.args || {}, MAX_PREVIEW_LENGTH),
        functionCall: part.functionCall,
        pairedFunctionResponse,
        raw: sanitizeForViewer(part)
      }
    }

    if (part.functionResponse) {
      const responseValue = part.functionResponse.response || {}
      return {
        index,
        type: 'functionResponse',
        title: part.functionResponse.name,
        preview: summarizeValue(responseValue, MAX_PREVIEW_LENGTH),
        functionResponse: part.functionResponse,
        responseSummary: summarizeValue(responseValue, MAX_PREVIEW_LENGTH),
        hasLargeResponse: isLargeValue(responseValue),
        raw: sanitizeForViewer(part)
      }
    }

    if (part.inlineData) {
      return {
        index,
        type: 'inlineData',
        title: part.inlineData.mimeType,
        preview: `${part.inlineData.mimeType} · ${part.inlineData.data?.length || 0}`,
        inlineData: {
          mimeType: part.inlineData.mimeType,
          dataSize: part.inlineData.data?.length || 0
        },
        raw: sanitizeForViewer(part)
      }
    }

    if (part.fileData) {
      return {
        index,
        type: 'fileData',
        title: part.fileData.displayName || part.fileData.fileUri,
        preview: `${part.fileData.mimeType} · ${part.fileData.fileUri}`,
        fileData: {
          mimeType: part.fileData.mimeType,
          fileUri: part.fileData.fileUri,
          displayName: part.fileData.displayName
        },
        raw: sanitizeForViewer(part)
      }
    }

    return {
      index,
      type: 'unknown',
      preview: summarizeValue(part, MAX_PREVIEW_LENGTH),
      raw: sanitizeForViewer(part)
    }
  })
}

function collectPartFunctionResponseMatches(parts?: ContentPart[]): Map<string, FunctionResponseMatch> {
  const matches = new Map<string, FunctionResponseMatch>()

  for (const part of parts || []) {
    const functionResponse = part.functionResponse
    if (!functionResponse?.id) {
      continue
    }

    matches.set(functionResponse.id, {
      response: functionResponse,
      source: 'partFunctionResponse'
    })
  }

  return matches
}

function collectHiddenFunctionResponseMatches(
  allMessages?: Message[],
  currentMessageId?: string
): Map<string, FunctionResponseMatch> {
  const matches = new Map<string, FunctionResponseMatch>()

  for (const message of allMessages || []) {
    if (!message.isFunctionResponse || !message.parts || message.id === currentMessageId) {
      continue
    }

    for (const part of message.parts) {
      const functionResponse = part.functionResponse
      if (!functionResponse?.id) {
        continue
      }

      matches.set(functionResponse.id, {
        response: functionResponse,
        source: 'hiddenFunctionResponse',
        sourceMessageId: message.id,
        sourceBackendIndex: message.backendIndex
      })
    }
  }

  return matches
}

function mergeFunctionResponseMatches(
  hiddenMatches: Map<string, FunctionResponseMatch>,
  currentMatches: Map<string, FunctionResponseMatch>
): Map<string, FunctionResponseMatch> {
  const merged = new Map(hiddenMatches)

  for (const [id, match] of currentMatches.entries()) {
    merged.set(id, match)
  }

  return merged
}

function resolveFunctionResponsePreview(
  match?: FunctionResponseMatch
): ResponseViewerResolvedFunctionResponse | undefined {
  if (!match) {
    return undefined
  }

  const responseValue = match.response.response || {}

  return {
    name: match.response.name,
    id: match.response.id,
    response: responseValue,
    preview: summarizeValue(responseValue, MAX_PREVIEW_LENGTH),
    source: match.source,
    sourceMessageId: match.sourceMessageId,
    sourceBackendIndex: match.sourceBackendIndex,
    hasLargeResponse: isLargeValue(responseValue)
  }
}

function resolveToolResult(
  result: unknown,
  match?: FunctionResponseMatch
): {
  result?: unknown
  resultSource?: ResponseViewerToolResultSource
  sourceMessageId?: string
  sourceBackendIndex?: number
} {
  if (result !== undefined) {
    return {
      result,
      resultSource: 'tool'
    }
  }

  if (!match) {
    return {}
  }

  return {
    result: match.response.response,
    resultSource: match.source,
    sourceMessageId: match.sourceMessageId,
    sourceBackendIndex: match.sourceBackendIndex
  }
}

function resolveToolStatus(
  status: ToolUsage['status'] | undefined,
  result: unknown,
  error?: string
): ToolUsage['status'] | undefined {
  const derivedStatus = deriveToolStatusFromResult(result, error)

  if (!status) {
    return derivedStatus
  }

  if (status === 'success' || status === 'error' || status === 'warning') {
    return status
  }

  return derivedStatus || status
}

function deriveToolStatusFromResult(
  result: unknown,
  error?: string
): ToolUsage['status'] | undefined {
  if (error) {
    return 'error'
  }

  if (result === undefined) {
    return undefined
  }

  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>

    if (record.requiresUserConfirmation === true) {
      return 'awaiting_apply'
    }

    if (record.cancelled === true || record.rejected === true) {
      return 'warning'
    }

    if (typeof record.error === 'string' && record.error.trim()) {
      return 'error'
    }
  }

  return 'success'
}

function getUsageMetadata(metadata?: MessageMetadata): UsageMetadata | undefined {
  if (metadata?.usageMetadata && hasUsageValues(metadata.usageMetadata)) {
    return metadata.usageMetadata
  }

  if (!metadata) {
    return undefined
  }

  const legacyUsage: UsageMetadata = {
    totalTokenCount: typeof metadata.tokens === 'number' ? metadata.tokens : undefined,
    candidatesTokenCount: typeof metadata.candidatesTokenCount === 'number' ? metadata.candidatesTokenCount : undefined,
    thoughtsTokenCount: typeof metadata.thoughtsTokenCount === 'number' ? metadata.thoughtsTokenCount : undefined
  }

  return hasUsageValues(legacyUsage) ? legacyUsage : undefined
}

function hasUsageValues(usage?: UsageMetadata): boolean {
  if (!usage) {
    return false
  }

  return [
    usage.promptTokenCount,
    usage.candidatesTokenCount,
    usage.totalTokenCount,
    usage.thoughtsTokenCount
  ].some(value => typeof value === 'number' && value > 0)
}

function getTokenRate(metadata?: MessageMetadata, usage?: UsageMetadata): number | undefined {
  if (!metadata || !usage) {
    return undefined
  }

  const streamDuration = metadata.streamDuration
  const chunkCount = metadata.chunkCount

  if (!streamDuration || streamDuration <= 0 || !chunkCount || chunkCount <= 1) {
    return undefined
  }

  const outputTokens = usage.candidatesTokenCount || 0
  const thoughtTokens = usage.thoughtsTokenCount || 0
  const totalTokens = thoughtTokens > 0 ? outputTokens + thoughtTokens : outputTokens

  if (totalTokens <= 0) {
    return undefined
  }

  return totalTokens / (streamDuration / 1000)
}

function summarizeResult(result: unknown, error?: string): string | undefined {
  if (error) {
    return summarizeText(error, MAX_PREVIEW_LENGTH)
  }

  if (result === undefined) {
    return undefined
  }

  return summarizeValue(result, MAX_PREVIEW_LENGTH)
}

function summarizeValue(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return summarizeText(value, maxLength)
  }

  try {
    const text = JSON.stringify(sanitizeForViewer(value), null, 2)
    return summarizeText(text || String(value), maxLength)
  } catch {
    return summarizeText(String(value), maxLength)
  }
}

function summarizeText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength)}...`
}

function extractErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined
  }

  const error = (result as Record<string, unknown>).error
  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return undefined
}

function filterToolCallMarkers(text: string): string {
  let result = text

  if (result.includes(TOOL_CALL_START)) {
    const jsonRegex = new RegExp(
      TOOL_CALL_START.replace(/[<>]/g, '\\$&') +
      '[\\s\\S]*?' +
      TOOL_CALL_END.replace(/[<>]/g, '\\$&'),
      'g'
    )
    result = result.replace(jsonRegex, '')

    const jsonStartIdx = result.indexOf(TOOL_CALL_START)
    if (jsonStartIdx !== -1) {
      result = result.substring(0, jsonStartIdx)
    }
  }

  if (result.includes(XML_TOOL_START)) {
    const xmlRegex = new RegExp(
      XML_TOOL_START.replace(/[<>]/g, '\\$&') +
      '[\\s\\S]*?' +
      XML_TOOL_END.replace(/[<>]/g, '\\$&'),
      'g'
    )
    result = result.replace(xmlRegex, '')

    const xmlStartIdx = result.indexOf(XML_TOOL_START)
    if (xmlStartIdx !== -1) {
      result = result.substring(0, xmlStartIdx)
    }
  }

  return result.trim()
}

function isLargeValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }

  if (typeof value === 'string') {
    return isLargeText(value)
  }

  try {
    return isLargeText(JSON.stringify(sanitizeForViewer(value), null, 2) || '')
  } catch {
    return isLargeText(String(value))
  }
}

function isLargeText(text: string): boolean {
  return text.length > LARGE_VALUE_LENGTH || text.split(/\r?\n/).length > LARGE_LINE_COUNT
}

function sanitizeForViewer(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  parentKey = ''
): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'string') {
    if (value.length > MAX_SAFE_STRING) {
      return `${value.slice(0, MAX_SAFE_STRING)}\n... (truncated, total=${value.length})`
    }
    return value
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (depth >= MAX_SAFE_DEPTH) {
    return '[MaxDepth]'
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)
    return value.map(item => sanitizeForViewer(item, depth + 1, seen, parentKey))
  }

  if (typeof value === 'object') {
    const target = value as Record<string, unknown>
    if (seen.has(target)) {
      return '[Circular]'
    }
    seen.add(target)

    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(target)) {
      if (parentKey === 'checkpoints' && (key === 'availableBefore' || key === 'editRestoreCandidates')) {
        continue
      }

      if (parentKey === 'debug' && key === 'renderBlocks') {
        continue
      }

      if (key === 'data' && typeof item === 'string') {
        result[key] = `[omitted, size=${item.length}]`
        continue
      }

      if (key === 'thumbnail' && typeof item === 'string') {
        result[key] = `[omitted, size=${item.length}]`
        continue
      }

      result[key] = sanitizeForViewer(item, depth + 1, seen, key)
    }

    return result
  }

  try {
    return String(value)
  } catch {
    return '[Unserializable]'
  }
}
