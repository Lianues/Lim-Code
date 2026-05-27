/**
 * 流式处理辅助函数
 * 
 * @module streamHelpers
 * 包含消息操作、工具调用解析等辅助函数
 */

import type { Message } from '../../types'
import type { ChatStoreState } from './types'
import { generateId } from '../../utils/format'
import { isPerfEnabled } from '../../utils/perf'


const todoDebugPrinted = new Set<string>()
function debugTodoOnce(key: string, data: Record<string, unknown>) {
  if (!isPerfEnabled()) return
  if (todoDebugPrinted.has(key)) return
  todoDebugPrinted.add(key)
  console.debug('[todo-debug][streamHelpers]', data)
}

function isTodoToolName(name: unknown): boolean {
  return name === 'todo_write' || name === 'todo_update' || name === 'create_plan'
}

/**
 * 添加 functionCall 到消息
 */
export function addFunctionCallToMessage(
  message: Message,
  call: { 
    id: string; 
    name: string; 
    args: Record<string, unknown>; 
    partialArgs?: string; 
    index?: number;
    itemId?: string
  }
): void {
  // 更新 tools 数组
  if (!message.tools) {
    message.tools = []
  }
  message.tools.push({
    id: call.id,
    name: call.name,
    args: call.args,
    // 为什么同步 itemId/index：message.tools 是 ToolMessage 的主要数据源，必须和 parts 使用同一套流式合并键。
    // 怎么改：把 provider 的内部定位字段只保留在前端投影里，不参与工具结果回传。
    // 目的：contentSnapshot 覆盖时可以识别并替换 0 参数占位工具，而不是把它追加成第二张卡。
    itemId: call.itemId,
    index: call.index,
    // 传递 partialArgs 以便 ToolMessage 组件显示流式预览
    partialArgs: call.partialArgs,
    // 刚从流式内容里解析/拼接出来的工具调用，视为“AI 还在输出/完善工具内容”
    // 有 partialArgs 说明参数仍在流式累积中；无 partialArgs 说明已拿到完整参数
    status: typeof call.partialArgs === 'string' ? 'streaming' : 'queued'
  })
  
  // 更新 parts（用于渲染）
  if (!message.parts) {
    message.parts = []
  }
  message.parts.push({
    functionCall: {
      id: call.id,
      name: call.name,
      args: call.args,
      partialArgs: call.partialArgs,
      index: call.index,
      // 为什么同步 itemId：parts 与 tools 都可能参与渲染和快照重建，两个投影必须共享同一内部合并键。
      // 怎么改：只在前端流式 part 上保存 itemId，后端最终历史会清理该字段。
      // 目的：让最后到达的完整参数事件能覆盖初始占位 part，而不是生成“参数 0”的假工具。
      itemId: call.itemId
    }
  })
}

/**
 * 添加文本到消息（合并连续的文本 part）
 */
export function addTextToMessage(message: Message, text: string, isThought: boolean = false): void {
  // 普通文本才累加到 content
  if (!isThought) {
    message.content += text
  }
  
  if (!message.parts) {
    message.parts = []
  }
  
  const lastPart = message.parts[message.parts.length - 1]
  // 只有相同类型（都是思考或都不是思考）才合并
  const lastIsThought = lastPart?.thought === true
  if (lastPart && lastPart.text !== undefined && !lastPart.functionCall && lastIsThought === isThought) {
    lastPart.text += text
  } else {
    message.parts.push(isThought ? { text, thought: true } : { text })
  }
}

/**
 * 处理流式文本
 *
 * Prompt 模式工具调用现在以后端解析结果为准。
 * 前端这里只负责把可见文本追加到消息中。
 */
export function processStreamingText(
  message: Message,
  text: string,
  _state: ChatStoreState
): void {
  addTextToMessage(message, text)
}

/**
 * 兼容旧调用链。
 * Prompt 模式工具缓冲现在位于后端，此处不再需要额外处理。
 */
export function flushToolCallBuffer(_message: Message, _state: ChatStoreState): void {
}

/**
 * 处理工具调用 part（原生 function call format）
 */

/**
 * partialArgs JSON.parse 节流控制
 * 
 * 问题：每个增量片段都对整个累积字符串做 JSON.parse，当参数很大时（如 write_file 写长代码），
 * 复杂度退化为 O(N²)，导致主线程卡死。
 * 
 * 策略：
 * - 跟踪上次成功/尝试 parse 时的字符串长度
 * - 每次增量后，只有当新增数据量超过阈值时才再次尝试 parse
 * - 阈值随字符串长度动态增长：短字符串频繁 parse（保证小参数的预览体验），
 *   长字符串大幅减少 parse 次数（避免 O(N²) 卡顿）
 */
const partialArgsParseState = new WeakMap<object, { lastParseLen: number }>()

function shouldAttemptParse(fcRef: object, currentLen: number): boolean {
  let state = partialArgsParseState.get(fcRef)
  if (!state) {
    state = { lastParseLen: 0 }
    partialArgsParseState.set(fcRef, state)
  }
  // 动态阈值：短字符串(<1KB) 每 200 字符 parse 一次；
  // 中等字符串(1-10KB) 每 1KB parse 一次；长字符串 每 4KB parse 一次
  const threshold = currentLen < 1024 ? 200 : currentLen < 10240 ? 1024 : 4096
  const delta = currentLen - state.lastParseLen
  if (delta < threshold) return false
  state.lastParseLen = currentLen
  return true
}

