<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { CustomScrollbar } from '../common'
import MessageItem from '../message/MessageItem.vue'
import { contentToMessageEnhanced } from '@/stores/chat/parsers'
import { applyStreamChunkToContents } from '@/stores/agentRun/contentDelta'
import { onMessageFromExtension, sendToExtension } from '@/utils/vscode'
import { shouldApplyEventFocus } from './monitorFocusPolicy'
import { compareMonitorRunsByStableCreationOrder } from './monitorRunOrdering'
import {
  createPreviousRunWindowRequestOptions,
  isRunWindowTailAuthoritative,
  prependRunContentWindow,
  replaceRunContentWindow,
  type SubAgentRunContentWindowState
} from './monitorWindowState'
import {
  applyMonitorToolOverlay,
  reduceMonitorToolStatusOverlay,
  type MonitorToolStatusOverlay
} from './monitorToolStatusOverlay'
import {
  DEFAULT_MONITOR_LIVE_DELTA_BUFFER_LIMIT,
  enqueueMonitorLiveDelta,
  getMonitorLiveDeltaRevision,
  getMonitorLiveDeltaSequence,
  hasRenderableMonitorLiveDelta,
  selectReplayableMonitorLiveDeltas,
  type MonitorLiveDeltaEvent
} from './monitorLiveDeltaBuffer'
import type { Content, ContentPart, Message, ToolUsage } from '@/types'

// 修改原因：Monitor 需要区分暂停、等待用户处理和扩展重载中断，不能把它们都展示成失败。
// 修改方式：与后端 SubAgentRunStatus 保持同构的前端状态联合类型。
// 修改目的：后续顶部控制按钮可以根据状态判断是否允许继续、退出或仅查看历史。
type RunStatus = 'running' | 'paused' | 'awaiting_monitor_action' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

interface SubAgentRunEvent {
  runId: string
  agentName?: string
  type: string
  timestamp: number
  toolId?: string
  toolName?: string
  eventSequence?: number
  contentRevision?: number
  payload?: any
}

interface SubAgentRunManifest {
  runId: string
  agentName?: string
  status: RunStatus
  createdAt: number
  updatedAt: number
  conversationId?: string
  contentCount: number
  eventCount: number
  contentRevision?: number
  eventSequence?: number
  preview?: string
  lastMessageRole?: Content['role']
}

interface SubAgentContentFreshness {
  contentCount: number
  contentRevision?: number
  eventSequence?: number
}

type SubAgentRunContentWindow = SubAgentRunContentWindowState

interface SubAgentRunSnapshot {
  runId: string
  agentName?: string
  status: RunStatus
  createdAt: number
  updatedAt: number
  contents: Content[]
  events: SubAgentRunEvent[]
  conversationId?: string
  contentRevision?: number
  eventSequence?: number
}

const DEFAULT_RUN_WINDOW_LIMIT = 20

// 修改原因：Monitor 首屏不再接收完整 snapshots，否则大输出会卡在传输、反序列化、Vue state 和 Markdown 渲染。
// 修改方式：状态拆成轻量 manifests 与按 run 缓存的 transcript window，只有聚焦 run 才加载 Content[]。
// 修改目的：保持 Content[]/MessageItem 渲染语义不分叉，同时把首屏 payload 限制为 run 列表元数据。
const manifests = ref<SubAgentRunManifest[]>([])
const windowsByRunId = ref<Record<string, SubAgentRunContentWindow>>({})
const eventsByRunId = ref<Record<string, SubAgentRunEvent[]>>({})
// 修改原因：工具状态是运行时事件状态，不能只从窗口内 functionResponse 反推，否则刷新丢失时工具卡会卡住。
// 修改方式：为每个 run 维护 toolId -> ToolUsage 状态 overlay，事件到达时用纯 reducer 更新。
// 修改目的：让 tool_started/tool_completed/tool_failed 实时驱动工具卡，同时仍由 functionResponse 做最终结果校准。
const toolStatusOverlaysByRunId = ref<Record<string, MonitorToolStatusOverlay>>({})
const loadingRunWindows = ref<Set<string>>(new Set())
// 修改原因：“加载更早消息”是按 run 维度的分页请求，必须单独记录 loading 以避免用户重复点击造成重叠 prepend。
// 修改方式：使用 Set<runId> 表示正在向前加载历史的 run，不复用聚焦尾部窗口 loading。
// 修改目的：尾部校准和历史分页可以并行建模，UI 上按钮能准确禁用。
const loadingOlderRunWindows = ref<Set<string>>(new Set())
// 修改原因：强制尾部校准请求可能在已有 getRunWindow 请求进行中到达，旧逻辑直接 return 会永久丢失校准意图。
// 修改方式：用普通 Set 记录 dirty run，请求完成后自动补发一次 force refresh；requestSeq 防止旧响应覆盖新窗口。
// 修改目的：保证 content_snapshot/run_completed 等边界事件最终一定校准当前窗口。
const pendingForcedRunWindowRefreshes = new Set<string>()
// 修改原因：Monitor 在流式中途打开时，llm_delta 可能早于 getRunWindow 响应到达，旧逻辑会直接丢弃这些正文增量。
// 修改方式：为每个 run 维护有界 live delta 缓冲；窗口可用且 revision 匹配后按 eventSequence 回放。
// 修改目的：不恢复 full snapshot 传输，也能让实时打开 Monitor 的显示最终追上同一轮流式输出。
const liveDeltaBuffersByRunId = new Map<string, MonitorLiveDeltaEvent[]>()
const latestRunWindowRequestSeq = new Map<string, number>()
let runWindowRequestSeq = 0
const focusedRunId = ref<string | undefined>((window as any).__LIMCODE_INITIAL_RUN_ID || undefined)
// 修改原因：顶部控制按钮只能作用于后端仍持有活跃主工具 Promise 的 run。
// 修改方式：由 SubAgentMonitorPanel 随 ready/manifest/event 消息下发 activeRunIds，前端只按该集合决定按钮可见性。
// 修改目的：历史 run 不会错误显示“中止/退出”等会影响主工具的操作。
const activeRunIds = ref<Set<string>>(new Set())
// 修改原因：实时事件会反复携带打开面板时的 focusRunId，并发 run 更新时会覆盖用户在 tab 上的手动选择。
// 修改方式：记录用户是否已经在 Monitor 内主动选中过 run，实时 event 只在用户未选择前应用后端焦点。
// 修改目的：从主窗口打开详情仍能自动定位，但 Monitor 内部切换不会被后续事件拉回旧 run。
const hasUserSelectedRun = ref(false)
const lastHeartbeatAt = ref<number>(0)
const heartbeatTick = ref(Date.now())
const lastEventSequenceByRunId = new Map<string, number>()
const gapRunIds = ref<Set<string>>(new Set())
let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let disposeMessageListener: (() => void) | undefined

