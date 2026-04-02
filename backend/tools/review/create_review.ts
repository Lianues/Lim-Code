/**
 * create_review 工具
 *
 * 目标：把 review 文档写入 .limcode/review/**.md（或 multi-root: workspace/.limcode/review/**.md）。
 * 注意：这是 Review 模式专用文档工具，不负责修改业务代码。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool, ToolContext, ToolDeclaration, ToolResult } from '../types';
import { getAllWorkspaces, resolveUriWithInfo } from '../utils';
import { isReviewPathAllowed } from '../../modules/settings/modeToolsPolicy';
import {
  buildInitialReviewDocument,
  getCurrentReviewDocumentLocale,
  summarizeReviewDocument
} from './reviewDocumentSection';
import { projectReviewToolResultData } from './resultProjection';
import { ensureNoActiveReviewSession, saveReviewSessionState } from './sessionState';

export interface CreateReviewArgs {
  title?: string;
  overview?: string;
  review: string;
  path?: string;
}

function slugify(input: string): string {
  const s = (input || '').trim().toLowerCase();
  const slug = s
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `review-${Date.now()}`;
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

async function ensureParentDir(uriFsPath: string): Promise<void> {
  const dir = path.dirname(uriFsPath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
}

export function createCreateReviewToolDeclaration(): ToolDeclaration {
  return {
    name: 'create_review',
    description:
      'Create a review document (markdown) and write it under .limcode/review/**.md. This tool is for Review mode and must not modify business code.',
    category: 'review',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional review title (used for default filename)' },
        overview: { type: 'string', description: 'Optional one-line review overview' },
        review: { type: 'string', description: 'Initial review content in markdown' },
        path: {
          type: 'string',
          description:
            'Optional output path. Must be under .limcode/review/**.md (or multi-root: workspace/.limcode/review/**.md).'
        }
      },
      required: ['review']
    }
  };
}

export function createCreateReviewTool(): Tool {
  return {
    declaration: createCreateReviewToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> => {
      const args = rawArgs as unknown as CreateReviewArgs;
      const review = typeof args.review === 'string' ? args.review : '';
      if (!review.trim()) {
        return { success: false, error: 'review is required and must be a non-empty string' };
      }

      const title = typeof args.title === 'string' ? args.title : '';
      const defaultPath = `.limcode/review/${slugify(title || 'review')}.md`;
      const outPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : defaultPath;

      if (!isReviewModePathAllowedWithMultiRoot(outPath)) {
        return { success: false, error: `Invalid review path. Only ".limcode/review/**.md" is allowed. Rejected path: ${outPath}` };
      }

      const sessionCheck = await ensureNoActiveReviewSession(context, outPath);
      if (sessionCheck.ok === false) {
        return { success: false, error: sessionCheck.error };
      }

      const { uri, error } = resolveUriWithInfo(outPath);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
      }

      try {
        await ensureParentDir(uri.fsPath);

        const locale = getCurrentReviewDocumentLocale();
        const content = buildInitialReviewDocument({
          title,
          overview: typeof args.overview === 'string' ? args.overview : '',
          review
        }, locale);
        const summary = summarizeReviewDocument(content);
        const bytes = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(uri, bytes);

        if (summary.reviewSnapshot) {
          await saveReviewSessionState(context, {
            reviewRunId: summary.reviewSnapshot.reviewRunId,
            reviewPath: outPath,
            status: summary.reviewSnapshot.status,
            createdAt: summary.reviewSnapshot.createdAt,
            finalizedAt: summary.reviewSnapshot.finalizedAt
          });
        }

        return {
          success: true,
          data: projectReviewToolResultData({
            path: outPath,
            content,
            delta: {
              type: 'created',
              changedFields: ['header', 'scope', 'reviewSnapshot', 'reviewSession']
            }
          })
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerCreateReview(): Tool {
  return createCreateReviewTool();
}
