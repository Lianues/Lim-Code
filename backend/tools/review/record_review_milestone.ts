/**
 * record_review_milestone 工具
 *
 * 目标：向现有 review 文档追加一个里程碑，并同步摘要区与问题汇总区。
 */

import * as vscode from 'vscode';
import type { Tool, ToolContext, ToolDeclaration, ToolResult } from '../types';
import { getAllWorkspaces, normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { isReviewPathAllowed } from '../../modules/settings/modeToolsPolicy';
import {
  appendReviewMilestone,
  getCurrentReviewDocumentLocale,
  type ReviewEvidenceRef,
  type ReviewFindingInput
} from './reviewDocumentSection';
import { projectReviewToolResultData } from './resultProjection';
import { ensureMatchingActiveReviewSession, saveReviewSessionState } from './sessionState';

export interface RecordReviewMilestoneArgs {
  path: string;
  milestoneId?: string;
  milestoneTitle: string;
  summary: string;
  status?: 'in_progress' | 'completed';
  conclusion?: string;
  evidenceFiles?: string[];
  evidence?: ReviewEvidenceRef[];
  findings?: string[];
  structuredFindings?: ReviewFindingInput[];
  reviewedModules?: string[];
  recommendedNextAction?: string;
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

export function createRecordReviewMilestoneToolDeclaration(): ToolDeclaration {
  return {
    name: 'record_review_milestone',
    description:
      'Append a milestone to an existing review document under .limcode/review/**.md and update the structured summary sections.',
    category: 'review',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Target review document path under .limcode/review/**.md' },
        milestoneId: { type: 'string', description: 'Optional milestone identifier. If omitted, it is generated automatically.' },
        milestoneTitle: { type: 'string', description: 'Milestone title' },
        summary: { type: 'string', description: 'Milestone summary in markdown' },
        status: { type: 'string', enum: ['in_progress', 'completed'], description: 'Milestone status' },
        conclusion: { type: 'string', description: 'Optional latest conclusion for the summary section' },
        evidenceFiles: {
          type: 'array',
          description: 'Optional related evidence file paths. Use this for simple file-level evidence when line-level references are not available.',
          items: { type: 'string' }
        },
        evidence: {
          type: 'array',
          description: 'Optional structured evidence references with file path and optional line or symbol details.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              lineStart: { type: 'number' },
              lineEnd: { type: 'number' },
              symbol: { type: 'string' },
              excerptHash: { type: 'string' }
            },
            required: ['path']
          }
        },
        findings: {
          type: 'array',
          description: 'Optional legacy finding strings to merge into the review findings section',
          items: { type: 'string' }
        },
        structuredFindings: {
          type: 'array',
          description: 'Optional structured findings to merge into the review findings section. Keep title concise, and put detailed explanation into description.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional short stable finding identifier. Omit it if you do not already have a concise id.' },
              severity: { type: 'string', enum: ['high', 'medium', 'low'] },
              category: {
                type: 'string',
                enum: ['html', 'css', 'javascript', 'accessibility', 'performance', 'maintainability', 'docs', 'test', 'other']
              },
              title: { type: 'string', description: 'Short finding title. Use a concise issue label, not a full sentence, file path, or recommendation.' },
              description: { type: 'string', description: 'Detailed explanation of the finding. Put reasoning, impact, and context here.' },
              evidenceFiles: { type: 'array', description: 'Optional simple evidence file paths for this finding.', items: { type: 'string' } },
              evidence: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    lineStart: { type: 'number' },
                    lineEnd: { type: 'number' },
                    symbol: { type: 'string' },
                    excerptHash: { type: 'string' }
                  },
                  required: ['path']
                }
              },
              relatedMilestoneIds: { type: 'array', description: 'Optional related milestone ids for cross-reference.', items: { type: 'string' } },
              recommendation: { type: 'string', description: 'Optional follow-up recommendation for fixing or handling the finding.' },
              trackingStatus: { type: 'string', enum: ['open', 'accepted_risk', 'fixed', 'wont_fix', 'duplicate'] }
            },
            required: ['title']
          }
        },
        reviewedModules: {
          type: 'array',
          description: 'Optional reviewed modules to merge into the review summary section',
          items: { type: 'string' }
        },
        recommendedNextAction: {
          type: 'string',
          description: 'Optional recommended next action for the review summary section'
        }
      },
      required: ['path', 'milestoneTitle', 'summary']
    }
  };
}

export function createRecordReviewMilestoneTool(): Tool {
  return {
    declaration: createRecordReviewMilestoneToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> => {
      const args = rawArgs as unknown as RecordReviewMilestoneArgs;
      const path = typeof args.path === 'string' ? args.path.trim() : '';
      const milestoneTitle = typeof args.milestoneTitle === 'string' ? args.milestoneTitle : '';
      const summary = typeof args.summary === 'string' ? args.summary : '';

      if (!path) {
        return { success: false, error: 'path is required and must be a non-empty string' };
      }
      if (!milestoneTitle.trim()) {
        return { success: false, error: 'milestoneTitle is required and must be a non-empty string' };
      }
      if (!summary.trim()) {
        return { success: false, error: 'summary is required and must be a non-empty string' };
      }

      if (!isReviewModePathAllowedWithMultiRoot(path)) {
        return { success: false, error: `Invalid review path. Only ".limcode/review/**.md" is allowed. Rejected path: ${path}` };
      }

      const sessionCheck = await ensureMatchingActiveReviewSession(context, path);
      if (sessionCheck.ok === false) {
        return { success: false, error: sessionCheck.error };
      }

      const { uri, error } = resolveUriWithInfo(path);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
      }

      try {
        const contentBytes = await vscode.workspace.fs.readFile(uri);
        const originalContent = normalizeLineEndingsToLF(new TextDecoder().decode(contentBytes));
        const locale = getCurrentReviewDocumentLocale();
        const next = appendReviewMilestone(originalContent, {
          milestoneId: typeof args.milestoneId === 'string' ? args.milestoneId : '',
          milestoneTitle,
          summary,
          status: args.status,
          conclusion: typeof args.conclusion === 'string' ? args.conclusion : '',
          evidenceFiles: Array.isArray(args.evidenceFiles) ? args.evidenceFiles : [],
          evidence: Array.isArray(args.evidence) ? args.evidence : [],
          findings: Array.isArray(args.findings) ? args.findings : [],
          structuredFindings: Array.isArray(args.structuredFindings) ? args.structuredFindings : [],
          reviewedModules: Array.isArray(args.reviewedModules) ? args.reviewedModules : [],
          recommendedNextAction: typeof args.recommendedNextAction === 'string' ? args.recommendedNextAction : ''
        }, locale);

        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(next.content));

        await saveReviewSessionState(context, {
          reviewRunId: next.reviewSnapshot.reviewRunId,
          reviewPath: path,
          status: next.reviewSnapshot.status,
          createdAt: next.reviewSnapshot.createdAt,
          finalizedAt: next.reviewSnapshot.finalizedAt
        });

        return {
          success: true,
          data: projectReviewToolResultData({
            path,
            content: next.content,
            delta: {
              type: 'milestone_recorded',
              milestoneId: next.milestoneId,
              addedFindingIds: next.addedFindingIds,
              changedFields: ['milestones', 'findings', 'summary', 'stats', 'reviewSnapshot', 'reviewSession']
            },
            extra: {
              milestoneId: next.milestoneId,
              findings: next.findings,
              structuredFindings: next.structuredFindings
            }
          })
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerRecordReviewMilestone(): Tool {
  return createRecordReviewMilestoneTool();
}
