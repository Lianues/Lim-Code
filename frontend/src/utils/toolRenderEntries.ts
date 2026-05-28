import type { ContentPart, ToolUsage } from '../types'
// WP15: 统一 functionCall merge 纯函数入口。
// 为什么从独立模块导入：toolRenderEntries.ts 此前自己定义了 normalizeNonEmptyString 和 hasNonEmptyArgs。
// 怎么改：复用 utils/functionCallMerge.ts 中的统一版本。
// 目的：渲染层的合并键判断与流式合并层完全一致。
import {
  normalizeNonEmptyString,
  hasNonEmptyArgs
} from './functionCallMerge'

type FunctionCallLike = NonNullable<ContentPart['functionCall']>

// WP15: normalizeNonEmptyString、hasNonEmptyArgs 已收敛到 utils/functionCallMerge.ts。

function areArgsEquivalent(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
  } catch {
    return false
  }
}

function findMatchingToolForFunctionCall(
  functionCall: FunctionCallLike,
  messageTools: ToolUsage[],
  functionCallOrdinal: number
): ToolUsage | undefined {
  const id = normalizeNonEmptyString(functionCall.id)
  if (id) {
    const byId = messageTools.find(t => t.id === id)
    if (byId) return byId
  }

  const itemId = normalizeNonEmptyString((functionCall as any).itemId)
  if (itemId) {
    const byItemId = messageTools.find(t => normalizeNonEmptyString((t as any).itemId) === itemId)
    if (byItemId) return byItemId
  }

  if (typeof (functionCall as any).index === 'number') {
    const byIndex = messageTools.find(t => typeof (t as any).index === 'number' && (t as any).index === (functionCall as any).index)
    if (byIndex) return byIndex
  }

  // 为什么 id 匹配失败后还要回退到序位：Responses/MCP 流式过程中，旧占位 part 可能已经带有临时 id，
  // 但 message.tools 已经被后续快照合并成最终 call_id；如果此时只看 id，渲染层会把临时占位和最终工具渲染成两张卡。
  // 怎么改：在 id、itemId、index 都无法命中时，按 functionCall 的出现序位回退到 message.tools 中同序位工具。
  // 目的：让 pending/awaiting 阶段的渲染使用与流式合并层一致的“同一逻辑工具”判断，消除最后一个工具重复显示。
  if (functionCallOrdinal < messageTools.length) {
    return messageTools[functionCallOrdinal]
  }

  const lastTool = messageTools[messageTools.length - 1]
  if (lastTool && lastTool.name === functionCall.name) {
    const incomingArgs = functionCall.args || {}
    // 为什么要给“超过 tools 长度的最后工具 part”兜底：真实 pending/execute 流里可能先出现最终 call_id，
    // 又迟到一个带临时 id 的同名占位 part；此时序位已经超过 message.tools 长度，旧逻辑会把它当新工具渲染。
    // 怎么改：仅当它看起来是最后一个工具的空占位，或参数与最后工具等价时，回收为最后一个 ToolUsage。
    // 目的：不吞掉真实的新工具，同时修复用户看到的“最后一个工具块重复显示”。
    if (!hasNonEmptyArgs(incomingArgs) || areArgsEquivalent(incomingArgs, lastTool.args)) {
      return lastTool
    }
  }

  return undefined
}

export function buildFunctionCallToolRenderEntry(options: {
  messageId: string
  functionCall: FunctionCallLike
  messageTools: ToolUsage[]
  functionCallOrdinal: number
}): ToolUsage {
  const { messageId, functionCall, messageTools, functionCallOrdinal } = options
  const existingTool = findMatchingToolForFunctionCall(functionCall, messageTools, functionCallOrdinal)
  const toolIdFromPart = normalizeNonEmptyString(functionCall.id)
  const stableToolId = existingTool?.id || toolIdFromPart || `${messageId}:tool:${functionCallOrdinal}`

  return {
    id: stableToolId,
    name: functionCall.name,
    args: functionCall.args,
    partialArgs: functionCall.partialArgs,
    status: existingTool?.status,
    result: existingTool?.result,
    error: existingTool?.error,
    duration: existingTool?.duration,
    itemId: existingTool?.itemId ?? (functionCall as any).itemId,
    index: typeof existingTool?.index === 'number' ? existingTool.index : (functionCall as any).index
  }
}

export function upsertToolRenderEntry(target: ToolUsage[], entry: ToolUsage): void {
  const existingIndex = target.findIndex(t => t.id === entry.id)
  if (existingIndex === -1) {
    target.push(entry)
    return
  }

  const previous = target[existingIndex]
  const previousHasArgs = hasNonEmptyArgs(previous.args)
  const entryHasArgs = hasNonEmptyArgs(entry.args)
  // 为什么重复 id 时替换而不是追加：同一逻辑工具可能先以占位 part 出现，再以完整参数 part 出现；追加会产生重复工具卡。
  // 怎么改：保留已有运行态字段，同时用后到达的 name/args/partialArgs 覆盖展示内容；但迟到空占位不能覆盖已解析好的参数。
  // 目的：pending 阶段只显示一张最新、最完整的工具卡，并保留执行状态和结果。
  target[existingIndex] = {
    ...previous,
    ...entry,
    args: entryHasArgs || !previousHasArgs ? entry.args : previous.args,
    partialArgs: entryHasArgs ? undefined : (entry.partialArgs ?? previous.partialArgs),
    status: entry.status ?? previous.status,
    result: entry.result ?? previous.result,
    error: entry.error ?? previous.error,
    duration: entry.duration ?? previous.duration
  }
}
