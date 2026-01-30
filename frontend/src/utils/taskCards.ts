export interface PreviewTextOptions {
  maxLines: number
  maxChars: number
}

/**
 * Extract a compact preview text from markdown/plaintext.
 *
 * Rules:
 * - trim leading/trailing whitespace
 * - keep at most maxLines lines
 * - if still longer than maxChars, truncate by chars and append ellipsis (…)
 */
export function extractPreviewText(input: string, opts: PreviewTextOptions): string {
  const text = (input || '').trim()
  if (!text) return ''

  const maxLines = Math.max(1, opts.maxLines || 1)
  const maxChars = Math.max(1, opts.maxChars || 1)

  const lines = text.split(/\r?\n/)
  const kept = lines.slice(0, maxLines).join('\n')

  if (kept.length <= maxChars) return kept

  // Truncate by chars and add ellipsis
  const slice = kept.slice(0, maxChars).trimEnd()
  return slice + '…'
}

export interface SubAgentRuntimeMeta {
  channelId: string
  modelId?: string
  modelVersion?: string
}

/**
 * Format a compact runtime badge like: "channelId · modelVersion".
 * Prefer modelVersion (actual) over modelId (configured).
 */
export function formatSubAgentRuntimeBadge(meta: SubAgentRuntimeMeta): string {
  const channel = (meta.channelId || '').trim()
  const model = (meta.modelVersion || meta.modelId || '').trim()

  if (!channel && !model) return ''
  if (channel && model) return `${channel} · ${model}`
  return channel || model
}

/**
 * Whether a path looks like a plan doc under .cursor/plans and ends with .md
 * (supports multi-root prefix like "workspace/.cursor/plans/x.plan.md").
 */
export function isPlanDocPath(path: string): boolean {
  const normalized = (path || '').replace(/\\/g, '/')
  const lower = normalized.toLowerCase()

  // Must be a markdown file
  if (!lower.endsWith('.md')) return false

  // Keep consistent with backend plan path safety rules
  // (avoid path traversal patterns showing up as “plan docs” in UI)
  if (lower.includes('..')) return false

  // Single-root: .cursor/plans/...
  if (lower.startsWith('.cursor/plans/')) return true

  // Multi-root: workspaceName/.cursor/plans/...
  // Only allow a single path segment as workspace prefix.
  const slashIndex = normalized.indexOf('/')
  if (slashIndex <= 0) return false

  const workspacePrefix = normalized.slice(0, slashIndex)
  // Reject pseudo-prefix like "./" or Windows drive letter "C:/"
  if (workspacePrefix === '.' || workspacePrefix === '..') return false
  if (workspacePrefix.includes(':')) return false

  const rest = normalized.slice(slashIndex + 1)
  return rest.toLowerCase().startsWith('.cursor/plans/')
}

export interface PlanTodoItem {
  text: string
  completed: boolean
}

/**
 * Extract TODO items from a plan markdown document.
 *
 * Supported markdown checklist formats:
 * - "- [ ] task"
 * - "- [x] done"
 * - "* [ ] task"
 * - "+ [X] done"
 */
export function extractTodosFromPlan(content: string): PlanTodoItem[] {
  const lines = (content || '').split(/\r?\n/)
  const todos: PlanTodoItem[] = []

  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/)
    if (!m) continue

    const mark = (m[1] || '').toLowerCase()
    const text = (m[2] || '').trim()
    if (!text) continue

    todos.push({
      text,
      completed: mark === 'x'
    })
  }

  return todos
}

