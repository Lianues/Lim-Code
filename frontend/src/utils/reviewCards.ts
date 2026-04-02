import { extractPreviewText, isReviewDocPath } from './taskCards'

export type ReviewToolName =
  | 'create_review'
  | 'record_review_milestone'
  | 'finalize_review'
  | 'reopen_review'
  | 'validate_review_document'
  | 'compare_review_documents'

export type ReviewCardStatus = 'in_progress' | 'completed'
export type ReviewCardOverallDecision =
  | 'accepted'
  | 'conditionally_accepted'
  | 'rejected'
  | 'needs_follow_up'
  | null
export type ReviewCardDetectedFormat = 'unknown' | 'v2' | 'v3' | 'v4'
export type ReviewCardTrackingStatus = 'open' | 'accepted_risk' | 'fixed' | 'wont_fix' | 'duplicate'

export interface ReviewCardIssue {
  severity?: 'error' | 'warning'
  code?: string
  message: string
}

export interface ReviewCardEvidenceRef {
  path: string
  lineStart?: number
  lineEnd?: number
  symbol?: string
  excerptHash?: string
  displayText: string
}

export interface ReviewCardFindingItem {
  key: string
  id?: string
  title: string
  severity?: 'high' | 'medium' | 'low'
  category?: string
  trackingStatus?: ReviewCardTrackingStatus
  description?: string
  recommendation?: string
  relatedMilestoneIds?: string[]
  evidence: ReviewCardEvidenceRef[]
}

export interface ReviewCardFindingDiffItem {
  key: string
  title: string
  changes: string[]
  base: ReviewCardFindingItem
  target: ReviewCardFindingItem
}

export interface ReviewCardData {
  path?: string
  title?: string
  date?: string
  status?: ReviewCardStatus
  overallDecision?: ReviewCardOverallDecision
  totalMilestones?: number
  completedMilestones?: number
  currentProgress?: string
  reviewedModules?: string[]
  reviewedModulesCount?: number
  totalFindings?: number
  highCount?: number
  mediumCount?: number
  lowCount?: number
  latestConclusion?: string
  latestConclusionPreview?: string
  recommendedNextAction?: string
  recommendedNextActionPreview?: string
  openTrackingCount?: number
  acceptedRiskTrackingCount?: number
  fixedTrackingCount?: number
  wontFixTrackingCount?: number
  duplicateTrackingCount?: number
  isValid?: boolean
  issueCount?: number
  errorCount?: number
  warningCount?: number
  detectedFormat?: ReviewCardDetectedFormat
  canAutoUpgrade?: boolean
  issues?: ReviewCardIssue[]
  findingItems?: ReviewCardFindingItem[]
  compareBasePath?: string
  compareBaseTitle?: string
  compareBaseDate?: string
  compareTargetPath?: string
  compareTargetTitle?: string
  compareTargetDate?: string
  compareAddedCount?: number
  compareRemovedCount?: number
  comparePersistedCount?: number
  compareSeverityChangedCount?: number
  compareTrackingChangedCount?: number
  compareEvidenceChangedCount?: number
  compareRelatedMilestoneChangedCount?: number
  compareAddedFindings?: ReviewCardFindingItem[]
  compareRemovedFindings?: ReviewCardFindingItem[]
  comparePersistedFindings?: ReviewCardFindingDiffItem[]
  sourceTool: ReviewToolName
}

type LooseRecord = Record<string, unknown>
type SeverityCounts = { high: number; medium: number; low: number }
type TrackingCounts = { open: number; accepted_risk: number; fixed: number; wont_fix: number; duplicate: number }

const REVIEW_TOOL_NAMES = new Set<ReviewToolName>([
  'create_review',
  'record_review_milestone',
  'finalize_review',
  'reopen_review',
  'validate_review_document',
  'compare_review_documents'
])

function asRecord(value: unknown): LooseRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LooseRecord
    : undefined
}

