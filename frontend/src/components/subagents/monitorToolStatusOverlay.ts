import type { ToolUsage } from '../../types'

export type MonitorToolStatusOverlay = Record<string, ToolUsage>

interface MonitorToolEventLike {
  runId?: string
  type?: string
  toolId?: string
  toolName?: string
  payload?: any
}

function deriveOverlayStatus(event: MonitorToolEventLike): ToolUsage['status'] | undefined {
  // 修改原因：SubAgent Monitor 的工具事件来自后端 runEventBus，不能继续只等 functionResponse 才更新工具卡。
  // 修改方式：把 tool_started/tool_progress/tool_completed/tool_failed 映射成与主聊天 ToolUsage 兼容的状态。
  // 修改目的：让工具卡实时推进到 executing/success/error，窗口刷新丢失时也不会卡在 queued/streaming。
  if (event.type === 'tool_started') return 'executing'
  if (event.type === 'tool_completed') return 'success'
  if (event.type === 'tool_failed') return 'error'
  if (event.type === 'tool_progress') {
    const status = event.payload?.status
    if (status === 'awaiting_approval' || status === 'awaiting_apply' || status === 'executing') return status
    return 'executing'
  }
  return undefined
}

export function reduceMonitorToolStatusOverlay(
  current: MonitorToolStatusOverlay,
  event: MonitorToolEventLike
): MonitorToolStatusOverlay {
  const status = deriveOverlayStatus(event)
  const toolId = typeof event.toolId === 'string' && event.toolId.trim() ? event.toolId.trim() : ''
  if (!status || !toolId) return current

  const previous = current[toolId]
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : undefined
  const next: ToolUsage = {
    ...previous,
    id: toolId,
    name: event.toolName || previous?.name || payload?.name || '',
    args: payload?.args ?? previous?.args,
    status,
    error: status === 'error' ? (payload?.error || previous?.error) : previous?.error,
    duration: typeof payload?.duration === 'number' ? payload.duration : previous?.duration
  }

  // 修改原因：overlay 是 run 级不可变状态，直接原地改对象会让 Vue 组件和单测难以判断更新边界。
  // 修改方式：每次工具事件返回带目标 toolId 新对象的新 overlay map。
  // 修改目的：保持工具状态 reducer 纯函数化，为后续接入统一 AgentRunEvent reducer 留出平滑路径。
  return {
    ...current,
    [toolId]: next
  }
}

export function applyMonitorToolOverlay(tool: ToolUsage, overlay: MonitorToolStatusOverlay | undefined): ToolUsage {
  const patch = overlay?.[tool.id]
  if (!patch) return tool
  // 修改原因：functionCall 解析出的 ToolUsage 仍是工具卡结构真源，overlay 只负责运行态字段。
  // 修改方式：保留工具 name/args/partialArgs 等展示字段，只覆盖 status/error/duration/result 等状态字段。
  // 修改目的：避免工具事件携带的瘦身 payload 覆盖已解析好的参数，同时让状态实时更新。
  return {
    ...tool,
    status: patch.status ?? tool.status,
    error: patch.error ?? tool.error,
    duration: patch.duration ?? tool.duration,
    result: patch.result ?? tool.result
  }
}
