import type { Content, ContentPart, ToolUsage } from '../../types'
import {
  type StreamFunctionCall,
  hasNonEmptyArgs,
  getFunctionCallMergeReason,
  mergeFunctionCall as unifiedMergeFunctionCall
} from '../../utils/functionCallMerge'

export type MonitorRuntimeToolState = 'queued' | 'executing' | 'success' | 'error' | 'cancelled'
export const DEFAULT_RUNTIME_LEDGER_LIVE_DELTA_BUFFER_LIMIT = 500

export interface MonitorRuntimeLedgerProjectionState {
  status?: 'ok' | 'degraded'
  mismatches?: string[]
  health?: {
    content?: 'ok' | 'recovering'
    replay?: 'ok' | 'truncated'
    projection?: 'ok' | 'diagnostic'
    renderable?: boolean
    contentReasons?: string[]
    diagnosticReasons?: string[]
  }
  ledger?: {
    toolStatesByInvocationId?: Record<string, MonitorRuntimeToolState>
    contentWindow?: MonitorRuntimeLedgerContentWindow
    liveDelta?: MonitorRuntimeLedgerLiveDelta
  }
}

export interface MonitorRuntimeLedgerContentWindow {
  runId: string
  contents: Content[]
  startIndex: number
  endIndex: number
  totalCount: number
    contentRevision?: number
    eventSequence?: number
    contentCoveredEventSequence?: number
    partialCoveredEventSequence?: number
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    source?: string
}

export interface MonitorRuntimeLedgerLiveDelta {
  runId: string
  type: 'llm_delta'
  timestamp?: number
  eventSequence?: number
  contentRevision?: number
  payload?: any
  source?: string
}

const TOOL_STATUS_BY_RUNTIME_STATE: Record<MonitorRuntimeToolState, ToolUsage['status']> = {
  queued: 'queued',
  executing: 'executing',
  success: 'success',
  error: 'error',
  cancelled: 'error'
}

function normalizeToolInvocationId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function runtimeToolCandidates(toolId: string): string[] {
  const normalized = normalizeToolInvocationId(toolId)
  if (!normalized) return []
  return [
    normalized,
    `tool:subagent:${normalized}`,
    `tool:chat:${normalized}`
  ]
}

export function getRuntimeLedgerToolState(
  toolId: string | undefined,
  runtimeLedger: MonitorRuntimeLedgerProjectionState | undefined
): MonitorRuntimeToolState | undefined {
  const states = runtimeLedger?.ledger?.toolStatesByInvocationId
  if (!states) return undefined

  for (const candidate of runtimeToolCandidates(toolId || '')) {
    const state = states[candidate]
    if (state) return state
  }

  return undefined
}

export function hasRuntimeLedgerToolProjection(
  toolId: string | undefined,
  runtimeLedger: MonitorRuntimeLedgerProjectionState | undefined
): boolean {
  return !!getRuntimeLedgerToolState(toolId, runtimeLedger)
}

export function applyRuntimeLedgerToolProjection(
  tool: ToolUsage,
  runtimeLedger: MonitorRuntimeLedgerProjectionState | undefined
): ToolUsage {
  const state = getRuntimeLedgerToolState(tool.id, runtimeLedger)
  if (!state) return tool

  return {
    ...tool,
    status: TOOL_STATUS_BY_RUNTIME_STATE[state] || tool.status
  }
}

export function describeRuntimeLedgerRecoveryState(
  runtimeLedger: MonitorRuntimeLedgerProjectionState | undefined,
  runId?: string
): string | undefined {
  if (runtimeLedger?.health?.renderable === true) return undefined
  if (runtimeLedger?.health?.content === 'recovering') return '正在重新同步 SubAgent 对话窗口…'
  if (runtimeLedger?.status !== 'degraded') return undefined
  if (getRuntimeLedgerContentWindow(runtimeLedger, runId)) return undefined
  const mismatches = Array.isArray(runtimeLedger.mismatches)
    ? runtimeLedger.mismatches.filter(item => typeof item === 'string' && item.trim())
    : []
  const needsContentWindow = mismatches.some(item =>
    item === 'source_window_missing'
    || item === 'source_snapshot_missing'
    || item === 'contentWindow:missing'
    || item.startsWith('contentWindow')
    || item.startsWith('contentCount')
    || item.startsWith('contentRevision')
  )
  return needsContentWindow
    ? '正在重新同步 SubAgent 对话窗口…'
    : undefined
}