const monitorConnectionState = computed<'syncing' | 'live' | 'stale' | 'gap' | 'degraded' | 'disconnected'>(() => {
  /**
   * 修改原因：Monitor 需要告诉用户连接是否新鲜，不能在 postMessage 停止时静默显示旧内容。
   * 修改方式：用后端 heartbeat 的 lastSeen 时间计算 live/stale/disconnected；首次收到前显示 syncing。
   * 修改目的：让“卡死不更新”变成可见状态，并给原地重置动作提供依据。
   */
  if (focusedRun.value?.runId && gapRunIds.value.has(focusedRun.value.runId)) return 'gap'
  const lastSeen = lastHeartbeatAt.value
  if (!lastSeen) return 'syncing'
  const age = heartbeatTick.value - lastSeen
  if (age > 15000) return 'disconnected'
  if (age > 8000) return 'stale'
  return 'live'
})

const freshnessLabel = computed(() => {
  switch (monitorConnectionState.value) {
    case 'live': return 'Live'
    case 'stale': return 'Stale'
    case 'gap': return 'Gap detected'
    case 'degraded': return 'Degraded'
    case 'disconnected': return 'Disconnected'
    default: return 'Syncing'
  }
})

const freshnessDescription = computed(() => {
  if (!lastHeartbeatAt.value) return 'Waiting for monitor heartbeat.'
  return `Last heartbeat ${Math.max(0, Math.round((heartbeatTick.value - lastHeartbeatAt.value) / 1000))}s ago.`
})

const orderedRuns = computed(() => {
  // 修改原因：updatedAt 会被每个 llm_delta 和工具事件刷新，并发 run 按 updatedAt 排序会导致 tab 顺序不停跳动。
  // 修改方式：Run tab 改用创建时间的稳定顺序；updatedAt 仍只用于展示最近更新时间。
  // 修改目的：Monitor 在流式提前执行和多 SubAgent 并发时不再出现“跑马灯”式重排。
  return [...manifests.value].sort(compareMonitorRunsByStableCreationOrder)
})

const focusedManifest = computed(() => {
  if (focusedRunId.value) {
    const found = orderedRuns.value.find(run => run.runId === focusedRunId.value)
    if (found) return found
  }
  return orderedRuns.value[0]
})

const focusedRun = computed<SubAgentRunSnapshot | undefined>(() => {
  const manifest = focusedManifest.value
  if (!manifest) return undefined
  const contentWindow = windowsByRunId.value[manifest.runId]
  return {
    runId: manifest.runId,
    agentName: manifest.agentName,
    status: manifest.status,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    conversationId: manifest.conversationId,
    contents: contentWindow?.contents || [],
    events: eventsByRunId.value[manifest.runId] || [],
    contentRevision: contentWindow?.contentRevision ?? manifest.contentRevision,
    eventSequence: contentWindow?.eventSequence ?? manifest.eventSequence
  }
})

function upsertManifest(manifest: SubAgentRunManifest | undefined) {
  if (!manifest?.runId) return
  const index = manifests.value.findIndex(item => item.runId === manifest.runId)
  if (index >= 0) {
    const next = [...manifests.value]
    next[index] = { ...next[index], ...manifest }
    manifests.value = next
  } else {
    manifests.value = [manifest, ...manifests.value]
  }
}

function detectEventGap(event: SubAgentRunEvent) {
  if (!event.runId || typeof event.eventSequence !== 'number') return
  const previous = lastEventSequenceByRunId.get(event.runId)
  if (typeof previous === 'number' && event.eventSequence > previous + 1) {
    /**
     * 修改原因：P1 要求 sequence gap 可见，不能只靠窗口刷新静默掩盖事件缺口。
     * 修改方式：按 runId 记录 gap 状态，同时强制重新拉取权威 window。
     * 目的：用户能看到当前 Monitor 正在降级恢复，失败时可点击原地重置。
     */
    gapRunIds.value = new Set([...gapRunIds.value, event.runId])
    void requestRunWindow(event.runId, true)
  }
  lastEventSequenceByRunId.set(event.runId, Math.max(previous || 0, event.eventSequence))
}

function clearEventGap(runId: string) {
  if (!gapRunIds.value.has(runId)) return
  const next = new Set(gapRunIds.value)
  next.delete(runId)
  gapRunIds.value = next
}

function markHeartbeat(data?: any) {
  lastHeartbeatAt.value = typeof data?.serverTime === 'number' ? Date.now() : Date.now()
  if (Array.isArray(data?.activeRunIds)) updateActiveRunIds(data.activeRunIds)
}

function applyManifestPayload(data: any) {
  // 修改原因：monitorReady/subagentMonitor.manifest 的协议已从 snapshots 切换为 manifests，前端不能再把全量 contents 放入首屏 state。
  // 修改方式：只接收 manifests，并同步焦点与 activeRunIds；窗口内容保留已有按需缓存。
  // 修改目的：重新打开已有面板时也不会因一次全量替换触发 Markdown 大渲染。
  manifests.value = Array.isArray(data?.manifests) ? data.manifests : []
  if (data?.focusRunId) {
    // 修改原因：manifest/monitorReady 代表打开详情或重新同步，是显式导航事件，应该能覆盖旧选择。
    // 修改方式：应用后端 focusRunId，同时清除“用户已手动选择”标记，让新的显式入口成为默认焦点。
    // 修改目的：用户从主聊天再次打开另一个 run 时，Monitor 能正确跳转到新 run。
    focusedRunId.value = data.focusRunId
    hasUserSelectedRun.value = false
  }
  updateActiveRunIds(data?.activeRunIds)
}

function upsertWindow(contentWindow: SubAgentRunContentWindow | undefined) {
  if (!contentWindow?.runId) return
  const replacement = replaceRunContentWindow(contentWindow, windowsByRunId.value[contentWindow.runId])
  if (!replacement) return
  windowsByRunId.value = {
    ...windowsByRunId.value,
    [contentWindow.runId]: replacement
  }
}

function prependWindow(contentWindow: SubAgentRunContentWindow | undefined) {
  if (!contentWindow?.runId) return
  const merged = prependRunContentWindow(windowsByRunId.value[contentWindow.runId], contentWindow)
  if (!merged) return
  windowsByRunId.value = {
    ...windowsByRunId.value,
    [contentWindow.runId]: merged
  }
}

