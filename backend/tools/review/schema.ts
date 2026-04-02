/**
 * Review V4 schema and shared types
 */

export type ReviewMilestoneStatus = 'in_progress' | 'completed';
export type ReviewFindingSeverity = 'high' | 'medium' | 'low';
export type ReviewFindingCategory =
  | 'html'
  | 'css'
  | 'javascript'
  | 'accessibility'
  | 'performance'
  | 'maintainability'
  | 'docs'
  | 'test'
  | 'other';
export type ReviewFindingTrackingStatus = 'open' | 'accepted_risk' | 'fixed' | 'wont_fix' | 'duplicate';
export type ReviewOverallDecision = 'accepted' | 'conditionally_accepted' | 'rejected' | 'needs_follow_up';
export type ReviewDocumentFormat = 'unknown' | 'v2' | 'v3' | 'v4';
export type ReviewDocumentLocale = 'zh-CN' | 'en' | 'ja';

export interface ReviewFindingInput {
  id?: string;
  severity?: ReviewFindingSeverity;
  category?: ReviewFindingCategory;
  title: string;
  description?: string;
  evidenceFiles?: string[];
  evidence?: ReviewEvidenceRef[];
  relatedMilestoneIds?: string[];
  recommendation?: string;
  trackingStatus?: ReviewFindingTrackingStatus;
}

export interface ReviewMilestoneInput {
  milestoneId?: string;
  milestoneTitle: string;
  summary: string;
  status?: ReviewMilestoneStatus;
  conclusion?: string;
  evidenceFiles?: string[];
  evidence?: ReviewEvidenceRef[];
  findings?: string[];
  structuredFindings?: ReviewFindingInput[];
  reviewedModules?: string[];
  recommendedNextAction?: string;
  recordedAt?: string;
}

export interface ReviewFinalizeInput {
  conclusion: string;
  overallDecision?: ReviewOverallDecision;
  recommendedNextAction?: string;
  reviewedModules?: string[];
}

export interface ReviewDocumentTemplateInput {
  title?: string;
  overview?: string;
  review: string;
  date?: string;
}

export interface ReviewValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ReviewEvidenceRef {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  excerptHash?: string;
}

export interface ReviewMilestoneRecordV4 {
  id: string;
  title: string;
  status: ReviewMilestoneStatus;
  recordedAt: string;
  summaryMarkdown: string;
  conclusionMarkdown: string | null;
  evidence: ReviewEvidenceRef[];
  reviewedModules: string[];
  recommendedNextAction: string | null;
  findingIds: string[];
}

export interface ReviewFindingRecordV4 {
  id: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  title: string;
  descriptionMarkdown: string | null;
  recommendationMarkdown: string | null;
  evidence: ReviewEvidenceRef[];
  relatedMilestoneIds: string[];
  trackingStatus: ReviewFindingTrackingStatus;
}

export interface ReviewSnapshotV4 {
  formatVersion: 4;
  kind: 'limcode.review';
  reviewRunId: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  status: ReviewMilestoneStatus;
  overallDecision: ReviewOverallDecision | null;
  header: {
    title: string;
    date: string;
    overview: string;
  };
  scope: {
    markdown: string;
  };
  summary: {
    latestConclusion: string | null;
    recommendedNextAction: string | null;
    reviewedModules: string[];
  };
  stats: {
    totalMilestones: number;
    completedMilestones: number;
    totalFindings: number;
    severity: Record<ReviewFindingSeverity, number>;
  };
  milestones: ReviewMilestoneRecordV4[];
  findings: ReviewFindingRecordV4[];
  render: {
    rendererVersion: number;
    bodyHash: string;
    generatedAt: string;
    locale: ReviewDocumentLocale;
  };
}

export interface ReviewMilestoneRecord {
  id: string;
  title: string;
  summary: string;
  status: ReviewMilestoneStatus;
  conclusion: string | null;
  evidenceFiles: string[];
  reviewedModules: string[];
  recommendedNextAction: string | null;
  recordedAt: string;
  findingIds: string[];
}

export interface ReviewFindingRecord {
  id: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  title: string;
  description: string | null;
  evidenceFiles: string[];
  relatedMilestoneIds: string[];
  recommendation: string | null;
}

export interface ReviewDocumentMetadataV3 {
  formatVersion: 3;
  reviewRunId: string;
  createdAt: string;
  finalizedAt: string | null;
  status: ReviewMilestoneStatus;
  overallDecision: ReviewOverallDecision | null;
  latestConclusion: string | null;
  recommendedNextAction: string | null;
  reviewedModules: string[];
  milestones: ReviewMilestoneRecord[];
  findings: ReviewFindingRecord[];
}

export interface ReviewValidationResult {
  detectedFormat: ReviewDocumentFormat;
  formatVersion: number | null;
  isValid: boolean;
  canAutoUpgrade: boolean;
  issues: ReviewValidationIssue[];
  metadata?: ReviewDocumentMetadataV3;
  reviewSnapshot?: ReviewSnapshotV4;
}

export interface ReviewDocumentSummarySnapshot {
  title: string;
  date: string;
  overview: string;
  status: ReviewMilestoneStatus;
  overallDecision: ReviewOverallDecision | null;
  totalMilestones: number;
  completedMilestones: number;
  currentProgress: string;
  reviewedModules: string[];
  totalFindings: number;
  findingsBySeverity: Record<ReviewFindingSeverity, number>;
  latestConclusion: string | null;
  recommendedNextAction: string | null;
  reviewSnapshot?: ReviewSnapshotV4;
}

