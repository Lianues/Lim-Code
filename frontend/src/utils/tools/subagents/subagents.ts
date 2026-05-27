/**
 * subagents 工具注册
 */

import { registerTool } from '../../toolRegistry'
import type { ToolUsage } from '../../../types'
import { t } from '../../../i18n'
import { sendToExtension } from '../../../utils/vscode'
import SubAgentsComponent from '../../../components/tools/subagents/subagents.vue'

function normalizeToolIdForRunId(toolId: string): string {
  // 修改原因：pending 阶段还没有工具 result，但主工具调用 id 已经存在，需要用它预先推导 Monitor runId。
  // 修改方式：前后端都把 toolId 规范化为只包含字母、数字、下划线和连字符的后缀。
  // 修改目的：让 pending 状态的 Open details 能聚焦同一次 SubAgent 运行，而不是退化为打开最新运行。
  return toolId.trim().replace(/[^A-Za-z0-9_-]/g, '_')
}

function getSubAgentRunIdFromToolId(toolId: string | undefined): string {
  const normalized = typeof toolId === 'string' ? normalizeToolIdForRunId(toolId) : ''
  return normalized ? `subagent_run_${normalized}` : ''
}

function getSubAgentResultRunId(result: unknown): string {
  // 修改原因：不同阶段的 subagents 工具结果可能把 runId 放在 data.runId 或直接放在 runId 上。
  // 修改方式：集中兼容两种结构，最终态 action 与历史卡片复用同一解析逻辑。
  // 修改目的：让历史卡片和新卡片都能打开正确 Monitor，不在 ToolMessage.vue 写 subagents 特例。
  const payload = result as any
  const direct = payload?.runId
  const nested = payload?.data?.runId
  return typeof nested === 'string' && nested.trim()
    ? nested.trim()
    : (typeof direct === 'string' && direct.trim() ? direct.trim() : '')
}

function getSubAgentRunId(tool: ToolUsage): string {
  const resultRunId = getSubAgentResultRunId(tool.result)
  if (resultRunId) return resultRunId
  // 修改原因：pending 阶段 tool.result 为空，如果继续只看 result，顶部 Open details 就不会渲染。
  // 修改方式：仅在 result 尚未返回时，从稳定的 tool.id 推导后端即将创建的 runId。
  // 修改目的：执行中和执行后都由同一个按钮打开同一个 SubAgent Monitor 详情。
  return tool.result ? '' : getSubAgentRunIdFromToolId(tool.id)
}

// 注册 subagents 工具
registerTool('subagents', {
  name: 'subagents',
  label: 'Sub-Agent',
  icon: 'codicon-hubot',
  
  // 动态标签 - 显示代理名称
  labelFormatter: (args) => {
    const agentName = args.agentName as string
    return agentName ? `Sub-Agent: ${agentName}` : 'Sub-Agent'
  },
  
  // 描述生成器 - 显示任务提示
  descriptionFormatter: (args) => {
    const prompt = args.prompt as string || ''
    return prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt
  },
  
  // 使用自定义组件显示内容
  contentComponent: SubAgentsComponent,
  actions: [
    {
      id: 'open-subagent-monitor',
      label: () => t('components.message.tool.openDetails'),
      title: () => t('components.message.tool.openSubAgentMonitorDetails'),
      icon: 'codicon-open-preview',
      variant: 'default',
      visible: (tool) => !!getSubAgentRunId(tool),
      async run(tool, context) {
        const runId = getSubAgentRunId(tool)
        if (!runId) return
        // 修改原因：主聊天 SubAgent 卡片只保存摘要，完整内部过程应该通过显眼按钮进入 Monitor。
        // 修改方式：ToolConfig action 在 pending 阶段使用 tool.id 推导 runId，完成后使用 result.data.runId，并传入当前 conversationId。
        // 修改目的：复用通用工具 action 机制，删除展开区硬编码“打开详情”按钮后仍可在执行中打开同一次运行。
        await sendToExtension('subagents.openMonitor', {
          runId,
          conversationId: context.conversationId || undefined
        })
      }
    }
  ]
})