function applyToolStatusEvent(event: SubAgentRunEvent) {
  if (!event?.runId) return
  const current = toolStatusOverlaysByRunId.value[event.runId] || {}
  const next = reduceMonitorToolStatusOverlay(current, event)
  if (next === current) return
  toolStatusOverlaysByRunId.value = {
    ...toolStatusOverlaysByRunId.value,
    [event.runId]: next
  }
}

function appendEvent(event: SubAgentRunEvent) {
  if (!event?.runId || event.type === 'llm_delta') return
  const current = eventsByRunId.value[event.runId] || []
  eventsByRunId.value = {
    ...eventsByRunId.value,
    [event.runId]: [...current, event]
  }
  // 修改原因：工具事件不仅用于审计列表，还必须实时推进 MessageItem 内的工具卡状态。
  // 修改方式：事件入库后同步喂给 run 级工具状态 overlay reducer。
  // 修改目的：窗口刷新或 functionResponse 暂未到达时，工具卡仍能显示 executing/success/error。
  applyToolStatusEvent(event)
}

async function requestRunWindow(runId: string | undefined, force = false) {
  if (!runId) return
  if (!force && windowsByRunId.value[runId]) return
  if (loadingRunWindows.value.has(runId)) {
    if (force) {
      // 修改原因：强制校准通常由 content_snapshot/run_completed 触发，不能因为已有请求在飞就丢弃。
      // 修改方式：把 run 标记为 dirty，当前请求结束后再自动补发一次 force refresh。
      // 修改目的：保证窗口最终追上后端 transcript 真源，避免旧窗口继续接收下一轮 delta。
      pendingForcedRunWindowRefreshes.add(runId)
    }
    return
  }

  const requestSeq = ++runWindowRequestSeq
  latestRunWindowRequestSeq.set(runId, requestSeq)
  const loading = new Set(loadingRunWindows.value)
  loading.add(runId)
  loadingRunWindows.value = loading
  try {
    const manifest = manifests.value.find(item => item.runId === runId)
    // 修改原因：聚焦 run 才需要 Content[]，请求窗口时携带 conversationId 允许后端先从 metadata 恢复历史 run。
    // 修改方式：调用 Monitor 专属 getRunWindow 协议，默认尾部 20 条；返回 manifest 用于同步 contentCount/status。
    // 修改目的：20k token 完成报告不会在 monitorReady 阶段一次性进入前端。
    const response = await sendToExtension<{
      window?: SubAgentRunContentWindow
      manifest?: SubAgentRunManifest
      activeRunIds?: string[]
    }>('subagents.monitor.getRunWindow', {
      runId,
      conversationId: manifest?.conversationId,
      options: { limit: DEFAULT_RUN_WINDOW_LIMIT, fromTail: true }
    })
    if (latestRunWindowRequestSeq.get(runId) !== requestSeq) {
      // 修改原因：Webview request/response 没有业务顺序保证，旧响应可能晚于后续强制刷新返回。
      // 修改方式：每个 tail window 请求带本地递增 seq，只有当前最新请求允许写入窗口缓存。
      // 修改目的：防止 stale response 覆盖已校准窗口。
      return
    }
    if (response?.manifest) upsertManifest(response.manifest)
    if (response?.window) {
      clearEventGap(response.window.runId)
      upsertWindow(response.window)
      // 修改原因：窗口响应可能是 Monitor 打开后第一次可用的 transcript 基线，之前到达的 llm_delta 不能再丢弃。
      // 修改方式：窗口写入缓存后立即尝试回放同 run 的有界 live delta 缓冲。
      // 修改目的：解决流式过程中打开 Monitor 时正文或工具调用只在结束后才恢复的问题。
      replayBufferedLiveDeltas(response.window.runId)
    }
    updateActiveRunIds(response?.activeRunIds)
  } finally {
    const nextLoading = new Set(loadingRunWindows.value)
    nextLoading.delete(runId)
    loadingRunWindows.value = nextLoading
    if (pendingForcedRunWindowRefreshes.delete(runId)) {
      // 修改原因：加载中发生的 force refresh 已被 dirty 标记记录，需要在当前请求释放后补偿执行。
      // 修改方式：finally 阶段消费 dirty 标记并递归发起一次强制刷新；若刷新期间又变 dirty，会继续排队。
      // 修改目的：把“强制校准不丢失”固化为窗口请求状态机不变量。
      void requestRunWindow(runId, true)
    }
  }
}

function resetFocusedView() {
  const runId = focusedRun.value?.runId || focusedManifest.value?.runId
  if (!runId) return
  /**
   * 修改原因：P1 要求 Monitor 卡死或 gap 后能原地重置，不再要求用户关闭再打开面板。
   * 修改方式：清理当前 run 的窗口、事件 overlay 与 live delta buffer，然后强制重新拉取权威 window。
   * 修改目的：在不重建 Webview 的情况下恢复可见状态。
   */
  const nextWindows = { ...windowsByRunId.value }
  delete nextWindows[runId]
  windowsByRunId.value = nextWindows
  const nextEvents = { ...eventsByRunId.value }
  delete nextEvents[runId]
  eventsByRunId.value = nextEvents
  const nextOverlays = { ...toolStatusOverlaysByRunId.value }
  delete nextOverlays[runId]
  toolStatusOverlaysByRunId.value = nextOverlays
  liveDeltaBuffersByRunId.delete(runId)
  clearEventGap(runId)
  void requestRunWindow(runId, true)
}