export function getRuntimeLedgerContentWindow(
  runtimeLedger: MonitorRuntimeLedgerProjectionState | undefined,
  runId?: string
): MonitorRuntimeLedgerContentWindow | undefined {
  const contentWindow = runtimeLedger?.ledger?.contentWindow
  if (!contentWindow?.runId || !Array.isArray(contentWindow.contents)) return undefined
  if (runtimeLedger?.health?.renderable !== true) return undefined
  if (runId && contentWindow.runId !== runId) return undefined
  if (typeof contentWindow.startIndex !== 'number' || typeof contentWindow.endIndex !== 'number') return undefined
  if (typeof contentWindow.totalCount !== 'number') return undefined
  return contentWindow
}

export function getRuntimeLedgerLiveDelta(
  runtimeLedger: MonitorRuntimeLedgerProjectionState | undefined,
  runId?: string
): MonitorRuntimeLedgerLiveDelta | undefined {
  const liveDelta = runtimeLedger?.ledger?.liveDelta
  if (!liveDelta || liveDelta.type !== 'llm_delta') return undefined
  if (runId && liveDelta.runId !== runId) return undefined
  if (!liveDelta.payload || typeof liveDelta.payload !== 'object') return undefined
  return liveDelta
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function getRuntimeLedgerLiveDeltaSequence(event: MonitorRuntimeLedgerLiveDelta | undefined): number | undefined {
  return finiteNumber(event?.eventSequence ?? event?.payload?.eventSequence)
}

export function getRuntimeLedgerLiveDeltaRevision(event: MonitorRuntimeLedgerLiveDelta | undefined): number {
  return finiteNumber(event?.contentRevision ?? event?.payload?.contentRevision) ?? 0
}

export function hasRenderableRuntimeLedgerLiveDelta(event: MonitorRuntimeLedgerLiveDelta | undefined): boolean {
  return event?.type === 'llm_delta'
    && (Array.isArray(event.payload?.delta) || !!event.payload?.contentSnapshot)
}

export function enqueueRuntimeLedgerLiveDelta(
  current: MonitorRuntimeLedgerLiveDelta[] | undefined,
  event: MonitorRuntimeLedgerLiveDelta,
  limit = DEFAULT_RUNTIME_LEDGER_LIVE_DELTA_BUFFER_LIMIT
): MonitorRuntimeLedgerLiveDelta[] {
  if (!hasRenderableRuntimeLedgerLiveDelta(event)) return current ? [...current] : []
  const safeLimit = Math.max(1, Math.floor(limit))
  const sequence = getRuntimeLedgerLiveDeltaSequence(event)
  const withoutDuplicate = typeof sequence === 'number'
    ? (current || []).filter(item => getRuntimeLedgerLiveDeltaSequence(item) !== sequence)
    : [...(current || [])]

  const next = [...withoutDuplicate, event]
  next.sort((a, b) => {
    const aSeq = getRuntimeLedgerLiveDeltaSequence(a)
    const bSeq = getRuntimeLedgerLiveDeltaSequence(b)
    if (typeof aSeq === 'number' && typeof bSeq === 'number') return aSeq - bSeq
    if (typeof aSeq === 'number') return -1
    if (typeof bSeq === 'number') return 1
    return 0
  })

  return next.slice(Math.max(0, next.length - safeLimit))
}

export function selectReplayableRuntimeLedgerLiveDeltas(
  current: MonitorRuntimeLedgerLiveDelta[] | undefined,
  contentWindow: Pick<MonitorRuntimeLedgerContentWindow, 'contentRevision' | 'eventSequence'> | undefined
): { replayable: MonitorRuntimeLedgerLiveDelta[]; remaining: MonitorRuntimeLedgerLiveDelta[] } {
  const buffer = current || []
  if (!contentWindow) return { replayable: [], remaining: buffer }
  const windowRevision = finiteNumber(contentWindow.contentRevision) ?? 0
  const windowSequence = finiteNumber(contentWindow.eventSequence)
  const replayable: MonitorRuntimeLedgerLiveDelta[] = []
  const remaining: MonitorRuntimeLedgerLiveDelta[] = []

  for (const event of buffer) {
    const eventRevision = getRuntimeLedgerLiveDeltaRevision(event)
    const eventSequence = getRuntimeLedgerLiveDeltaSequence(event)
    if (typeof eventSequence === 'number' && typeof windowSequence === 'number' && eventSequence <= windowSequence) continue
    if (eventRevision < windowRevision) continue
    if (eventRevision > windowRevision) {
      remaining.push(event)
      continue
    }
    replayable.push(event)
  }

  return { replayable, remaining }
}

function cloneContent(content: Content): Content {
  return {
    ...content,
    parts: (content.parts || []).map(part => {
      const cloned: ContentPart = { ...part }
      if (part.functionCall) cloned.functionCall = { ...(part.functionCall as StreamFunctionCall) } as ContentPart['functionCall']
      if (part.functionResponse) cloned.functionResponse = { ...part.functionResponse }
      return cloned
    })
  }
}

function mergeFunctionCall(target: StreamFunctionCall, incoming: StreamFunctionCall): void {
  unifiedMergeFunctionCall(target, incoming)
}

function appendFunctionCallPart(parts: ContentPart[], incomingPart: ContentPart): void {
  const incoming = incomingPart.functionCall as StreamFunctionCall | undefined
  if (!incoming) return

  let isLastFunctionCall = true
  for (let i = parts.length - 1; i >= 0; i--) {
    const existing = parts[i].functionCall as StreamFunctionCall | undefined
    if (!existing) continue

    const reason = getFunctionCallMergeReason(incoming, existing, isLastFunctionCall)
    if (reason) {
      mergeFunctionCall(existing, incoming)
      return
    }

    isLastFunctionCall = false
  }

  const newFunctionCall: StreamFunctionCall = {
    ...(incoming as any),
    name: incoming.name || '',
    args: hasNonEmptyArgs(incoming.args) ? incoming.args : {}
  }
  mergeFunctionCall(newFunctionCall, incoming)
  parts.push({ functionCall: newFunctionCall as ContentPart['functionCall'] })
}

function appendContentPart(target: Content, part: ContentPart): void {
  if (part.text !== undefined) {
    const lastPart = target.parts[target.parts.length - 1]
    const isThought = part.thought === true
    const lastIsThought = lastPart?.thought === true
    if (lastPart && lastPart.text !== undefined && !lastPart.functionCall && lastIsThought === isThought) {
      lastPart.text += part.text
    } else {
      target.parts.push(isThought ? { text: part.text, thought: true } : { text: part.text })
    }
    return
  }

  if (part.functionCall) {
    appendFunctionCallPart(target.parts, part)
    return
  }

  target.parts.push({ ...part })
}

function ensureLastModelContent(contents: Content[], timestamp: number, baseIndex: number): Content {
  const last = contents[contents.length - 1]
  if (last?.role === 'model') return last

  const created = {
    role: 'model' as const,
    parts: [],
    timestamp,
    index: baseIndex + contents.length
  } as Content
  contents.push(created)
  return created
}

export function applyRuntimeLedgerLiveDeltaToContents(
  contents: Content[],
  payload: any,
  timestamp: number = Date.now(),
  baseIndex: number = 0
): Content[] {
  const source = contents || []
  const next = [...source]
  const snapshot = payload?.contentSnapshot as Content | undefined
  if (snapshot?.parts) {
    const replacement = cloneContent({
      ...snapshot,
      timestamp: snapshot.timestamp || timestamp,
      index: typeof snapshot.index === 'number' ? snapshot.index : baseIndex + Math.max(0, next.length - 1)
    } as Content)
    let lastModelIndex = -1
    for (let index = next.length - 1; index >= 0; index--) {
      if (next[index]?.role === 'model') {
        lastModelIndex = index
        break
      }
    }
    if (lastModelIndex >= 0) {
      next[lastModelIndex] = replacement
    } else {
      replacement.index = baseIndex + next.length
      next.push(replacement)
    }
    return next
  }

  const lastIndex = next.length - 1
  let modelContent: Content
  if (lastIndex >= 0 && next[lastIndex]?.role === 'model') {
    modelContent = cloneContent(next[lastIndex])
    next[lastIndex] = modelContent
  } else {
    modelContent = ensureLastModelContent(next, timestamp, baseIndex)
  }

  for (const part of payload?.delta || []) {
    appendContentPart(modelContent, part)
  }

  if (payload?.usage) modelContent.usageMetadata = payload.usage
  if (payload?.modelVersion) modelContent.modelVersion = payload.modelVersion
  if (payload?.thinkingStartTime) modelContent.thinkingStartTime = payload.thinkingStartTime

  return next
}
