/**
 * WP15: functionCall 合并逻辑统一预备
 *
 * 为什么需要这个文件：Main Chat (streamHelpers.ts) 和 SubAgent Monitor Runtime Ledger projection
 * 各自维护了几乎相同的 functionCall merge 纯函数，包括 normalizeNonEmptyString、
 * hasNonEmptyArgs、tryParseArgs、getMergeReason/mergeFunctionCall 等。
 * parsers.ts 和 toolRenderEntries.ts 也各自重复定义了 normalizeNonEmptyString、hasNonEmptyArgs。
 *
 * 怎么改：把四份重复的纯函数收敛到这个单一模块，Main Chat 和 SubAgent Monitor 都从
 * 这里导入。merge 语义保持一致（itemId > index > id > fresh placeholder > legacy partial）。
 *
 * 目的：后续 WP20 AgentRunEvent 统一 reducer 可以直接依赖这个模块，避免两套合并逻辑
 * 继续分叉。当前阶段只做纯函数收敛，不改任何调用方的行为。
 *
 * 禁止：不修改 stream 协议、不修改 provider 热路径、不修改 UI/UX。
 */

export type StreamFunctionCall = {
  id?: string
  name?: string
  args?: Record<string, unknown>
  partialArgs?: string
  index?: number
  itemId?: string
  finalArgs?: boolean
}

export type FunctionCallMergeReason =
  | 'sameItemId'
  | 'sameIndex'
  | 'sameId'
  | 'freshPlaceholder'
  | 'legacyPartial'

/**
 * 将 unknown 值规范化为非空字符串，否则返回 ''。
 * 为什么需要这个函数：流式事件中 itemId/id/index 可能以多种类型传入（undefined、空字符串、数字），
 * 需要统一判空后才能作为合并键使用。
 */
export function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/**
 * 判断 args 是否为非空对象。
 * 为什么用 Object.keys 而不是 truthy：OpenAI/Anthropic 创建占位 functionCall 时会写入 args: {}，
 * 需要区分"空占位"和"已解析出真实参数"。
 */
export function hasNonEmptyArgs(args: unknown): args is Record<string, unknown> {
  return !!(args && typeof args === 'object' && Object.keys(args as Record<string, unknown>).length > 0)
}

/**
 * 安全解析 partialArgs JSON 字符串。
 * 返回解析后的对象，或 null（未完成/格式错误）。
 */
