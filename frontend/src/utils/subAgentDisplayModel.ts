export interface SubAgentRunDisplayModel {
  title: string
  agentName: string
  taskSummary: string
  preview: string
  promptDebug?: string
  contextDebug?: string
  status: 'running' | 'success' | 'error'
  runId?: string
  chips: string[]
  footerRight: string
}

export function summarizeSubAgentTask(prompt: string, maxChars = 160): string {
  /**
   * 修改原因：最终对抗复核指出“截取 prompt 第一行”仍然属于 raw prompt 泄漏，只是把泄漏缩短了。
   * 修改方式：主卡片只展示任务输入已接收和长度级别，不从 prompt 文本内容派生摘要；完整 prompt 只能进入调试折叠区。
   * 修改目的：彻底切断 ToolMessage 描述行、SubAgent subtitle/preview 与 raw prompt 内容的直接路径。
   */
  const length = typeof prompt === 'string' ? prompt.trim().length : 0
  if (!length) return '等待 SubAgent 任务输入…'
  const boundedLength = Math.min(length, Math.max(1, maxChars) * 100)
  return `已接收 SubAgent 任务输入（约 ${boundedLength} 字符），可在调试折叠区查看原始内容。`
}

export function buildSubAgentRunDisplayModel(options: {
  args: Record<string, unknown>
  result?: Record<string, unknown>
  runtimeBadge?: string
}): SubAgentRunDisplayModel {
  /**
   * 修改原因：SubAgent 工具卡过去直接由 args/result 现场拼 UI，running 时只能 fallback 到 prompt，success 后才像正式卡片。
   * 修改方式：集中派生 SubAgentRunDisplayModel，让三种状态共享 title、taskSummary、preview、chips、footer 字段。
   * 修改目的：Monitor 和主窗口都能以稳定字段渲染 SubAgent 卡片，不再把 raw prompt 当主卡片内容。
   */
  const resultData = ((options.result as any)?.data || {}) as any
  const prompt = typeof options.args.prompt === 'string' ? options.args.prompt : ''
  const context = typeof options.args.context === 'string' ? options.args.context : ''
  const agentName = (typeof options.args.agentName === 'string' && options.args.agentName) || resultData.agentName || 'Sub-Agent'
  const responseText = String(resultData.response || resultData.partialResponse || '')
  const errorMessage = typeof (options.result as any)?.error === 'string' ? (options.result as any).error : ''
  const taskSummary = summarizeSubAgentTask(prompt)
  const status: SubAgentRunDisplayModel['status'] = !options.result ? 'running' : (options.result as any).success === true ? 'success' : 'error'
  const chips: string[] = []
  if (typeof resultData.steps === 'number') chips.push(`Steps: ${resultData.steps}`)
  if (status === 'running') chips.push('Running')

  return {
    title: `Sub-Agent · ${agentName}`,
    agentName,
    taskSummary,
    preview: responseText || errorMessage || (status === 'running' ? 'SubAgent 正在执行，输出将在此处持续更新。' : taskSummary),
    promptDebug: prompt,
    contextDebug: context,
    status,
    runId: resultData.runId as string | undefined,
    chips,
    footerRight: options.runtimeBadge || ''
  }
}
