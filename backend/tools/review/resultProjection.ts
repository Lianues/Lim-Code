/**
 * Review tool result projection helpers
 */

import type { ReviewDocumentSummarySnapshot, ReviewToolDeltaV4, ReviewToolStructuredResultV4, ReviewValidationSummaryV4 } from './schema';
import { summarizeReviewDocument, validateReviewDocument } from './reviewDocumentSection';

export interface ProjectReviewToolResultOptions {
  path: string;
  content: string;
  delta?: ReviewToolDeltaV4;
  extra?: Record<string, unknown>;
  includeContent?: boolean;
}

export function buildReviewValidationSummary(content: string): ReviewValidationSummaryV4 {
  const validation = validateReviewDocument(content);
  return {
    isValid: validation.isValid,
    detectedFormat: validation.detectedFormat,
    formatVersion: validation.formatVersion,
    issueCount: validation.issues.length,
    errorCount: validation.issues.filter((item) => item.severity === 'error').length,
    warningCount: validation.issues.filter((item) => item.severity === 'warning').length,
    canAutoUpgrade: validation.canAutoUpgrade,
    issues: validation.issues
  };
}

export function projectReviewToolResultData(options: ProjectReviewToolResultOptions): ReviewToolStructuredResultV4 {
  const validation = validateReviewDocument(options.content);
  const summary: ReviewDocumentSummarySnapshot = summarizeReviewDocument(options.content);
  const reviewValidation = buildReviewValidationSummary(options.content);

  const data: ReviewToolStructuredResultV4 = {
    path: options.path,
    reviewSnapshot: validation.reviewSnapshot,
    reviewValidation,
    reviewDelta: options.delta,
    title: summary.title,
    date: summary.date,
    status: summary.status,
    currentStatus: summary.status,
    overallDecision: summary.overallDecision,
    milestoneCount: summary.totalMilestones,
    totalMilestones: summary.totalMilestones,
    completedMilestones: summary.completedMilestones,
    currentProgress: summary.currentProgress,
    totalFindings: summary.totalFindings,
    findingsBySeverity: summary.findingsBySeverity,
    reviewedModules: summary.reviewedModules,
    latestConclusion: summary.latestConclusion,
    recommendedNextAction: summary.recommendedNextAction,
    metadata: validation.metadata,
    formatVersion: validation.formatVersion,
    detectedFormat: validation.detectedFormat,
    isValid: validation.isValid,
    canAutoUpgrade: validation.canAutoUpgrade,
    issues: validation.issues,
    issueCount: reviewValidation.issueCount,
    errorCount: reviewValidation.errorCount,
    warningCount: reviewValidation.warningCount,
    content: options.includeContent === false ? undefined : options.content
  };

  if (options.extra) {
    Object.assign(data, options.extra);
  }

  return data;
}
