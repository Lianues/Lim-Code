import { extractPreviewText, isProgressDocPath } from './taskCards'
// WP14: 从统合后的 typeGuards 导入，消除重复定义
import { asBoolean, asNumber, asRecord, asString } from './typeGuards'

export type ProgressToolName =
  | 'create_progress'
  | 'update_progress'
  | 'record_progress_milestone'
  | 'validate_progress_document'

export type ProgressCardStatus = 'active' | 'blocked' | 'completed' | 'archived'
export type ProgressCardPhase = 'design' | 'plan' | 'implementation' | 'review' | 'maintenance'
export type ProgressCardMilestoneStatus = 'in_progress' | 'completed'
export type ProgressValidationIssueSeverity = 'error' | 'warning'

export interface ProgressCardValidationIssue {
  severity?: ProgressValidationIssueSeverity
  code?: string
  message: string
}

export interface ProgressCardData {
  path?: string
  title?: string
  projectId?: string
  projectName?: string
  status?: ProgressCardStatus
  phase?: ProgressCardPhase
  currentFocus?: string
  currentProgress?: string
  latestConclusion?: string
  latestConclusionPreview?: string
  currentBlocker?: string
  currentBlockerPreview?: string
  nextAction?: string
  nextActionPreview?: string
  updatedAt?: string
  milestonesTotal?: number
  milestonesCompleted?: number
  todosTotal?: number
  todosCompleted?: number
  todosInProgress?: number
  todosCancelled?: number
  activeRisks?: number
  activeDesignPath?: string
  activePlanPath?: string
  activeReviewPath?: string
  latestMilestoneId?: string
  latestMilestoneTitle?: string
  latestMilestoneStatus?: ProgressCardMilestoneStatus
  latestMilestoneRecordedAt?: string
  isValid?: boolean
  formatVersion?: number | null
  issueCount?: number
  errorCount?: number
  warningCount?: number
  issues?: ProgressCardValidationIssue[]
  sourceTool: ProgressToolName
}

type LooseRecord = Record<string, unknown>

const PROGRESS_TOOL_NAMES = new Set<ProgressToolName>([
  'create_progress',
  'update_progress',
  'record_progress_milestone',
  'validate_progress_document'
])

function normalizeStatus(value: unknown): ProgressCardStatus | undefined {
  return value === 'active' || value === 'blocked' || value === 'completed' || value === 'archived'
    ? value
    : undefined
}

function normalizePhase(value: unknown): ProgressCardPhase | undefined {
  return value === 'design' || value === 'plan' || value === 'implementation' || value === 'review' || value === 'maintenance'
    ? value
    : undefined
}

function normalizeMilestoneStatus(value: unknown): ProgressCardMilestoneStatus | undefined {
  return value === 'in_progress' || value === 'completed'
    ? value
    : undefined
}

// WP14: asBoolean 已从 typeGuards 导入，此处不再重复定义

function normalizeIssues(value: unknown): ProgressCardValidationIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asRecord(item))
    .filter((item): item is LooseRecord => !!item && !!asString(item.message))
    .map((item) => ({
      severity: item.severity === 'error' || item.severity === 'warning' ? item.severity : undefined,
      code: asString(item.code),
      message: asString(item.message) || ''
    }))
}

function getResultData(result?: Record<string, unknown>): LooseRecord {
  const data = asRecord((result as any)?.data)
  return data || {}
}

function buildCurrentProgressFromSnapshot(snapshot: LooseRecord): string | undefined {
  const stats = asRecord(snapshot.stats)
  const latestMilestone = asRecord(snapshot.latestMilestone)
  const total = asNumber(stats?.milestonesTotal)
  const completed = asNumber(stats?.milestonesCompleted)
  const latestId = asString(latestMilestone?.id)

  if (typeof total === 'number' && typeof completed === 'number' && total > 0) {
    return `${completed}/${total} 个里程碑已完成${latestId ? `；最新：${latestId}` : ''}`
  }

  return undefined
}

export function isProgressToolName(name: string): name is ProgressToolName {
  return PROGRESS_TOOL_NAMES.has(name as ProgressToolName)
}

export function formatProgressToolFallbackContent(
  toolName: ProgressToolName,
  args: Record<string, unknown> = {},
  result?: Record<string, unknown>
): string {
  const data = getResultData(result)
  const snapshot = asRecord(data.progressSnapshot)

  if (toolName === 'record_progress_milestone') {
    return asString(args.summary)
      || asString(snapshot?.latestConclusion)
      || asString(data.latestConclusion)
      || ''
  }

  if (toolName === 'validate_progress_document') {
    const validation = asRecord(data.progressValidation)
    const isValid = asBoolean(validation?.isValid)
    const issueCount = asNumber(validation?.issueCount) || 0
    const errorCount = asNumber(validation?.errorCount) || 0
    const warningCount = asNumber(validation?.warningCount) || 0
    return [
      `Valid: ${isValid === true ? 'true' : isValid === false ? 'false' : 'unknown'}`,
      `Issues: ${issueCount}`,
      `Errors: ${errorCount}`,
      `Warnings: ${warningCount}`,
    ].join('\n')
  }

  const blocks: string[] = []
  const currentFocus = asString(snapshot?.currentFocus) || asString(data.currentFocus) || asString(args.currentFocus)
  const currentProgress = asString(snapshot?.currentProgress) || asString(data.currentProgress) || buildCurrentProgressFromSnapshot(snapshot || {})
  const latestConclusion = asString(snapshot?.latestConclusion) || asString(data.latestConclusion) || asString(args.latestConclusion)
  const currentBlocker = asString(snapshot?.currentBlocker) || asString(data.currentBlocker) || asString(args.currentBlocker)
  const nextAction = asString(snapshot?.nextAction) || asString(data.nextAction) || asString(args.nextAction)

  if (currentFocus) blocks.push(`当前焦点\n${currentFocus}`)
  if (currentProgress) blocks.push(`当前进度\n${currentProgress}`)
  if (latestConclusion) blocks.push(`最新结论\n${latestConclusion}`)
  if (currentBlocker) blocks.push(`当前阻塞\n${currentBlocker}`)
  if (nextAction) blocks.push(`下一步\n${nextAction}`)

  return blocks.join('\n\n')
}

