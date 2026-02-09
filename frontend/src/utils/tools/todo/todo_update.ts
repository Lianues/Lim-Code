/**
 * todo_update 工具注册
 */

import { registerTool } from '../../toolRegistry'
import { t } from '../../../i18n'
import TodoWritePanel from '../../../components/tools/todo/todo_write.vue'

type OpName = 'add' | 'set_status' | 'set_content' | 'cancel' | 'remove'

function normalizeOps(input: unknown): Array<{ op: OpName }> {
  if (!Array.isArray(input)) return []
  const out: Array<{ op: OpName }> = []
  for (const item of input) {
    const op = (item as any)?.op
    if (op === 'add' || op === 'set_status' || op === 'set_content' || op === 'cancel' || op === 'remove') {
      out.push({ op })
    }
  }
  return out
}

function countOps(ops: Array<{ op: OpName }>): Record<OpName, number> {
  const c: Record<OpName, number> = { add: 0, set_status: 0, set_content: 0, cancel: 0, remove: 0 }
  for (const o of ops) c[o.op]++
  return c
}

registerTool('todo_update', {
  name: 'todo_update',
  label: t('components.message.tool.todoUpdate.label'),
  icon: 'codicon-edit',

  labelFormatter: (args) => {
    const ops = normalizeOps((args as any)?.ops)
    return ops.length > 0 ? t('components.message.tool.todoUpdate.labelWithCount', { count: ops.length }) : t('components.message.tool.todoUpdate.label')
  },

  descriptionFormatter: (args) => {
    const ops = normalizeOps((args as any)?.ops)
    const c = countOps(ops)
    return t('components.message.tool.todoUpdate.description', {
      add: c.add,
      setStatus: c.set_status,
      setContent: c.set_content,
      cancel: c.cancel,
      remove: c.remove
    })
  },
  contentComponent: TodoWritePanel
})