function asRecordArray(value: unknown): LooseRecord[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((item) => asRecord(item))
    .filter((item): item is LooseRecord => !!item)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asString(item))
    .filter((item): item is string => !!item)
}

function formatEvidenceDisplay(record: LooseRecord): string {
  const path = asString(record.path) || ''
  if (!path) return ''

  const lineStart = asNumber(record.lineStart)
  const lineEnd = asNumber(record.lineEnd)
  const symbol = asString(record.symbol)

  const linePart = typeof lineStart === 'number'
    ? `:${lineStart}${typeof lineEnd === 'number' && lineEnd !== lineStart ? `-${lineEnd}` : ''}`
    : ''
  const symbolPart = symbol ? `#${symbol}` : ''
  return `${path}${linePart}${symbolPart}`
}

function normalizeEvidenceRefs(value: unknown): ReviewCardEvidenceRef[] {
  const records = asRecordArray(value) || []
  const seen = new Set<string>()
  const result: ReviewCardEvidenceRef[] = []

  for (const record of records) {
    const path = asString(record.path)
    if (!path) continue
    const displayText = formatEvidenceDisplay(record)
    const key = [
      path,
      asNumber(record.lineStart) ?? '',
      asNumber(record.lineEnd) ?? '',
      asString(record.symbol) || '',
      asString(record.excerptHash) || ''
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      path,
      lineStart: asNumber(record.lineStart),
      lineEnd: asNumber(record.lineEnd),
      symbol: asString(record.symbol),
      excerptHash: asString(record.excerptHash),
      displayText
    })
  }

  return result
}

function normalizeStatus(value: unknown): ReviewCardStatus | undefined {
  return value === 'in_progress' || value === 'completed'
    ? value
    : undefined
}

function normalizeDecision(value: unknown): ReviewCardOverallDecision | undefined {
  if (value === null) return null
  return value === 'accepted'
    || value === 'conditionally_accepted'
    || value === 'rejected'
    || value === 'needs_follow_up'
    ? value
    : undefined
}

function normalizeTrackingStatus(value: unknown): ReviewCardTrackingStatus {
  return value === 'accepted_risk'
    || value === 'fixed'
    || value === 'wont_fix'
    || value === 'duplicate'
    ? value
    : 'open'
}

function normalizeDetectedFormat(value: unknown): ReviewCardDetectedFormat | undefined {
  return value === 'unknown' || value === 'v2' || value === 'v3' || value === 'v4'
    ? value
    : undefined
}

function normalizeIssues(value: unknown): ReviewCardIssue[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => asRecord(item))
    .filter((item): item is LooseRecord => !!item && !!asString(item.message))
    .map((item) => ({
      severity: item.severity === 'error' || item.severity === 'warning'
        ? item.severity
        : undefined,
      code: asString(item.code),
      message: asString(item.message) || ''
    }))
}

function getSeverityCountsFromRecord(value: unknown): SeverityCounts | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  return {
    high: asNumber(record.high) || 0,
    medium: asNumber(record.medium) || 0,
    low: asNumber(record.low) || 0
  }
}

function getSeverityCountsFromFindings(findings: unknown): SeverityCounts | undefined {
  const records = asRecordArray(findings)
  if (!records) return undefined

  const counts: SeverityCounts = { high: 0, medium: 0, low: 0 }
  for (const item of records) {
    const severity = item.severity
    if (severity === 'high' || severity === 'medium' || severity === 'low') {
      counts[severity] += 1
    }
  }
  return counts
}

function getTrackingCountsFromFindings(findings: unknown): TrackingCounts | undefined {
  const records = asRecordArray(findings)
  if (!records || records.length === 0) return undefined

  const counts: TrackingCounts = { open: 0, accepted_risk: 0, fixed: 0, wont_fix: 0, duplicate: 0 }
  for (const item of records) {
    counts[normalizeTrackingStatus(item.trackingStatus)] += 1
  }

  return counts
}