async function loadOlderMessages() {
  const run = focusedRun.value
  if (!run) return
  let currentWindow = windowsByRunId.value[run.runId]
  if (!currentWindow) {
    // 修改原因：如果用户在窗口尚未加载完时点击加载历史，没有 current.startIndex 可作为分页锚点。
    // 修改方式：先沿用聚焦 run 的尾部窗口加载逻辑，拿到尾部窗口后再允许下一次点击加载更早。
    // 修改目的：所有分页都以真实 backendIndex 为锚，不用可见数组下标猜测。
    await requestRunWindow(run.runId)
    currentWindow = windowsByRunId.value[run.runId]
  }
  if (!currentWindow?.hasMoreBefore) return
  if (loadingOlderRunWindows.value.has(run.runId)) return

  const loading = new Set(loadingOlderRunWindows.value)
  loading.add(run.runId)
  loadingOlderRunWindows.value = loading
  try {
    // 修改原因：后端 window.endIndex 使用完整 Content[] 的半开区间索引；加载更早时应请求当前 startIndex 之前的一页。
    // 修改方式：传 endIndex=currentWindow.startIndex 且 limit=20，后端从该位置向前取窗口。
    // 修改目的：prepend 后每条 content.index 仍是全局真实索引，删除/重试不会因分页错位。
    const response = await sendToExtension<{
      window?: SubAgentRunContentWindow
      manifest?: SubAgentRunManifest
      activeRunIds?: string[]
    }>('subagents.monitor.getRunWindow', {
      runId: run.runId,
      conversationId: run.conversationId,
      options: createPreviousRunWindowRequestOptions(currentWindow, DEFAULT_RUN_WINDOW_LIMIT)
    })
    if (response?.manifest) upsertManifest(response.manifest)
    if (response?.window) prependWindow(response.window)
    updateActiveRunIds(response?.activeRunIds)
  } finally {
    const nextLoading = new Set(loadingOlderRunWindows.value)
    nextLoading.delete(run.runId)
    loadingOlderRunWindows.value = nextLoading
  }
}

function setLiveDeltaBuffer(runId: string, buffer: MonitorLiveDeltaEvent[]) {
  // 修改原因：缓冲区是 Map，Vue 不需要追踪它；但必须集中删除空数组，避免长期打开 Monitor 后残留空 run key。
  // 修改方式：空缓冲直接 delete，非空缓冲替换为新数组引用。
  // 修改目的：让有界缓冲的生命周期清晰，避免后台 run 持续占用内存。
  if (buffer.length === 0) {
    liveDeltaBuffersByRunId.delete(runId)
  } else {
    liveDeltaBuffersByRunId.set(runId, buffer)
  }
}

function bufferLiveDeltaEvent(event: SubAgentRunEvent) {
  if (!event.runId || !hasRenderableMonitorLiveDelta(event)) return
  const current = liveDeltaBuffersByRunId.get(event.runId)
  setLiveDeltaBuffer(
    event.runId,
    enqueueMonitorLiveDelta(current, event, DEFAULT_MONITOR_LIVE_DELTA_BUFFER_LIMIT)
  )
}

function clearSupersededLiveDeltaBuffer(runId: string, revision: number | undefined) {
  const current = liveDeltaBuffersByRunId.get(runId)
  if (!current || typeof revision !== 'number') return
  // 修改原因：content_snapshot 表示后端 transcript 已进入更新 revision，旧 revision 的 live delta 已被权威窗口取代。
  // 修改方式：低于新 revision 的缓冲 delta 提前淘汰，等于或高于 revision 的 delta 继续等待匹配窗口。
  // 修改目的：流结束或工具结果写入后，不让旧实时片段重新追加到新窗口。
  setLiveDeltaBuffer(runId, current.filter(event => getMonitorLiveDeltaRevision(event) >= revision))
}

function applyLiveDeltaToWindow(
  event: MonitorLiveDeltaEvent,
  contentWindow: SubAgentRunContentWindow,
  freshness?: SubAgentContentFreshness
): SubAgentRunContentWindow | undefined {
  if (!event.runId || !hasRenderableMonitorLiveDelta(event)) return contentWindow
  const eventRevision = getMonitorLiveDeltaRevision(event)
  const windowRevision = typeof contentWindow.contentRevision === 'number' ? contentWindow.contentRevision : 0
  if (eventRevision < windowRevision) return contentWindow

  const effectiveFreshness = {
    contentCount: freshness?.contentCount ?? contentWindow.totalCount,
    contentRevision: eventRevision,
    eventSequence: getMonitorLiveDeltaSequence(event) ?? freshness?.eventSequence ?? contentWindow.eventSequence
  }
  if (!isRunWindowTailAuthoritative(contentWindow, effectiveFreshness)) return undefined

  // 修改原因：后端不再为每个 SubAgent llm_delta 附带完整 snapshot，否则大输出会造成 postMessage 与事件数组 O(n²) 膨胀。
  // 修改方式：当事件仍携带轻量可渲染 delta 且窗口已确认是同 revision 尾部时，Monitor 前端用共享 Content[] delta reducer 本地更新已加载 run。
  // 修改目的：兼容旧协议实时输出，同时新瘦身协议不会把大正文塞进 event。
  const timestamp = event.timestamp || Date.now()
  const nextContents = applyStreamChunkToContents(contentWindow.contents || [], event.payload, timestamp, contentWindow.startIndex || 0)
  const sequence = getMonitorLiveDeltaSequence(event)
  return {
    ...contentWindow,
    contents: nextContents,
    endIndex: Math.max(contentWindow.endIndex, contentWindow.startIndex + nextContents.length),
    totalCount: Math.max(contentWindow.totalCount, contentWindow.startIndex + nextContents.length),
    contentRevision: eventRevision,
    eventSequence: Math.max(contentWindow.eventSequence || 0, sequence ?? freshness?.eventSequence ?? 0)
  }
}

function replayBufferedLiveDeltas(runId: string) {
  const currentWindow = windowsByRunId.value[runId]
  const currentBuffer = liveDeltaBuffersByRunId.get(runId)
  if (!currentWindow || !currentBuffer?.length) return

  const { replayable, remaining } = selectReplayableMonitorLiveDeltas(currentBuffer, currentWindow)
  if (replayable.length === 0) {
    setLiveDeltaBuffer(runId, remaining)
    return
  }

  let workingWindow = currentWindow
  const stillBlocked: MonitorLiveDeltaEvent[] = []
  for (const event of replayable) {
    const nextWindow = applyLiveDeltaToWindow(event, workingWindow, {
      contentCount: workingWindow.totalCount,
      contentRevision: getMonitorLiveDeltaRevision(event),
      eventSequence: getMonitorLiveDeltaSequence(event) ?? workingWindow.eventSequence
    })
    if (!nextWindow) {
      stillBlocked.push(event)
      continue
    }
    workingWindow = nextWindow
  }

  windowsByRunId.value = {
    ...windowsByRunId.value,
    [runId]: workingWindow
  }
  setLiveDeltaBuffer(runId, [...stillBlocked, ...remaining])
}

