import type { ToolUsage } from '../../types'

const LIVE_ARGUMENT_PREVIEW_STATUSES = new Set<ToolUsage['status']>([
  'streaming',
  'queued',
  'executing',
  'awaiting_approval'
])

/**
 * 判断工具是否仍应展示流式参数预览。
 *
 * 修改原因：流式提前执行让工具在参数最终快照落地前就进入 executing；旧逻辑把预览绑定到 status=streaming，导致工具刚开始执行时原始参数预览消失。
 * 修改方式：把“是否展示 partialArgs”从单一状态字段中拆出来，只要工具仍处于非终态并带有 partialArgs，就继续展示预览。
 * 修改目的：修复流式提前执行中的卡片预览消失，同时为后续把输入态和执行态拆成两个字段留下清晰边界。
 */
export function shouldShowToolArgumentPreview(tool: ToolUsage): boolean {
  return LIVE_ARGUMENT_PREVIEW_STATUSES.has(tool.status) && !!tool.partialArgs && tool.partialArgs.length > 0
}
