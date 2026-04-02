/**
 * compare_review_documents 工具
 *
 * 目标：只读比较两份 review 文档的 snapshot 差异，不修改任何 review 文档。
 */

import * as vscode from 'vscode';
import { createHash } from 'crypto';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { getAllWorkspaces, normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { isReviewPathAllowed } from '../../modules/settings/modeToolsPolicy';
import type {
  ReviewCompareFindingChange,
  ReviewCompareFindingDiffItem,
  ReviewCompareFindingItem,
  ReviewCompareResultV4,
  ReviewEvidenceRef,
  ReviewFindingRecordV4,
  ReviewSnapshotV4
} from './schema';
import { buildReviewValidationSummary } from './resultProjection';
import { validateReviewDocument } from './reviewDocumentSection';

export interface CompareReviewDocumentsArgs {
  basePath: string;
  targetPath: string;
  includeUnchanged?: boolean;
}

function isReviewModePathAllowedWithMultiRoot(pathStr: string): boolean {
  if (isReviewPathAllowed(pathStr)) return true;

  const workspaces = getAllWorkspaces();
  if (workspaces.length <= 1) return false;

  const normalized = (pathStr || '').replace(/\\/g, '/');
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) return false;

  const workspacePrefix = normalized.slice(0, slashIndex);
  if (workspacePrefix === '.' || workspacePrefix === '..') return false;
  if (workspacePrefix.includes(':')) return false;

  const rest = normalized.slice(slashIndex + 1);
  return isReviewPathAllowed(rest);
}

function normalizeComparableText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeEvidenceKey(ref: ReviewEvidenceRef): string {
  return [
    normalizeComparableText(ref.path),
    ref.lineStart ?? '',
    ref.lineEnd ?? '',
    normalizeComparableText(ref.symbol),
    normalizeComparableText(ref.excerptHash)
  ].join('|');
}

function sortUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function hashFindingKey(finding: ReviewFindingRecordV4): string {
  const evidenceKey = finding.evidence
    .map((item) => normalizeEvidenceKey(item))
    .filter(Boolean)
    .sort()
    .join('||');

  const payload = [
    normalizeComparableText(finding.category),
    normalizeComparableText(finding.title),
    normalizeComparableText(finding.descriptionMarkdown),
    evidenceKey
  ].join('||');

  return `finding:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

function toCompareFindingItem(finding: ReviewFindingRecordV4): ReviewCompareFindingItem {
  return {
    key: hashFindingKey(finding),
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    trackingStatus: finding.trackingStatus,
    descriptionMarkdown: finding.descriptionMarkdown,
    recommendationMarkdown: finding.recommendationMarkdown,
    relatedMilestoneIds: [...finding.relatedMilestoneIds],
    evidence: [...finding.evidence]
  };
}

function diffCompareFindingItems(
  base: ReviewCompareFindingItem,
  target: ReviewCompareFindingItem
): ReviewCompareFindingChange[] {
  const changes: ReviewCompareFindingChange[] = [];

  if (base.severity !== target.severity) changes.push('severity');
  if (base.trackingStatus !== target.trackingStatus) changes.push('trackingStatus');
  if (normalizeComparableText(base.title) !== normalizeComparableText(target.title)) changes.push('title');
  if (normalizeComparableText(base.descriptionMarkdown) !== normalizeComparableText(target.descriptionMarkdown)) changes.push('description');
  if (normalizeComparableText(base.recommendationMarkdown) !== normalizeComparableText(target.recommendationMarkdown)) changes.push('recommendation');

  const baseEvidence = sortUnique(base.evidence.map((item) => normalizeEvidenceKey(item)));
  const targetEvidence = sortUnique(target.evidence.map((item) => normalizeEvidenceKey(item)));
  if (baseEvidence.join('||') !== targetEvidence.join('||')) changes.push('evidence');

  const baseMilestones = sortUnique(base.relatedMilestoneIds);
  const targetMilestones = sortUnique(target.relatedMilestoneIds);
  if (baseMilestones.join('||') !== targetMilestones.join('||')) changes.push('relatedMilestoneIds');

  return changes;
}

function buildStatsDelta(base: ReviewSnapshotV4, target: ReviewSnapshotV4): ReviewCompareResultV4['statsDelta'] {
  return {
    totalMilestones: {
      base: base.stats.totalMilestones,
      target: target.stats.totalMilestones
    },
    completedMilestones: {
      base: base.stats.completedMilestones,
      target: target.stats.completedMilestones
    },
    totalFindings: {
      base: base.stats.totalFindings,
      target: target.stats.totalFindings
    },
    severity: {
      high: {
        base: base.stats.severity.high,
        target: target.stats.severity.high
      },
      medium: {
        base: base.stats.severity.medium,
        target: target.stats.severity.medium
      },
      low: {
        base: base.stats.severity.low,
        target: target.stats.severity.low
      }
    }
  };
}

function compareReviewSnapshots(
  basePath: string,
  baseSnapshot: ReviewSnapshotV4,
  targetPath: string,
  targetSnapshot: ReviewSnapshotV4,
  includeUnchanged: boolean
): ReviewCompareResultV4 {
  const baseFindings = baseSnapshot.findings.map((item) => toCompareFindingItem(item));
  const targetFindings = targetSnapshot.findings.map((item) => toCompareFindingItem(item));
  const baseMap = new Map(baseFindings.map((item) => [item.key, item]));
  const targetMap = new Map(targetFindings.map((item) => [item.key, item]));

  const added: ReviewCompareFindingItem[] = [];
  const removed: ReviewCompareFindingItem[] = [];
  const persisted: ReviewCompareFindingDiffItem[] = [];

  for (const targetItem of targetFindings) {
    const baseItem = baseMap.get(targetItem.key);
    if (!baseItem) {
      added.push(targetItem);
      continue;
    }

    const changes = diffCompareFindingItems(baseItem, targetItem);
    if (includeUnchanged || changes.length > 0) {
      persisted.push({
        key: targetItem.key,
        base: baseItem,
        target: targetItem,
        changes
      });
    }
  }

  for (const baseItem of baseFindings) {
    if (!targetMap.has(baseItem.key)) {
      removed.push(baseItem);
    }
  }

  const allPersistedCount = targetFindings.filter((item) => baseMap.has(item.key)).length;

  return {
    base: {
      path: basePath,
      reviewRunId: baseSnapshot.reviewRunId,
      generatedAt: baseSnapshot.render.generatedAt,
      locale: baseSnapshot.render.locale,
      title: baseSnapshot.header.title,
      date: baseSnapshot.header.date,
      status: baseSnapshot.status,
      overallDecision: baseSnapshot.overallDecision
    },
    target: {
      path: targetPath,
      reviewRunId: targetSnapshot.reviewRunId,
      generatedAt: targetSnapshot.render.generatedAt,
      locale: targetSnapshot.render.locale,
      title: targetSnapshot.header.title,
      date: targetSnapshot.header.date,
      status: targetSnapshot.status,
      overallDecision: targetSnapshot.overallDecision
    },
    summary: {
      addedFindings: added.length,
      removedFindings: removed.length,
      persistedFindings: allPersistedCount,
      severityChanged: persisted.filter((item) => item.changes.includes('severity')).length,
      trackingChanged: persisted.filter((item) => item.changes.includes('trackingStatus')).length,
      evidenceChanged: persisted.filter((item) => item.changes.includes('evidence')).length,
      relatedMilestoneChanged: persisted.filter((item) => item.changes.includes('relatedMilestoneIds')).length
    },
    findings: {
      added,
      removed,
      persisted
    },
    statsDelta: buildStatsDelta(baseSnapshot, targetSnapshot)
  };
}

export function createCompareReviewDocumentsToolDeclaration(): ToolDeclaration {
  return {
    name: 'compare_review_documents',
    description:
      'Compare two review documents under .limcode/review/**.md without modifying them. Returns finding deltas, tracking changes, and snapshot statistics differences.',
    category: 'review',
    parameters: {
      type: 'object',
      properties: {
        basePath: { type: 'string', description: 'Base review document path under .limcode/review/**.md' },
        targetPath: { type: 'string', description: 'Target review document path under .limcode/review/**.md' },
        includeUnchanged: { type: 'boolean', description: 'Whether to include unchanged persisted findings in the result' }
      },
      required: ['basePath', 'targetPath']
    }
  };
}

export function createCompareReviewDocumentsTool(): Tool {
  return {
    declaration: createCompareReviewDocumentsToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      const args = rawArgs as unknown as CompareReviewDocumentsArgs;
      const basePath = typeof args.basePath === 'string' ? args.basePath.trim() : '';
      const targetPath = typeof args.targetPath === 'string' ? args.targetPath.trim() : '';
      const includeUnchanged = args.includeUnchanged === true;

      if (!basePath || !targetPath) {
        return { success: false, error: 'basePath and targetPath are required and must be non-empty strings' };
      }

      if (!isReviewModePathAllowedWithMultiRoot(basePath) || !isReviewModePathAllowedWithMultiRoot(targetPath)) {
        return {
          success: false,
          error: `Invalid review path. Only ".limcode/review/**.md" is allowed. Received: ${basePath}, ${targetPath}`
        };
      }

      const baseResolved = resolveUriWithInfo(basePath);
      const targetResolved = resolveUriWithInfo(targetPath);
      if (!baseResolved.uri || !targetResolved.uri) {
        return {
          success: false,
          error: baseResolved.error || targetResolved.error || 'No workspace folder open'
        };
      }

      try {
        const [baseBytes, targetBytes] = await Promise.all([
          vscode.workspace.fs.readFile(baseResolved.uri),
          vscode.workspace.fs.readFile(targetResolved.uri)
        ]);

        const baseContent = normalizeLineEndingsToLF(new TextDecoder().decode(baseBytes));
        const targetContent = normalizeLineEndingsToLF(new TextDecoder().decode(targetBytes));
        const baseValidation = validateReviewDocument(baseContent);
        const targetValidation = validateReviewDocument(targetContent);
        const baseSnapshot = baseValidation.reviewSnapshot;
        const targetSnapshot = targetValidation.reviewSnapshot;

        if (!baseSnapshot || !targetSnapshot) {
          return {
            success: false,
            error: 'Both review documents must be parseable as recognized review formats before comparison.'
          };
        }

        const compareResult = compareReviewSnapshots(
          basePath,
          baseSnapshot,
          targetPath,
          targetSnapshot,
          includeUnchanged
        );

        return {
          success: true,
          data: {
            ...compareResult,
            baseValidation: buildReviewValidationSummary(baseContent),
            targetValidation: buildReviewValidationSummary(targetContent)
          }
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerCompareReviewDocuments(): Tool {
  return createCompareReviewDocumentsTool();
}
