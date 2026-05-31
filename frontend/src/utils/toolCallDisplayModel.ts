import type { ToolUsage } from '../types'
import type { ToolConfig } from './toolRegistry'
import { hasNonEmptyArgs } from './functionCallMerge'

export type ToolInputState =
  | { status: 'empty_placeholder' }
  | { status: 'input_streaming'; partialArgs: string; parseableArgs?: Record<string, unknown> }
  | { status: 'input_available'; args: Record<string, unknown>; source: 'args_snapshot' | 'parsed_partial' | 'tool_result' }
  | { status: 'input_incomplete'; partialArgs?: string; reason: 'parse_error' | 'stream_done_without_args' }
  | { status: 'input_unknown'; reason: string }

export type ToolExecutionState =
  | { status: 'not_started' }
  | { status: 'queued' }
  | { status: 'awaiting_approval' }
  | { status: 'executing' }
  | { status: 'awaiting_apply' }
  | { status: 'success'; result?: Record<string, unknown>; duration?: number }
  | { status: 'error'; error?: string; duration?: number }
  | { status: 'warning'; result?: Record<string, unknown>; duration?: number }

export type ToolCardDisplayState =
  | 'input_streaming'
  | 'input_ready'
  | 'queued'
  | 'executing'
  | 'awaiting_approval'
  | 'awaiting_apply'
  | 'success'
  | 'error'
  | 'warning'
  | 'input_unknown'

export interface ToolCallState {
  stableKey: string
  toolCallId?: string
  toolName: string
  input: ToolInputState
  execution: ToolExecutionState
}

export interface ToolCardDisplayModel {
  stableKey: string
  toolCallId?: string
  toolName: string
  title: string
  description: string
  displayState: ToolCardDisplayState
  inputState: ToolInputState['status']
  executionState: ToolExecutionState['status']
  statusIcon: 'spinner' | 'clock' | 'shield' | 'check' | 'warning' | 'error' | 'diff' | 'none'
  statusClass: 'status-running' | 'status-pending' | 'status-warning' | 'status-success' | 'status-error' | ''
  displayArgs?: Record<string, unknown>
  partialArgsPreview?: {
    text: string
    appendOnly: boolean
    stableContainerKey: string
  }
  diagnostics?: {
    rawPartialLength?: number
    argsSource?: string
    reason?: string
  }
}

