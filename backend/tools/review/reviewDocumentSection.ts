/**
 * Review 文档协议与渲染工具
 */

import { createHash } from 'crypto';
import {
  DEFAULT_FINAL_CONCLUSION,
  DEFAULT_REVIEW_SCOPE,
  NO_FINDINGS_PLACEHOLDER,
  NO_MILESTONES_PLACEHOLDER,
  REVIEW_FINAL_CONCLUSION_SECTION_TITLE,
  REVIEW_FINDINGS_END,
  REVIEW_FINDINGS_SECTION_TITLE,
  REVIEW_FINDINGS_START,
  REVIEW_METADATA_END,
  REVIEW_METADATA_START,
  REVIEW_MILESTONES_END,
  REVIEW_MILESTONES_SECTION_TITLE,
  REVIEW_MILESTONES_START,
  REVIEW_SCOPE_SECTION_TITLE,
  REVIEW_SNAPSHOT_RENDERER_VERSION,
  REVIEW_SNAPSHOT_SECTION_TITLE,
  REVIEW_SUMMARY_END,
  REVIEW_SUMMARY_SECTION_TITLE,
  REVIEW_SUMMARY_START,
  type ReviewDocumentFormat,
  type ReviewDocumentLocale,
  type ReviewDocumentMetadataV3,
  type ReviewDocumentSummarySnapshot,
  type ReviewDocumentTemplateInput,
  type ReviewEvidenceRef,
  type ReviewFinalizeInput,
  type ReviewFindingCategory,
  type ReviewFindingInput,
  type ReviewFindingRecord,
  type ReviewFindingRecordV4,
  type ReviewFindingSeverity,
  type ReviewFindingTrackingStatus,
  type ReviewMilestoneInput,
  type ReviewMilestoneRecord,
  type ReviewMilestoneRecordV4,
  type ReviewMilestoneStatus,
  type ReviewOverallDecision,
  type ReviewSnapshotV4,
  type ReviewValidationIssue,
  type ReviewValidationResult
} from './schema';
import {
  getActualLanguage,
  getMessagesForLanguage
} from '../../i18n';

export {
  DEFAULT_FINAL_CONCLUSION,
  DEFAULT_REVIEW_SCOPE,
  NO_FINDINGS_PLACEHOLDER,
  NO_MILESTONES_PLACEHOLDER,
  REVIEW_FINAL_CONCLUSION_SECTION_TITLE,
  REVIEW_FINDINGS_END,
  REVIEW_FINDINGS_SECTION_TITLE,
  REVIEW_FINDINGS_START,
  REVIEW_METADATA_END,
  REVIEW_METADATA_START,
  REVIEW_MILESTONES_END,
  REVIEW_MILESTONES_SECTION_TITLE,
  REVIEW_MILESTONES_START,
  REVIEW_SCOPE_SECTION_TITLE,
  REVIEW_SNAPSHOT_RENDERER_VERSION,
  REVIEW_SNAPSHOT_SECTION_TITLE,
  REVIEW_SUMMARY_END,
  REVIEW_SUMMARY_SECTION_TITLE,
  REVIEW_SUMMARY_START
} from './schema';
export type {
  ReviewDocumentFormat,
  ReviewDocumentMetadataV3,
  ReviewDocumentSummarySnapshot,
  ReviewDocumentTemplateInput,
  ReviewEvidenceRef,
  ReviewFinalizeInput,
  ReviewFindingCategory,
  ReviewFindingInput,
  ReviewFindingRecord,
  ReviewFindingRecordV4,
  ReviewFindingSeverity,
  ReviewFindingTrackingStatus,
  ReviewMilestoneInput,
  ReviewMilestoneRecord,
  ReviewMilestoneRecordV4,
  ReviewMilestoneStatus,
  ReviewOverallDecision,
  ReviewSnapshotV4,
  ReviewDocumentLocale,
  ReviewValidationIssue,
  ReviewValidationResult
} from './schema';

interface ReviewHeaderMetadata {
  title: string;
  date: string;
  overview: string;
  status: ReviewMilestoneStatus;
  overallDecision?: ReviewOverallDecision;
}

interface ParsedSection {
  heading: string;
  body: string;
}

interface ParsedReviewSummary {
  reviewedModules: string[];
  latestConclusion?: string;
  recommendedNextAction?: string;
  overallDecision?: ReviewOverallDecision;
}

interface ParsedLegacyMilestone {
  id: string;
  title: string;
  summary: string;
  status: ReviewMilestoneStatus;
  conclusion: string | null;
  evidenceFiles: string[];
  reviewedModules: string[];
  recommendedNextAction: string | null;
  recordedAt: string;
  findingTexts: string[];
}

interface ReviewDocumentV3State {
  header: ReviewHeaderMetadata;
  scope: string;
  metadata: ReviewDocumentMetadataV3;
  detectedFormat: 'v2' | 'v3';
}

interface ReviewDocumentV4State {
  snapshot: ReviewSnapshotV4;
  body: string;
  detectedFormat: ReviewDocumentFormat;
}

const REVIEW_MILESTONE_HEADING_REGEX = /^###\s+([^\s]+)\s+·\s+(.+)$/gm;
const REVIEW_FINDING_HEADING_REGEX = /^###\s+([^\s]+)\s+·\s+(.+)$/gm;
const V4_BODY_SECTION_ORDER = [
  REVIEW_SCOPE_SECTION_TITLE,
  REVIEW_SUMMARY_SECTION_TITLE,
  REVIEW_FINDINGS_SECTION_TITLE,
  REVIEW_MILESTONES_SECTION_TITLE,
  REVIEW_FINAL_CONCLUSION_SECTION_TITLE,
  REVIEW_SNAPSHOT_SECTION_TITLE
];
const LEGACY_CANONICAL_SECTION_ORDER = [
  REVIEW_SCOPE_SECTION_TITLE,
  REVIEW_SUMMARY_SECTION_TITLE,
  REVIEW_FINDINGS_SECTION_TITLE,
  REVIEW_MILESTONES_SECTION_TITLE
];
const AUTO_FIXABLE_V4_CODES = new Set([
  'body_out_of_sync_with_snapshot',
  'stats_out_of_sync',
  'body_hash_mismatch'
]);

type ReviewDocumentMessages = ReturnType<typeof getMessagesForLanguage>['tools']['reviewDocument'];

const REVIEW_DOCUMENT_LOCALES: ReviewDocumentLocale[] = ['zh-CN', 'en', 'ja'];

function applyTemplate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key] !== undefined ? String(params[key]) : match;
  });
}

export function resolveReviewDocumentLocale(
  value: unknown,
  fallback: ReviewDocumentLocale = 'en'
): ReviewDocumentLocale {
  if (value === 'en' || value === 'ja' || value === 'zh-CN') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.startsWith('zh')) return 'zh-CN';
    if (value.startsWith('en')) return 'en';
    if (value.startsWith('ja')) return 'ja';
  }
  return fallback;
}

export function getCurrentReviewDocumentLocale(fallback: ReviewDocumentLocale = 'zh-CN'): ReviewDocumentLocale {
  return resolveReviewDocumentLocale(getActualLanguage(), fallback);
}

function getReviewDocumentMessages(locale: ReviewDocumentLocale): ReviewDocumentMessages {
  return getMessagesForLanguage(resolveReviewDocumentLocale(locale)).tools.reviewDocument;
}

function getReviewSectionHeadings(locale: ReviewDocumentLocale): {
  scope: string;
  summary: string;
  findings: string;
  milestones: string;
  finalConclusion: string;
  snapshot: string;
} {
  const sections = getReviewDocumentMessages(locale).sections;
  return {
    scope: `## ${sections.scope}`,
    summary: `## ${sections.summary}`,
    findings: `## ${sections.findings}`,
    milestones: `## ${sections.milestones}`,
    finalConclusion: `## ${sections.finalConclusion}`,
    snapshot: `## ${sections.snapshot}`
  };
}