function countCompletedMilestones(milestones: unknown): number | undefined {
  const records = asRecordArray(milestones)
  if (!records) return undefined
  return records.filter((item) => item.status === 'completed').length
}

function countItems(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined
}

function deriveTitleFromPath(path?: string): string | undefined {
  const normalized = asString(path)
  if (!normalized) return undefined
  const segments = normalized.replace(/\\/g, '/').split('/')
  const fileName = segments[segments.length - 1] || normalized
  return fileName.replace(/\.md$/i, '').trim() || undefined
}

function getResultData(result: unknown): LooseRecord {
  const resultRecord = asRecord(result)
  return asRecord(resultRecord?.data) || {}
}

function buildValidationFallbackContent(data: LooseRecord): string {
  const reviewValidation = asRecord(data.reviewValidation)
  const issues = normalizeIssues(reviewValidation?.issues || data.issues)
  const isValid = asBoolean(reviewValidation?.isValid ?? data.isValid)
  const detectedFormat = asString(reviewValidation?.detectedFormat) || asString(data.detectedFormat) || 'unknown'
  const formatVersion = reviewValidation?.formatVersion ?? data.formatVersion ?? 'unknown'
  const lines = [
    `Valid: ${isValid === undefined ? 'unknown' : (isValid ? 'true' : 'false')}`,
    `Detected format: ${detectedFormat}`,
    `Format version: ${formatVersion}`,
    `Issues: ${issues.length}`
  ]

  for (const issue of issues) {
    lines.push(`- [${issue.severity || 'warning'}] ${issue.message}`)
  }

  return lines.join('\n')
}

function normalizeFindingItems(findings: unknown): ReviewCardFindingItem[] {
  const records = asRecordArray(findings)
  if (!records) return []

  return records
    .map((item, index) => {
      const title = asString(item.title) || asString(item.id) || ''
      if (!title) return null
      const finding: ReviewCardFindingItem = {
        key: asString(item.key) || asString(item.id) || `${index}:${title}`,
        id: asString(item.id),
        title,
        severity: item.severity === 'high' || item.severity === 'medium' || item.severity === 'low'
          ? item.severity
          : undefined,
        category: asString(item.category),
        trackingStatus: normalizeTrackingStatus(item.trackingStatus),
        description: asString(item.descriptionMarkdown) || asString(item.description),
        recommendation: asString(item.recommendationMarkdown) || asString(item.recommendation),
        relatedMilestoneIds: asStringArray(item.relatedMilestoneIds),
        evidence: normalizeEvidenceRefs(item.evidence)
      }
      return finding
    })
    .filter((item): item is ReviewCardFindingItem => !!item)
}

function normalizeFindingDiffItems(value: unknown): ReviewCardFindingDiffItem[] {
  const records = asRecordArray(value)
  if (!records) return []

  return records
    .map((item, index) => {
      const base = asRecord(item.base)
      const target = asRecord(item.target)
      const baseFinding = base ? normalizeFindingItems([base])[0] : undefined
      const targetFinding = target ? normalizeFindingItems([target])[0] : undefined
      const title = targetFinding?.title || baseFinding?.title || ''
      if (!baseFinding || !targetFinding || !title) return null
      return {
        key: asString(item.key) || baseFinding.key || targetFinding.key || `${index}:${title}`,
        title,
        changes: asStringArray(item.changes),
        base: baseFinding,
        target: targetFinding
      } satisfies ReviewCardFindingDiffItem
    })
    .filter((item): item is ReviewCardFindingDiffItem => !!item)
}

