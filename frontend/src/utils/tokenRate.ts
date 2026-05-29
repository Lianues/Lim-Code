import type { MessageMetadata, UsageMetadata } from '../types'

export const DUPLICATE_DURATION_TOLERANCE_MS = 50

/**
 * 修改原因：主聊天、SubAgent Monitor 和响应详情过去各自计算 token 速度，且曾错误使用首块到末块的短窗口作分母。
 * 修改方式：把 token 数、速率和重复 duration 展示判断集中成纯函数；速率优先使用完整响应耗时 responseDuration，并保留 streamDuration 作为旧记录回退。
 * 修改目的：让所有入口共享同一套 token 速度语义，避免 SSE 一次性吐出多块时出现畸高速度，也防止后续再复制公式。
 */
export function getTokenRateTokenCount(usage?: UsageMetadata): number {
  if (!usage) return 0

  const outputTokens = usage.candidatesTokenCount || 0
  const thoughtTokens = usage.thoughtsTokenCount || 0
  return thoughtTokens > 0 ? outputTokens + thoughtTokens : outputTokens
}

/**
 * 修改原因：旧实现用 streamDuration 作为唯一分母，遇到上游攒包后会把大量 token 除以极短解析窗口。
 * 修改方式：统一从 MessageMetadata 中选取完整响应耗时；responseDuration 优先，streamDuration 只在旧数据缺失 responseDuration 时兜底。
 * 修改目的：既修复新旧主界面与 Monitor 的速度显示，又保持历史记录在信息不完整时仍能 best-effort 展示。
 */
export function calculateTokenRate(
  metadata?: MessageMetadata,
  resolvedUsage?: UsageMetadata
): number | undefined {
  if (!metadata) return undefined

  const chunkCount = metadata.chunkCount || 0
  if (chunkCount <= 1) return undefined

  const duration = metadata.responseDuration ?? metadata.streamDuration
  if (!duration || duration <= 0) return undefined

  const totalTokens = getTokenRateTokenCount(resolvedUsage ?? metadata.usageMetadata)
  if (totalTokens <= 0) return undefined

  return totalTokens / (duration / 1000)
}

/**
 * 修改原因：不同 UI 入口需要同样的小数位展示，但单位文案由各自模板控制。
 * 修改方式：只格式化数字精度，不拼接 t/s。
 * 修改目的：复用展示精度，同时避免工具函数耦合具体 UI 文案。
 */
export function formatTokenRate(rate: number): string {
  return rate.toFixed(1)
}

/**
 * 修改原因：修复后 streamDuration 与 responseDuration 在新记录中同源，详情页继续并列展示会造成重复信息。
 * 修改方式：当两者在容差内近似相等时隐藏 streamDuration；差异较大的旧记录或异常记录仍保留诊断价值。
 * 修改目的：减少详情页噪音，同时不丢失历史数据中可能有意义的时长差异。
 */
export function shouldShowStreamDuration(
  responseDuration?: number,
  streamDuration?: number,
  toleranceMs = DUPLICATE_DURATION_TOLERANCE_MS
): boolean {
  if (typeof streamDuration !== 'number' || streamDuration <= 0) return false
  if (typeof responseDuration !== 'number' || responseDuration <= 0) return true
  return Math.abs(streamDuration - responseDuration) > toleranceMs
}