export function extractProgressCardData(
  toolName: ProgressToolName,
  args: Record<string, unknown> = {},
  result?: Record<string, unknown>
): ProgressCardData | null {
  const data = getResultData(result)
  const snapshot = asRecord(data.progressSnapshot)
  const stats = asRecord(snapshot?.stats || data.stats)
  const activeArtifacts = asRecord(snapshot?.activeArtifacts || data.activeArtifacts)
  const validation = asRecord(data.progressValidation)
  const latestMilestone = asRecord(snapshot?.latestMilestone || data.latestMilestone)

  const rawPath = asString(data.path) || asString(snapshot?.path) || asString(args.path) || '.limcode/progress.md'
  const path = isProgressDocPath(rawPath) ? rawPath : undefined

  const projectName = asString(snapshot?.projectName) || asString(data.projectName) || asString(args.projectName)
  const projectId = asString(snapshot?.projectId) || asString(data.projectId) || asString(args.projectId)
  const title = projectName || projectId || undefined

  const latestConclusion = asString(snapshot?.latestConclusion) || asString(data.latestConclusion) || asString(args.latestConclusion)
  const currentBlocker = asString(snapshot?.currentBlocker) || asString(data.currentBlocker) || asString(args.currentBlocker)
  const nextAction = asString(snapshot?.nextAction) || asString(data.nextAction) || asString(args.nextAction)

  const card: ProgressCardData = {
    path,
    title,
    projectId,
    projectName,
    status: normalizeStatus(snapshot?.status || data.status),
    phase: normalizePhase(snapshot?.phase || data.phase),
    currentFocus: asString(snapshot?.currentFocus) || asString(data.currentFocus) || asString(args.currentFocus),
    currentProgress: asString(snapshot?.currentProgress) || asString(data.currentProgress) || buildCurrentProgressFromSnapshot(snapshot || {}),
    latestConclusion,
    latestConclusionPreview: latestConclusion
      ? extractPreviewText(latestConclusion, { maxLines: 3, maxChars: 220 })
      : undefined,
    currentBlocker,
    currentBlockerPreview: currentBlocker
      ? extractPreviewText(currentBlocker, { maxLines: 2, maxChars: 180 })
      : undefined,
    nextAction,
    nextActionPreview: nextAction
      ? extractPreviewText(nextAction, { maxLines: 2, maxChars: 180 })
      : undefined,
    updatedAt: asString(snapshot?.updatedAt) || asString(data.updatedAt),
    milestonesTotal: asNumber(stats?.milestonesTotal),
    milestonesCompleted: asNumber(stats?.milestonesCompleted),
    todosTotal: asNumber(stats?.todosTotal),
    todosCompleted: asNumber(stats?.todosCompleted),
    todosInProgress: asNumber(stats?.todosInProgress),
    todosCancelled: asNumber(stats?.todosCancelled),
    activeRisks: asNumber(stats?.activeRisks),
    activeDesignPath: asString(activeArtifacts?.design),
    activePlanPath: asString(activeArtifacts?.plan),
    activeReviewPath: asString(activeArtifacts?.review),
    latestMilestoneId: asString(latestMilestone?.id),
    latestMilestoneTitle: asString(latestMilestone?.title),
    latestMilestoneStatus: normalizeMilestoneStatus(latestMilestone?.status),
    latestMilestoneRecordedAt: asString(latestMilestone?.recordedAt),
    isValid: asBoolean(validation?.isValid ?? data.isValid),
    formatVersion: asNumber(validation?.formatVersion ?? data.formatVersion),
    issueCount: asNumber(validation?.issueCount ?? data.issueCount),
    errorCount: asNumber(validation?.errorCount ?? data.errorCount),
    warningCount: asNumber(validation?.warningCount ?? data.warningCount),
    issues: normalizeIssues(validation?.issues || data.issues),
    sourceTool: toolName,
  }

  const hasMeaningfulData = Boolean(
    card.path
    || card.title
    || card.status
    || card.phase
    || card.currentFocus
    || card.currentProgress
    || card.latestConclusion
    || card.currentBlocker
    || card.nextAction
    || typeof card.milestonesTotal === 'number'
    || typeof card.todosTotal === 'number'
  )

  return hasMeaningfulData ? card : null
}