type StreamFunctionCall = {
  id?: string
  name?: string
  args?: Record<string, unknown>
  partialArgs?: string
  index?: number
  itemId?: string
  finalArgs?: boolean
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function hasNonEmptyArgs(args: unknown): args is Record<string, unknown> {
  return !!(args && typeof args === 'object' && Object.keys(args as Record<string, unknown>).length > 0)
}

function tryParseArgs(argsText: string | undefined): Record<string, unknown> | null {
  if (typeof argsText !== 'string' || !argsText.trim()) return null
  try {
    const parsed = JSON.parse(argsText)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function getFunctionCallMergeReason(
  incoming: StreamFunctionCall,
  existing: StreamFunctionCall,
  isLastFunctionCall: boolean
): 'sameItemId' | 'sameIndex' | 'sameId' | 'freshPlaceholder' | 'legacyPartial' | null {
  const incomingItemId = normalizeNonEmptyString(incoming.itemId)
  const existingItemId = normalizeNonEmptyString(existing.itemId)
  if (incomingItemId && existingItemId && incomingItemId === existingItemId) return 'sameItemId'

  // 为什么 index 要用 typeof number 判断：Responses 的 output_index 可以是 0，不能用 truthy 判断把 0 当成缺失。
  // 怎么改：只有双方都提供数字 index 时才按 index 合并，避免把无 index 的独立工具误并到一起。
  // 目的：修复用户看到的“最后一个工具参数 0”占位卡无法和后续真实参数合并的问题。
  if (typeof incoming.index === 'number' && typeof existing.index === 'number' && incoming.index === existing.index) {
    return 'sameIndex'
  }

  const incomingId = normalizeNonEmptyString(incoming.id)
  const existingId = normalizeNonEmptyString(existing.id)
  if (incomingId && existingId && incomingId === existingId) return 'sameId'

  const incomingHasPartial = typeof incoming.partialArgs === 'string'
  const incomingHasIdOrIndexOrItem = !!incomingId || typeof incoming.index === 'number' || !!incomingItemId
  const existingIsFreshPlaceholder =
    isLastFunctionCall &&
    !hasNonEmptyArgs(existing.args) &&
    (existing.partialArgs === undefined || existing.partialArgs === '')

  // 为什么保留 fresh placeholder 兜底：部分兼容网关会先给一个空 function_call，再给无 id/index 的参数增量。
  // 怎么改：只允许合并到最后一个仍为空的 functionCall，且只在 incoming 是参数片段时触发。
  // 目的：兼容旧流式格式，同时避免跨工具误合并。
  if (!incomingHasIdOrIndexOrItem && incomingHasPartial && existingIsFreshPlaceholder) return 'freshPlaceholder'

  // 为什么保留 legacyPartial：历史兼容渠道可能没有任何定位字段，只能把连续参数片段拼到最后一个工具上。
  // 怎么改：限制为最后一个 functionCall，并且 incoming 必须只有 partialArgs。
  // 目的：不破坏旧渠道，同时把特判收敛为“同一流式工具片段”的通用兜底。
  if (!incomingHasIdOrIndexOrItem && incomingHasPartial && isLastFunctionCall) return 'legacyPartial'

  return null
}

function findToolEntry(message: Message, fc: StreamFunctionCall, previousId?: string) {
  const tools = message.tools || []
  const ids = [previousId, fc.id].map(normalizeNonEmptyString).filter(Boolean)

  for (const id of ids) {
    const byId = tools.find(t => t.id === id)
    if (byId) return byId
  }

  const itemId = normalizeNonEmptyString(fc.itemId)
  if (itemId) {
    const byItemId = tools.find(t => normalizeNonEmptyString((t as any).itemId) === itemId)
    if (byItemId) return byItemId
  }

  if (typeof fc.index === 'number') {
    const byIndex = tools.find(t => typeof (t as any).index === 'number' && (t as any).index === fc.index)
    if (byIndex) return byIndex
  }

  return undefined
}

function syncToolEntryFromFunctionCall(message: Message, fc: StreamFunctionCall, previousId?: string): void {
  const toolEntry = findToolEntry(message, fc, previousId)
  if (!toolEntry) return

  const nextId = normalizeNonEmptyString(fc.id)
  if (nextId && toolEntry.id !== nextId) {
    toolEntry.id = nextId
  }
  if (fc.name) toolEntry.name = fc.name
  if (fc.itemId) toolEntry.itemId = fc.itemId
  if (typeof fc.index === 'number') toolEntry.index = fc.index

  if (hasNonEmptyArgs(fc.args)) {
    toolEntry.args = fc.args
  }

  if (typeof fc.partialArgs === 'string') {
    toolEntry.status = 'streaming'
    toolEntry.partialArgs = fc.partialArgs
  } else if (toolEntry.status === 'streaming' && hasNonEmptyArgs(fc.args)) {
    toolEntry.status = 'queued'
    delete toolEntry.partialArgs
  }
}

function mergeFunctionCall(target: StreamFunctionCall, incoming: StreamFunctionCall): string | undefined {
  const previousId = target.id

  if (incoming.name && !target.name) target.name = incoming.name
  if (incoming.id) target.id = incoming.id
  if (incoming.itemId && !target.itemId) target.itemId = incoming.itemId
  if (typeof incoming.index === 'number' && typeof target.index !== 'number') target.index = incoming.index

  if (typeof incoming.partialArgs === 'string') {
    // 为什么 finalArgs 要覆盖而不是追加：arguments.done/output_item.done 传的是完整 JSON，不是增量 delta。
    // 怎么改：finalArgs=true 时用完整 arguments 替换已累积片段，并绕过节流立即解析。
    // 目的：避免 {..}{..} 拼接导致解析失败，最终显示成“参数 0”的假工具。
    target.partialArgs = incoming.finalArgs === true
      ? incoming.partialArgs
      : (target.partialArgs || '') + incoming.partialArgs

    const parsed = incoming.finalArgs === true || shouldAttemptParse(target, target.partialArgs.length)
      ? tryParseArgs(target.partialArgs)
      : null

    if (parsed) {
      target.args = parsed
      if (incoming.finalArgs === true) {
        delete target.partialArgs
      }
    }
  } else if (hasNonEmptyArgs(incoming.args)) {
    target.args = { ...(target.args || {}), ...incoming.args }
    delete target.partialArgs
  }

  return previousId
}

function normalizeNewFunctionCall(incoming: StreamFunctionCall): { args: Record<string, unknown>; partialArgs?: string } {
  if (hasNonEmptyArgs(incoming.args)) {
    return { args: incoming.args }
  }

  const parsed = incoming.finalArgs === true ? tryParseArgs(incoming.partialArgs) : null
  if (parsed) {
    return { args: parsed }
  }

  return { args: {}, partialArgs: incoming.partialArgs }
}

export function handleFunctionCallPart(part: any, message: Message): void {
  const fc = part.functionCall as StreamFunctionCall
  const incomingHasPartial = typeof fc.partialArgs === 'string'
  const incomingHasArgs = hasNonEmptyArgs(fc.args)

  let matched: { fc: StreamFunctionCall; reason: string } | null = null
  let isLastFunctionCall = true

  // 为什么从后往前找，而不是只看最后一个 part：流式响应里可能穿插思考签名、文本或状态快照。
  // 怎么改：按 itemId、index、id、fresh placeholder 的统一优先级寻找同一逻辑工具调用。
  // 目的：让前端和后端 StreamAccumulator 使用同一套合并模型，避免 MCP 工具临时重复显示。
  for (let i = (message.parts?.length || 0) - 1; i >= 0; i--) {
    const existing = message.parts?.[i]?.functionCall as StreamFunctionCall | undefined
    if (!existing) continue

    const reason = getFunctionCallMergeReason(fc, existing, isLastFunctionCall)
    if (reason) {
      matched = { fc: existing, reason }
      break
    }

    isLastFunctionCall = false
  }

  if (matched) {
    if (isTodoToolName(fc.name) || isTodoToolName(matched.fc.name)) {
      debugTodoOnce(`merge-${message.id}-${matched.fc.id || 'no-last-id'}-${fc.id || 'no-id'}-${String(fc.name || matched.fc.name)}`, {
        messageId: message.id,
        action: 'merge_function_call_part',
        incomingName: fc.name || null,
        incomingId: normalizeNonEmptyString(fc.id) || null,
        incomingItemId: normalizeNonEmptyString(fc.itemId) || null,
        incomingIndex: fc.index ?? null,
        incomingHasPartial,
        incomingHasArgs,
        lastName: matched.fc.name || null,
        lastId: normalizeNonEmptyString(matched.fc.id) || null,
        lastItemId: normalizeNonEmptyString(matched.fc.itemId) || null,
        lastIndex: matched.fc.index ?? null,
        canMerge: true,
        canMergeReason: matched.reason
      })
    }

    const previousId = mergeFunctionCall(matched.fc, fc)
    syncToolEntryFromFunctionCall(message, matched.fc, previousId)
    return
  }

  if (isTodoToolName(fc.name)) {
    debugTodoOnce(`append-${message.id}-${fc.id || 'no-id'}-${String(fc.name)}`, {
      messageId: message.id,
      action: 'append_new_function_call_part',
      incomingName: fc.name,
      incomingId: typeof fc.id === 'string' ? fc.id : null,
      incomingItemId: typeof fc.itemId === 'string' ? fc.itemId : null,
      incomingIndex: fc.index ?? null,
      hasPartial: incomingHasPartial,
      hasArgs: incomingHasArgs
    })
  }

  const normalized = normalizeNewFunctionCall(fc)
  addFunctionCallToMessage(message, {
    id: fc.id || generateId(),
    name: fc.name || '',
    args: normalized.args,
    partialArgs: normalized.partialArgs,
    index: fc.index,
    itemId: fc.itemId
  })
}