function safeParseArgs(text: string | undefined): Record<string, unknown> | undefined {
  if (!text || !text.trim()) return undefined
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function isTerminalStatus(status: ToolUsage['status'] | undefined): boolean {
  return status === 'success' || status === 'error' || status === 'warning' || status === 'awaiting_apply'
}

export function getToolStableKey(tool: Pick<ToolUsage, 'id' | 'name' | 'itemId' | 'index'>): string {
  /**
   * 修改原因：Bug 7 暴露了流式参数阶段卡片 key 随迟到 call_id 抖动会导致 spinner 动画重置和 hover 闪烁。
   * 修改方式：优先使用 provider 生命周期内更早稳定的 itemId/index，最后才回退最终 id。
   * 修改目的：让参数 streaming、toolStatus 和最终 snapshot 都挂在同一个卡片壳上，避免 DOM 重挂载。
   */
  if (tool.itemId && String(tool.itemId).trim()) return `${tool.name}:item:${tool.itemId}`
  if (typeof tool.index === 'number') return `${tool.name}:index:${tool.index}`
  return `${tool.name}:id:${tool.id}`
}

export function deriveToolCallState(tool: ToolUsage): ToolCallState {
  /**
   * 修改原因：Bug 2/5 证明 ToolUsage.status 同时表达“参数生成”和“工具执行”会产生完成勾选但参数为 ?、参数 JSON 可见但仍显示生成中等矛盾状态。
   * 修改方式：在不破坏旧 ToolUsage 热路径的前提下，派生出独立 ToolInputState 与 ToolExecutionState。
   * 修改目的：让 UI 先消费 LimCode 自有领域状态，再逐步把旧 formatter/overlay 收敛到统一 reducer。
   */
  const parsedPartial = safeParseArgs(tool.partialArgs)
  let input: ToolInputState

  if (hasNonEmptyArgs(tool.args)) {
    input = { status: 'input_available', args: tool.args, source: 'args_snapshot' }
  } else if (parsedPartial && hasNonEmptyArgs(parsedPartial)) {
    input = { status: 'input_available', args: parsedPartial, source: 'parsed_partial' }
  } else if (tool.partialArgs && tool.partialArgs.length > 0 && !isTerminalStatus(tool.status)) {
    input = { status: 'input_streaming', partialArgs: tool.partialArgs }
  } else if (tool.partialArgs && tool.partialArgs.length > 0) {
    input = { status: 'input_incomplete', partialArgs: tool.partialArgs, reason: 'parse_error' }
  } else if (isTerminalStatus(tool.status) || tool.status === 'executing') {
    input = { status: 'input_unknown', reason: '工具执行状态已推进，但参数快照尚未归一化' }
  } else {
    input = { status: 'empty_placeholder' }
  }

  let execution: ToolExecutionState
  switch (tool.status) {
    case 'streaming':
      execution = { status: 'not_started' }
      break
    case 'queued':
      execution = { status: 'queued' }
      break
    case 'awaiting_approval':
      execution = { status: 'awaiting_approval' }
      break
    case 'executing':
      execution = { status: 'executing' }
      break
    case 'awaiting_apply':
      execution = { status: 'awaiting_apply' }
      break
    case 'success':
      execution = { status: 'success', result: tool.result, duration: tool.duration }
      break
    case 'error':
      execution = { status: 'error', error: tool.error, duration: tool.duration }
      break
    case 'warning':
      execution = { status: 'warning', result: tool.result, duration: tool.duration }
      break
    default:
      execution = { status: 'queued' }
  }

  return {
    stableKey: getToolStableKey(tool),
    toolCallId: tool.id,
    toolName: tool.name,
    input,
    execution
  }
}

function formatDescriptionFromArgs(tool: ToolUsage, args: Record<string, unknown>, config?: ToolConfig): string {
  if (config?.descriptionFormatter) {
    try {
      const formatted = config.descriptionFormatter(args)
      return formatted && formatted !== '?' ? formatted : '参数已可用，正在生成可读摘要'
    } catch {
      return '参数已可用，摘要格式化失败'
    }
  }
  return `${Object.keys(args).length} 个参数`
}

function getTitle(tool: ToolUsage, args: Record<string, unknown> | undefined, config?: ToolConfig): string {
  if (args && config?.labelFormatter) {
    try {
      return config.labelFormatter(args)
    } catch {
      // fall through
    }
  }
  return config?.label || tool.name
}

export function buildToolCardDisplayModel(tool: ToolUsage, config?: ToolConfig): ToolCardDisplayModel {
  /**
   * 修改原因：ToolMessage 过去直接把 raw args/partialArgs/result 喂给工具卡，导致 read_file 空参数显示 ?，SubAgent Monitor 参数阶段闪烁。
   * 修改方式：集中把 ToolUsage 投影成 ToolCardDisplayModel，formatter 只在 displayArgs 可用时执行。
   * 修改目的：主窗口和 Monitor 复用同一展示语义，后续新增 provider 或工具时不再复制 UI 兜底。
   */
  const state = deriveToolCallState(tool)
  const displayArgs = state.input.status === 'input_available' ? state.input.args : undefined
  const title = getTitle(tool, displayArgs, config)

  let description: string
  let displayState: ToolCardDisplayState
  let statusIcon: ToolCardDisplayModel['statusIcon'] = 'none'
  let statusClass: ToolCardDisplayModel['statusClass'] = ''
  let partialArgsPreview: ToolCardDisplayModel['partialArgsPreview'] | undefined

  if (state.input.status === 'input_streaming') {
    displayState = 'input_streaming'
    statusIcon = 'spinner'
    statusClass = 'status-running'
    description = '正在解析工具参数…'
    partialArgsPreview = {
      text: `已接收 ${state.input.partialArgs.length} 个字符，等待完整参数快照。`,
      appendOnly: true,
      stableContainerKey: `${state.stableKey}:partial-preview`
    }
  } else if (state.execution.status === 'awaiting_approval') {
    displayState = 'awaiting_approval'
    statusIcon = 'shield'
    statusClass = 'status-warning'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '等待确认执行，参数仍在校准。'
  } else if (state.execution.status === 'executing') {
    displayState = 'executing'
    statusIcon = 'spinner'
    statusClass = 'status-running'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '工具正在执行，参数仍在校准。'
  } else if (state.execution.status === 'awaiting_apply') {
    displayState = 'awaiting_apply'
    statusIcon = 'diff'
    statusClass = 'status-pending'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '等待应用生成的变更。'
  } else if (state.execution.status === 'success') {
    displayState = 'success'
    statusIcon = 'check'
    statusClass = 'status-success'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '执行成功，输入参数快照不可用。'
  } else if (state.execution.status === 'warning') {
    displayState = 'warning'
    statusIcon = 'warning'
    statusClass = 'status-warning'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '执行完成但存在警告，输入参数快照不可用。'
  } else if (state.execution.status === 'error') {
    displayState = 'error'
    statusIcon = 'error'
    statusClass = 'status-error'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '执行失败，输入参数快照不可用。'
  } else if (state.input.status === 'input_unknown' || state.input.status === 'input_incomplete') {
    displayState = 'input_unknown'
    statusIcon = 'warning'
    statusClass = 'status-warning'
    description = state.input.status === 'input_unknown'
      ? '参数快照未归一化，等待权威快照校准。'
      : '参数片段未能解析，等待快照校准。'
  } else if (state.execution.status === 'queued') {
    displayState = displayArgs ? 'queued' : 'input_streaming'
    statusIcon = displayArgs ? 'clock' : 'spinner'
    statusClass = displayArgs ? 'status-pending' : 'status-running'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '等待完整工具参数…'
  } else {
    displayState = displayArgs ? 'input_ready' : 'input_streaming'
    statusIcon = displayArgs ? 'clock' : 'spinner'
    statusClass = displayArgs ? 'status-pending' : 'status-running'
    description = displayArgs ? formatDescriptionFromArgs(tool, displayArgs, config) : '等待工具参数…'
  }

  return {
    stableKey: state.stableKey,
    toolCallId: state.toolCallId,
    toolName: state.toolName,
    title,
    description,
    displayState,
    inputState: state.input.status,
    executionState: state.execution.status,
    statusIcon,
    statusClass,
    displayArgs,
    partialArgsPreview,
    diagnostics: {
      rawPartialLength: tool.partialArgs?.length,
      argsSource: state.input.status === 'input_available' ? state.input.source : undefined,
      reason: state.input.status === 'input_unknown' ? state.input.reason : state.input.status === 'input_incomplete' ? state.input.reason : undefined
    }
  }
}