function inferReviewDocumentLocaleFromSnapshotHeading(heading: string): ReviewDocumentLocale | undefined {
  const normalized = normalizeHeadingToken(heading);
  for (const locale of REVIEW_DOCUMENT_LOCALES) {
    const snapshotHeading = getReviewSectionHeadings(locale).snapshot.replace(/^##\s+/, '');
    if (normalizeHeadingToken(snapshotHeading) === normalized) {
      return locale;
    }
  }
  return undefined;
}

function isSnapshotHeading(heading: string): boolean {
  const normalized = normalizeHeadingToken(heading);
  return REVIEW_DOCUMENT_LOCALES.some((locale) => {
    const snapshotHeading = getReviewSectionHeadings(locale).snapshot.replace(/^##\s+/, '');
    return normalizeHeadingToken(snapshotHeading) === normalized;
  });
}

function formatCurrentProgress(snapshot: ReviewSnapshotV4, locale: ReviewDocumentLocale): string {
  const messages = getReviewDocumentMessages(locale);
  if (snapshot.stats.totalMilestones > 0) {
    return applyTemplate(messages.templates.currentProgressWithLatest, {
      count: snapshot.stats.totalMilestones,
      latestId: snapshot.milestones[snapshot.milestones.length - 1]?.id || ''
    });
  }
  return messages.templates.currentProgressEmpty;
}

function formatEvidenceRefText(ref: ReviewEvidenceRef): string {
  const path = normalizeSingleLineText(ref.path);
  if (!path) return '';
  const lineStart = ref.lineStart;
  const lineEnd = ref.lineEnd;
  const linePart = lineStart
    ? `:${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ''}`
    : '';
  const symbol = normalizeSingleLineText(ref.symbol);
  const symbolPart = symbol ? `#${symbol}` : '';
  return `${path}${linePart}${symbolPart}`;
}

function countSnapshotSectionHeadings(content: string): number {
  return parseH2Sections(content).filter((section) => isSnapshotHeading(section.heading)).length;
}

function getV4BodySectionOrder(locale: ReviewDocumentLocale): string[] {
  const headings = getReviewSectionHeadings(locale);
  return [
    headings.scope,
    headings.summary,
    headings.findings,
    headings.milestones,
    headings.finalConclusion,
    headings.snapshot
  ];
}

function getDisplayMilestoneStatus(status: ReviewMilestoneStatus, locale: ReviewDocumentLocale): string {
  const values = getReviewDocumentMessages(locale).values.milestoneStatus;
  return status === 'completed' ? values.completed : values.inProgress;
}

function getDisplayOverallDecision(
  decision: ReviewOverallDecision | null | undefined,
  locale: ReviewDocumentLocale
): string {
  const values = getReviewDocumentMessages(locale).values.overallDecision;
  if (!decision) return values.pending;
  switch (decision) {
    case 'accepted':
      return values.accepted;
    case 'conditionally_accepted':
      return values.conditionallyAccepted;
    case 'rejected':
      return values.rejected;
    case 'needs_follow_up':
      return values.needsFollowUp;
    default:
      return values.pending;
  }
}

function getDisplaySeverity(severity: ReviewFindingSeverity, locale: ReviewDocumentLocale): string {
  return getReviewDocumentMessages(locale).values.severity[severity];
}

function getDisplayCategory(category: ReviewFindingCategory, locale: ReviewDocumentLocale): string {
  return getReviewDocumentMessages(locale).values.category[category];
}

function getDisplayTrackingStatus(status: ReviewFindingTrackingStatus, locale: ReviewDocumentLocale): string {
  const values = getReviewDocumentMessages(locale).values.trackingStatus;
  switch (status) {
    case 'accepted_risk':
      return values.acceptedRisk;
    case 'fixed':
      return values.fixed;
    case 'wont_fix':
      return values.wontFix;
    case 'duplicate':
      return values.duplicate;
    default:
      return values.open;
  }
}

function getPendingText(locale: ReviewDocumentLocale): string {
  return getReviewDocumentMessages(locale).values.pending;
}

function getLocalizedDefaultReviewScope(locale: ReviewDocumentLocale): string {
  return getReviewDocumentMessages(locale).placeholders.defaultReviewScope;
}

function getLocalizedDefaultFinalConclusion(locale: ReviewDocumentLocale): string {
  return getReviewDocumentMessages(locale).placeholders.defaultFinalConclusion;
}

function getLocalizedNoFindingsPlaceholder(locale: ReviewDocumentLocale): string {
  const placeholder = getReviewDocumentMessages(locale).placeholders.noFindings;
  return placeholder || NO_FINDINGS_PLACEHOLDER;
}

function getLocalizedNoMilestonesPlaceholder(locale: ReviewDocumentLocale): string {
  const placeholder = getReviewDocumentMessages(locale).placeholders.noMilestones;
  return placeholder || NO_MILESTONES_PLACEHOLDER;
}

function formatFindingsBySeverity(counts: Record<ReviewFindingSeverity, number>, locale: ReviewDocumentLocale): string {
  return applyTemplate(getReviewDocumentMessages(locale).templates.findingsBySeverity, {
    high: counts.high,
    medium: counts.medium,
    low: counts.low
  });
}

function joinDisplayList(items: string[], locale: ReviewDocumentLocale): string {
  return items.length > 0 ? items.join(', ') : getPendingText(locale);
}

function formatSingleLineValue(value: string | null | undefined, locale: ReviewDocumentLocale): string {
  return normalizeSingleLineText(value) || getPendingText(locale);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeLineEndings(text: string): string {
  return (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSingleLineText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeMarkdownText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return normalizeLineEndings(input).trim();
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of input) {
    const value = normalizeSingleLineText(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeSingleLineText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeMilestoneStatus(value: unknown): ReviewMilestoneStatus {
  return value === 'completed' ? 'completed' : 'in_progress';
}

function normalizeFindingSeverity(value: unknown): ReviewFindingSeverity {
  return value === 'high' || value === 'medium' ? value : 'low';
}

function normalizeFindingCategory(value: unknown): ReviewFindingCategory {
  const normalized = normalizeSingleLineText(value).toLowerCase();
  switch (normalized) {
    case 'html':
    case 'css':
    case 'javascript':
    case 'js':
      return normalized === 'js' ? 'javascript' : (normalized as ReviewFindingCategory);
    case 'accessibility':
    case 'performance':
    case 'maintainability':
    case 'docs':
    case 'test':
      return normalized as ReviewFindingCategory;
    default:
      return 'other';
  }
}

function normalizeFindingTrackingStatus(value: unknown): ReviewFindingTrackingStatus {
  return value === 'accepted_risk'
    || value === 'fixed'
    || value === 'wont_fix'
    || value === 'duplicate'
    ? value
    : 'open';
}

function normalizeOverallDecision(value: unknown): ReviewOverallDecision | undefined {
  return value === 'accepted'
    || value === 'conditionally_accepted'
    || value === 'rejected'
    || value === 'needs_follow_up'
    ? value
    : undefined;
}

function normalizeNullableMarkdown(value: unknown): string | null {
  const normalized = normalizeMarkdownText(value);
  return normalized || null;
}

function formatDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date: Date = new Date()): string {
  return date.toISOString();
}

function parseDateToIsoStart(dateText: string): string {
  const value = normalizeSingleLineText(dateText);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? formatDateTime() : parsed.toISOString();
}

function createReviewRunId(date: Date = new Date()): string {
  return `review-${date.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeIdFragment(input: string, fallback: string): string {
  const normalized = normalizeSingleLineText(input)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return normalized || fallback;
}

function normalizeComparableReviewText(value: string): string {
  return normalizeSingleLineText(value)
    .replace(/[`*_~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isFindingTitleNotConcise(title: string): boolean {
  const normalized = normalizeSingleLineText(title);
  if (!normalized) return false;

  const hasFileReference = /`[^`]+\.[^`]*:\d[^`]*`/.test(normalized)
    || /(?:^|\s)[^`\s]+?\.[a-z0-9_-]+:\d[\d,-]*/i.test(normalized);
  const hasClauseSeparator = /[，；]|,\s|;\s|:\s|：/.test(normalized);
  const hasRecommendationCue = /(建议|应统一|应改|需要|推荐|recommend|recommended|should|needs to|follow-up|べき|必要)/i.test(normalized);

  return (hasFileReference && (normalized.length > 24 || hasClauseSeparator || hasRecommendationCue))
    || (normalized.length > 64 && (hasClauseSeparator || hasRecommendationCue));
}

function isFindingTitleRepeatingDescription(title: string, description?: string | null): boolean {
  const normalizedTitle = normalizeComparableReviewText(title).replace(/[。.!?]+$/g, '');
  const normalizedDescription = normalizeComparableReviewText(description || '').replace(/[。.!?]+$/g, '');
  if (!normalizedTitle || !normalizedDescription || normalizedTitle.length < 24) {
    return false;
  }
  return normalizedTitle === normalizedDescription
    || normalizedDescription.startsWith(normalizedTitle)
    || normalizedTitle.startsWith(normalizedDescription);
}

function buildFindingIdBase(preferredTitle: string, category: ReviewFindingCategory, indexHint: number): string {
  const titleBase = sanitizeIdFragment(preferredTitle, '');
  const categoryBase = sanitizeIdFragment(category, 'finding');
  if (!titleBase || titleBase.length > 32 || isFindingTitleNotConcise(preferredTitle)) {
    return `${categoryBase}-${indexHint}`;
  }
  return titleBase;
}

function nextFindingId(existingIds: Set<string>, preferredTitle: string, category: ReviewFindingCategory, indexHint: number): string {
  const base = buildFindingIdBase(preferredTitle, category, indexHint);
  let candidate = `F-${base}`;
  let cursor = 2;
  while (existingIds.has(candidate)) {
    candidate = `F-${base}-${cursor}`;
    cursor += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

function nextMilestoneId(existingIds: Set<string>, indexHint: number): string {
  let candidate = `M${indexHint}`;
  let cursor = indexHint + 1;
  while (existingIds.has(candidate)) {
    candidate = `M${cursor}`;
    cursor += 1;
  }
  existingIds.add(candidate);
  return candidate;
}

function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const int = Math.trunc(value);
    return int > 0 ? int : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function serializeEvidenceRefKey(ref: ReviewEvidenceRef): string {
  return [
    normalizeSingleLineText(ref.path),
    ref.lineStart ?? '',
    ref.lineEnd ?? '',
    normalizeSingleLineText(ref.symbol),
    normalizeSingleLineText(ref.excerptHash)
  ].join('|');
}

function normalizeEvidenceRefs(input: unknown): ReviewEvidenceRef[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: ReviewEvidenceRef[] = [];

  for (const item of input) {
    if (typeof item === 'string') {
      const path = normalizeSingleLineText(item);
      if (!path) continue;
      const ref: ReviewEvidenceRef = { path };
      const key = serializeEvidenceRefKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(ref);
      continue;
    }

    const record = asRecord(item);
    if (!record) continue;
    const path = normalizeSingleLineText(record.path);
    if (!path) continue;
    const ref: ReviewEvidenceRef = {
      path,
      lineStart: parseOptionalInt(record.lineStart),
      lineEnd: parseOptionalInt(record.lineEnd),
      symbol: normalizeSingleLineText(record.symbol) || undefined,
      excerptHash: normalizeSingleLineText(record.excerptHash) || undefined
    };
    const key = serializeEvidenceRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }

  return result;
}

function mergeEvidenceRefs(existing: ReviewEvidenceRef[], incoming: ReviewEvidenceRef[]): ReviewEvidenceRef[] {
  return normalizeEvidenceRefs([...existing, ...incoming]);
}

function evidenceFilesToRefs(evidenceFiles: unknown): ReviewEvidenceRef[] {
  return normalizeEvidenceRefs(normalizeStringList(evidenceFiles));
}

function evidenceRefsToFiles(evidence: ReviewEvidenceRef[]): string[] {
  return uniqueStrings(evidence.map((item) => item.path));
}

function normalizeFindingInput(
  input: ReviewFindingInput,
  fallbackMilestoneId?: string,
  fallbackEvidenceFiles?: string[]
): ReviewFindingInput {
  const fallbackEvidence = evidenceFilesToRefs(fallbackEvidenceFiles);
  const evidence = mergeEvidenceRefs(normalizeEvidenceRefs(input.evidence), fallbackEvidence);
  const evidenceFiles = uniqueStrings([
    ...normalizeStringList(input.evidenceFiles),
    ...evidenceRefsToFiles(normalizeEvidenceRefs(input.evidence)),
    ...evidenceRefsToFiles(fallbackEvidence),
    ...normalizeStringList(fallbackEvidenceFiles)
  ]);
  const relatedMilestoneIds = uniqueStrings([
    ...normalizeStringList(input.relatedMilestoneIds),
    ...(fallbackMilestoneId ? [fallbackMilestoneId] : [])
  ]);

  return {
    id: normalizeSingleLineText(input.id),
    severity: normalizeFindingSeverity(input.severity),
    category: normalizeFindingCategory(input.category),
    title: normalizeSingleLineText(input.title),
    description: normalizeMarkdownText(input.description),
    evidenceFiles,
    evidence,
    relatedMilestoneIds,
    recommendation: normalizeMarkdownText(input.recommendation),
    trackingStatus: normalizeFindingTrackingStatus(input.trackingStatus)
  };
}

function convertLegacyFindingToStructured(
  text: string,
  milestoneId?: string,
  evidenceFiles?: string[]
): ReviewFindingInput {
  return normalizeFindingInput(
    {
      title: normalizeSingleLineText(text),
      severity: 'low',
      category: 'other',
      trackingStatus: 'open'
    },
    milestoneId,
    evidenceFiles
  );
}

function metadataFindingToInput(record: ReviewFindingRecord): ReviewFindingInput {
  return {
    id: record.id,
    severity: record.severity,
    category: record.category,
    title: record.title,
    description: record.description || undefined,
    evidenceFiles: [...record.evidenceFiles],
    evidence: evidenceFilesToRefs(record.evidenceFiles),
    relatedMilestoneIds: [...record.relatedMilestoneIds],
    recommendation: record.recommendation || undefined,
    trackingStatus: 'open'
  };
}

function snapshotFindingToInput(record: ReviewFindingRecordV4): ReviewFindingInput {
  return {
    id: record.id,
    severity: record.severity,
    category: record.category,
    title: record.title,
    description: record.descriptionMarkdown || undefined,
    evidenceFiles: evidenceRefsToFiles(record.evidence),
    evidence: [...record.evidence],
    relatedMilestoneIds: [...record.relatedMilestoneIds],
    recommendation: record.recommendationMarkdown || undefined,
    trackingStatus: record.trackingStatus
  };
}

function getFindingMergeKey(input: ReviewFindingInput): string {
  const id = normalizeSingleLineText(input.id);
  if (id) return `id:${id}`;
  return [
    normalizeFindingSeverity(input.severity),
    normalizeFindingCategory(input.category),
    normalizeSingleLineText(input.title).toLowerCase()
  ].join('|');
}

function formatFindingSummaryText(input: ReviewFindingInput, locale?: ReviewDocumentLocale): string {
  const title = normalizeSingleLineText(input.title);
  const severity = normalizeFindingSeverity(input.severity);
  const category = normalizeFindingCategory(input.category);
  if (locale) {
    return `[${getDisplaySeverity(severity, locale)}] ${getDisplayCategory(category, locale)}: ${title}`;
  }
  return `[${severity}] ${category}: ${title}`;
}

function normalizeFindingRecordV4(
  input: ReviewFindingInput,
  existingIds: Set<string>,
  preferredId?: string,
  indexHint: number = existingIds.size + 1
): ReviewFindingRecordV4 {
  const normalized = normalizeFindingInput(input);
  const category = normalizeFindingCategory(normalized.category);
  const requestedId = normalizeSingleLineText(preferredId || normalized.id);
  const id = requestedId || nextFindingId(existingIds, normalized.title, category, indexHint);
  existingIds.add(id);

  return {
    id,
    severity: normalizeFindingSeverity(normalized.severity),
    category,
    title: normalizeSingleLineText(normalized.title),
    descriptionMarkdown: normalizeNullableMarkdown(normalized.description),
    recommendationMarkdown: normalizeNullableMarkdown(normalized.recommendation),
    evidence: mergeEvidenceRefs(normalizeEvidenceRefs(normalized.evidence), evidenceFilesToRefs(normalized.evidenceFiles)),
    relatedMilestoneIds: normalizeStringList(normalized.relatedMilestoneIds),
    trackingStatus: normalizeFindingTrackingStatus(normalized.trackingStatus)
  };
}

function mergeFindingRecords(
  existing: ReviewFindingRecordV4[],
  incoming: ReviewFindingInput[]
): { findings: ReviewFindingRecordV4[]; addedFindingIds: string[] } {
  const merged = new Map<string, ReviewFindingInput>();
  const existingByKey = new Map<string, ReviewFindingRecordV4>();

  for (const current of existing) {
    const input = snapshotFindingToInput(current);
    const key = getFindingMergeKey(input);
    merged.set(key, input);
    existingByKey.set(key, current);
  }

  for (const item of incoming) {
    const normalized = normalizeFindingInput(item);
    if (!normalized.title) continue;

    const key = getFindingMergeKey(normalized);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, normalized);
      continue;
    }

    merged.set(key, {
      id: current.id || normalized.id,
      severity: current.severity || normalized.severity,
      category: current.category || normalized.category,
      title: current.title || normalized.title,
      description: (normalized.description || '').length > (current.description || '').length
        ? normalized.description
        : current.description,
      evidenceFiles: uniqueStrings([...(current.evidenceFiles || []), ...(normalized.evidenceFiles || [])]),
      evidence: mergeEvidenceRefs(normalizeEvidenceRefs(current.evidence), normalizeEvidenceRefs(normalized.evidence)),
      relatedMilestoneIds: uniqueStrings([...(current.relatedMilestoneIds || []), ...(normalized.relatedMilestoneIds || [])]),
      recommendation: current.recommendation || normalized.recommendation,
      trackingStatus: current.trackingStatus || normalized.trackingStatus || 'open'
    });
  }

  const usedIds = new Set<string>();
  const addedFindingIds: string[] = [];
  const findings = Array.from(merged.entries()).map(([key, input], index) => {
    const matchedExisting = existingByKey.get(key)
      || existing.find((current) => current.id === normalizeSingleLineText(input.id));
    const record = normalizeFindingRecordV4(input, usedIds, matchedExisting?.id || input.id, index + 1);
    if (!matchedExisting) {
      addedFindingIds.push(record.id);
    }
    return record;
  });

  return { findings, addedFindingIds };
}

function countFindingsBySeverity(findings: Array<ReviewFindingInput | ReviewFindingRecord | ReviewFindingRecordV4>): Record<ReviewFindingSeverity, number> {
  const counts: Record<ReviewFindingSeverity, number> = {
    high: 0,
    medium: 0,
    low: 0
  };

  for (const finding of findings) {
    counts[normalizeFindingSeverity((finding as ReviewFindingInput).severity)] += 1;
  }

  return counts;
}

function parseH2Sections(content: string): ParsedSection[] {
  const normalized = normalizeLineEndings(content);
  const matches = Array.from(normalized.matchAll(/^##\s+(.+)$/gm));
  if (matches.length === 0) return [];

  const sections: ParsedSection[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const nextMatch = matches[i + 1];
    const start = match.index ?? 0;
    const end = nextMatch?.index ?? normalized.length;
    const heading = normalizeSingleLineText(match[1]);
    const lineEnd = normalized.indexOf('\n', start);
    const bodyStart = lineEnd >= 0 ? lineEnd + 1 : end;
    const body = normalized.slice(bodyStart, end).trim();
    sections.push({ heading, body });
  }

  return sections;
}

function normalizeHeadingToken(heading: string): string {
  return normalizeSingleLineText(heading)
    .toLowerCase()
    .replace(/[\s\-_:：，,.()（）\[\]【】'"`]+/g, '');
}

function isScopeHeading(heading: string): boolean {
  const token = normalizeHeadingToken(heading);
  return [
    'reviewscope',
    'scope',
    'reviewplan',
    'plan',
    '审查范围',
    '评审范围',
    '审查计划',
    '评审计划',
    'レビュー範囲',
    'レビュー計画'
  ].includes(token);
}

function isSummaryHeading(heading: string): boolean {
  const token = normalizeHeadingToken(heading);
  return ['reviewsummary', 'summary', '审查摘要', '评审摘要', '总结', 'レビュー要約', '要約'].includes(token);
}

function isFindingsHeading(heading: string): boolean {
  const token = normalizeHeadingToken(heading);
  return ['reviewfindings', 'findings', '审查发现', '评审发现', '问题', '发现', 'レビュー所見', '指摘'].includes(token);
}

function isMilestonesHeading(heading: string): boolean {
  const token = normalizeHeadingToken(heading);
  return ['reviewmilestones', 'milestones', '审查里程碑', '评审里程碑', '里程碑', 'レビューマイルストーン', 'マイルストーン'].includes(token);
}

function demoteSectionIntoScope(heading: string, body: string): string {
  const normalizedHeading = normalizeSingleLineText(heading);
  const normalizedBody = normalizeMarkdownText(body);
  if (!normalizedHeading) return normalizedBody;
  if (!normalizedBody) return `### ${normalizedHeading}`;
  return `### ${normalizedHeading}\n${normalizedBody}`;
}

function findSectionRange(
  content: string,
  startMarker: string,
  endMarker: string
): { start: number; bodyStart: number; endStart: number; end: number } | null {
  const start = content.indexOf(startMarker);
  const endStart = start >= 0 ? content.indexOf(endMarker, start + startMarker.length) : -1;
  if (start < 0 || endStart < 0 || endStart < start) return null;

  return {
    start,
    bodyStart: start + startMarker.length,
    endStart,
    end: endStart + endMarker.length
  };
}

export function extractReviewSectionBody(content: string, startMarker: string, endMarker: string): string {
  const normalized = normalizeLineEndings(content);
  const range = findSectionRange(normalized, startMarker, endMarker);
  if (!range) return '';
  return normalized.slice(range.bodyStart, range.endStart).trim();
}

function extractLooseHeaderContent(content: string): string {
  const normalized = normalizeLineEndings(content).replace(
    new RegExp(`${escapeRegExp(REVIEW_METADATA_START)}[\\s\\S]*?${escapeRegExp(REVIEW_METADATA_END)}\\s*`, 'g'),
    ''
  );
  const firstSectionMatch = /^##\s+/m.exec(normalized);
  const headerBlock = firstSectionMatch ? normalized.slice(0, firstSectionMatch.index).trim() : normalized.trim();
  if (!headerBlock) return '';

  const cleanedLines = headerBlock
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^#\s+/.test(trimmed)) return false;
      if (/^- Date:\s*/.test(trimmed)) return false;
      if (/^- Overview:\s*/.test(trimmed)) return false;
      if (/^- Status:\s*/.test(trimmed)) return false;
      if (/^- Overall decision:\s*/i.test(trimmed)) return false;
      return true;
    });

  return cleanedLines.join('\n').trim();
}

function extractLegacyFindingStrings(body: string): string[] {
  return normalizeLineEndings(body)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => normalizeSingleLineText(line.replace(/^[-*]\s+/, '')))
    .filter(Boolean);
}

function extractLegacySummaryBody(content: string): string {
  const sections = parseH2Sections(content);
  const section = sections.find((item) => isSummaryHeading(item.heading));
  return normalizeMarkdownText(section?.body || '');
}

function extractLegacyFindings(content: string): string[] {
  const sections = parseH2Sections(content);
  const findings: string[] = [];
  for (const section of sections) {
    if (!isFindingsHeading(section.heading)) continue;
    findings.push(...extractLegacyFindingStrings(section.body));
  }
  return uniqueStrings(findings);
}

export function extractInitialReviewScope(content: string): string {
  const normalized = normalizeLineEndings(content);
  const sections = parseH2Sections(normalized);
  const hasSummaryMarkers = !!findSectionRange(normalized, REVIEW_SUMMARY_START, REVIEW_SUMMARY_END);
  const hasFindingsMarkers = !!findSectionRange(normalized, REVIEW_FINDINGS_START, REVIEW_FINDINGS_END);
  const hasMilestoneMarkers = !!findSectionRange(normalized, REVIEW_MILESTONES_START, REVIEW_MILESTONES_END);

  const scopeParts: string[] = [];
  const looseHeader = extractLooseHeaderContent(normalized);
  if (looseHeader) {
    scopeParts.push(looseHeader);
  }

  for (const section of sections) {
    if (isScopeHeading(section.heading)) {
      const body = normalizeMarkdownText(section.body);
      if (body) scopeParts.push(body);
      continue;
    }

    if (isSummaryHeading(section.heading)) {
      if (!hasSummaryMarkers) {
        const body = normalizeMarkdownText(section.body);
        if (body) scopeParts.push(demoteSectionIntoScope(section.heading, body));
      }
      continue;
    }

    if (isFindingsHeading(section.heading)) {
      if (!hasFindingsMarkers) {
        const body = normalizeMarkdownText(section.body);
        if (body && extractLegacyFindingStrings(body).length === 0) {
          scopeParts.push(demoteSectionIntoScope(section.heading, body));
        }
      }
      continue;
    }

    if (isMilestonesHeading(section.heading)) {
      if (!hasMilestoneMarkers) {
        const body = normalizeMarkdownText(section.body);
        if (body) scopeParts.push(demoteSectionIntoScope(section.heading, body));
      }
      continue;
    }

    const body = normalizeMarkdownText(section.body);
    if (body || section.heading) {
      scopeParts.push(demoteSectionIntoScope(section.heading, body));
    }
  }

  const scope = scopeParts.filter(Boolean).join('\n\n').trim();
  return scope || DEFAULT_REVIEW_SCOPE;
}

function countOccurrences(content: string, token: string): number {
  return Array.from(content.matchAll(new RegExp(escapeRegExp(token), 'g'))).length;
}

function detectSectionOrder(content: string, sectionTitles: string[]): boolean {
  const indices = sectionTitles.map((title) => content.indexOf(title));
  if (indices.some((index) => index < 0)) return false;
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i] <= indices[i - 1]) return false;
  }
  return true;
}

function parseHeaderMetadata(content: string): ReviewHeaderMetadata {
  const normalized = normalizeLineEndings(content);
  const titleMatch = /^#\s+(.+)$/m.exec(normalized);
  const dateMatch = /^- Date:\s*(.+)$/m.exec(normalized);
  const overviewMatch = /^- Overview:\s*(.+)$/m.exec(normalized);
  const statusMatch = /^- Status:\s*(.+)$/m.exec(normalized);
  const overallDecisionMatch = /^- Overall decision:\s*(.+)$/mi.exec(normalized);

  return {
    title: normalizeSingleLineText(titleMatch?.[1]) || 'Review',
    date: normalizeSingleLineText(dateMatch?.[1]) || formatDate(),
    overview: normalizeSingleLineText(overviewMatch?.[1]) || 'Workspace review',
    status: normalizeMilestoneStatus(statusMatch?.[1]),
    overallDecision: normalizeOverallDecision(overallDecisionMatch?.[1])
  };
}

function parseReviewSummarySection(body: string): ParsedReviewSummary {
  const normalized = normalizeMarkdownText(body);
  if (!normalized) {
    return { reviewedModules: [] };
  }

  const getLineValue = (label: string): string => {
    const match = new RegExp(`^- ${escapeRegExp(label)}:\\s*(.+)$`, 'mi').exec(normalized);
    return normalizeSingleLineText(match?.[1]);
  };

  return {
    reviewedModules: getLineValue('Reviewed modules') && getLineValue('Reviewed modules') !== 'pending'
      ? getLineValue('Reviewed modules').split(',').map((item) => normalizeSingleLineText(item)).filter(Boolean)
      : [],
    latestConclusion: getLineValue('Latest conclusion'),
    recommendedNextAction: getLineValue('Recommended next action'),
    overallDecision: normalizeOverallDecision(getLineValue('Overall decision'))
  };
}

function parseStructuredFindingBlock(blockLines: string[]): ReviewFindingInput | null {
  const firstLine = blockLines[0]?.trim() || '';
  const structuredMatch = /^- \[(high|medium|low)\]\s+([^:]+):\s+(.+)$/i.exec(firstLine);
  if (!structuredMatch) {
    const legacyText = normalizeSingleLineText(firstLine.replace(/^-\s+/, ''));
    return legacyText ? convertLegacyFindingToStructured(legacyText) : null;
  }

  const finding: ReviewFindingInput = {
    severity: normalizeFindingSeverity(structuredMatch[1].toLowerCase()),
    category: normalizeFindingCategory(structuredMatch[2]),
    title: normalizeSingleLineText(structuredMatch[3]),
    evidenceFiles: [],
    relatedMilestoneIds: [],
    trackingStatus: 'open'
  };

  let readingEvidenceFiles = false;
  for (let i = 1; i < blockLines.length; i += 1) {
    const trimmed = blockLines[i].trim();
    if (!trimmed) continue;

    if (/^- ID:\s+/i.test(trimmed)) {
      finding.id = normalizeSingleLineText(trimmed.replace(/^- ID:\s+/i, ''));
      readingEvidenceFiles = false;
      continue;
    }

    if (/^- Description:\s+/i.test(trimmed)) {
      finding.description = normalizeMarkdownText(trimmed.replace(/^- Description:\s+/i, ''));
      readingEvidenceFiles = false;
      continue;
    }

    if (/^- Evidence Files:\s*$/i.test(trimmed)) {
      readingEvidenceFiles = true;
      continue;
    }

    if (readingEvidenceFiles && /^-\s+`.+`$/.test(trimmed)) {
      const file = trimmed.replace(/^-\s+`/, '').replace(/`$/, '');
      finding.evidenceFiles = uniqueStrings([...(finding.evidenceFiles || []), file]);
      continue;
    }

    if (/^- Related Milestones:\s+/i.test(trimmed)) {
      finding.relatedMilestoneIds = uniqueStrings(
        trimmed
          .replace(/^- Related Milestones:\s+/i, '')
          .split(',')
          .map((item) => normalizeSingleLineText(item))
      );
      readingEvidenceFiles = false;
      continue;
    }

    if (/^- Recommendation:\s+/i.test(trimmed)) {
      finding.recommendation = normalizeMarkdownText(trimmed.replace(/^- Recommendation:\s+/i, ''));
      readingEvidenceFiles = false;
      continue;
    }

    if (/^- Tracking Status:\s+/i.test(trimmed)) {
      finding.trackingStatus = normalizeFindingTrackingStatus(trimmed.replace(/^- Tracking Status:\s+/i, ''));
      readingEvidenceFiles = false;
      continue;
    }

    readingEvidenceFiles = false;
  }

  return normalizeFindingInput(finding);
}

function parseReviewFindingsSection(body: string): ReviewFindingInput[] {
  const normalized = normalizeMarkdownText(body);
  if (!normalized || normalized === NO_FINDINGS_PLACEHOLDER) return [];

  const lines = normalizeLineEndings(normalized).split('\n');
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (/^-\s+/.test(line)) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [line];
      continue;
    }

    if (currentBlock.length > 0) {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks
    .map((block) => parseStructuredFindingBlock(block))
    .filter((item): item is ReviewFindingInput => !!item && !!item.title);
}

function splitLegacyMilestoneBlocks(body: string): string[] {
  const normalized = normalizeMarkdownText(body);
  if (!normalized || normalized === NO_MILESTONES_PLACEHOLDER) return [];

  const matches = Array.from(normalized.matchAll(REVIEW_MILESTONE_HEADING_REGEX));
  if (matches.length === 0) return [];

  const blocks: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = matches[i + 1]?.index ?? normalized.length;
    blocks.push(normalized.slice(start, end).trim());
  }

  return blocks;
}

function parseLegacyMilestoneBlock(block: string): ParsedLegacyMilestone | null {
  const lines = normalizeLineEndings(block).split('\n');
  const headingMatch = /^###\s+([^\s]+)\s+·\s+(.+)$/.exec(lines[0]?.trim() || '');
  if (!headingMatch) return null;

  let index = 1;
  const record: ParsedLegacyMilestone = {
    id: normalizeSingleLineText(headingMatch[1]),
    title: normalizeSingleLineText(headingMatch[2]),
    summary: '',
    status: 'in_progress',
    conclusion: null,
    evidenceFiles: [],
    reviewedModules: [],
    recommendedNextAction: null,
    recordedAt: formatDateTime(),
    findingTexts: []
  };

  const readIndentedList = (): string[] => {
    const items: string[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (!/^\s+-\s+/.test(line)) break;
      items.push(normalizeSingleLineText(line.replace(/^\s+-\s+/, '').replace(/^`/, '').replace(/`$/, '')));
      index += 1;
    }
    return items.filter(Boolean);
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^- Status:\s+/i.test(trimmed)) {
      record.status = normalizeMilestoneStatus(trimmed.replace(/^- Status:\s+/i, ''));
      index += 1;
      continue;
    }

    if (/^- Recorded At:\s+/i.test(trimmed)) {
      const value = normalizeSingleLineText(trimmed.replace(/^- Recorded At:\s+/i, ''));
      record.recordedAt = value || record.recordedAt;
      index += 1;
      continue;
    }

    if (/^- Reviewed Modules:\s+/i.test(trimmed)) {
      record.reviewedModules = uniqueStrings(
        trimmed
          .replace(/^- Reviewed Modules:\s+/i, '')
          .split(',')
          .map((item) => normalizeSingleLineText(item))
      );
      index += 1;
      continue;
    }

    if (/^- Summary:\s*$/i.test(trimmed)) {
      index += 1;
      const summaryLines: string[] = [];
      while (index < lines.length) {
        const nextLine = lines[index];
        if (/^- (Conclusion|Evidence Files|Recommended Next Action|Findings):/i.test(nextLine.trim())) {
          break;
        }
        summaryLines.push(nextLine);
        index += 1;
      }
      record.summary = summaryLines.join('\n').trim();
      continue;
    }

    if (/^- Conclusion:\s+/i.test(trimmed)) {
      record.conclusion = normalizeMarkdownText(trimmed.replace(/^- Conclusion:\s+/i, '')) || null;
      index += 1;
      continue;
    }

    if (/^- Evidence Files:\s*$/i.test(trimmed)) {
      index += 1;
      record.evidenceFiles = uniqueStrings([...record.evidenceFiles, ...readIndentedList()]);
      continue;
    }

    if (/^- Recommended Next Action:\s+/i.test(trimmed)) {
      record.recommendedNextAction = normalizeMarkdownText(trimmed.replace(/^- Recommended Next Action:\s+/i, '')) || null;
      index += 1;
      continue;
    }

    if (/^- Findings:\s*$/i.test(trimmed)) {
      index += 1;
      record.findingTexts = uniqueStrings([...record.findingTexts, ...readIndentedList()]);
      continue;
    }

    index += 1;
  }

  record.summary = normalizeMarkdownText(record.summary) || record.title;
  record.conclusion = record.conclusion || normalizeSingleLineText(record.summary) || record.title;
  return record;
}