export interface ReviewToolDeltaV4 {
  type: 'created' | 'milestone_recorded' | 'finalized' | 'validated' | 'reopened';
  milestoneId?: string;
  addedFindingIds?: string[];
  changedFields?: string[];
}

export interface ReviewValidationSummaryV4 {
  isValid: boolean;
  detectedFormat: ReviewDocumentFormat;
  formatVersion: number | null;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  canAutoUpgrade: boolean;
  issues: ReviewValidationIssue[];
}

export type ReviewCompareFindingChange =
  | 'severity'
  | 'trackingStatus'
  | 'title'
  | 'description'
  | 'recommendation'
  | 'evidence'
  | 'relatedMilestoneIds';

export interface ReviewCompareFindingItem {
  key: string;
  id?: string;
  title: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  trackingStatus: ReviewFindingTrackingStatus;
  descriptionMarkdown?: string | null;
  recommendationMarkdown?: string | null;
  relatedMilestoneIds: string[];
  evidence: ReviewEvidenceRef[];
}

export interface ReviewCompareFindingDiffItem {
  key: string;
  base: ReviewCompareFindingItem;
  target: ReviewCompareFindingItem;
  changes: ReviewCompareFindingChange[];
}

export interface ReviewCompareResultV4 {
  base: { path: string; reviewRunId?: string; generatedAt?: string; locale?: ReviewDocumentLocale; title?: string; date?: string; status?: ReviewMilestoneStatus; overallDecision?: ReviewOverallDecision | null; };
  target: { path: string; reviewRunId?: string; generatedAt?: string; locale?: ReviewDocumentLocale; title?: string; date?: string; status?: ReviewMilestoneStatus; overallDecision?: ReviewOverallDecision | null; };
  summary: { addedFindings: number; removedFindings: number; persistedFindings: number; severityChanged: number; trackingChanged: number; evidenceChanged: number; relatedMilestoneChanged: number; };
  findings: {
    added: ReviewCompareFindingItem[];
    removed: ReviewCompareFindingItem[];
    persisted: ReviewCompareFindingDiffItem[];
  };
  statsDelta: {
    totalMilestones: { base: number; target: number };
    completedMilestones: { base: number; target: number };
    totalFindings: { base: number; target: number };
    severity: { high: { base: number; target: number }; medium: { base: number; target: number }; low: { base: number; target: number } };
  };
}

export interface ReviewToolStructuredResultV4 {
  path: string;
  reviewSnapshot?: ReviewSnapshotV4;
  reviewValidation?: ReviewValidationSummaryV4;
  reviewDelta?: ReviewToolDeltaV4;
  title?: string;
  date?: string;
  status?: ReviewMilestoneStatus;
  currentStatus?: ReviewMilestoneStatus;
  overallDecision?: ReviewOverallDecision | null;
  milestoneCount?: number;
  totalMilestones?: number;
  completedMilestones?: number;
  currentProgress?: string;
  totalFindings?: number;
  findingsBySeverity?: Record<ReviewFindingSeverity, number>;
  reviewedModules?: string[];
  latestConclusion?: string | null;
  recommendedNextAction?: string | null;
  metadata?: ReviewDocumentMetadataV3;
  formatVersion?: number | null;
  detectedFormat?: ReviewDocumentFormat;
  isValid?: boolean;
  canAutoUpgrade?: boolean;
  issues?: ReviewValidationIssue[];
  issueCount?: number;
  errorCount?: number;
  warningCount?: number;
  content?: string;
  findings?: string[];
  structuredFindings?: ReviewFindingInput[];
}

export interface ConversationReviewSessionState {
  reviewRunId: string;
  reviewPath: string;
  status: ReviewMilestoneStatus;
  createdAt: string;
  finalizedAt: string | null;
}

export const REVIEW_SCOPE_SECTION_TITLE = '## Review Scope';
export const REVIEW_SUMMARY_SECTION_TITLE = '## Review Summary';
export const REVIEW_FINDINGS_SECTION_TITLE = '## Review Findings';
export const REVIEW_MILESTONES_SECTION_TITLE = '## Review Milestones';
export const REVIEW_FINAL_CONCLUSION_SECTION_TITLE = '## Review Final Conclusion';
export const REVIEW_SNAPSHOT_SECTION_TITLE = '## Review Snapshot';

export const REVIEW_SUMMARY_START = '<!-- LIMCODE_REVIEW_SUMMARY_START -->';
export const REVIEW_SUMMARY_END = '<!-- LIMCODE_REVIEW_SUMMARY_END -->';
export const REVIEW_FINDINGS_START = '<!-- LIMCODE_REVIEW_FINDINGS_START -->';
export const REVIEW_FINDINGS_END = '<!-- LIMCODE_REVIEW_FINDINGS_END -->';
export const REVIEW_MILESTONES_START = '<!-- LIMCODE_REVIEW_MILESTONES_START -->';
export const REVIEW_MILESTONES_END = '<!-- LIMCODE_REVIEW_MILESTONES_END -->';
export const REVIEW_METADATA_START = '<!-- LIMCODE_REVIEW_METADATA_START -->';
export const REVIEW_METADATA_END = '<!-- LIMCODE_REVIEW_METADATA_END -->';

export const REVIEW_SNAPSHOT_RENDERER_VERSION = 4;
export const NO_MILESTONES_PLACEHOLDER = '<!-- no milestones -->';
export const NO_FINDINGS_PLACEHOLDER = '<!-- no findings -->';
export const DEFAULT_REVIEW_SCOPE = '_Review scope not provided._';
export const DEFAULT_FINAL_CONCLUSION = '_Final conclusion is pending._';
