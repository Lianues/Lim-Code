import { estimateJsonBytes } from './cacheLifecycleGovernor'
import type { Message } from '../types'

export interface RuntimePerfBudget {
  maxEnvelopeBytes: number
  maxRetainedCacheBytes: number
  maxDomItems: number
  maxVisibleMessages: number
  maxRefreshLatencyMs: number
}

export interface RuntimePerfSample {
  name: string
  envelopeBytes?: number
  retainedCacheBytes?: number
  domItems?: number
  visibleMessages?: number
  refreshLatencyMs?: number
}

export interface RuntimePerfBudgetEvaluation {
  ok: boolean
  violations: string[]
}

export const DEFAULT_RUNTIME_PERF_BUDGET: RuntimePerfBudget = {
  maxEnvelopeBytes: 16 * 1024,
  maxRetainedCacheBytes: 2 * 1024 * 1024,
  maxDomItems: 240,
  maxVisibleMessages: 140,
  maxRefreshLatencyMs: 250
}

export function evaluateRuntimePerfSample(
  sample: RuntimePerfSample,
  budget: RuntimePerfBudget = DEFAULT_RUNTIME_PERF_BUDGET
): RuntimePerfBudgetEvaluation {
  const violations: string[] = []
  if (typeof sample.envelopeBytes === 'number' && sample.envelopeBytes > budget.maxEnvelopeBytes) {
    violations.push(`${sample.name}: envelopeBytes ${sample.envelopeBytes} > ${budget.maxEnvelopeBytes}`)
  }
  if (typeof sample.retainedCacheBytes === 'number' && sample.retainedCacheBytes > budget.maxRetainedCacheBytes) {
    violations.push(`${sample.name}: retainedCacheBytes ${sample.retainedCacheBytes} > ${budget.maxRetainedCacheBytes}`)
  }
  if (typeof sample.domItems === 'number' && sample.domItems > budget.maxDomItems) {
    violations.push(`${sample.name}: domItems ${sample.domItems} > ${budget.maxDomItems}`)
  }
  if (typeof sample.visibleMessages === 'number' && sample.visibleMessages > budget.maxVisibleMessages) {
    violations.push(`${sample.name}: visibleMessages ${sample.visibleMessages} > ${budget.maxVisibleMessages}`)
  }
  if (typeof sample.refreshLatencyMs === 'number' && sample.refreshLatencyMs > budget.maxRefreshLatencyMs) {
    violations.push(`${sample.name}: refreshLatencyMs ${sample.refreshLatencyMs} > ${budget.maxRefreshLatencyMs}`)
  }

  return {
    ok: violations.length === 0,
    violations
  }
}

export function estimateMessageWindowDomItems(messages: Message[]): number {
  return messages.reduce((total, message) => {
    const toolCount = Array.isArray(message.tools) ? message.tools.length : 0
    const partCount = Array.isArray(message.parts) ? message.parts.length : 0
    return total + 1 + toolCount + Math.min(partCount, 8)
  }, 0)
}

export function createPayloadPerfSample(name: string, envelope: unknown): RuntimePerfSample {
  return {
    name,
    envelopeBytes: estimateJsonBytes(envelope)
  }
}

export function createRenderWindowPerfSample(name: string, messages: Message[]): RuntimePerfSample {
  return {
    name,
    visibleMessages: messages.length,
    domItems: estimateMessageWindowDomItems(messages)
  }
}