function parseLegacyMilestones(body: string): ParsedLegacyMilestone[] {
  return splitLegacyMilestoneBlocks(body)
    .map((block) => parseLegacyMilestoneBlock(block))
    .filter((item): item is ParsedLegacyMilestone => !!item && !!item.id);
}

function normalizeMetadataV3(raw: unknown, header?: ReviewHeaderMetadata): ReviewDocumentMetadataV3 {
  const source = asRecord(raw) || {};
  const milestoneIds = new Set<string>();
  const normalizedMilestones: ReviewMilestoneRecord[] = Array.isArray(source.milestones)
    ? source.milestones
        .map((item, index) => {
          const milestone = asRecord(item) || {};
          const requestedId = normalizeSingleLineText(milestone.id);
          const id = requestedId || nextMilestoneId(milestoneIds, index + 1);
          milestoneIds.add(id);
          return {
            id,
            title: normalizeSingleLineText(milestone.title) || id,
            summary: normalizeMarkdownText(milestone.summary) || normalizeSingleLineText(milestone.title) || id,
            status: normalizeMilestoneStatus(milestone.status),
            conclusion: normalizeNullableMarkdown(milestone.conclusion),
            evidenceFiles: normalizeStringList(milestone.evidenceFiles),
            reviewedModules: normalizeStringList(milestone.reviewedModules),
            recommendedNextAction: normalizeNullableMarkdown(milestone.recommendedNextAction),
            recordedAt: normalizeSingleLineText(milestone.recordedAt) || formatDateTime(),
            findingIds: normalizeStringList(milestone.findingIds)
          };
        })
        .filter((item) => !!item.id)
    : [];

  const findingIds = new Set<string>();
  const normalizedFindings: ReviewFindingRecord[] = Array.isArray(source.findings)
    ? source.findings
        .map((item, index) => {
          const finding = asRecord(item) || {};
          const requestedId = normalizeSingleLineText(finding.id);
          const id = requestedId || nextFindingId(
            findingIds,
            normalizeSingleLineText(finding.title),
            normalizeFindingCategory(finding.category),
            index + 1
          );
          findingIds.add(id);
          return {
            id,
            severity: normalizeFindingSeverity(finding.severity),
            category: normalizeFindingCategory(finding.category),
            title: normalizeSingleLineText(finding.title),
            description: normalizeNullableMarkdown(finding.description),
            evidenceFiles: normalizeStringList(finding.evidenceFiles),
            relatedMilestoneIds: normalizeStringList(finding.relatedMilestoneIds),
            recommendation: normalizeNullableMarkdown(finding.recommendation)
          };
        })
        .filter((item) => !!item.title)
    : [];

  const reviewedModules = uniqueStrings([
    ...normalizeStringList(source.reviewedModules),
    ...normalizedMilestones.flatMap((item) => item.reviewedModules)
  ]);

  return reconcileMetadataRelations({
    formatVersion: 3,
    reviewRunId: normalizeSingleLineText(source.reviewRunId) || createReviewRunId(),
    createdAt: normalizeSingleLineText(source.createdAt) || parseDateToIsoStart(header?.date || formatDate()),
    finalizedAt: normalizeSingleLineText(source.finalizedAt) || null,
    status: normalizeMilestoneStatus(source.status),
    overallDecision: normalizeOverallDecision(source.overallDecision) || null,
    latestConclusion: normalizeNullableMarkdown(source.latestConclusion),
    recommendedNextAction: normalizeNullableMarkdown(source.recommendedNextAction),
    reviewedModules,
    milestones: normalizedMilestones,
    findings: normalizedFindings
  });
}