export function tryParseArgs(argsText: string | undefined): Record<string, unknown> | null {
  if (typeof argsText !== 'string' || !argsText.trim()) return null
  try {
    const parsed = JSON.parse(argsText)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * 合并 functionCall 的身份字段（name/id/itemId/index）。
 *
 * 为什么需要独立导出：parsers.ts 的 mergeFunctionCallSnapshot（快照去重路径）与
 * mergeFunctionCall（流式增量路径）需要相同的身份字段合并规则，但 args/partialArgs
 * 处理策略不同（快照用"替换"和"更长片段胜出"，流式用"spread 合并"和"追加拼接"）。
 *
 * 怎么改：把 4 行身份字段填充逻辑抽成独立函数，两路径共享。
 *
 * 目的：进入 G1 前消除 parsers.ts 与 functionCallMerge.ts 的身份合并重复，
 * 同时保留快照与增量在 args/partialArgs 策略上的语义差异。
 */
export function mergeFunctionCallIdentity(target: StreamFunctionCall, incoming: StreamFunctionCall): void {
  if (incoming.name && !target.name) target.name = incoming.name
  if (incoming.id) target.id = incoming.id
  if (incoming.itemId && !target.itemId) target.itemId = incoming.itemId
  if (typeof incoming.index === 'number' && typeof target.index !== 'number') target.index = incoming.index
}

/**
 * 判断 incoming functionCall 是否可以合并到 existing functionCall。
 *
 * 合并优先级：
 * 1. sameItemId — OpenAI Responses item_id 匹配
 * 2. sameIndex — output_index 匹配（注意 index=0 是合法值）
 * 3. sameId — Anthropic/通用 call_id 匹配
 * 4. freshPlaceholder — 最后一个工具仍是空占位，且 incoming 是无定位字段的参数片段
 * 5. legacyPartial — 旧兼容渠道，连续参数片段合并到最后一个工具
 *
 * @param isLastFunctionCall 当遍历 parts 时，existing 是否为"最后一个 functionCall"
 */
export function getFunctionCallMergeReason(
  incoming: StreamFunctionCall,
  existing: StreamFunctionCall,
  isLastFunctionCall: boolean
): FunctionCallMergeReason | null {
  const incomingItemId = normalizeNonEmptyString(incoming.itemId)
  const existingItemId = normalizeNonEmptyString(existing.itemId)
  if (incomingItemId && existingItemId && incomingItemId === existingItemId) return 'sameItemId'

  // 为什么 index 要用 typeof number 判断：Responses 的 output_index 可以是 0，不能用 truthy 判断把 0 当成缺失。
  // 怎么改：只有双方都提供数字 index 时才按 index 合并。
  // 目的：修复用户看到的"最后一个工具参数 0"占位卡无法和后续真实参数合并的问题。
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
  // 目的：不破坏旧渠道，同时把特判收敛为"同一流式工具片段"的通用兜底。
  if (!incomingHasIdOrIndexOrItem && incomingHasPartial && isLastFunctionCall) return 'legacyPartial'

  return null
}

export interface FunctionCallMergeOptions {
  /**
   * 是否尝试在每次 partialArgs 累积后解析 JSON。
   * 默认：只在 finalArgs=true 时解析（适合 Monitor Runtime Ledger live delta）。
   * Main Chat 流式路径应传入自定义回调以使用节流控制（shouldAttemptParse）。
   */
  shouldParseArgs?: (incoming: StreamFunctionCall, combinedPartialArgs: string) => boolean
}

/**
 * 将 incoming functionCall 合并到 target。
 *
 * 合并规则：
 * - 身份字段（name/id/itemId/index）：只在 target 缺失时填充
 * - partialArgs：finalArgs=true 时覆盖，否则追加
 * - args：从解析后的 partialArgs 或 incoming.args 获取
 *
 * @returns 合并前的 target.id（用于同步 message.tools 中的旧 id）
 */
export function mergeFunctionCall(
  target: StreamFunctionCall,
  incoming: StreamFunctionCall,
  options?: FunctionCallMergeOptions
): string | undefined {
  const previousId = target.id

  // WP15 条件 1：身份字段合并委托给独立函数 mergeFunctionCallIdentity，
  // 这样 parsers.ts 的 mergeFunctionCallSnapshot 可以共享，避免 4 行重复。
  mergeFunctionCallIdentity(target, incoming)

  if (typeof incoming.partialArgs === 'string') {
    // 为什么 finalArgs 要覆盖而不是追加：arguments.done/output_item.done 传的是完整 JSON，不是增量 delta。
    // 怎么改：finalArgs=true 时用完整 arguments 替换已累积片段。
    // 目的：避免 {..}{..} 拼接导致解析失败，最终显示成"参数 0"的假工具。
    target.partialArgs = incoming.finalArgs === true
      ? incoming.partialArgs
      : (target.partialArgs || '') + incoming.partialArgs

    const shouldParse = options?.shouldParseArgs
      ? options.shouldParseArgs(incoming, target.partialArgs)
      : incoming.finalArgs === true

    if (shouldParse) {
      const parsed = tryParseArgs(target.partialArgs)
      if (parsed) {
        target.args = parsed
        if (incoming.finalArgs === true) {
          delete target.partialArgs
        }
      }
    }
    return previousId
  }

  if (hasNonEmptyArgs(incoming.args)) {
    // 为什么使用 spread 合并而不是直接替换：流式过程中可能先通过 partialArgs 解析出部分 args，
    // 后续再收到带补充字段的 args 对象；直接替换会丢失先前的键。
    // 怎么改：用 { ...(target.args || {}), ...incoming.args } 保留已有键。
    // 目的：所有调用方（Main Chat、Monitor）共享同一合并语义。
    target.args = { ...(target.args || {}), ...incoming.args }
    delete target.partialArgs
  }

  return previousId
}
