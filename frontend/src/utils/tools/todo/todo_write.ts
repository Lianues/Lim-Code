/**
 * todo_write 工具注册
 */

import { registerTool } from '../../toolRegistry'
import { t } from '../../../i18n'
import TodoWritePanel from '../../../components/tools/todo/todo_write.vue'

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

function normalizeTodos(input: unknown): Array<{ id: string; content: string; status: TodoStatus }> {
  if (!Array.isArray(input)) return []
  const out: Array<{ id: string; content: string; status: TodoStatus }> = []
  for (const item of input) {
    const id = (item as any)?.id
    const content = (item as any)?.content
    const status = (item as any)?.status
    if (typeof id !== 'string' || typeof content !== 'string') continue
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed' && status !== 'cancelled') continue
    out.push({ id, content, status })
  }
  return out
}

function countByStatus(todos: Array<{ status: TodoStatus }>): Record<TodoStatus, number> {
  const c: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 }
  for (const t of todos) c[t.status]++
  return c
}

registerTool('todo_write', {
  name: 'todo_write',
  label: t('components.message.tool.todoWrite.label'),
  icon: 'codicon-list-unordered',

  labelFormatter: (args) => {
    const todos = normalizeTodos((args as any)?.todos)
    return todos.length > 0 ? t('components.message.tool.todoWrite.labelWithCount', { count: todos.length }) : t('components.message.tool.todoWrite.label')
  },

  descriptionFormatter: (args) => {
    const merge = (args as any)?.merge
    const todos = normalizeTodos((args as any)?.todos)
    const c = countByStatus(todos)
    const prefix = merge === true ? t('components.message.tool.todoWrite.mergePrefix') : ''
    return `${prefix}${t('components.message.tool.todoWrite.description', {
      pending: c.pending,
      inProgress: c.in_progress,
      completed: c.completed
    })}`
  },

  contentComponent: TodoWritePanel
})