function parseMetadataFromContent(content: string, header: ReviewHeaderMetadata): ReviewDocumentMetadataV3 {
  const normalized = normalizeLineEndings(content);
  const range = findSectionRange(normalized, REVIEW_METADATA_START, REVIEW_METADATA_END);
  if (!range) {
    throw new Error('Missing review metadata block.');
  }

  const rawBody = normalized.slice(range.bodyStart, range.endStart).trim();
  if (!rawBody) {
    throw new Error('Empty review metadata block.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error: any) {
    throw new Error(`Invalid review metadata JSON: ${error?.message || String(error)}`);
  }

  return normalizeMetadataV3(parsed, header);
}

function reconcileMetadataRelations(metadata: ReviewDocumentMetadataV3): ReviewDocumentMetadataV3 {
  const findingMap = new Map(metadata.findings.map((item) => [item.id, { ...item }]));
  const milestones = metadata.milestones.map((milestone) => ({ ...milestone, findingIds: uniqueStrings(milestone.findingIds) }));

  for (const finding of findingMap.values()) {
    finding.relatedMilestoneIds = uniqueStrings(
      finding.relatedMilestoneIds.filter((id) => milestones.some((milestone) => milestone.id === id))
    );
  }

  for (const milestone of milestones) {
    milestone.findingIds = uniqueStrings(
      milestone.findingIds.filter((id) => findingMap.has(id))
    );
  }

  for (const finding of findingMap.values()) {
    for (const milestoneId of finding.relatedMilestoneIds) {
      const milestone = milestones.find((item) => item.id === milestoneId);
      if (!milestone) continue;
      milestone.findingIds = uniqueStrings([...milestone.findingIds, finding.id]);
    }
  }

  for (const milestone of milestones) {
    for (const findingId of milestone.findingIds) {
      const finding = findingMap.get(findingId);
      if (!finding) continue;
      finding.relatedMilestoneIds = uniqueStrings([...finding.relatedMilestoneIds, milestone.id]);
    }
  }

  return {
    ...metadata,
    reviewedModules: uniqueStrings([...metadata.reviewedModules, ...milestones.flatMap((item) => item.reviewedModules)]),
    milestones,
    findings: Array.from(findingMap.values())
  };
}

function migrateLegacyDocumentToV3(content: string): ReviewDocumentV3State {
  const normalized = normalizeLineEndings(content).trim();
  const header = parseHeaderMetadata(normalized);
  const scope = extractInitialReviewScope(normalized);
  const summary = parseReviewSummarySection(
    extractReviewSectionBody(normalized, REVIEW_SUMMARY_START, REVIEW_SUMMARY_END) || extractLegacySummaryBody(normalized)
  );
  const findingsSectionBody = extractReviewSectionBody(normalized, REVIEW_FINDINGS_START, REVIEW_FINDINGS_END);
  const milestoneSectionBody = extractReviewSectionBody(normalized, REVIEW_MILESTONES_START, REVIEW_MILESTONES_END) || NO_MILESTONES_PLACEHOLDER;
  const parsedMilestones = parseLegacyMilestones(milestoneSectionBody);
  const legacyFindings = (
    findingsSectionBody ? [] : extractLegacyFindings(normalized).map((item) => convertLegacyFindingToStructured(item))
  ).concat(parseReviewFindingsSection(findingsSectionBody));

  const v4Merged = mergeFindingRecords([], legacyFindings);
  const mergedFindings = v4Merged.findings.map((item) => ({
    id: item.id,
    severity: item.severity,
    category: item.category,
    title: item.title,
    description: item.descriptionMarkdown,
    evidenceFiles: evidenceRefsToFiles(item.evidence),
    relatedMilestoneIds: item.relatedMilestoneIds,
    recommendation: item.recommendationMarkdown
  }));

  const milestoneFindingIdMap = new Map<string, string[]>();
  for (const milestone of parsedMilestones) {
    milestoneFindingIdMap.set(milestone.id, []);
  }
  for (const finding of mergedFindings) {
    for (const milestoneId of finding.relatedMilestoneIds) {
      milestoneFindingIdMap.set(milestoneId, uniqueStrings([...(milestoneFindingIdMap.get(milestoneId) || []), finding.id]));
    }
  }

  const milestones: ReviewMilestoneRecord[] = parsedMilestones.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    status: item.status,
    conclusion: item.conclusion,
    evidenceFiles: item.evidenceFiles,
    reviewedModules: item.reviewedModules,
    recommendedNextAction: item.recommendedNextAction,
    recordedAt: item.recordedAt,
    findingIds: milestoneFindingIdMap.get(item.id) || []
  }));

  const createdAt = parseDateToIsoStart(header.date);
  const finalizedAt = header.status === 'completed'
    ? milestones[milestones.length - 1]?.recordedAt || createdAt
    : null;

  const metadata = reconcileMetadataRelations({
    formatVersion: 3,
    reviewRunId: createReviewRunId(),
    createdAt,
    finalizedAt,
    status: header.status === 'completed' ? 'completed' : 'in_progress',
    overallDecision: summary.overallDecision || header.overallDecision || null,
    latestConclusion: summary.latestConclusion || milestones[milestones.length - 1]?.conclusion || null,
    recommendedNextAction: summary.recommendedNextAction || milestones[milestones.length - 1]?.recommendedNextAction || null,
    reviewedModules: uniqueStrings([
      ...summary.reviewedModules,
      ...milestones.flatMap((item) => item.reviewedModules)
    ]),
    milestones,
    findings: mergedFindings
  });

  return {
    header: {
      ...header,
      status: metadata.status,
      overallDecision: metadata.overallDecision || undefined
    },
    scope,
    metadata,
    detectedFormat: 'v2'
  };
}

