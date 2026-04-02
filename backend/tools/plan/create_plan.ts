/**
 * create_plan 工具
 *
 * 目标：把计划文档写入 .limcode/plans/**.md（或 multi-root: workspace/.limcode/plans/**.md）。
 * 注意：这是“生成计划”工具，不负责执行。
 */

import * as vscode from 'vscode';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { buildPlanDocument } from './documentLayout';
import { ensureParentDir, isPlanModePathAllowedWithMultiRoot } from './pathUtils';
import { buildTrackedPlanSourceArtifact, renderPlanSourceArtifactSection, type PlanSourceArtifactInput } from './sourceArtifactSection';

export interface CreatePlanArgs {
  title?: string;
  overview?: string;
  plan: string;
  todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }>;
  path?: string;
  sourceArtifact?: PlanSourceArtifactInput;
}

function slugify(input: string): string {
  const s = (input || '').trim().toLowerCase();
  const slug = s
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `plan-${Date.now()}`;
}

export function createCreatePlanToolDeclaration(): ToolDeclaration {
  return {
    name: 'create_plan',
    description:
      'Create a plan document (markdown) and write it under .limcode/plans/**.md. This tool only creates the plan; it does NOT execute it.',
    category: 'plan',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional plan title (used for default filename)' },
        overview: { type: 'string', description: 'Optional one-line overview' },
        plan: { type: 'string', description: 'Plan content in markdown' },
        todos: {
          type: 'array',
          description: 'Optional TODO checklist (Cursor-style)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] }
            },
            required: ['id', 'content', 'status']
          }
        },
        sourceArtifact: {
          type: 'object',
          description: 'Optional source artifact to track plan freshness against a confirmed design or review.',
          properties: {
            type: { type: 'string', enum: ['design', 'review'] },
            path: { type: 'string' }
          },
          required: ['type', 'path']
        },
        path: {
          type: 'string',
          description:
            'Optional output path. Must be under .limcode/plans/**.md (or multi-root: workspace/.limcode/plans/**.md).'
        }
      },
      required: ['plan', 'todos']
    }
  };
}

export function createCreatePlanTool(): Tool {
  return {
    declaration: createCreatePlanToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>, context?: any): Promise<ToolResult> => {
      const args = rawArgs as unknown as CreatePlanArgs;
      const plan = typeof args.plan === 'string' ? args.plan : '';
      if (!plan.trim()) {
        return { success: false, error: 'plan is required and must be a non-empty string' };
      }

      const title = typeof args.title === 'string' ? args.title : '';
      const defaultPath = `.limcode/plans/${slugify(title || 'plan')}.plan.md`;
      const outPath = (typeof args.path === 'string' && args.path.trim()) ? args.path.trim() : defaultPath;

      if (!isPlanModePathAllowedWithMultiRoot(outPath)) {
        return { success: false, error: `Invalid plan path. Only ".limcode/plans/**.md" is allowed. Rejected path: ${outPath}` };
      }

      const { uri, error } = resolveUriWithInfo(outPath);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
      }

      try {
        await ensureParentDir(uri.fsPath);

        const normalizedPlan = normalizeLineEndingsToLF(plan);
        const trackedSourceArtifact = args.sourceArtifact
          ? await buildTrackedPlanSourceArtifact(args.sourceArtifact)
          : undefined;
        const sourceSection = trackedSourceArtifact
          ? renderPlanSourceArtifactSection(trackedSourceArtifact)
          : undefined;
        const { content, todos } = buildPlanDocument(normalizedPlan, args.todos, sourceSection);
        const bytes = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(uri, bytes);

        return {
          success: true,
          requiresUserConfirmation: true,
          data: {
            path: outPath,
            content,
            todos,
            sourceArtifact: trackedSourceArtifact
          }
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerCreatePlan(): Tool {
  return createCreatePlanTool();
}