function applyLiveDeltaEvent(event: SubAgentRunEvent) {
  if (event.type !== 'llm_delta' || !event.runId) return

  const timestamp = event.timestamp || Date.now()
  const existingWindow = windowsByRunId.value[event.runId]
  const existingManifest = manifests.value.find(item => item.runId === event.runId)
  upsertManifest({
    runId: event.runId,
    agentName: event.agentName || existingManifest?.agentName,
    status: existingManifest?.status || 'running',
    createdAt: existingManifest?.createdAt || timestamp,
    updatedAt: timestamp,
    conversationId: existingManifest?.conversationId,
    contentCount: event.payload?.contentCount || existingManifest?.contentCount || existingWindow?.totalCount || 0,
    eventCount: existingManifest?.eventCount || 0,
    contentRevision: event.contentRevision ?? event.payload?.contentRevision ?? existingManifest?.contentRevision ?? existingWindow?.contentRevision,
    eventSequence: event.eventSequence ?? event.payload?.eventSequence ?? existingManifest?.eventSequence ?? existingWindow?.eventSequence,
    preview: existingManifest?.preview,
    lastMessageRole: existingManifest?.lastMessageRole
  })

  if (!hasRenderableMonitorLiveDelta(event)) {
    // 修改原因：Monitor 后端事件瘦身后，llm_delta 可能只携带 deltaCount/done 等状态计数，不再包含正文 delta。
    // 修改方式：没有可渲染正文时只更新 manifest，不调用 Content[] reducer 创建空 model 楼层。
    // 目的：遵守“正文走 window”原则，同时避免状态事件污染当前 transcript window。
    return
  }

  if (!existingWindow) {
    const isFocusedLiveRun = event.runId === focusedRunId.value || event.runId === focusedManifest.value?.runId
    if (isFocusedLiveRun) {
      // 修改原因：打开 Monitor 的首个 getRunWindow 可能尚未返回；此时直接 return 会永久丢失已经到达的正文或 functionCall delta。
      // 修改方式：只为当前聚焦 run 缓冲可渲染 live delta，并触发一次窗口请求；窗口到达后按 revision/sequence 回放。
      // 目的：仍然避免为所有后台 run 构造 Content[]，但当前查看 run 不再缺字或缺工具卡。
      bufferLiveDeltaEvent(event)
      void requestRunWindow(event.runId, true)
    }
    return
  }

  const latestManifest = manifests.value.find(item => item.runId === event.runId) || existingManifest
  const nextWindow = applyLiveDeltaToWindow(event, existingWindow, latestManifest)
  if (!nextWindow) {
    // 修改原因：可渲染 delta 没有独立 content identity，只能追加到同 revision 的尾部窗口；窗口落后时不能丢弃 delta。
    // 修改方式：先把 delta 放入有界缓冲，再强制拉取权威窗口，等待窗口 revision 匹配后回放。
    // 目的：避免 stale window 混楼，同时修复中途窗口校准导致的实时片段丢失。
    bufferLiveDeltaEvent(event)
    void requestRunWindow(event.runId, true)
    return
  }

  windowsByRunId.value = {
    ...windowsByRunId.value,
    [event.runId]: nextWindow
  }
}

function getFunctionResponseMap(contents: Content[]): Map<string, NonNullable<ContentPart['functionResponse']>> {
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

function deriveToolStatus(result: unknown): ToolUsage['status'] {
  const r = result as any
  if (r?.success === false || r?.error || r?.cancelled || r?.rejected) return 'error'
  if (r?.data && r.data.appliedCount > 0 && r.data.failedCount > 0) return 'warning'
  return 'success'
}

function toRenderableMessages(run: SubAgentRunSnapshot | undefined): Message[] {
  if (!run) return []
  const responseMap = getFunctionResponseMap(run.contents || [])
  const toolOverlay = toolStatusOverlaysByRunId.value[run.runId]
  const contentWindow = windowsByRunId.value[run.runId]
  const isLiveRun = activeRunIds.value.has(run.runId)
    && (run.status === 'running' || run.status === 'paused' || run.status === 'awaiting_monitor_action')

  return (run.contents || [])
    .map((content, windowOffset) => ({ content, windowOffset }))
    .filter(item => item.content.isFunctionResponse !== true)
    .map(({ content, windowOffset }) => {
      // 修改原因：Monitor 现在只加载 transcript window，可见数组下标既不等于完整 Content[] 索引，也可能跳过 functionResponse。
      // 修改方式：优先使用后端 content.index，缺失时用窗口 startIndex + offset 还原真实 contentIndex，并写入 backendIndex。
      // 修改目的：删除/重试时仍传给后端真实 contentIndex，不会误删窗口内相邻消息。
      const contentIndex = typeof content.index === 'number'
        ? content.index
        : (contentWindow?.startIndex || 0) + windowOffset
      const message = contentToMessageEnhanced(content, `${run.runId}_${contentIndex}`)
      message.backendIndex = contentIndex

      // 修改原因：Monitor 复用 MessageItem 但过去没有给活跃尾部 model 消息标记 streaming，导致它不走主窗口同一流式 Markdown 策略。
      // 修改方式：当当前窗口覆盖 transcript 尾部，且 run 仍由后端 active controller 管理时，只把尾部 model 楼层投影为 streaming。
      // 修改目的：SubAgent Monitor 与主聊天共享“活跃尾部消息流式渲染、历史消息完成态渲染”的统一契约。
      if (
        isLiveRun &&
        content.role === 'model' &&
        contentWindow?.hasMoreAfter !== true &&
        contentIndex === Math.max(0, (contentWindow?.totalCount || 0) - 1)
      ) {
        message.streaming = true
      }

      if (message.tools && message.tools.length > 0) {
        message.tools = message.tools.map(tool => {
          const response = responseMap.get(tool.id)
          if (!response) return applyMonitorToolOverlay(tool, toolOverlay)
          const result = response.response as Record<string, unknown>
          return {
            ...applyMonitorToolOverlay(tool, toolOverlay),
            result,
            status: deriveToolStatus(result)
          }
        })
      }

      return message
    })
}

const renderMessages = computed(() => toRenderableMessages(focusedRun.value))
const focusedRunIsActive = computed(() => !!focusedRun.value && activeRunIds.value.has(focusedRun.value.runId))
const focusedWindow = computed(() => focusedRun.value ? windowsByRunId.value[focusedRun.value.runId] : undefined)
const focusedOlderLoading = computed(() => !!focusedRun.value && loadingOlderRunWindows.value.has(focusedRun.value.runId))
const latestRetryEvent = computed(() => {
  const events = focusedRun.value?.events || []
  // 修改原因：SubAgent 自动重试状态已通过 runEventBus 路由到 Monitor，需要在聊天视图顶部给用户可见反馈。
  // 修改方式：从当前 run 的事件列表倒序查找 retrying/retrySuccess/retryFailed 最新事件。
  // 修改目的：不把内部重试推到主窗口，同时让 Monitor 能审计自动重试过程。
  return [...events].reverse().find(event => event.type === 'retrying' || event.type === 'retrySuccess' || event.type === 'retryFailed')
})

function formatTime(ms?: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString()
}

function selectRun(runId: string) {
  // 修改原因：用户在 Monitor 内点击 run tab 是显式选择，后续 run 事件不应再用旧 focusRunId 覆盖它。
  // 修改方式：除更新 focusedRunId 外，同步标记 hasUserSelectedRun，并在缺少窗口时按需拉取。
  // 修改目的：并发多个 SubAgent 时，用户可以稳定查看任意一个 run，且只为实际查看的 run 加载 Content[]。
  hasUserSelectedRun.value = true
  focusedRunId.value = runId
  void requestRunWindow(runId)
}

function updateActiveRunIds(raw: unknown) {
  // 修改原因：activeRunIds 来自后端运行控制器，是判断顶部控制按钮是否可用的权威来源。
  // 修改方式：只接受字符串数组并转换为 Set，非法载荷回退为空集合。
  // 修改目的：避免前端根据历史状态猜测可控制性。
  activeRunIds.value = new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [])
}

