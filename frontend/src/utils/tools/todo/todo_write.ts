/**
 * todo_write 工具注册
 */

import { registerTool } from '../../toolRegistry'
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
  label: 'TODO',
  icon: 'codicon-list-unordered',

  labelFormatter: (args) => {
    const todos = normalizeTodos((args as any)?.todos)
    return todos.length > 0 ? `TODO · ${todos.length}` : 'TODO'
  },

  descriptionFormatter: (args) => {
    const merge = (args as any)?.merge
    const todos = normalizeTodos((args as any)?.todos)
    const c = countByStatus(todos)
    const mode = merge === true ? 'merge' : (merge === false ? 'replace' : '—')
    return `${mode} · 待做 ${c.pending} · 进行中 ${c.in_progress} · 完成 ${c.completed}`
  },

  contentComponent: TodoWritePanel
})

