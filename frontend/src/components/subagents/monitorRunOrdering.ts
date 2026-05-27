export interface MonitorRunOrderingInput {
  runId: string
  createdAt: number
}

/**
 * SubAgent Monitor 的 Run tab 使用创建时间排序，而不是更新时间排序。
 *
 * 修改原因：流式执行时每个 llm_delta 都会刷新 run.updatedAt；如果按 updatedAt 排序，并发 run 会在每个 token 或工具事件到来时互相抢第一位，视觉上形成“跑马灯”。
 * 修改方式：按 createdAt 降序排序，创建时间相同再按 runId 稳定排序。
 * 修改目的：新 run 仍出现在前面，但活跃 run 的高频输出不会导致 tab 顺序抖动。
 */
export function compareMonitorRunsByStableCreationOrder(
  a: MonitorRunOrderingInput,
  b: MonitorRunOrderingInput
): number {
  const createdDelta = (b.createdAt || 0) - (a.createdAt || 0)
  if (createdDelta !== 0) return createdDelta
  return a.runId.localeCompare(b.runId)
}
