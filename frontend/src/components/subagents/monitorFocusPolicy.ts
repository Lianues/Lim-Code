export interface SubAgentMonitorEventFocusInput {
  currentFocusRunId?: string
  incomingFocusRunId?: string
  hasUserSelectedRun: boolean
}

/**
 * 判断实时 run 事件是否可以改写 Monitor 当前焦点。
 *
 * 修改原因：后端每条 subagentMonitor.event 都会附带打开面板时的 focusRunId，并发 SubAgent 高频事件会反复把前端焦点拉回旧 run，用户点击其他 run 后看起来“卡死”。
 * 修改方式：实时事件只在用户尚未主动选择 run 时应用后端焦点；用户点击 tab 后，只有 snapshot/monitorReady 这类显式导航事件才允许覆盖。
 * 修改目的：保留从主聊天“打开详情”时的自动定位，同时允许用户在 Monitor 中自由切换并发 run。
 */
export function shouldApplyEventFocus(input: SubAgentMonitorEventFocusInput): boolean {
  const incoming = input.incomingFocusRunId?.trim()
  if (!incoming) return false
  if (input.hasUserSelectedRun) return false
  return incoming !== input.currentFocusRunId
}
