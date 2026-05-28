/**
 * WP14: 统合前端 type guard 工具函数。
 *
 * 背景：asRecord / asString / asNumber / asBoolean 在 progressCards.ts、
 * reviewCards.ts、pendingAgentAction.ts、toolContinuations.ts 中各有重复定义。
 * 不同模块的 asRecord 返回 null vs undefined、是否排除数组存在语义差异，
 * 不能盲目统一为一个签名。因此本模块提供两个变体：
 *
 *   - asRecord(value)         → Record<string, unknown> | undefined（排除数组）
 *     用于 progressCards.ts 和 reviewCards.ts。
 *
 *   - asRecordOrNull(value)   → Record<string, unknown> | null（不排除数组）
 *     用于 pendingAgentAction.ts 和 toolContinuations.ts，保持 null 返回值兼容。
 *
 * asString / asNumber / asBoolean 在所有模块中语义一致，直接统合。
 */

/**
 * 安全地将 unknown 转为 Record<string, unknown>，排除数组。
 * 返回 undefined 表示输入不是有效 record。
 *
 * 使用者：progressCards.ts, reviewCards.ts
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * 兼容变体：返回 null 而非 undefined，且不排除数组。
 * 保留 pendingAgentAction.ts 和 toolContinuations.ts 的原有 null 语义。
 *
 * 使用者：pendingAgentAction.ts, toolContinuations.ts
 */
export function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

/**
 * 安全地将 unknown 转为非空 string。
 * 返回 undefined 表示输入不是有效字符串。
 */
export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

/**
 * 安全地将 unknown 转为有限 number（支持数字和数字字符串）。
 * 返回 undefined 表示输入不是有效数字。
 */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * 安全地将 unknown 转为 boolean。
 * 返回 undefined 表示输入不是 boolean。
 */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