function loadReviewDocumentV3State(content: string): ReviewDocumentV3State {
  const normalized = normalizeLineEndings(content).trim();
  const header = parseHeaderMetadata(normalized);
  const metadata = reconcileMetadataRelations(parseMetadataFromContent(normalized, header));
  const scope = extractInitialReviewScope(normalized);
  return {
    header: {
      ...header,
      status: metadata.status,
      overallDecision: metadata.overallDecision || undefined
    },
    scope,
    metadata,
    detectedFormat: 'v3'
  };
}

function normalizeMilestoneRecordV4(raw: unknown, existingIds: Set<string>, indexHint: number): ReviewMilestoneRecordV4 {
  const record = asRecord(raw) || {};
  const requestedId = normalizeSingleLineText(record.id);
  const id = requestedId || nextMilestoneId(existingIds, indexHint);
  existingIds.add(id);

  return {
    id,
    title: normalizeSingleLineText(record.title) || id,
    status: normalizeMilestoneStatus(record.status),
    recordedAt: normalizeSingleLineText(record.recordedAt) || formatDateTime(),
    summaryMarkdown: normalizeMarkdownText(record.summaryMarkdown ?? record.summary) || normalizeSingleLineText(record.title) || id,
    conclusionMarkdown: normalizeNullableMarkdown(record.conclusionMarkdown ?? record.conclusion),
    evidence: normalizeEvidenceRefs(record.evidence ?? record.evidenceFiles),
    reviewedModules: normalizeStringList(record.reviewedModules),
    recommendedNextAction: normalizeNullableMarkdown(record.recommendedNextAction),
    findingIds: normalizeStringList(record.findingIds)
  };
}

function normalizeReviewSnapshot(raw: unknown, fallbacks?: {
  title?: string;
  date?: string;
  overview?: string;
  scopeMarkdown?: string;
  reviewRunId?: string;
  createdAt?: string;
  status?: ReviewMilestoneStatus;
  overallDecision?: ReviewOverallDecision | null;
  locale?: ReviewDocumentLocale;
}): ReviewSnapshotV4 {
  const source = asRecord(raw) || {};
  const headerRecord = asRecord(source.header) || {};
  const scopeRecord = asRecord(source.scope) || {};
  const summaryRecord = asRecord(source.summary) || {};
  const renderRecord = asRecord(source.render) || {};
  const milestoneIds = new Set<string>();
  const milestones = Array.isArray(source.milestones)
    ? source.milestones.map((item, index) => normalizeMilestoneRecordV4(item, milestoneIds, index + 1))
    : [];

  const findingIds = new Set<string>();
  const findings = Array.isArray(source.findings)
    ? source.findings
        .map((item, index) => {
          const finding = asRecord(item) || {};
          const requestedId = normalizeSingleLineText(finding.id);
          const id = requestedId || nextFindingId(
            findingIds,
            normalizeSingleLineText(finding.title),
            normalizeFindingCategory(finding.category),
            index + 1
          );
          findingIds.add(id);
          return {
            id,
            severity: normalizeFindingSeverity(finding.severity),
            category: normalizeFindingCategory(finding.category),
            title: normalizeSingleLineText(finding.title),
            descriptionMarkdown: normalizeNullableMarkdown(finding.descriptionMarkdown ?? finding.description),
            recommendationMarkdown: normalizeNullableMarkdown(finding.recommendationMarkdown ?? finding.recommendation),
            evidence: normalizeEvidenceRefs(finding.evidence ?? finding.evidenceFiles),
            relatedMilestoneIds: normalizeStringList(finding.relatedMilestoneIds),
            trackingStatus: normalizeFindingTrackingStatus(finding.trackingStatus)
          } satisfies ReviewFindingRecordV4;
        })
        .filter((item) => !!item.title)
    : [];

  const title = normalizeSingleLineText(headerRecord.title) || normalizeSingleLineText(fallbacks?.title) || 'Review';
  const date = normalizeSingleLineText(headerRecord.date) || normalizeSingleLineText(fallbacks?.date) || formatDate();
  const overview = normalizeSingleLineText(headerRecord.overview) || normalizeSingleLineText(fallbacks?.overview) || 'Workspace review';
  const createdAt = normalizeSingleLineText(source.createdAt) || normalizeSingleLineText(fallbacks?.createdAt) || parseDateToIsoStart(date);
  const updatedAt = normalizeSingleLineText(source.updatedAt) || normalizeSingleLineText(source.finalizedAt) || createdAt;
  const finalizedAt = normalizeSingleLineText(source.finalizedAt) || null;
  const locale = resolveReviewDocumentLocale(renderRecord.locale ?? fallbacks?.locale, 'en');
  const status = normalizeMilestoneStatus(source.status ?? fallbacks?.status);
  const overallDecision = normalizeOverallDecision(source.overallDecision ?? fallbacks?.overallDecision) || null;
  const scopeMarkdown = normalizeMarkdownText(scopeRecord.markdown)
    || normalizeMarkdownText(fallbacks?.scopeMarkdown)
    || getLocalizedDefaultReviewScope(locale);
  const reviewedModules = uniqueStrings([
    ...normalizeStringList(summaryRecord.reviewedModules),
    ...milestones.flatMap((item) => item.reviewedModules)
  ]);
  const latestMilestone = milestones[milestones.length - 1];
  const latestConclusion = normalizeNullableMarkdown(summaryRecord.latestConclusion)
    || latestMilestone?.conclusionMarkdown
    || null;
  const recommendedNextAction = normalizeNullableMarkdown(summaryRecord.recommendedNextAction)
    || latestMilestone?.recommendedNextAction
    || null;

  const snapshot: ReviewSnapshotV4 = {
    formatVersion: 4,
    kind: 'limcode.review',
    reviewRunId: normalizeSingleLineText(source.reviewRunId) || normalizeSingleLineText(fallbacks?.reviewRunId) || createReviewRunId(),
    createdAt,
    updatedAt,
    finalizedAt,
    status,
    overallDecision,
    header: {
      title,
      date,
      overview
    },
    scope: {
      markdown: scopeMarkdown
    },
    summary: {
      latestConclusion,
      recommendedNextAction,
      reviewedModules
    },
    stats: {
      totalMilestones: 0,
      completedMilestones: 0,
      totalFindings: 0,
      severity: {
        high: 0,
        medium: 0,
        low: 0
      }
    },
    milestones,
    findings,
    render: {
      rendererVersion: REVIEW_SNAPSHOT_RENDERER_VERSION,
      bodyHash: normalizeSingleLineText(renderRecord.bodyHash),
      generatedAt: normalizeSingleLineText(renderRecord.generatedAt) || updatedAt,
      locale
    }
  };

  return reconcileReviewSnapshot(snapshot);
}

