/**
 * create_plan 工具注册（前端展示）
 */

import { registerTool } from '../../toolRegistry'

registerTool('create_plan', {
  name: 'create_plan',
  label: '创建计划',
  icon: 'codicon-list-unordered',
  descriptionFormatter: (args) => {
    const path = (args as any)?.path as string | undefined
    const title = (args as any)?.title as string | undefined
    if (path && path.trim()) return path
    if (title && title.trim()) return title.trim()
    return 'Plan'
  },
  contentFormatter: (args, result) => {
    const content = ((result as any)?.data?.content || (args as any)?.plan || '') as string
    return content || ''
  }
})