async function controlFocusedRun(action: 'pause' | 'resume' | 'exit') {
  const run = focusedRun.value
  if (!run || !focusedRunIsActive.value) return
  const type = action === 'pause'
    ? 'subagents.pauseRun'
    : action === 'resume'
      ? 'subagents.resumeRun'
      : 'subagents.exitRun'

  // 修改原因：Monitor 顶部按钮要控制当前活跃 run，而不是改前端本地状态。
  // 修改方式：把 pause/resume/exit 意图发送给后端 runController handler，等待事件总线回推新状态。
  // 修改目的：保持后端为控制语义的 source of truth，避免主工具 Promise 与 UI 状态不一致。
  await sendToExtension(type, {
    runId: run.runId,
    reason: action === 'exit' ? '用户主动终止 SubAgent 执行' : undefined
  })
}

function pauseFocusedRun() {
  void controlFocusedRun('pause')
}

function resumeFocusedRun() {
  void controlFocusedRun('resume')
}

function exitFocusedRun() {
  void controlFocusedRun('exit')
}

function findContentIndexByMessageId(messageId: string): number | null {
  const message = renderMessages.value.find(item => item.id === messageId)
  return typeof message?.backendIndex === 'number' ? message.backendIndex : null
}

async function handleCopy(content: string) {
  // 修改原因：Monitor 复用 MessageItem 的复制按钮，但没有主窗口 MessageList 的上层 copy handler。
  // 修改方式：在 Monitor 内部直接调用 Clipboard API。
  // 修改目的：让子聊天窗口每一楼的复制按钮和主窗口一样可用，同时不依赖主聊天 store。
  if (!content) return
  await navigator.clipboard?.writeText(content)
}

async function mutateRunMessage(messageId: string, messageType: 'delete' | 'retry') {
  const run = focusedRun.value
  const contentIndex = findContentIndexByMessageId(messageId)
  if (!run || contentIndex === null) return

  // 修改原因：Monitor 的删除/重试只应该改 SubAgent 子对话，不影响主聊天历史。
  // 修改方式：向后端发送 runId、真实 contentIndex 和 conversationId，由后端基于 TranscriptMutation 更新 subAgentRuns 子记录。
  // 修改目的：保持子对话持久化记录为 source of truth，并复用后端配对删除规则。
  const type = messageType === 'delete' ? 'subagents.deleteRunMessage' : 'subagents.retryRunFromMessage'
  const response = await sendToExtension<{
    manifest?: SubAgentRunManifest
    window?: SubAgentRunContentWindow
    contentWindow?: SubAgentRunContentWindow
    snapshot?: SubAgentRunSnapshot
  }>(type, {
    runId: run.runId,
    contentIndex,
    conversationId: run.conversationId
  })
  if (response?.manifest) upsertManifest(response.manifest)
  const returnedWindow = response?.window || response?.contentWindow
  if (returnedWindow) {
    // 修改原因：删除/重试后端响应已改为 manifest + window，不能再把完整 snapshot.contents 回传到 Monitor。
    // 修改方式：用后端返回的权威窗口替换当前 run 缓存；窗口内 Content[] 仍交给 MessageItem 渲染。
    // 修改目的：用户操作后校准当前 run，但大 run 不会因单次 mutation 全量进入前端。
    upsertWindow(returnedWindow)
  }
  if (response?.snapshot) {
    // 修改原因：保留旧协议兼容只用于防御旧扩展/测试夹层，新增后端不应再走这里。
    // 修改方式：只在没有 window 时从 snapshot 投影为窗口，避免新协议回退依赖 full snapshot。
    // 修改目的：不破坏运行中的旧消息，同时让测试锁定新 handler 不返回 snapshot。
    upsertManifest({
      runId: response.snapshot.runId,
      agentName: response.snapshot.agentName,
      status: response.snapshot.status,
      createdAt: response.snapshot.createdAt,
      updatedAt: response.snapshot.updatedAt,
      conversationId: response.snapshot.conversationId,
      contentCount: response.snapshot.contents.length,
      eventCount: response.snapshot.events.length,
      contentRevision: response.snapshot.contentRevision,
      eventSequence: response.snapshot.eventSequence,
      preview: response.snapshot.contents[response.snapshot.contents.length - 1]?.parts?.find(part => part.text)?.text?.slice(0, 160),
      lastMessageRole: response.snapshot.contents[response.snapshot.contents.length - 1]?.role
    })
    if (!returnedWindow) {
      upsertWindow({
        runId: response.snapshot.runId,
        contents: response.snapshot.contents,
        startIndex: 0,
        endIndex: response.snapshot.contents.length,
        totalCount: response.snapshot.contents.length,
        contentRevision: response.snapshot.contentRevision,
        eventSequence: response.snapshot.eventSequence,
        hasMoreBefore: false,
        hasMoreAfter: false
      })
    }
    eventsByRunId.value = { ...eventsByRunId.value, [response.snapshot.runId]: response.snapshot.events || [] }
  }
}

function handleDelete(messageId: string) {
  void mutateRunMessage(messageId, 'delete')
}

function handleRetry(messageId: string) {
  void mutateRunMessage(messageId, 'retry')
}

