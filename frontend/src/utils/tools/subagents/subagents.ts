/**
 * subagents 工具注册
 */

import { registerTool } from '../../toolRegistry'
import SubAgentsComponent from '../../../components/tools/subagents/subagents.vue'

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
  contentComponent: SubAgentsComponent
})
