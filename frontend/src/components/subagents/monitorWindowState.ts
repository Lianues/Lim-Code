/**
 * SubAgent Monitor transcript window 合并工具。
 *
 * 修改原因：Monitor 现在按 manifest + window 分页加载 Content[]，组件内直接拼接容易把真实 backendIndex
 * 和可见数组下标混淆，也难以测试“加载更早”是否保留尾部对象引用。
 * 修改方式：把窗口合并收敛为纯函数，支持前置分页 prepend 与后端校准窗口 replace 两种策略。
 * 修改目的：保持 Monitor 仍使用 Content[]/MessageItem 渲染语义，但窗口状态更新可独立回归测试。
 */

import type { Content } from '../../types'

export interface SubAgentRunContentWindowState {
  runId: string
  contents: Content[]
  startIndex: number
  endIndex: number
  totalCount: number
  /**
   * 修改原因：Monitor window 是后端 transcript 的投影，异步请求返回时必须能判断自己是否落后于最新 manifest。
   * 修改方式：随窗口保存后端 contentRevision；旧测试/旧协议未提供时按 0 处理。
   * 目的：禁止 stale window 继续接收下一轮 live delta，避免多次回复混为一楼。
   */
  contentRevision?: number
  /**
   * 修改原因：窗口响应和事件推送可能乱序到达，单靠 updatedAt 不足以表达 run 内顺序。
   * 修改方式：随窗口保存后端 eventSequence；旧数据未提供时按 0 处理。
   * 目的：为响应去旧和后续 AgentRunEvent replay 提供统一序号。
   */
  eventSequence?: number
  hasMoreBefore: boolean
  hasMoreAfter: boolean
}

export interface SubAgentRunFreshnessManifest {
  contentCount?: number
  contentRevision?: number
  eventSequence?: number
}

function revisionOf(value: { contentRevision?: number } | undefined): number {
  return typeof value?.contentRevision === 'number' && Number.isFinite(value.contentRevision) ? value.contentRevision : 0
}

function sequenceOf(value: { eventSequence?: number } | undefined): number {
  return typeof value?.eventSequence === 'number' && Number.isFinite(value.eventSequence) ? value.eventSequence : 0
}

export interface RunContentWindowRequestOptions {
  limit: number
  endIndex: number
}

export function createPreviousRunWindowRequestOptions(
  current: SubAgentRunContentWindowState,
  limit: number
): RunContentWindowRequestOptions {
  // 修改原因：加载更早消息必须用完整 transcript 的半开区间锚点，而不是可见数组下标。
  // 修改方式：把当前窗口 startIndex 作为下一页请求的 endIndex，后端按 [endIndex-limit, endIndex) 返回 older window。
  // 修改目的：组件和测试共享同一分页请求构造规则，避免后续 UI 改动误传 startIndex 或 offset。
  return {
    limit,
    endIndex: current.startIndex
  }
}

/**
 * 合并向前分页返回的 older window。
 *
 * 修改原因：“加载更早消息”返回的是当前 startIndex 之前的一页，不能替换已显示尾部，否则用户刚看的尾部消息会抖动。
 * 修改方式：只把 older.contents 中尚未在当前窗口覆盖的真实 index 前置；current.contents 原对象引用原样保留。
 * 修改目的：既能扩展可见历史，又避免不必要替换尾部 Content 对象触发 Markdown 重渲染。
 */
export function prependRunContentWindow(
  current: SubAgentRunContentWindowState | undefined,
  older: SubAgentRunContentWindowState | undefined
): SubAgentRunContentWindowState | undefined {
  if (!older?.runId) return current
  if (!current || current.runId !== older.runId) return older

  const nonOverlappingOlder = (older.contents || []).filter((content, offset) => {
    const backendIndex = typeof content.index === 'number' ? content.index : older.startIndex + offset
    return backendIndex < current.startIndex
  })

  return {
    runId: current.runId,
    contents: [...nonOverlappingOlder, ...(current.contents || [])],
    startIndex: Math.min(current.startIndex, older.startIndex),
    endIndex: Math.max(current.endIndex, older.endIndex),
    totalCount: older.totalCount,
    contentRevision: Math.max(revisionOf(current), revisionOf(older)),
    eventSequence: Math.max(sequenceOf(current), sequenceOf(older)),
    hasMoreBefore: older.hasMoreBefore,
    hasMoreAfter: current.hasMoreAfter || older.hasMoreAfter
  }
}

/**
 * 应用后端返回的校准窗口。
 *
 * 修改原因：content_snapshot/delete/retry 后后端会返回权威窗口；如果该窗口与当前窗口不连续，继续拼接会制造重复或空洞。
 * 修改方式：默认 replace；只有明确是 prepend 时调用 prependRunContentWindow。
 * 修改目的：把“历史分页”和“权威校准”分成两个通用策略，避免组件里出现 endpoint 特判式状态更新。
 */
export function shouldApplyRunContentWindow(
  current: SubAgentRunContentWindowState | undefined,
  incoming: SubAgentRunContentWindowState | undefined
): boolean {
  // 修改原因：getRunWindow 是异步 request/response，旧响应可能晚于新响应返回并覆盖最新窗口。
  // 修改方式：按 contentRevision 优先、eventSequence 其次比较，只允许不旧于当前缓存的窗口写入。
  // 修改目的：消除 stale response 覆盖，保持前端窗口始终是后端 transcript 的最新投影。
  if (!incoming?.runId) return false
  if (!current || current.runId !== incoming.runId) return true
  const incomingRevision = revisionOf(incoming)
  const currentRevision = revisionOf(current)
  if (incomingRevision !== currentRevision) return incomingRevision > currentRevision
  return sequenceOf(incoming) >= sequenceOf(current)
}

export function replaceRunContentWindow(
  incoming: SubAgentRunContentWindowState | undefined,
  current?: SubAgentRunContentWindowState
): SubAgentRunContentWindowState | undefined {
  // 修改原因：权威校准窗口可能与当前窗口不连续，必须 replace；但过期校准不能覆盖新窗口。
  // 修改方式：先用 shouldApplyRunContentWindow 做 freshness 判断，再返回 incoming 作为替换窗口。
  // 修改目的：区分“校准 replace”和“历史 prepend”，同时防止旧响应回滚 UI。
  return shouldApplyRunContentWindow(current, incoming) ? incoming : current
}

export function isRunWindowTailAuthoritative(
  current: SubAgentRunContentWindowState | undefined,
  manifest?: SubAgentRunFreshnessManifest
): boolean {
  // 修改原因：live delta 只能追加到后端最新尾部窗口；对旧窗口或非尾部窗口追加会把多轮回复混到同一楼。
  // 修改方式：要求窗口覆盖 transcript 尾部，且 manifest 的 contentCount/contentRevision 不超过当前窗口。
  // 修改目的：没有 content identity 的 delta 只能在 tail-authoritative 条件下应用，否则必须改走强制窗口刷新。
  if (!current) return false
  if (current.hasMoreAfter) return false
  if (current.endIndex !== current.totalCount) return false
  if (typeof manifest?.contentCount === 'number' && manifest.contentCount > current.totalCount) return false
  if (typeof manifest?.contentRevision === 'number' && manifest.contentRevision > revisionOf(current)) return false
  return true
}
