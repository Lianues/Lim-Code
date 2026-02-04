/**
 * execute_plan 工具注册（前端展示）
 */

import { registerTool } from '../../toolRegistry'

registerTool('execute_plan', {
  name: 'execute_plan',
  label: '执行计划（门闸）',
  icon: 'codicon-play',
  descriptionFormatter: (args) => {
    const path = (args as any)?.path as string | undefined
    return path && path.trim() ? path : 'Plan'
  },
  contentFormatter: (_args, result) => {
    const planContent = ((result as any)?.data?.planContent || '') as string
    return planContent || ''
  }
})

