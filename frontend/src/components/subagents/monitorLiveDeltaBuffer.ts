import type { SubAgentRunContentWindowState } from './monitorWindowState'

/**
 * SubAgent Monitor live delta 缓冲工具。
 *
 * 修改原因：Monitor 在流式中途打开或窗口校准请求在飞时，llm_delta 可能早于 transcript window 到达；旧逻辑直接丢弃这些 delta，
 * 导致实时界面缺字、工具卡缺 functionCall，直到流结束后由后端权威窗口替换才恢复。
 * 修改方式：把“暂时不能应用的可渲染 llm_delta”收敛为有界、按 eventSequence 排序的纯函数缓冲区；窗口到达后只回放与窗口
 * contentRevision 相同的 delta，旧 revision delta 交给后端权威窗口淘汰，新 revision delta 留待下一次窗口校准。
 * 修改目的：保持正文仍走 manifest/window + 轻量 delta 协议，不回退到 full snapshot，同时让实时打开 Monitor 的显示与重开后的显示一致。
 */

export const DEFAULT_MONITOR_LIVE_DELTA_BUFFER_LIMIT = 500

export interface MonitorLiveDeltaEvent {
  runId?: string
  type?: string
  timestamp?: number
  eventSequence?: number
  contentRevision?: number
  payload?: any
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function getMonitorLiveDeltaSequence(event: MonitorLiveDeltaEvent | undefined): number | undefined {
  // 修改原因：eventSequence 可能在旧协议或测试夹层中缺失，所有排序/去重都必须安全降级。
  // 修改方式：集中读取并校验有限数字，调用方缺失时保留插入顺序。
  // 修改目的：新旧 Monitor 协议都能使用同一缓冲 helper。
  return finiteNumber(event?.eventSequence ?? event?.payload?.eventSequence)
}

export function getMonitorLiveDeltaRevision(event: MonitorLiveDeltaEvent | undefined): number {
  // 修改原因：llm_delta 的 contentRevision 表示它基于哪一版 transcript window 生成，决定窗口到达后能否回放。
  // 修改方式：优先读取事件顶层字段，其次兼容 payload 字段，缺失时按旧协议 0 处理。
  // 修改目的：避免窗口已经被更高 revision 的 content_snapshot 替换后，又把旧 delta 应用回去。
  return finiteNumber(event?.contentRevision ?? event?.payload?.contentRevision) ?? 0
}

export function hasRenderableMonitorLiveDelta(event: MonitorLiveDeltaEvent | undefined): boolean {
  // 修改原因：部分 llm_delta 只携带 done/usage/deltaCount 等状态计数，没有可渲染正文，缓冲它们只会制造噪音。
  // 修改方式：只把 delta 数组或 contentSnapshot 视为可回放正文事件。
  // 修改目的：缓冲区只承载 transcript 增量，工具状态仍由 manifest/overlay 直接处理。
  return event?.type === 'llm_delta'
    && (Array.isArray(event.payload?.delta) || !!event.payload?.contentSnapshot)
}

export function enqueueMonitorLiveDelta(
  current: MonitorLiveDeltaEvent[] | undefined,
  event: MonitorLiveDeltaEvent,
  limit = DEFAULT_MONITOR_LIVE_DELTA_BUFFER_LIMIT
): MonitorLiveDeltaEvent[] {
  if (!hasRenderableMonitorLiveDelta(event)) return current ? [...current] : []
  const safeLimit = Math.max(1, Math.floor(limit))
  const sequence = getMonitorLiveDeltaSequence(event)
  const withoutDuplicate = typeof sequence === 'number'
    ? (current || []).filter(item => getMonitorLiveDeltaSequence(item) !== sequence)
    : [...(current || [])]

  const next = [...withoutDuplicate, event]
  next.sort((a, b) => {
    const aSeq = getMonitorLiveDeltaSequence(a)
    const bSeq = getMonitorLiveDeltaSequence(b)
    if (typeof aSeq === 'number' && typeof bSeq === 'number') return aSeq - bSeq
    if (typeof aSeq === 'number') return -1
    if (typeof bSeq === 'number') return 1
    return 0
  })

  // 修改原因：用户可能长时间保持 Monitor 打开而窗口请求失败，live delta 缓冲不能无界增长。
  // 修改方式：超过上限时丢弃最旧 delta；最终内容仍由后续 content_snapshot/getRunWindow 权威校准。
  // 修改目的：用有界内存换取实时显示尽力而为，符合 Monitor “事件轻量、窗口权威”的协议边界。
  return next.slice(Math.max(0, next.length - safeLimit))
}

export function selectReplayableMonitorLiveDeltas(
  current: MonitorLiveDeltaEvent[] | undefined,
  contentWindow: Pick<SubAgentRunContentWindowState, 'contentRevision'> | undefined
): { replayable: MonitorLiveDeltaEvent[]; remaining: MonitorLiveDeltaEvent[] } {
  const buffer = current || []
  if (!contentWindow) return { replayable: [], remaining: buffer }
  const windowRevision = finiteNumber(contentWindow.contentRevision) ?? 0
  const replayable: MonitorLiveDeltaEvent[] = []
  const remaining: MonitorLiveDeltaEvent[] = []

  for (const event of buffer) {
    const eventRevision = getMonitorLiveDeltaRevision(event)
    if (eventRevision < windowRevision) {
      // 修改原因：更高 revision 的后端窗口已经包含或取代了旧 live delta 的语义，继续回放会重复或回滚 UI。
      // 修改方式：低于窗口 revision 的 delta 直接丢弃。
      // 修改目的：流结束后的权威 content_snapshot 能自然清理中途打开时积累的临时 delta。
      continue
    }
    if (eventRevision > windowRevision) {
      remaining.push(event)
      continue
    }
    replayable.push(event)
  }

  return { replayable, remaining }
}
