export type ContinuationIntent = 'generate_plan_now' | 'implement_now'
export type ContinuationSourceArtifactType = 'design' | 'review' | 'plan'
export type PlanUpdateMode = 'revision' | 'progress_sync'

export interface ToolContinuationContext {
  continuationApproved: true
  continuationIntent: ContinuationIntent
  sourceArtifactType: ContinuationSourceArtifactType
  sourcePath?: string
  sourceContent?: string
  continuationPrompt: string
  todos?: Array<{
    id: string
    content: string
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  }>
}

function normalizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function isContinuationIntent(value: unknown): value is ContinuationIntent {
  return value === 'generate_plan_now' || value === 'implement_now'
}

function isSourceArtifactType(value: unknown): value is ContinuationSourceArtifactType {
  return value === 'design' || value === 'review' || value === 'plan'
}

function normalizePlanUpdateMode(value: unknown): PlanUpdateMode {
  return value === 'progress_sync' ? 'progress_sync' : 'revision'
}

function getLegacyPlanExecutionPrompt(record: Record<string, unknown>): string {
  return normalizePrompt(record.planExecutionPrompt)
}

function getLegacyPlanGenerationPrompt(record: Record<string, unknown>): string {
  return normalizePrompt(record.planGenerationPrompt)
}

function getUnifiedContinuationPrompt(
  record: Record<string, unknown>,
  expectedIntent?: ContinuationIntent
): string {
  if (record.continuationApproved !== true) return ''

  const continuationIntent = record.continuationIntent
  if (!isContinuationIntent(continuationIntent)) return ''
  if (expectedIntent && continuationIntent !== expectedIntent) return ''

  return normalizePrompt(record.continuationPrompt)
}

function getContinuationPromptValue(
  record: Record<string, unknown>,
  expectedIntent?: ContinuationIntent
): string {
  const unifiedPrompt = getUnifiedContinuationPrompt(record, expectedIntent)
  if (unifiedPrompt) return unifiedPrompt

  if (expectedIntent === 'implement_now') {
    return getLegacyPlanExecutionPrompt(record) || normalizePrompt(record.continuationPrompt)
  }

  if (expectedIntent === 'generate_plan_now') {
    return getLegacyPlanGenerationPrompt(record) || normalizePrompt(record.continuationPrompt)
  }

  return normalizePrompt(record.continuationPrompt)
    || getLegacyPlanExecutionPrompt(record)
    || getLegacyPlanGenerationPrompt(record)
}

export function getContinuationContext(response: unknown): ToolContinuationContext | null {
  const record = asRecord(response)
  if (!record) return null
  if (record.continuationApproved !== true) return null

  const continuationIntent = record.continuationIntent
  if (!isContinuationIntent(continuationIntent)) return null

  const sourceArtifactType = record.sourceArtifactType
  if (!isSourceArtifactType(sourceArtifactType)) return null

  const continuationPrompt = getContinuationPromptValue(record, continuationIntent)
  if (!continuationPrompt) return null

  const sourcePath = normalizePrompt(record.sourcePath)
  const sourceContent = typeof record.sourceContent === 'string' ? record.sourceContent : ''
  const todos = Array.isArray(record.todos)
    ? record.todos as ToolContinuationContext['todos']
    : undefined

  return {
    continuationApproved: true,
    continuationIntent,
    sourceArtifactType,
    sourcePath: sourcePath || undefined,
    sourceContent: sourceContent || undefined,
    continuationPrompt,
    todos
  }
}

export function getPlanExecutionPrompt(response: unknown): string {
  const record = asRecord(response)
  if (!record) return ''
  return getContinuationPromptValue(record, 'implement_now')
}

export function getPlanGenerationPrompt(response: unknown): string {
  const record = asRecord(response)
  if (!record) return ''
  return getContinuationPromptValue(record, 'generate_plan_now')
}

export function getToolContinuationPrompt(response: unknown): string {
  const record = asRecord(response)
  if (!record) return ''
  return getContinuationPromptValue(record)
}

export function getPlanUpdateMode(response: unknown, args?: unknown): PlanUpdateMode {
  const record = asRecord(response)
  const data = asRecord(record?.data)
  const argsRecord = asRecord(args)

  return normalizePlanUpdateMode(
    data?.updateMode
    ?? record?.updateMode
    ?? argsRecord?.updateMode
  )
}

export function isPlanProgressSync(response: unknown, args?: unknown): boolean {
  return getPlanUpdateMode(response, args) === 'progress_sync'
}

export function hasApprovedContinuation(response: unknown, expectedIntent?: ContinuationIntent): boolean {
  const record = asRecord(response)
  if (!record) return false
  if (record.continuationApproved !== true) return false

  const continuationIntent = record.continuationIntent
  if (!isContinuationIntent(continuationIntent)) return false
  if (expectedIntent && continuationIntent !== expectedIntent) return false

  return getContinuationPromptValue(record, continuationIntent).length > 0
}

export function isAwaitingToolUserConfirmation(response: unknown): boolean {
  const record = asRecord(response)
  if (!record) return false
  if (record.requiresUserConfirmation !== true) return false
  return getToolContinuationPrompt(record).length === 0
}
