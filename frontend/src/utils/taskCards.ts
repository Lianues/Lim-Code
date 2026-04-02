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
  channelName: string
  modelId?: string
}

/**
 * Format a compact runtime badge like: "channelName · modelId".
 */
export function formatSubAgentRuntimeBadge(meta: SubAgentRuntimeMeta): string {
  const channel = (meta.channelName || '').trim()
  const model = (meta.modelId || '').trim()

  if (!channel && !model) return ''
  if (channel && model) return `${channel} · ${model}`
  return channel || model
}

function isScopedMarkdownDocPath(path: string, scopeRoot: string): boolean {
  const normalized = (path || '').replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  const scopeLower = scopeRoot.toLowerCase()

  // Must be a markdown file
  if (!lower.endsWith('.md')) return false

  // Keep consistent with backend path safety rules
  // (avoid path traversal patterns showing up as document cards in UI)
  if (lower.includes('..')) return false

  // Single-root: .limcode/.../...md
  if (lower.startsWith(scopeLower)) return true

  // Multi-root: workspaceName/.limcode/.../...md
  // Only allow a single path segment as workspace prefix.
  const slashIndex = normalized.indexOf('/')
  if (slashIndex <= 0) return false

  const workspacePrefix = normalized.slice(0, slashIndex)
  // Reject pseudo-prefix like "./" or Windows drive letter "C:/"
  if (workspacePrefix === '.' || workspacePrefix === '..') return false
  if (workspacePrefix.includes(':')) return false

  const rest = normalized.slice(slashIndex + 1)
  return rest.toLowerCase().startsWith(scopeLower)
}

/**
 * Whether a path looks like a plan doc under .limcode/plans and ends with .md
 * (supports multi-root prefix like "workspace/.limcode/plans/x.plan.md").
 */
export function isPlanDocPath(path: string): boolean {
  return isScopedMarkdownDocPath(path, '.limcode/plans/')
}

/**
 * Whether a path looks like a design doc under .limcode/design and ends with .md
 * (supports multi-root prefix like "workspace/.limcode/design/x.md").
 */
export function isDesignDocPath(path: string): boolean {
  return isScopedMarkdownDocPath(path, '.limcode/design/')
}

/**
 * Whether a path looks like a review doc under .limcode/review and ends with .md
 * (supports multi-root prefix like "workspace/.limcode/review/x.md").
 */
export function isReviewDocPath(path: string): boolean {
  return isScopedMarkdownDocPath(path, '.limcode/review/')
}

const PLAN_SOURCE_ARTIFACT_SECTION_START = '<!-- LIMCODE_SOURCE_ARTIFACT_START -->'
const PLAN_SOURCE_ARTIFACT_SECTION_END = '<!-- LIMCODE_SOURCE_ARTIFACT_END -->'

/**
 * Hide the tracked source metadata block from plan markdown when rendering task cards.
 *
 * The metadata remains in the saved document for machine-readable tracking,
 * but the card preview should focus on user-facing plan content.
 */
export function stripPlanSourceArtifactSection(content: string): string {
  const normalized = (content || '').replace(/\r\n?/g, '\n')
  const start = normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_START)
  const end = start >= 0
    ? normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_END, start + PLAN_SOURCE_ARTIFACT_SECTION_START.length)
    : -1

  if (start < 0 || end < 0 || end < start) return normalized

  const before = normalized.slice(0, start).trimEnd()
  const after = normalized.slice(end + PLAN_SOURCE_ARTIFACT_SECTION_END.length).trim()
  if (before && after) return `${before}\n\n${after}`
  return before || after || ''
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
  let hasCheckbox = false

  // Strip optional [status] prefix and trailing `#id` from task text
  function cleanTaskText(raw: string): string {
    return raw
      .replace(/^\[(pending|in_progress|completed|cancelled)\]\s*/i, '')
      .replace(/`#[^`]*`\s*$/, '')
      .trim()
  }

  // 1. First pass: try to find standard markdown checkboxes
  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/)
    if (m) {
      hasCheckbox = true
      const mark = (m[1] || '').toLowerCase()
      const text = cleanTaskText(m[2] || '')
      if (text) {
        todos.push({
          text,
          completed: mark === 'x'
        })
      }
    }
  }

  // 2. Fallback: if no checkboxes found, treat standard list items as pending tasks
  // (only if we have "enough" content to avoid matching single-line greetings as tasks)
  if (!hasCheckbox && todos.length === 0) {
    for (const line of lines) {
      // Match bullet points or numbered lists
      // - item, * item, + item, 1. item
      const m = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/)
      if (m) {
        const text = cleanTaskText(m[1] || '')
        if (text) {
          todos.push({
            text,
            completed: false
          })
        }
      }
    }
  }

  return todos
}
