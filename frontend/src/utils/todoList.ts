import type { Message, ToolUsage } from '../types'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type TodoItem = {
  id: string
  content: string
  status: TodoStatus
}

export function normalizeTodoStatus(value: unknown): TodoStatus {
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled') return value
  return 'pending'
}

export function normalizeTodoList(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) return []
  const out: TodoItem[] = []

  for (const item of input) {
    const id = (item as any)?.id
    const content = (item as any)?.content
    const status = (item as any)?.status

    if (typeof id !== 'string' || !id.trim()) continue
    if (typeof content !== 'string') continue

    out.push({
      id: id.trim(),
      content,
      status: normalizeTodoStatus(status)
    })
  }

  return out
}

export function applyTodoUpdateOps(existing: TodoItem[], opsInput: unknown): TodoItem[] {
  const result: Array<TodoItem | null> = existing.map(t => ({ ...t }))
  const indexById = new Map<string, number>()

  for (let i = 0; i < result.length; i++) {
    const t = result[i]
    if (t) indexById.set(t.id, i)
  }

  const ops = Array.isArray(opsInput) ? opsInput : []
  for (const opAny of ops) {
    const op = (opAny as any)?.op
    const idRaw = (opAny as any)?.id
    const id = typeof idRaw === 'string' ? idRaw.trim() : ''

    if (op === 'add') {
      const content = (opAny as any)?.content
      if (!id || typeof content !== 'string') continue

      const status = normalizeTodoStatus((opAny as any)?.status)
      const idx = indexById.get(id)

      if (idx === undefined) {
        indexById.set(id, result.length)
        result.push({ id, content, status })
      } else {
        const current = result[idx]
        if (!current) continue
        current.content = content
        current.status = status
      }
      continue
    }

    if (!id) continue

    const idx = indexById.get(id)
    if (idx === undefined) continue

    const current = result[idx]
    if (!current) continue

    if (op === 'set_status') {
      current.status = normalizeTodoStatus((opAny as any)?.status)
      continue
    }

    if (op === 'set_content') {
      const content = (opAny as any)?.content
      if (typeof content === 'string') current.content = content
      continue
    }

    if (op === 'cancel') {
      current.status = 'cancelled'
      continue
    }

    if (op === 'remove') {
      result[idx] = null
      indexById.delete(id)
    }
  }

  return result.filter((t): t is TodoItem => !!t)
}

function getMergedToolResult(
  tool: ToolUsage,
  resolveToolResponseById?: (toolCallId: string) => unknown
): Record<string, unknown> | undefined {
  const fromTool = tool.result && typeof tool.result === 'object'
    ? tool.result as Record<string, unknown>
    : undefined

  const fromResponseRaw = tool.id && resolveToolResponseById
    ? resolveToolResponseById(tool.id)
    : undefined
  const fromResponse = fromResponseRaw && typeof fromResponseRaw === 'object'
    ? fromResponseRaw as Record<string, unknown>
    : undefined

  if (fromTool && fromResponse) {
    return { ...fromTool, ...fromResponse }
  }

  return fromResponse || fromTool
}

function isToolFailed(tool: ToolUsage, mergedResult?: Record<string, unknown>): boolean {
  if (tool.status === 'error') return true
  if (mergedResult?.success === false) return true
  return false
}

/**
 * 通过当前会话消息重放 todo 列表。
 * - create_plan.todos / todo_write.todos 视作全量重置
 * - todo_update.ops 视作增量更新
 */
export interface ReplayTodoState {
  todos: TodoItem[] | null
  /** TODO 面板插入点（首个有效工具调用消息的 backendIndex + 1，保证渲染在该消息下方） */
  anchorBackendIndex: number | null
}

export interface ReplayTodoOptions {
  resolveToolResponseById?: (toolCallId: string) => unknown
  /** 仅重放到指定 toolId（包含该工具调用） */
  stopAtToolId?: string
  /** 仅重放到指定 backendIndex（包含该消息），用于 toolId 缺失/不稳定时兜底 */
  stopAtBackendIndex?: number
}


export function replayTodoStateFromMessages(
  messages: Message[],
  options?: ReplayTodoOptions
): ReplayTodoState {
  let touched = false
  let list: TodoItem[] = []
  let anchorBackendIndex: number | null = null
  const stopAtToolId = typeof options?.stopAtToolId === 'string' ? options.stopAtToolId.trim() : ''
  const stopAtBackendIndex =
    typeof options?.stopAtBackendIndex === 'number' && Number.isFinite(options.stopAtBackendIndex)
      ? options.stopAtBackendIndex
      : null
  let stopped = false

  for (const msg of messages) {
    if (stopped) break
    const msgBackendIndex =
      typeof msg.backendIndex === 'number' && Number.isFinite(msg.backendIndex)
        ? msg.backendIndex
        : null
    if (stopAtBackendIndex !== null && msgBackendIndex !== null && msgBackendIndex > stopAtBackendIndex) break

    if (msg.role !== 'assistant' || !Array.isArray(msg.tools)) continue

    for (const tool of msg.tools) {
      const mergedResult = getMergedToolResult(tool, options?.resolveToolResponseById)
      if (!isToolFailed(tool, mergedResult)) {
        const markTouched = () => {
          touched = true
          if (
            anchorBackendIndex === null &&
            typeof msg.backendIndex === 'number' &&
            Number.isFinite(msg.backendIndex)
          ) anchorBackendIndex = msg.backendIndex + 1
        }

        if (tool.name === 'create_plan') {
          const todosInput = Array.isArray((tool.args as any)?.todos)
            ? (tool.args as any)?.todos
            : (mergedResult as any)?.data?.todos
          if (Array.isArray(todosInput)) {
            list = normalizeTodoList(todosInput)
            markTouched()
          }
        }

        if (tool.name === 'todo_write') {
          const todosInput = (tool.args as any)?.todos
          if (Array.isArray(todosInput)) {
            list = normalizeTodoList(todosInput)
            markTouched()
          }
        }

        if (tool.name === 'todo_update') {
          const opsInput = (tool.args as any)?.ops
          if (Array.isArray(opsInput)) {
            list = applyTodoUpdateOps(list, opsInput)
            markTouched()
          }
        }
      }

      if (stopAtToolId && tool.id === stopAtToolId) {
        stopped = true
        break
      }
    }

    if (!stopped && stopAtBackendIndex !== null && msgBackendIndex !== null && msgBackendIndex >= stopAtBackendIndex) {
      stopped = true
    }
  }

  return {
    todos: touched ? list : null,
    anchorBackendIndex
  }
}

/**
 * 兼容旧调用：仅返回 todo 列表。
 * 返回 null 表示“当前会话没有出现过 todo 相关工具调用”。
 */
export function replayTodoListFromMessages(
  messages: Message[],
  options?: ReplayTodoOptions
): TodoItem[] | null {
  return replayTodoStateFromMessages(messages, options).todos
}