function reconcileReviewSnapshot(snapshot: ReviewSnapshotV4): ReviewSnapshotV4 {
  const findingMap = new Map(snapshot.findings.map((item) => [item.id, { ...item, relatedMilestoneIds: uniqueStrings(item.relatedMilestoneIds) }]));
  const milestones = snapshot.milestones.map((item) => ({
    ...item,
    findingIds: uniqueStrings(item.findingIds),
    reviewedModules: uniqueStrings(item.reviewedModules),
    evidence: normalizeEvidenceRefs(item.evidence)
  }));

  for (const finding of findingMap.values()) {
    finding.relatedMilestoneIds = uniqueStrings(
      finding.relatedMilestoneIds.filter((id) => milestones.some((milestone) => milestone.id === id))
    );
    finding.evidence = normalizeEvidenceRefs(finding.evidence);
  }

  for (const milestone of milestones) {
    milestone.findingIds = uniqueStrings(
      milestone.findingIds.filter((id) => findingMap.has(id))
    );
  }

  for (const finding of findingMap.values()) {
    for (const milestoneId of finding.relatedMilestoneIds) {
      const milestone = milestones.find((item) => item.id === milestoneId);
      if (!milestone) continue;
      milestone.findingIds = uniqueStrings([...milestone.findingIds, finding.id]);
    }
  }

  for (const milestone of milestones) {
    for (const findingId of milestone.findingIds) {
      const finding = findingMap.get(findingId);
      if (!finding) continue;
      finding.relatedMilestoneIds = uniqueStrings([...finding.relatedMilestoneIds, milestone.id]);
    }
  }

  const findings = Array.from(findingMap.values());
  const reviewedModules = uniqueStrings([...snapshot.summary.reviewedModules, ...milestones.flatMap((item) => item.reviewedModules)]);
  const latestMilestone = milestones[milestones.length - 1];
  const latestConclusion = normalizeNullableMarkdown(snapshot.summary.latestConclusion) || latestMilestone?.conclusionMarkdown || null;
  const recommendedNextAction = normalizeNullableMarkdown(snapshot.summary.recommendedNextAction) || latestMilestone?.recommendedNextAction || null;

  return {
    ...snapshot,
    summary: {
      ...snapshot.summary,
      latestConclusion,
      recommendedNextAction,
      reviewedModules
    },
    stats: {
      totalMilestones: milestones.length,
      completedMilestones: milestones.filter((item) => item.status === 'completed').length,
      totalFindings: findings.length,
      severity: countFindingsBySeverity(findings)
    },
    milestones,
    findings,
    render: {
      rendererVersion: REVIEW_SNAPSHOT_RENDERER_VERSION,
      bodyHash: normalizeSingleLineText(snapshot.render.bodyHash),
      generatedAt: normalizeSingleLineText(snapshot.render.generatedAt) || normalizeSingleLineText(snapshot.updatedAt) || formatDateTime(),
      locale: resolveReviewDocumentLocale(snapshot.render.locale, 'en')
    }
  };
}

function snapshotToMetadataCompat(snapshot: ReviewSnapshotV4): ReviewDocumentMetadataV3 {
  return {
    formatVersion: 3,
    reviewRunId: snapshot.reviewRunId,
    createdAt: snapshot.createdAt,
    finalizedAt: snapshot.finalizedAt,
    status: snapshot.status,
    overallDecision: snapshot.overallDecision,
    latestConclusion: snapshot.summary.latestConclusion,
    recommendedNextAction: snapshot.summary.recommendedNextAction,
    reviewedModules: snapshot.summary.reviewedModules,
    milestones: snapshot.milestones.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summaryMarkdown,
      status: item.status,
      conclusion: item.conclusionMarkdown,
      evidenceFiles: evidenceRefsToFiles(item.evidence),
      reviewedModules: item.reviewedModules,
      recommendedNextAction: item.recommendedNextAction,
      recordedAt: item.recordedAt,
      findingIds: item.findingIds
    })),
    findings: snapshot.findings.map((item) => ({
      id: item.id,
      severity: item.severity,
      category: item.category,
      title: item.title,
      description: item.descriptionMarkdown,
      evidenceFiles: evidenceRefsToFiles(item.evidence),
      relatedMilestoneIds: item.relatedMilestoneIds,
      recommendation: item.recommendationMarkdown
    }))
  };
}

function convertV3StateToSnapshot(state: ReviewDocumentV3State): ReviewSnapshotV4 {
  const latestMilestone = state.metadata.milestones[state.metadata.milestones.length - 1];
  return normalizeReviewSnapshot({
    formatVersion: 4,
    kind: 'limcode.review',
    reviewRunId: state.metadata.reviewRunId,
    createdAt: state.metadata.createdAt,
    updatedAt: state.metadata.finalizedAt || latestMilestone?.recordedAt || state.metadata.createdAt,
    finalizedAt: state.metadata.finalizedAt,
    status: state.metadata.status,
    overallDecision: state.metadata.overallDecision,
    header: {
      title: state.header.title,
      date: state.header.date,
      overview: state.header.overview
    },
    scope: {
      markdown: state.scope
    },
    summary: {
      latestConclusion: state.metadata.latestConclusion,
      recommendedNextAction: state.metadata.recommendedNextAction,
      reviewedModules: state.metadata.reviewedModules
    },
    milestones: state.metadata.milestones.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      recordedAt: item.recordedAt,
      summaryMarkdown: item.summary,
      conclusionMarkdown: item.conclusion,
      evidence: evidenceFilesToRefs(item.evidenceFiles),
      reviewedModules: item.reviewedModules,
      recommendedNextAction: item.recommendedNextAction,
      findingIds: item.findingIds
    })),
    findings: state.metadata.findings.map((item) => ({
      id: item.id,
      severity: item.severity,
      category: item.category,
      title: item.title,
      descriptionMarkdown: item.description,
      recommendationMarkdown: item.recommendation,
      evidence: evidenceFilesToRefs(item.evidenceFiles),
      relatedMilestoneIds: item.relatedMilestoneIds,
      trackingStatus: 'open'
    })),
    render: {
      rendererVersion: REVIEW_SNAPSHOT_RENDERER_VERSION,
      bodyHash: '',
      generatedAt: state.metadata.finalizedAt || latestMilestone?.recordedAt || state.metadata.createdAt,
      locale: 'en'
    }
  });
}