function buildCompareFallbackContent(data: LooseRecord, args: Record<string, unknown>): string {
  const summary = asRecord(data.summary)
  const base = asRecord(data.base)
  const target = asRecord(data.target)
  return [
    `Base: ${asString(base?.path) || asString(args.basePath) || '-'}`,
    `Target: ${asString(target?.path) || asString(args.targetPath) || '-'}`,
    `Added findings: ${asNumber(summary?.addedFindings) || 0}`,
    `Removed findings: ${asNumber(summary?.removedFindings) || 0}`,
    `Persisted findings: ${asNumber(summary?.persistedFindings) || 0}`,
    `Severity changed: ${asNumber(summary?.severityChanged) || 0}`,
    `Tracking changed: ${asNumber(summary?.trackingChanged) || 0}`
  ].join('\n')
}

function buildCurrentProgressFromSnapshot(snapshot: LooseRecord): string | undefined {
  const milestones = asRecordArray(snapshot.milestones) || []
  if (milestones.length === 0) return '0 milestones recorded'
  const latestMilestoneId = asString(milestones[milestones.length - 1]?.id) || ''
  return `${milestones.length} milestones recorded; latest: ${latestMilestoneId}`
}

export function isReviewToolName(name: string): name is ReviewToolName {
  return REVIEW_TOOL_NAMES.has(name as ReviewToolName)
}

export function formatReviewToolFallbackContent(
  toolName: ReviewToolName,
  args: Record<string, unknown> = {},
  result?: Record<string, unknown>
): string {
  const data = getResultData(result)

  if (toolName === 'create_review') {
    return asString(data.content) || asString(args.review) || ''
  }

  if (toolName === 'record_review_milestone') {
    return asString(data.content) || asString(args.summary) || ''
  }

  if (toolName === 'finalize_review') {
    return asString(data.content) || asString(args.conclusion) || ''
  }

  if (toolName === 'reopen_review') {
    return asString(data.content) || asString(args.path) || ''
  }

  if (toolName === 'compare_review_documents') {
    return buildCompareFallbackContent(data, args)
  }

  return buildValidationFallbackContent(data)
}

