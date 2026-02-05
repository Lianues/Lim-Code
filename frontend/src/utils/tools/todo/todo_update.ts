/**
 * todo_update 工具注册
 */

import { registerTool } from '../../toolRegistry'

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
  label: 'TODO Update',
  icon: 'codicon-edit',

  labelFormatter: (args) => {
    const ops = normalizeOps((args as any)?.ops)
    return ops.length > 0 ? `TODO Update · ${ops.length}` : 'TODO Update'
  },

  descriptionFormatter: (args) => {
    const ops = normalizeOps((args as any)?.ops)
    const c = countOps(ops)
    return `新增 ${c.add} · 状态 ${c.set_status} · 描述 ${c.set_content} · 取消 ${c.cancel} · 移除 ${c.remove}`
  }
})