function parseV4SnapshotSection(content: string): { body: string; snapshot: ReviewSnapshotV4 } {
  const normalized = normalizeLineEndings(content).trim();
  const regex = /(?:^|\n)(##\s+.+)\s*\n+```json\s*\n([\s\S]*?)\n```\s*$/m;
  const match = regex.exec(normalized);
  if (!match || typeof match.index !== 'number') {
    throw new Error('Missing or invalid Review Snapshot section.');
  }

  const sectionStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
  const body = normalized.slice(0, sectionStart).trimEnd();
  const rawJson = match[2]?.trim();
  if (!rawJson) {
    throw new Error('Empty Review Snapshot json block.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error: any) {
    throw new Error(`Invalid Review Snapshot JSON: ${error?.message || String(error)}`);
  }

  const bodyHeader = parseHeaderMetadata(body);
  const localeFromHeading = inferReviewDocumentLocaleFromSnapshotHeading(match[1]?.replace(/^##\s+/, '') || '');
  const snapshot = normalizeReviewSnapshot(parsed, {
    title: bodyHeader.title,
    date: bodyHeader.date,
    overview: bodyHeader.overview,
    status: bodyHeader.status,
    overallDecision: bodyHeader.overallDecision,
    scopeMarkdown: extractInitialReviewScope(body),
    locale: localeFromHeading
  });

  return { body, snapshot };
}

function loadReviewDocumentState(content: string): ReviewDocumentV4State {
  const normalized = normalizeLineEndings(content).trim();
  const detectedFormat = detectReviewDocumentFormat(normalized);

  if (detectedFormat === 'v4') {
    const parsed = parseV4SnapshotSection(normalized);
    return {
      snapshot: parsed.snapshot,
      body: parsed.body,
      detectedFormat
    };
  }

  if (detectedFormat === 'v3') {
    const v3State = loadReviewDocumentV3State(normalized);
    const snapshot = convertV3StateToSnapshot(v3State);
    return {
      snapshot,
      body: renderReviewDocumentBody(snapshot),
      detectedFormat
    };
  }

  if (detectedFormat === 'v2') {
    const v3State = migrateLegacyDocumentToV3(normalized);
    const snapshot = convertV3StateToSnapshot(v3State);
    return {
      snapshot,
      body: renderReviewDocumentBody(snapshot),
      detectedFormat
    };
  }

  throw new Error('Unknown review document format.');
}

function appendLabeledMarkdownBlock(lines: string[], label: string, markdown?: string | null): void {
  const normalized = normalizeNullableMarkdown(markdown);
  if (!normalized) return;
  lines.push(`- ${label}:`);
  lines.push('');
  for (const line of normalizeLineEndings(normalized).split('\n')) {
    lines.push(line ? `  ${line}` : '');
  }
}

function renderReviewSummary(snapshot: ReviewSnapshotV4): string {
  const locale = resolveReviewDocumentLocale(snapshot.render.locale, 'en');
  const labels = getReviewDocumentMessages(locale).summary;
  const currentProgress = formatCurrentProgress(snapshot, locale);

  return [
    `- ${labels.currentStatus}: ${getDisplayMilestoneStatus(snapshot.status, locale)}`,
    `- ${labels.reviewedModules}: ${joinDisplayList(snapshot.summary.reviewedModules, locale)}`,
    `- ${labels.currentProgress}: ${currentProgress}`,
    `- ${labels.totalMilestones}: ${snapshot.stats.totalMilestones}`,
    `- ${labels.completedMilestones}: ${snapshot.stats.completedMilestones}`,
    `- ${labels.totalFindings}: ${snapshot.stats.totalFindings}`,
    `- ${labels.findingsBySeverity}: ${formatFindingsBySeverity(snapshot.stats.severity, locale)}`,
    `- ${labels.latestConclusion}: ${formatSingleLineValue(snapshot.summary.latestConclusion, locale)}`,
    `- ${labels.recommendedNextAction}: ${formatSingleLineValue(snapshot.summary.recommendedNextAction, locale)}`,
    `- ${labels.overallDecision}: ${getDisplayOverallDecision(snapshot.overallDecision, locale)}`
  ].join('\n');
}

function renderReviewFindings(snapshot: ReviewSnapshotV4): string {
  const locale = resolveReviewDocumentLocale(snapshot.render.locale, 'en');
  const labels = getReviewDocumentMessages(locale).finding;
  if (snapshot.findings.length === 0) {
    return getLocalizedNoFindingsPlaceholder(locale);
  }

  return snapshot.findings.map((finding) => {
    const lines = [
      `### ${finding.title}`,
      '',
      `- ID: ${finding.id}`,
      `- ${labels.severity}: ${getDisplaySeverity(finding.severity, locale)}`,
      `- ${labels.category}: ${getDisplayCategory(finding.category, locale)}`,
      `- ${labels.trackingStatus}: ${getDisplayTrackingStatus(finding.trackingStatus, locale)}`
    ];

    if (finding.relatedMilestoneIds.length > 0) {
      lines.push(`- ${labels.relatedMilestones}: ${finding.relatedMilestoneIds.join(', ')}`);
    }

    appendLabeledMarkdownBlock(lines, labels.description, finding.descriptionMarkdown);
    appendLabeledMarkdownBlock(lines, labels.recommendation, finding.recommendationMarkdown);

    if (finding.evidence.length > 0) {
      lines.push(`- ${labels.evidenceFiles}:`);
      for (const evidence of finding.evidence) {
        lines.push(`  - \`${formatEvidenceRefText(evidence)}\``);
      }
    }

    return lines.join('\n');
  }).join('\n\n');
}

function renderReviewMilestones(snapshot: ReviewSnapshotV4): string {
  const locale = resolveReviewDocumentLocale(snapshot.render.locale, 'en');
  const labels = getReviewDocumentMessages(locale).milestone;
  if (snapshot.milestones.length === 0) {
    return getLocalizedNoMilestonesPlaceholder(locale);
  }

  const findingMap = new Map(snapshot.findings.map((item) => [item.id, item]));
  return snapshot.milestones.map((milestone) => {
    const lines = [
      `### ${milestone.id} · ${milestone.title}`,
      '',
      `- ${labels.status}: ${getDisplayMilestoneStatus(milestone.status, locale)}`,
      `- ${labels.recordedAt}: ${milestone.recordedAt}`
    ];

    if (milestone.reviewedModules.length > 0) {
      lines.push(`- ${labels.reviewedModules}: ${milestone.reviewedModules.join(', ')}`);
    }

    appendLabeledMarkdownBlock(lines, labels.summary, milestone.summaryMarkdown);
    appendLabeledMarkdownBlock(lines, labels.conclusion, milestone.conclusionMarkdown);

    if (milestone.evidence.length > 0) {
      lines.push(`- ${labels.evidenceFiles}:`);
      for (const evidence of milestone.evidence) {
        lines.push(`  - \`${formatEvidenceRefText(evidence)}\``);
      }
    }

    appendLabeledMarkdownBlock(lines, labels.recommendedNextAction, milestone.recommendedNextAction);

    if (milestone.findingIds.length > 0) {
      lines.push(`- ${labels.findings}:`);
      for (const findingId of milestone.findingIds) {
        const finding = findingMap.get(findingId);
        if (!finding) continue;
        lines.push(`  - ${formatFindingSummaryText(snapshotFindingToInput(finding), locale)}`);
      }
    }

    return lines.join('\n');
  }).join('\n\n');
}

function renderReviewFinalConclusion(snapshot: ReviewSnapshotV4): string {
  const locale = resolveReviewDocumentLocale(snapshot.render.locale, 'en');
  return snapshot.summary.latestConclusion || getLocalizedDefaultFinalConclusion(locale);
}

function renderReviewDocumentBody(snapshot: ReviewSnapshotV4): string {
  const normalizedSnapshot = reconcileReviewSnapshot(snapshot);
  const locale = resolveReviewDocumentLocale(normalizedSnapshot.render.locale, 'en');
  const headings = getReviewSectionHeadings(locale);
  const headerLabels = getReviewDocumentMessages(locale).header;
  const lines = [
    `# ${normalizedSnapshot.header.title}`,
    `- ${headerLabels.date}: ${normalizedSnapshot.header.date}`,
    `- ${headerLabels.overview}: ${normalizedSnapshot.header.overview}`,
    `- ${headerLabels.status}: ${getDisplayMilestoneStatus(normalizedSnapshot.status, locale)}`,
    `- ${headerLabels.overallDecision}: ${getDisplayOverallDecision(normalizedSnapshot.overallDecision, locale)}`,
    '',
    headings.scope,
    '',
    normalizedSnapshot.scope.markdown || getLocalizedDefaultReviewScope(locale),
    '',
    headings.summary,
    '',
    renderReviewSummary(normalizedSnapshot),
    '',
    headings.findings,
    '',
    renderReviewFindings(normalizedSnapshot),
    '',
    headings.milestones,
    '',
    renderReviewMilestones(normalizedSnapshot),
    '',
    headings.finalConclusion,
    '',
    renderReviewFinalConclusion(normalizedSnapshot)
  ];

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderReviewSnapshotSection(snapshot: ReviewSnapshotV4): string {
  const locale = resolveReviewDocumentLocale(snapshot.render.locale, 'en');
  const headings = getReviewSectionHeadings(locale);

  return [
    headings.snapshot,
    '',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```'
  ].join('\n');
}

function buildReviewDocument(snapshotInput: ReviewSnapshotV4): string {
  const base = reconcileReviewSnapshot(snapshotInput);
  const body = renderReviewDocumentBody(base);
  const finalSnapshot = reconcileReviewSnapshot({
    ...base,
    render: {
      rendererVersion: REVIEW_SNAPSHOT_RENDERER_VERSION,
      bodyHash: hashText(body),
      generatedAt: normalizeSingleLineText(base.render.generatedAt) || normalizeSingleLineText(base.updatedAt) || formatDateTime(),
      locale: resolveReviewDocumentLocale(base.render.locale, 'en')
    }
  });

  return `${body.trimEnd()}\n\n${renderReviewSnapshotSection(finalSnapshot).trimEnd()}\n`;
}

function buildSummaryFromSnapshot(snapshot: ReviewSnapshotV4): ReviewDocumentSummarySnapshot {
  const locale = resolveReviewDocumentLocale(snapshot.render.locale, 'en');

  return {
    title: snapshot.header.title,
    date: snapshot.header.date,
    overview: snapshot.header.overview,
    status: snapshot.status,
    overallDecision: snapshot.overallDecision,
    totalMilestones: snapshot.stats.totalMilestones,
    completedMilestones: snapshot.stats.completedMilestones,
    currentProgress: formatCurrentProgress(snapshot, locale),
    reviewedModules: snapshot.summary.reviewedModules,
    totalFindings: snapshot.stats.totalFindings,
    findingsBySeverity: snapshot.stats.severity,
    latestConclusion: snapshot.summary.latestConclusion,
    recommendedNextAction: snapshot.summary.recommendedNextAction,
    reviewSnapshot: snapshot
  };
}

function validateMetadataCompat(metadata: ReviewDocumentMetadataV3): ReviewValidationIssue[] {
  const issues: ReviewValidationIssue[] = [];
  const milestoneIds = metadata.milestones.map((item) => normalizeSingleLineText(item.id)).filter(Boolean);
  const findingIds = metadata.findings.map((item) => normalizeSingleLineText(item.id)).filter(Boolean);

  if (new Set(milestoneIds).size !== milestoneIds.length) {
    issues.push({ severity: 'error', code: 'duplicate_milestone_ids', message: 'Review metadata contains duplicate milestone ids.' });
  }

  if (new Set(findingIds).size !== findingIds.length) {
    issues.push({ severity: 'error', code: 'duplicate_finding_ids', message: 'Review metadata contains duplicate finding ids.' });
  }

  if (metadata.status === 'completed' && !metadata.finalizedAt) {
    issues.push({ severity: 'error', code: 'missing_finalized_at', message: 'Completed review metadata must include finalizedAt.' });
  }

  const milestoneIdSet = new Set(milestoneIds);
  const findingIdSet = new Set(findingIds);

  for (const milestone of metadata.milestones) {
    for (const findingId of milestone.findingIds) {
      if (!findingIdSet.has(findingId)) {
        issues.push({
          severity: 'error',
          code: 'missing_linked_finding',
          message: `Milestone "${milestone.id}" references missing finding "${findingId}".`
        });
      }
    }
  }

  for (const finding of metadata.findings) {
    for (const milestoneId of finding.relatedMilestoneIds) {
      if (!milestoneIdSet.has(milestoneId)) {
        issues.push({
          severity: 'error',
          code: 'missing_linked_milestone',
          message: `Finding "${finding.id}" references missing milestone "${milestoneId}".`
        });
      }
    }
  }

  return issues;
}

function validateV4Document(content: string): ReviewValidationResult {
  const normalized = normalizeLineEndings(content).trim();
  const issues: ReviewValidationIssue[] = [];

  const snapshotSectionCount = countSnapshotSectionHeadings(normalized);
  if (snapshotSectionCount !== 1) {
    issues.push({ severity: 'error', code: 'snapshot_section_count', message: 'Review document must contain exactly one Review Snapshot section.' });
  }

  const jsonFenceCount = countOccurrences(normalized, '```json');
  if (jsonFenceCount !== 1) {
    issues.push({ severity: 'error', code: 'snapshot_json_fence_count', message: 'Review document must contain exactly one trailing json code block for Review Snapshot.' });
  }

  let parsed: ReviewDocumentV4State | undefined;
  try {
    parsed = loadReviewDocumentState(normalized);
  } catch (error: any) {
    return {
      detectedFormat: 'v4',
      formatVersion: 4,
      isValid: false,
      canAutoUpgrade: false,
      issues: [
        ...issues,
        { severity: 'error', code: 'invalid_snapshot_json', message: error?.message || String(error) }
      ]
    };
  }

  const compatMetadata = snapshotToMetadataCompat(parsed.snapshot);
  issues.push(...validateMetadataCompat(compatMetadata));

  const locale = resolveReviewDocumentLocale(parsed.snapshot.render.locale, 'en');
  if (!detectSectionOrder(normalized, getV4BodySectionOrder(locale))) {
    issues.push({ severity: 'error', code: 'non_canonical_section_order', message: 'Visible review sections are not in canonical order.' });
  }

  const expectedBody = renderReviewDocumentBody(parsed.snapshot).trim();
  const actualBody = parsed.body.trim();
  if (actualBody !== expectedBody) {
    issues.push({ severity: 'warning', code: 'body_out_of_sync_with_snapshot', message: 'Review document body is out of sync with the trailing Review Snapshot JSON for the stored locale.' });
  }

  if (parsed.snapshot.render.bodyHash !== hashText(renderReviewDocumentBody(parsed.snapshot))) {
    issues.push({ severity: 'warning', code: 'body_hash_mismatch', message: 'Review Snapshot render.bodyHash does not match the rendered document body.' });
  }

  const derivedStats = buildSummaryFromSnapshot(parsed.snapshot);
  if (
    parsed.snapshot.stats.totalMilestones !== derivedStats.totalMilestones
    || parsed.snapshot.stats.completedMilestones !== derivedStats.completedMilestones
    || parsed.snapshot.stats.totalFindings !== derivedStats.totalFindings
    || parsed.snapshot.stats.severity.high !== derivedStats.findingsBySeverity.high
    || parsed.snapshot.stats.severity.medium !== derivedStats.findingsBySeverity.medium
    || parsed.snapshot.stats.severity.low !== derivedStats.findingsBySeverity.low
  ) {
    issues.push({ severity: 'warning', code: 'stats_out_of_sync', message: 'Review Snapshot stats are out of sync with milestones or findings.' });
  }

  for (const finding of parsed.snapshot.findings) {
    if (isFindingTitleNotConcise(finding.title)) {
      issues.push({
        severity: 'warning',
        code: 'finding_title_not_concise',
        message: `Finding \`${finding.id}\` has an overloaded title. Keep the title concise, and move file paths, detailed explanation, and recommendations into description, evidence, or recommendation fields.`
      });
    }
    if (isFindingTitleRepeatingDescription(finding.title, finding.descriptionMarkdown)) {
      issues.push({
        severity: 'warning',
        code: 'finding_title_repeats_description',
        message: `Finding \`${finding.id}\` repeats the same content in title and description. Keep the title short and move detailed text into description.`
      });
    }
  }

  return {
    detectedFormat: 'v4',
    formatVersion: 4,
    isValid: issues.every((item) => item.severity !== 'error'),
    canAutoUpgrade: issues.some((item) => AUTO_FIXABLE_V4_CODES.has(item.code)),
    issues,
    metadata: compatMetadata,
    reviewSnapshot: parsed.snapshot
  };
}

function createInitialSnapshot(input: ReviewDocumentTemplateInput, locale: ReviewDocumentLocale = 'en'): ReviewSnapshotV4 {
  const title = normalizeSingleLineText(input.title) || 'Review';
  const overview = normalizeSingleLineText(input.overview) || 'Workspace review';
  const review = normalizeMarkdownText(input.review) || getLocalizedDefaultReviewScope(resolveReviewDocumentLocale(locale, 'en'));
  const date = normalizeSingleLineText(input.date) || formatDate();
  const createdAt = parseDateToIsoStart(date);
  const renderLocale = resolveReviewDocumentLocale(locale, 'en');

  return normalizeReviewSnapshot({
    formatVersion: 4,
    kind: 'limcode.review',
    reviewRunId: createReviewRunId(),
    createdAt,
    updatedAt: createdAt,
    finalizedAt: null,
    status: 'in_progress',
    overallDecision: null,
    header: {
      title,
      date,
      overview
    },
    scope: {
      markdown: review
    },
    summary: {
      latestConclusion: null,
      recommendedNextAction: null,
      reviewedModules: []
    },
    milestones: [],
    findings: [],
    render: {
      rendererVersion: REVIEW_SNAPSHOT_RENDERER_VERSION,
      bodyHash: '',
      generatedAt: createdAt,
      locale: renderLocale
    }
  });
}

export function detectReviewDocumentFormat(content: string): ReviewDocumentFormat {
  const normalized = normalizeLineEndings(content);
  const v4Match = /(?:^|\n)##\s+.+\s*\n+```json\s*\n([\s\S]*?)\n```\s*$/m.exec(normalized.trim());
  if (v4Match?.[1]) {
    try {
      const parsed = JSON.parse(v4Match[1].trim());
      const record = asRecord(parsed);
      if (record?.kind === 'limcode.review' && record?.formatVersion === 4) {
        return 'v4';
      }
    } catch {
      // ignore and continue detection
    }
  }
  if (normalized.includes(REVIEW_METADATA_START) && normalized.includes(REVIEW_METADATA_END)) {
    return 'v3';
  }

  const allScopeHeadings = [
    REVIEW_SCOPE_SECTION_TITLE,
    ...REVIEW_DOCUMENT_LOCALES.map((locale) => getReviewSectionHeadings(locale).scope)
  ];
  if (
    /^#\s+/m.test(normalized)
    && (
      /^- Date:\s+/m.test(normalized)
      || allScopeHeadings.some((heading) => normalized.includes(heading))
      || normalized.includes(REVIEW_SUMMARY_START)
    )
  ) {
    return 'v2';
  }
  return 'unknown';
}

export function validateReviewDocument(content: string): ReviewValidationResult {
  const normalized = normalizeLineEndings(content).trim();
  const detectedFormat = detectReviewDocumentFormat(normalized);

  if (detectedFormat === 'v4') {
    return validateV4Document(normalized);
  }

  if (detectedFormat === 'v3') {
    const state = loadReviewDocumentV3State(normalized);
    const snapshot = convertV3StateToSnapshot(state);
    return {
      detectedFormat,
      formatVersion: 3,
      isValid: true,
      canAutoUpgrade: true,
      issues: [{ severity: 'warning', code: 'upgrade_required', message: 'Review document uses legacy V3 format and can be upgraded to V4.' }],
      metadata: state.metadata,
      reviewSnapshot: snapshot
    };
  }

  if (detectedFormat === 'v2') {
    const state = migrateLegacyDocumentToV3(normalized);
    const snapshot = convertV3StateToSnapshot(state);
    return {
      detectedFormat,
      formatVersion: 2,
      isValid: true,
      canAutoUpgrade: true,
      issues: [{ severity: 'warning', code: 'upgrade_required', message: 'Review document is a legacy format and can be upgraded to V4.' }],
      metadata: state.metadata,
      reviewSnapshot: snapshot
    };
  }

  return {
    detectedFormat,
    formatVersion: null,
    isValid: false,
    canAutoUpgrade: false,
    issues: [{ severity: 'error', code: 'unknown_review_format', message: 'Review document does not match the expected Review format.' }]
  };
}

export function summarizeReviewDocument(content: string): ReviewDocumentSummarySnapshot {
  const state = loadReviewDocumentState(content);
  return buildSummaryFromSnapshot(state.snapshot);
}

function ensureValidRenderedDocument(content: string): ReviewValidationResult {
  const validation = validateReviewDocument(content);
  const errors = validation.issues.filter((item) => item.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((item) => item.message).join(' '));
  }
  return validation;
}

export function upgradeReviewDocumentToV4(content: string): string {
  const state = loadReviewDocumentState(content);
  return buildReviewDocument(state.snapshot);
}

export function upgradeReviewDocumentToV3(content: string): string {
  return upgradeReviewDocumentToV4(content);
}

export function normalizeReviewDocumentStructure(content: string): string {
  return upgradeReviewDocumentToV4(content);
}

export function ensureReviewDocumentSections(content: string): string {
  return normalizeReviewDocumentStructure(content);
}

export function getNextReviewMilestoneId(content: string): string {
  const state = loadReviewDocumentState(content);
  return `M${state.snapshot.milestones.length + 1}`;
}

export function buildInitialReviewDocument(input: ReviewDocumentTemplateInput, locale: ReviewDocumentLocale = 'en'): string {
  const snapshot = createInitialSnapshot(input, locale);
  const content = buildReviewDocument(snapshot);
  ensureValidRenderedDocument(content);
  return content;
}

export function appendReviewMilestone(content: string, input: ReviewMilestoneInput, locale?: ReviewDocumentLocale): {
  content: string;
  milestoneId: string;
  milestoneCount: number;
  completedMilestones: number;
  findings: string[];
  structuredFindings: ReviewFindingInput[];
  reviewedModules: string[];
  addedFindingIds: string[];
  reviewSnapshot: ReviewSnapshotV4;
} {
  const state = loadReviewDocumentState(content);

  if (state.snapshot.status === 'completed') {
    throw new Error('Cannot record a milestone for a finalized review document.');
  }

  const existingMilestoneIds = new Set(state.snapshot.milestones.map((item) => item.id));
  const milestoneId = normalizeSingleLineText(input.milestoneId)
    || nextMilestoneId(existingMilestoneIds, state.snapshot.milestones.length + 1);
  if (state.snapshot.milestones.some((item) => item.id === milestoneId)) {
    throw new Error(`Duplicate milestone id is not allowed: ${milestoneId}`);
  }

  const milestoneTitle = normalizeSingleLineText(input.milestoneTitle) || milestoneId;
  const summaryMarkdown = normalizeMarkdownText(input.summary) || milestoneTitle;
  const conclusionMarkdown = normalizeMarkdownText(input.conclusion)
    || normalizeSingleLineText(summaryMarkdown)
    || milestoneTitle;
  const evidenceFiles = normalizeStringList(input.evidenceFiles);
  const evidence = mergeEvidenceRefs(normalizeEvidenceRefs(input.evidence), evidenceFilesToRefs(evidenceFiles));
  const renderLocale = resolveReviewDocumentLocale(locale ?? state.snapshot.render.locale, 'en');
  const reviewedModules = normalizeStringList(input.reviewedModules);
  const recommendedNextAction = normalizeNullableMarkdown(input.recommendedNextAction);
  const recordedAt = normalizeSingleLineText(input.recordedAt) || formatDateTime();

  const incomingFindings = [
    ...normalizeStringList(input.findings).map((item) => convertLegacyFindingToStructured(item, milestoneId, evidenceFiles)),
    ...(Array.isArray(input.structuredFindings)
      ? input.structuredFindings.map((item) => normalizeFindingInput(item, milestoneId, evidenceFiles))
      : [])
  ];
  const mergedFindingsResult = mergeFindingRecords(state.snapshot.findings, incomingFindings);
  const mergedFindings = mergedFindingsResult.findings;
  const linkedFindingIds = mergedFindings
    .filter((item) => item.relatedMilestoneIds.includes(milestoneId))
    .map((item) => item.id);

  const nextSnapshot = normalizeReviewSnapshot({
    ...state.snapshot,
    updatedAt: recordedAt,
    finalizedAt: null,
    status: 'in_progress',
    summary: {
      ...state.snapshot.summary,
      latestConclusion: conclusionMarkdown || state.snapshot.summary.latestConclusion,
      recommendedNextAction: recommendedNextAction || state.snapshot.summary.recommendedNextAction,
      reviewedModules: uniqueStrings([...state.snapshot.summary.reviewedModules, ...reviewedModules])
    },
    milestones: [
      ...state.snapshot.milestones,
      {
        id: milestoneId,
        title: milestoneTitle,
        status: normalizeMilestoneStatus(input.status),
        recordedAt,
        summaryMarkdown,
        conclusionMarkdown,
        evidence,
        reviewedModules,
        recommendedNextAction,
        findingIds: linkedFindingIds
      }
    ],
    findings: mergedFindings,
    render: {
      ...state.snapshot.render,
      generatedAt: recordedAt,
      locale: renderLocale
    }
  });

  const rendered = buildReviewDocument(nextSnapshot);
  const validation = ensureValidRenderedDocument(rendered);
  const finalSnapshot = validation.reviewSnapshot || nextSnapshot;

  return {
    content: rendered,
    milestoneId,
    milestoneCount: finalSnapshot.stats.totalMilestones,
    completedMilestones: finalSnapshot.stats.completedMilestones,
    findings: finalSnapshot.findings.map((item) => formatFindingSummaryText(snapshotFindingToInput(item))),
    structuredFindings: finalSnapshot.findings.map((item) => snapshotFindingToInput(item)),
    reviewedModules: finalSnapshot.summary.reviewedModules,
    addedFindingIds: mergedFindingsResult.addedFindingIds,
    reviewSnapshot: finalSnapshot
  };
}

export function finalizeReviewDocument(content: string, input: ReviewFinalizeInput, locale?: ReviewDocumentLocale): {
  content: string;
  milestoneCount: number;
  completedMilestones: number;
  findings: string[];
  structuredFindings: ReviewFindingInput[];
  reviewedModules: string[];
  overallDecision?: ReviewOverallDecision;
  reviewSnapshot: ReviewSnapshotV4;
} {
  const state = loadReviewDocumentState(content);
  const reviewedModules = normalizeStringList(input.reviewedModules);
  const finalizedAt = formatDateTime();
  const renderLocale = resolveReviewDocumentLocale(locale ?? state.snapshot.render.locale, 'en');

  const nextSnapshot = normalizeReviewSnapshot({
    ...state.snapshot,
    updatedAt: finalizedAt,
    finalizedAt,
    status: 'completed',
    overallDecision: normalizeOverallDecision(input.overallDecision) || state.snapshot.overallDecision,
    summary: {
      ...state.snapshot.summary,
      latestConclusion: normalizeMarkdownText(input.conclusion) || state.snapshot.summary.latestConclusion,
      recommendedNextAction: normalizeMarkdownText(input.recommendedNextAction) || state.snapshot.summary.recommendedNextAction,
      reviewedModules: uniqueStrings([...state.snapshot.summary.reviewedModules, ...reviewedModules])
    },
    render: {
      ...state.snapshot.render,
      generatedAt: finalizedAt,
      locale: renderLocale
    }
  });

  const rendered = buildReviewDocument(nextSnapshot);
  const validation = ensureValidRenderedDocument(rendered);
  const finalSnapshot = validation.reviewSnapshot || nextSnapshot;

  return {
    content: rendered,
    milestoneCount: finalSnapshot.stats.totalMilestones,
    completedMilestones: finalSnapshot.stats.completedMilestones,
    findings: finalSnapshot.findings.map((item) => formatFindingSummaryText(snapshotFindingToInput(item))),
    structuredFindings: finalSnapshot.findings.map((item) => snapshotFindingToInput(item)),
    reviewedModules: finalSnapshot.summary.reviewedModules,
    overallDecision: finalSnapshot.overallDecision || undefined,
    reviewSnapshot: finalSnapshot
  };
}


export function reopenReviewDocument(content: string, locale?: ReviewDocumentLocale): {
  content: string;
  milestoneCount: number;
  completedMilestones: number;
  findings: string[];
  structuredFindings: ReviewFindingInput[];
  reviewedModules: string[];
  reviewSnapshot: ReviewSnapshotV4;
} {
  const state = loadReviewDocumentState(content);
  if (state.snapshot.status !== 'completed') {
    throw new Error('Cannot reopen a review document that is not finalized.');
  }

  const reopenedAt = formatDateTime();
  const renderLocale = resolveReviewDocumentLocale(locale ?? state.snapshot.render.locale, 'en');
  const nextSnapshot = normalizeReviewSnapshot({
    ...state.snapshot,
    updatedAt: reopenedAt,
    finalizedAt: null,
    status: 'in_progress',
    overallDecision: null,
    render: {
      ...state.snapshot.render,
      generatedAt: reopenedAt,
      locale: renderLocale
    }
  });

  const rendered = buildReviewDocument(nextSnapshot);
  const validation = ensureValidRenderedDocument(rendered);
  const finalSnapshot = validation.reviewSnapshot || nextSnapshot;

  return {
    content: rendered,
    milestoneCount: finalSnapshot.stats.totalMilestones,
    completedMilestones: finalSnapshot.stats.completedMilestones,
    findings: finalSnapshot.findings.map((item) => formatFindingSummaryText(snapshotFindingToInput(item))),
    structuredFindings: finalSnapshot.findings.map((item) => snapshotFindingToInput(item)),
    reviewedModules: finalSnapshot.summary.reviewedModules,
    reviewSnapshot: finalSnapshot
  };
}
