/**
 * update_plan 工具注册（前端展示）
 */

import { registerTool } from '../../toolRegistry'
import { t } from '../../../i18n'
import TodoWritePanel from '../../../components/tools/todo/todo_write.vue'

registerTool('update_plan', {
  name: 'update_plan',
  label: t('components.message.tool.updatePlan.label'),
  icon: 'codicon-edit',
  descriptionFormatter: (args) => {
    const path = (args as any)?.path as string | undefined
    const title = (args as any)?.title as string | undefined
    if (path && path.trim()) return path
    if (title && title.trim()) return title.trim()
    return t('components.message.tool.updatePlan.fallbackTitle')
  },
  contentFormatter: (args, result) => {
    const content = ((result as any)?.data?.content || (args as any)?.plan || '') as string
    return content || ''
  },
  contentComponent: TodoWritePanel
})
