/**
 * validate_review_document 工具
 *
 * 目标：只读校验 review 文档的格式、元数据和生命周期一致性。
 */

import * as vscode from 'vscode';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { getAllWorkspaces, normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { isReviewPathAllowed } from '../../modules/settings/modeToolsPolicy';
import {
  summarizeReviewDocument,
  validateReviewDocument
} from './reviewDocumentSection';
import { buildReviewValidationSummary } from './resultProjection';

export interface ValidateReviewDocumentArgs {
  path: string;
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

export function createValidateReviewDocumentToolDeclaration(): ToolDeclaration {
  return {
    name: 'validate_review_document',
    description:
      'Validate an existing review document under .limcode/review/**.md without modifying it. Reports format, metadata health, and invariant issues.',
    category: 'review',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Target review document path under .limcode/review/**.md' }
      },
      required: ['path']
    }
  };
}

export function createValidateReviewDocumentTool(): Tool {
  return {
    declaration: createValidateReviewDocumentToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      const args = rawArgs as unknown as ValidateReviewDocumentArgs;
      const path = typeof args.path === 'string' ? args.path.trim() : '';

      if (!path) {
        return { success: false, error: 'path is required and must be a non-empty string' };
      }

      if (!isReviewModePathAllowedWithMultiRoot(path)) {
        return { success: false, error: `Invalid review path. Only ".limcode/review/**.md" is allowed. Rejected path: ${path}` };
      }

      const { uri, error } = resolveUriWithInfo(path);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
      }

      try {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const content = normalizeLineEndingsToLF(new TextDecoder().decode(contentBytes));
        const validation = validateReviewDocument(content);
        let summary: ReturnType<typeof summarizeReviewDocument> | undefined;

        try {
          if (validation.detectedFormat !== 'unknown') {
            summary = summarizeReviewDocument(content);
          }
        } catch {
          summary = undefined;
        }

        const reviewValidation = buildReviewValidationSummary(content);

        return {
          success: true,
          data: {
            path,
            ...validation,
            reviewSnapshot: validation.reviewSnapshot,
            reviewValidation,
            reviewDelta: {
              type: 'validated',
              changedFields: []
            },
            metadata: validation.metadata,
            title: summary?.title,
            date: summary?.date,
            status: summary?.status,
            currentStatus: summary?.status,
            overallDecision: summary?.overallDecision,
            milestoneCount: summary?.totalMilestones,
            totalMilestones: summary?.totalMilestones,
            completedMilestones: summary?.completedMilestones,
            currentProgress: summary?.currentProgress,
            totalFindings: summary?.totalFindings,
            findingsBySeverity: summary?.findingsBySeverity,
            latestConclusion: summary?.latestConclusion,
            recommendedNextAction: summary?.recommendedNextAction,
            reviewedModules: summary?.reviewedModules,
            issueCount: reviewValidation.issueCount,
            errorCount: reviewValidation.errorCount,
            warningCount: reviewValidation.warningCount
          }
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerValidateReviewDocument(): Tool {
  return createValidateReviewDocumentTool();
}