export function extractReviewCardData(
  toolName: ReviewToolName,
  args: Record<string, unknown> = {},
  result?: Record<string, unknown>
): ReviewCardData | null {
  const data = getResultData(result)

  if (toolName === 'compare_review_documents') {
    const base = asRecord(data.base)
    const target = asRecord(data.target)
    const summary = asRecord(data.summary)
    const added = normalizeFindingItems(asRecord(data.findings)?.added)
    const removed = normalizeFindingItems(asRecord(data.findings)?.removed)
    const persisted = normalizeFindingDiffItems(asRecord(data.findings)?.persisted)

    const compareBaseTitle = asString(base?.title) || deriveTitleFromPath(asString(base?.path))
    const compareTargetTitle = asString(target?.title) || deriveTitleFromPath(asString(target?.path))
    const title = compareBaseTitle && compareTargetTitle
      ? `${compareBaseTitle} ↔ ${compareTargetTitle}`
      : compareTargetTitle || compareBaseTitle || deriveTitleFromPath(asString(target?.path) || asString(args.targetPath))

    const card: ReviewCardData = {
      path: asString(target?.path) || asString(args.targetPath),
      title,
      date: asString(target?.date),
      compareBasePath: asString(base?.path) || asString(args.basePath),
      compareBaseTitle,
      compareBaseDate: asString(base?.date),
      compareTargetPath: asString(target?.path) || asString(args.targetPath),
      compareTargetTitle,
      compareTargetDate: asString(target?.date),
      compareAddedCount: asNumber(summary?.addedFindings) || 0,
      compareRemovedCount: asNumber(summary?.removedFindings) || 0,
      comparePersistedCount: asNumber(summary?.persistedFindings) || 0,
      compareSeverityChangedCount: asNumber(summary?.severityChanged) || 0,
      compareTrackingChangedCount: asNumber(summary?.trackingChanged) || 0,
      compareEvidenceChangedCount: asNumber(summary?.evidenceChanged) || 0,
      compareRelatedMilestoneChangedCount: asNumber(summary?.relatedMilestoneChanged) || 0,
      compareAddedFindings: added,
      compareRemovedFindings: removed,
      comparePersistedFindings: persisted,
      sourceTool: 'compare_review_documents'
    }

    const hasMeaningfulData = Boolean(
      card.title
      || card.compareBasePath
      || card.compareTargetPath
      || card.compareAddedCount
      || card.compareRemovedCount
      || card.comparePersistedCount
    )

    return hasMeaningfulData ? card : null
  }

  const reviewSnapshot = asRecord(data.reviewSnapshot)
  const reviewValidation = asRecord(data.reviewValidation)
  const metadata = asRecord(data.metadata)
  const metadataMilestones = asRecordArray(metadata?.milestones)
  const metadataFindings = asRecordArray(metadata?.findings)
  const snapshotHeader = asRecord(reviewSnapshot?.header)
  const snapshotSummary = asRecord(reviewSnapshot?.summary)
  const snapshotStats = asRecord(reviewSnapshot?.stats)
  const snapshotMilestones = asRecordArray(reviewSnapshot?.milestones)
  const snapshotFindings = asRecordArray(reviewSnapshot?.findings)
  const structuredFindings = asRecordArray(data.structuredFindings)
  const issues = normalizeIssues(reviewValidation?.issues || data.issues)

  const rawPath = asString(data.path) || asString(args.path)
  const path = rawPath && isReviewDocPath(rawPath) ? rawPath : undefined

  const title =
    asString(snapshotHeader?.title)
    || asString(data.title)
    || asString(args.title)
    || deriveTitleFromPath(path)

  const status =
    normalizeStatus(reviewSnapshot?.status)
    || normalizeStatus(data.status)
    || normalizeStatus(data.currentStatus)
    || normalizeStatus(metadata?.status)
    || (toolName === 'create_review'
      ? 'in_progress'
      : toolName === 'reopen_review'
        ? 'in_progress'
      : toolName === 'finalize_review'
        ? 'completed'
        : undefined)

  const overallDecision =
    normalizeDecision(reviewSnapshot?.overallDecision)
    ?? normalizeDecision(data.overallDecision)
    ?? normalizeDecision(metadata?.overallDecision)
    ?? (toolName === 'create_review' ? null : undefined)

  const findingsBySeverity =
    getSeverityCountsFromRecord(snapshotStats?.severity)
    || getSeverityCountsFromRecord(data.findingsBySeverity)
    || getSeverityCountsFromFindings(snapshotFindings)
    || getSeverityCountsFromFindings(structuredFindings)
    || getSeverityCountsFromFindings(metadataFindings)
    || (toolName === 'create_review'
      ? { high: 0, medium: 0, low: 0 }
      : undefined)

  const totalMilestones =
    asNumber(snapshotStats?.totalMilestones)
    ?? asNumber(data.totalMilestones)
    ?? asNumber(data.milestoneCount)
    ?? countItems(snapshotMilestones)
    ?? countItems(metadataMilestones)
    ?? (toolName === 'create_review' ? 0 : undefined)

  const completedMilestones =
    asNumber(snapshotStats?.completedMilestones)
    ?? asNumber(data.completedMilestones)
    ?? countCompletedMilestones(snapshotMilestones)
    ?? countCompletedMilestones(metadataMilestones)
    ?? (toolName === 'create_review' ? 0 : undefined)

  const totalFindings =
    asNumber(snapshotStats?.totalFindings)
    ?? asNumber(data.totalFindings)
    ?? countItems(snapshotFindings)
    ?? countItems(structuredFindings)
    ?? countItems(metadataFindings)
    ?? (findingsBySeverity
      ? findingsBySeverity.high + findingsBySeverity.medium + findingsBySeverity.low
      : undefined)
    ?? (toolName === 'create_review' ? 0 : undefined)

  const trackingCounts =
    getTrackingCountsFromFindings(snapshotFindings)
    || getTrackingCountsFromFindings(structuredFindings)
    || getTrackingCountsFromFindings(metadataFindings)

  const reviewedModules = asStringArray(snapshotSummary?.reviewedModules).length > 0
    ? asStringArray(snapshotSummary?.reviewedModules)
    : asStringArray(data.reviewedModules).length > 0
      ? asStringArray(data.reviewedModules)
      : asStringArray(metadata?.reviewedModules)

  const latestConclusion =
    asString(snapshotSummary?.latestConclusion)
    || asString(data.latestConclusion)
    || asString(metadata?.latestConclusion)
  const recommendedNextAction =
    asString(snapshotSummary?.recommendedNextAction)
    || asString(data.recommendedNextAction)
    || asString(metadata?.recommendedNextAction)

  const latestConclusionPreview = latestConclusion
    ? extractPreviewText(latestConclusion, { maxLines: 3, maxChars: 220 })
    : undefined

  const recommendedNextActionPreview = recommendedNextAction
    ? extractPreviewText(recommendedNextAction, { maxLines: 2, maxChars: 140 })
    : undefined

  const issueCount = asNumber(reviewValidation?.issueCount) ?? asNumber(data.issueCount) ?? (toolName === 'validate_review_document' ? issues.length : undefined)
  const errorCount = asNumber(reviewValidation?.errorCount)
    ?? asNumber(data.errorCount)
    ?? (toolName === 'validate_review_document'
      ? issues.filter((issue) => issue.severity === 'error').length
      : undefined)
  const warningCount = asNumber(reviewValidation?.warningCount)
    ?? asNumber(data.warningCount)
    ?? (toolName === 'validate_review_document'
      ? issues.filter((issue) => issue.severity === 'warning').length
      : undefined)

  const primaryFindingSource = (snapshotFindings || []).length > 0
    ? snapshotFindings
    : (structuredFindings || []).length > 0
      ? structuredFindings
      : metadataFindings || []
  const card: ReviewCardData = {
    path,
    title,
    date: asString(snapshotHeader?.date) || asString(data.date),
    status,
    overallDecision,
    totalMilestones,
    completedMilestones,
    currentProgress: asString(data.currentProgress) || (reviewSnapshot ? buildCurrentProgressFromSnapshot(reviewSnapshot) : undefined),
    reviewedModules,
    reviewedModulesCount: reviewedModules.length,
    totalFindings,
    highCount: findingsBySeverity?.high,
    mediumCount: findingsBySeverity?.medium,
    lowCount: findingsBySeverity?.low,
    latestConclusion,
    latestConclusionPreview,
    recommendedNextAction,
    recommendedNextActionPreview,
    openTrackingCount: trackingCounts?.open,
    acceptedRiskTrackingCount: trackingCounts?.accepted_risk,
    fixedTrackingCount: trackingCounts?.fixed,
    wontFixTrackingCount: trackingCounts?.wont_fix,
    duplicateTrackingCount: trackingCounts?.duplicate,
    isValid: asBoolean(reviewValidation?.isValid ?? data.isValid),
    issueCount,
    errorCount,
    warningCount,
    detectedFormat: normalizeDetectedFormat(reviewValidation?.detectedFormat) || normalizeDetectedFormat(data.detectedFormat) || (reviewSnapshot ? 'v4' : undefined),
    canAutoUpgrade: asBoolean(reviewValidation?.canAutoUpgrade ?? data.canAutoUpgrade),
    issues: issues.length > 0 ? issues : undefined,
    findingItems: normalizeFindingItems(primaryFindingSource),
    sourceTool: toolName
  }

  const hasMeaningfulData = Boolean(
    card.path
    || card.title
    || card.status
    || typeof card.totalMilestones === 'number'
    || typeof card.totalFindings === 'number'
    || typeof card.issueCount === 'number'
  )

  return hasMeaningfulData ? card : null
}
