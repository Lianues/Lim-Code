import type { Content, ContentPart, Message, ToolUsage } from '../../types'
import { contentToMessageEnhanced } from '../../stores/chat/parsers'
import {
  applyRuntimeLedgerToolProjection,
  hasRuntimeLedgerToolProjection,
  type MonitorRuntimeLedgerProjectionState
} from './monitorRuntimeLedgerProjection'
import { estimateJsonBytes } from '../../utils/cacheLifecycleGovernor'

export interface MonitorRenderableMessageInput {
  runId: string
  content: Content
  contentIndex: number
  responseMap: Map<string, NonNullable<ContentPart['functionResponse']>>
  runtimeLedger?: MonitorRuntimeLedgerProjectionState
  isLiveTail: boolean
}

interface MonitorMessageProjectionCacheEntry {
  content: Content
  runtimeLedger?: MonitorRuntimeLedgerProjectionState
  isLiveTail: boolean
  responseRefs: Array<NonNullable<ContentPart['functionResponse']> | undefined>
  toolIds: string[]
  message: Message
}

function sameResponseRefs(
  left: Array<NonNullable<ContentPart['functionResponse']> | undefined>,
  right: Array<NonNullable<ContentPart['functionResponse']> | undefined>
): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function deriveToolStatus(result: unknown): ToolUsage['status'] {
  const r = result as any
  if (r?.success === false || r?.error || r?.cancelled || r?.rejected) return 'error'
  if (r?.data && r.data.appliedCount > 0 && r.data.failedCount > 0) return 'warning'
  return 'success'
}

export function getFunctionResponseMap(contents: Content[]): Map<string, NonNullable<ContentPart['functionResponse']>> {
  const map = new Map<string, NonNullable<ContentPart['functionResponse']>>()
  for (const content of contents) {
    const parts = content.parts || []
    for (const part of parts) {
      const response = part.functionResponse
      if (response?.id) {
        map.set(response.id, response)
      }
    }
  }
  return map
}

export class MonitorMessageProjectionCache {
  private readonly entries = new Map<string, MonitorMessageProjectionCacheEntry>()

  project(input: MonitorRenderableMessageInput): Message {
    const key = this.createKey(input.runId, input.contentIndex)
    const existing = this.entries.get(key)
    if (existing?.content === input.content) {
      const responseRefs = existing.toolIds.map(toolId => input.responseMap.get(toolId))
      if (
        existing.runtimeLedger === input.runtimeLedger &&
        existing.isLiveTail === input.isLiveTail &&
        sameResponseRefs(existing.responseRefs, responseRefs)
      ) {
        return existing.message
      }
    }

    const message = contentToMessageEnhanced(input.content, `${input.runId}_${input.contentIndex}`)
    message.backendIndex = input.contentIndex
    if (input.isLiveTail) {
      message.streaming = true
    }

    const toolIds = (message.tools || []).map(tool => tool.id)
    const responseRefs = toolIds.map(toolId => input.responseMap.get(toolId))
    if (message.tools && message.tools.length > 0) {
      message.tools = message.tools.map(tool => {
        const response = input.responseMap.get(tool.id)
        const hasLedgerProjection = hasRuntimeLedgerToolProjection(tool.id, input.runtimeLedger)
        const projectedTool = hasLedgerProjection
          ? applyRuntimeLedgerToolProjection(tool, input.runtimeLedger)
          : tool
        if (!response) return projectedTool
        const result = response.response as Record<string, unknown>
        const runtimeProjectedTool = hasLedgerProjection
          ? applyRuntimeLedgerToolProjection(projectedTool, input.runtimeLedger)
          : undefined
        return {
          ...projectedTool,
          result,
          status: runtimeProjectedTool?.status || deriveToolStatus(result)
        }
      })
    }

    this.entries.set(key, {
      content: input.content,
      runtimeLedger: input.runtimeLedger,
      isLiveTail: input.isLiveTail,
      responseRefs,
      toolIds,
      message
    })
    return message
  }

  pruneRun(runId: string, retainedContentIndexes: Set<number>): number {
    let removed = 0
    const prefix = `${runId}:`
    for (const key of Array.from(this.entries.keys())) {
      if (!key.startsWith(prefix)) continue
      const index = Number(key.slice(prefix.length))
      if (!retainedContentIndexes.has(index)) {
        this.entries.delete(key)
        removed += 1
      }
    }
    return removed
  }

  pruneToMaxEntries(maxEntries: number): number {
    if (!Number.isFinite(maxEntries) || maxEntries < 0) return 0

    let removed = 0
    while (this.entries.size > maxEntries) {
      const next = this.entries.keys().next()
      if (next.done) break
      this.entries.delete(next.value)
      removed += 1
    }
    return removed
  }

  estimateBytes(): number {
    let total = 0
    for (const [key, entry] of this.entries) {
      total += estimateJsonBytes(key)
      total += estimateJsonBytes(entry.message)
    }
    return total
  }

  size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  private createKey(runId: string, contentIndex: number): string {
    return `${runId}:${contentIndex}`
  }
}
