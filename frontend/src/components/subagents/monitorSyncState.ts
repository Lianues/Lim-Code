export type MonitorConnectionState = 'syncing' | 'live' | 'stale' | 'gap' | 'degraded' | 'disconnected'

export interface MonitorSyncStateInput {
  hasFocusedRun: boolean
  hasWindow: boolean
  isLoadingWindow: boolean
  isResyncing: boolean
  hasRenderableMessages: boolean
  hasGap: boolean
  error?: string
  lastHeartbeatAt: number
  now: number
}

export interface MonitorSyncState {
  transportHealth: MonitorConnectionState
  contentHealth: 'not_loaded' | 'loading' | 'fresh' | 'resyncing' | 'gap' | 'degraded' | 'empty'
  headerState: MonitorConnectionState
  label: string
  description: string
  waitingMessage?: string
}

export function deriveMonitorSyncState(input: MonitorSyncStateInput): MonitorSyncState {
  /**
   * 修改原因：Bug 3 证明旧 Monitor 只用 heartbeat 推导 Live，会在内容冻结或 reset 空白时误导用户。
   * 修改方式：把 transport heartbeat 与 focused run 内容窗口健康度分开，再联合派生 header label 和等待态。
   * 修改目的：Live 只在 transport 与内容都健康时出现；resync/replay/loading/error 都能被 UI 明确展示。
   */
  const age = input.lastHeartbeatAt ? input.now - input.lastHeartbeatAt : Number.POSITIVE_INFINITY
  const transportHealth: MonitorConnectionState = !input.lastHeartbeatAt
    ? 'syncing'
    : age > 15000
      ? 'disconnected'
      : age > 8000
        ? 'stale'
        : 'live'

  let contentHealth: MonitorSyncState['contentHealth'] = 'empty'
  let waitingMessage: string | undefined

  if (!input.hasFocusedRun) {
    contentHealth = 'empty'
  } else if (input.error) {
    contentHealth = 'degraded'
    waitingMessage = input.error
  } else if (input.hasGap) {
    contentHealth = 'gap'
    waitingMessage = '检测到事件缺口，正在重新同步 Monitor 内容…'
  } else if (input.isResyncing) {
    contentHealth = 'resyncing'
    waitingMessage = '正在原地重新同步视图，旧内容会保留到新窗口成功返回。'
  } else if (input.isLoadingWindow || !input.hasWindow) {
    contentHealth = 'loading'
    waitingMessage = '正在加载 SubAgent 对话窗口…'
  } else if (!input.hasRenderableMessages) {
    contentHealth = 'not_loaded'
    waitingMessage = '等待上游 LLM 返回首个可展示内容…'
  } else {
    contentHealth = 'fresh'
  }

  const headerState: MonitorConnectionState = transportHealth === 'disconnected' || transportHealth === 'stale'
    ? transportHealth
    : contentHealth === 'degraded'
      ? 'degraded'
      : contentHealth === 'gap'
        ? 'gap'
        : contentHealth === 'fresh'
          ? 'live'
          : 'syncing'

  const label = headerState === 'live'
    ? 'Live'
    : headerState === 'gap'
      ? 'Gap recovering'
      : headerState === 'degraded'
        ? 'Degraded'
        : headerState === 'stale'
          ? 'Stale'
          : headerState === 'disconnected'
            ? 'Disconnected'
            : 'Syncing content'

  const heartbeatDescription = input.lastHeartbeatAt
    ? `Last heartbeat ${Math.max(0, Math.round(age / 1000))}s ago.`
    : 'Waiting for monitor heartbeat.'

  return {
    transportHealth,
    contentHealth,
    headerState,
    label,
    description: waitingMessage ? `${heartbeatDescription} ${waitingMessage}` : heartbeatDescription,
    waitingMessage
  }
}