function noop() {
  // 修改原因：Monitor 当前阶段仍不支持编辑或回档编辑，避免误改主聊天历史或检查点。
  // 修改方式：仅保留 edit/restore edit/restore retry 的空处理，删除、复制、重试已接入子对话专用 handler。
  // 修改目的：逐步复用主窗口消息操作，同时不引入未设计好的编辑语义。
}

watch(
  () => focusedManifest.value?.runId,
  runId => {
    if (runId) void requestRunWindow(runId)
  }
)

onMounted(async () => {
  // 修改原因：Monitor 应渲染 SubAgent 子对话 Content[]，但不应在首屏拉取所有 run 的完整 transcript。
  // 修改方式：挂载后请求轻量 manifests，并订阅后续 manifest/event；聚焦 run 再请求窗口。
  // 修改目的：像主聊天窗口一样展示消息语义，同时避免大输出 Monitor 打开卡顿。
  disposeMessageListener = onMessageFromExtension((message: any) => {
    if (message.type === 'subagentMonitor.heartbeat') {
      markHeartbeat(message.data)
    }
    if (message.type === 'subagentMonitor.event') {
      markHeartbeat({ serverTime: Date.now(), activeRunIds: message.data?.activeRunIds })
      if (message.data?.manifest) upsertManifest(message.data.manifest)
      if (shouldApplyEventFocus({
        currentFocusRunId: focusedRunId.value,
        incomingFocusRunId: message.data?.focusRunId,
        hasUserSelectedRun: hasUserSelectedRun.value
      })) {
        // 修改原因：实时事件携带的 focusRunId 是用户从主界面打开详情时的导航意图，delta 处理前需要先知道当前聚焦 run。
        // 修改方式：把焦点同步提前到 event 应用之前，后续无窗口 delta 才能进入当前 run 的有界缓冲。
        // 修改目的：修复“刚打开 Monitor 时首批 delta 被当成后台 run 丢弃”的时序漏洞。
        focusedRunId.value = message.data.focusRunId
      }
      if (message.data?.event) {
        detectEventGap(message.data.event)
        appendEvent(message.data.event)
        applyLiveDeltaEvent(message.data.event)
        if (message.data.event.type === 'content_snapshot') {
          clearSupersededLiveDeltaBuffer(
            message.data.event.runId,
            message.data.event.contentRevision ?? message.data.event.payload?.contentRevision
          )
        }
        if (message.data.event.type !== 'llm_delta' && message.data.event.runId === focusedRun.value?.runId) {
          // 修改原因：content_snapshot/run_completed 等低频事件代表后端真源可能已校准，当前聚焦窗口需要刷新但不能接收完整 snapshot。
          // 修改方式：只对当前聚焦 run 强制重新拉取窗口；非聚焦 run 等用户切换时再拉。
          // 修改目的：保证当前可见内容最终一致，同时避免后台 run 大 transcript 进入前端。
          void requestRunWindow(message.data.event.runId, true)
        }
      }
      updateActiveRunIds(message.data?.activeRunIds)
    }
    if (message.type === 'subagentMonitor.manifest') {
      applyManifestPayload(message.data)
    }
  })

  heartbeatTimer = setInterval(() => {
    heartbeatTick.value = Date.now()
  }, 1000)

  const initial = await sendToExtension<{ manifests: SubAgentRunManifest[]; focusRunId?: string; activeRunIds?: string[] }>('subagents.monitorReady', {})
  markHeartbeat({ serverTime: Date.now(), activeRunIds: initial?.activeRunIds })
  applyManifestPayload(initial)
  const initialFocus = initial?.focusRunId || focusedManifest.value?.runId
  if (initialFocus) {
    focusedRunId.value = initialFocus
    await requestRunWindow(initialFocus)
  }
})

onBeforeUnmount(() => {
  disposeMessageListener?.()
  if (heartbeatTimer) clearInterval(heartbeatTimer)
})
</script>


<template>
  <div class="monitor-root">
    <header class="monitor-header">
      <div>
        <h1>SubAgent Monitor</h1>
        <p>以聊天窗口形式展示 SubAgent 的 System、Context、Prompt、AI 输出、思维过程和工具调用。</p>
      </div>
      <div class="monitor-header-actions">
        <span class="freshness-indicator" :class="`freshness-indicator--${monitorConnectionState}`">
          <i class="codicon" :class="monitorConnectionState === 'live' ? 'codicon-radio-tower' : monitorConnectionState === 'syncing' ? 'codicon-sync codicon-modifier-spin' : 'codicon-warning'"></i>
          {{ freshnessLabel }}
        </span>
        <span class="freshness-description">{{ freshnessDescription }}</span>
        <button class="control-btn" type="button" @click="resetFocusedView">
          <span class="codicon codicon-refresh"></span>
          原地重置视图
        </button>
        <span class="run-count">{{ orderedRuns.length }} runs</span>
      </div>
    </header>

    <div v-if="orderedRuns.length > 1" class="run-tabs">
      <button
        v-for="run in orderedRuns"
        :key="run.runId"
        class="run-tab"
        :class="{ active: focusedRun?.runId === run.runId }"
        type="button"
        @click="selectRun(run.runId)"
      >
        <span class="run-name">{{ run.agentName || 'Sub-Agent' }}</span>
        <span class="run-meta">{{ run.status }} · {{ formatTime(run.updatedAt) }}</span>
      </button>
    </div>

    <CustomScrollbar class="message-scroll" :max-height="'calc(100vh - 96px)'">
      <div v-if="!focusedRun" class="empty">
        <i class="codicon codicon-hubot"></i>
        <span>暂无 SubAgent 子对话记录。</span>
      </div>

      <div v-else class="message-shell">
        <div class="run-title-row">
          <div>
            <div class="run-title">{{ focusedRun.agentName || 'Sub-Agent' }}</div>
            <div class="run-subtitle">{{ focusedRun.runId }} · {{ focusedRun.status }} · {{ formatTime(focusedRun.updatedAt) }}</div>
            <div v-if="focusedWindow?.hasMoreBefore" class="run-window-note">
              <!--
                修改原因：当前窗口可能由多次向前分页拼接而来，文案不能继续暗示只显示“最近”尾部。
                修改方式：按当前窗口实际 contents.length / totalCount 展示已加载数量，顶部按钮负责继续加载更早。
                修改目的：让用户知道还有历史可取，同时不为首屏恢复全量加载。
              -->
              已加载 {{ focusedWindow.contents.length }} / {{ focusedWindow.totalCount }} 条记录
            </div>
            <div v-if="latestRetryEvent" class="run-retry-status" :class="`retry-${latestRetryEvent.type}`">
              <span class="codicon" :class="latestRetryEvent.type === 'retrying' ? 'codicon-sync codicon-modifier-spin' : latestRetryEvent.type === 'retrySuccess' ? 'codicon-check' : 'codicon-warning'"></span>
              <span>
                {{ latestRetryEvent.type === 'retrying'
                  ? `自动重试 ${latestRetryEvent.payload?.attempt ?? ''}/${latestRetryEvent.payload?.maxAttempts ?? ''}`
                  : latestRetryEvent.type === 'retrySuccess'
                    ? '自动重试成功'
                    : `自动重试失败：${latestRetryEvent.payload?.error || ''}` }}
              </span>
            </div>
          </div>
          <div v-if="focusedRunIsActive" class="run-control-buttons">
            <!--
              修改原因：活跃 SubAgent run 需要能从 Monitor 顶部暂停、继续或退出。
              修改方式：按钮只在 activeRunIds 包含当前 run 时显示，并把操作发送给后端 runController。
              修改目的：历史 run 只可查看，活跃 run 才能影响主窗口工具调用。
            -->
            <button v-if="focusedRun.status === 'running'" class="control-btn" type="button" @click="pauseFocusedRun">
              <span class="codicon codicon-debug-pause"></span>
              中止
            </button>
            <button v-if="focusedRun.status === 'paused' || focusedRun.status === 'awaiting_monitor_action'" class="control-btn primary" type="button" @click="resumeFocusedRun">
              <span class="codicon codicon-debug-continue"></span>
              重试
            </button>
            <button class="control-btn danger" type="button" @click="exitFocusedRun">
              <span class="codicon codicon-debug-stop"></span>
              退出并让主工具失败
            </button>
          </div>
        </div>

        <div v-if="focusedWindow?.hasMoreBefore" class="load-older-row">
          <!--
            修改原因：默认只加载尾部 20 条时，用户需要可控地向前补齐历史，而不是误以为早期内容丢失。
            修改方式：按钮调用同一个 getRunWindow 协议，以当前 window.startIndex 为 endIndex 拉取上一页并 prepend。
            修改目的：继续保持 manifest/window 按需加载，不回退到一次性完整 snapshot。
          -->
          <button class="load-older-btn" type="button" :disabled="focusedOlderLoading" @click="loadOlderMessages">
            <span v-if="focusedOlderLoading" class="codicon codicon-sync codicon-modifier-spin"></span>
            <span v-else class="codicon codicon-arrow-up"></span>
            {{ focusedOlderLoading ? '加载中…' : '加载更早消息' }}
          </button>
        </div>

        <MessageItem
          v-for="(message, index) in renderMessages"
          :key="message.id"
          :message="message"
          :message-index="message.backendIndex ?? index"
          @edit="noop"
          @restore-and-edit="noop"
          @delete="handleDelete"
          @retry="handleRetry"
          @restore-and-retry="noop"
          @copy="handleCopy"
        />
      </div>
    </CustomScrollbar>
  </div>
</template>

<style scoped>
.monitor-root {
  height: 100vh;
  box-sizing: border-box;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  display: flex;
  flex-direction: column;
}

.monitor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.monitor-header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.monitor-header p {
  margin: 4px 0 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.monitor-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.run-count,
.freshness-indicator {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 11px;
  white-space: nowrap;
}

.freshness-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
}

.freshness-indicator--stale,
.freshness-indicator--gap,
.freshness-indicator--degraded,
.freshness-indicator--disconnected {
  border-color: var(--vscode-editorWarning-foreground);
  background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 14%, var(--vscode-editorWidget-background));
  color: var(--vscode-foreground);
}

.freshness-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

.run-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  overflow-x: auto;
}

.run-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 180px;
  padding: 6px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 7px;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  cursor: pointer;
}

.run-tab.active {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-activeSelectionBackground);
}

.run-name {
  font-size: 12px;
  font-weight: 600;
}

.run-meta,
.run-subtitle {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}

.run-window-note {
  /* 修改原因：Monitor 默认只拉尾部窗口时，用户需要知道当前不是完整 transcript。
     修改方式：使用与 subtitle 一致的弱提示样式，避免抢占主状态信息。
     修改目的：优化可理解性，同时保持按需加载性能边界。 */
  margin-top: 3px;
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
}

.run-retry-status {
  /* 修改原因：Monitor 需要展示 SubAgent 内部自动重试状态，但不能像主窗口一样弹全局 retry 提示。
     修改方式：在 run 标题区添加紧凑状态行，并按 retry 类型调整颜色。
     修改目的：让内部 API 抖动和恢复过程在 Monitor 中可审计。 */
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.run-retry-status.retry-retrySuccess {
  color: var(--vscode-testing-iconPassed);
}

.run-retry-status.retry-retryFailed {
  color: var(--vscode-testing-iconFailed);
}

.load-older-row {
  /* 修改原因：历史分页入口属于消息列表的一部分，应该出现在当前窗口顶部而不是标题区。
     修改方式：居中放置小按钮，并与消息楼层保持同样的横向留白。
     修改目的：用户向上阅读时自然发现“加载更早”，同时不影响 run 控制按钮。 */
  display: flex;
  justify-content: center;
  padding: 10px 16px 4px;
}

.load-older-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 999px;
  background: var(--vscode-sideBar-background);
  color: var(--vscode-foreground);
  font-size: 11px;
  cursor: pointer;
}

.load-older-btn:disabled {
  cursor: wait;
  opacity: 0.7;
}

.load-older-btn:not(:disabled):hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.message-scroll {
  flex: 1;
  min-height: 0;
}

.message-shell {
  min-height: 100%;
}

.run-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}

.run-control-buttons {
  /* 修改原因：Monitor 顶部控制按钮需要醒目但仍保持 VS Code 工具栏风格。
     修改方式：使用紧凑 inline-flex 按钮组，并通过 primary/danger 变体区分继续和退出。
     修改目的：避免误触“退出并让主工具失败”，同时不引入与主窗口不一致的视觉组件。 */
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-foreground);
  font-size: 11px;
  cursor: pointer;
}

.control-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.control-btn.primary {
  border-color: var(--vscode-button-background);
}

.control-btn.danger {
  border-color: var(--vscode-errorForeground);
  color: var(--vscode-errorForeground);
}

.run-title {
  font-size: 13px;
  font-weight: 700;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 260px;
  color: var(--vscode-descriptionForeground);
}
</style>
