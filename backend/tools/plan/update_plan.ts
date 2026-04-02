/**
 * update_plan 工具
 *
 * 目标：正式回写既有 plan 文档，并保持 TODO LIST 区块与当前计划内容一致。
 */

import * as vscode from 'vscode';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { buildPlanDocument, extractPlanBodyContent } from './documentLayout';
import { ensureParentDir, isPlanModePathAllowedWithMultiRoot } from './pathUtils';
import {
  buildTrackedPlanSourceArtifact,
  extractPlanSourceArtifactSection,
  renderPlanSourceArtifactSection,
  type PlanSourceArtifactInput
} from './sourceArtifactSection';

export type PlanUpdateMode = 'revision' | 'progress_sync';

export interface UpdatePlanArgs {
  path: string;
  plan?: string;
  todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }>;
  title?: string;
  overview?: string;
  changeSummary?: string;
  updateMode?: PlanUpdateMode;
  sourceArtifact?: PlanSourceArtifactInput;
}

const PROGRESS_SYNC_SOURCE_ARTIFACT_WARNING =
  'sourceArtifact was provided in progress_sync mode and has been ignored. Use updateMode: \'revision\' if you need to change the plan source.';
function normalizeUpdateMode(value: unknown): PlanUpdateMode {
  return value === 'progress_sync' ? 'progress_sync' : 'revision';
}

export function createUpdatePlanToolDeclaration(): ToolDeclaration {
  return {
    name: 'update_plan',
    strict: true,
    description:
      'Update an existing plan document (markdown) under .limcode/plans/**.md. Use revision mode to revise the plan itself, or progress_sync mode to sync the latest TODO snapshot during implementation. In progress_sync mode, only send path, todos, updateMode, and optional changeSummary. If sourceArtifact is accidentally included, it will be ignored with a warning. Do NOT forward continuation/source-artifact carry-over fields such as sourceArtifactType, sourcePath, sourceContent, planPath, planContent, or continuationPrompt.',
    category: 'plan',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target existing plan document path under .limcode/plans/**.md. Reuse the approved plan path here; do not send separate sourcePath or planPath fields.'
        },
        title: { type: 'string', description: 'Optional updated plan title.' },
        overview: { type: 'string', description: 'Optional updated one-line overview.' },
        plan: { type: 'string', description: 'Updated plan content in markdown. Required in revision mode.' },
        todos: {
          type: 'array',
          description: 'Updated TODO checklist for the plan.',
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
        updateMode: {
          type: 'string',
          description: 'revision rewrites the plan and requires re-confirmation. progress_sync only updates TODO state during implementation. In progress_sync mode, only send path, todos, updateMode, and optional changeSummary. If sourceArtifact is included by mistake, it will be ignored with a warning.',
          enum: ['revision', 'progress_sync']
        },
        sourceArtifact: {
          type: 'object',
          description: 'Optional source artifact to rebind the plan to the latest confirmed design or review. Allowed only in revision mode. Use this nested object only when the schema explicitly allows it. Do NOT send sibling carry-over fields such as sourceArtifactType, sourcePath, or sourceContent.',
          properties: {
            type: { type: 'string', enum: ['design', 'review'] },
            path: { type: 'string' }
          },
          required: ['type', 'path']
        },
        changeSummary: {
          type: 'string',
          description: 'Optional short summary of what changed in this plan revision.'
        }
      },
      required: ['path', 'todos']
    }
  };
}


export function createUpdatePlanTool(): Tool {
  return {
    declaration: createUpdatePlanToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      const args = rawArgs as unknown as UpdatePlanArgs;
      const targetPath = typeof args.path === 'string' ? args.path.trim() : '';
      const plan = typeof args.plan === 'string' ? args.plan : '';
      const changeSummary = typeof args.changeSummary === 'string' ? args.changeSummary.trim() : '';
      const updateMode = normalizeUpdateMode(args.updateMode);
      const hasSourceArtifactArg = Object.prototype.hasOwnProperty.call(rawArgs, 'sourceArtifact');
      const shouldIgnoreSourceArtifact = updateMode === 'progress_sync' && hasSourceArtifactArg;
      const warnings = shouldIgnoreSourceArtifact ? [PROGRESS_SYNC_SOURCE_ARTIFACT_WARNING] : [];
      const nextSourceArtifact = shouldIgnoreSourceArtifact ? undefined : args.sourceArtifact;

      if (!targetPath) {
        return { success: false, error: 'path is required and must be a non-empty string' };
      }

      if (updateMode === 'revision' && !plan.trim()) {
        return { success: false, error: 'plan is required and must be a non-empty string in revision mode' };
      }

      if (!isPlanModePathAllowedWithMultiRoot(targetPath)) {
        return { success: false, error: `Invalid plan path. Only ".limcode/plans/**.md" is allowed. Rejected path: ${targetPath}` };
      }

      const { uri, error } = resolveUriWithInfo(targetPath);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
      }

      let existingContent = '';
      try {
        const existingBytes = await vscode.workspace.fs.readFile(uri);
        existingContent = Buffer.from(existingBytes).toString('utf-8');
      } catch (e: any) {
        return { success: false, error: e?.message || `Plan document does not exist: ${targetPath}` };
      }

      try {
        await ensureParentDir(uri.fsPath);

        const existingSourceSection = extractPlanSourceArtifactSection(existingContent);
        const sourceSection = nextSourceArtifact
          ? renderPlanSourceArtifactSection(await buildTrackedPlanSourceArtifact(nextSourceArtifact))
          : existingSourceSection;

        const bodyContent = updateMode === 'progress_sync'
          ? extractPlanBodyContent(existingContent)
          : normalizeLineEndingsToLF(plan);

        const { content, todos } = buildPlanDocument(bodyContent, args.todos, sourceSection);
        const bytes = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(uri, bytes);

        return {
          success: true,
          requiresUserConfirmation: updateMode === 'revision',
          data: {
            path: targetPath,
            content,
            todos,
            updateMode,
            changeSummary: changeSummary || undefined,
            warnings: warnings.length > 0 ? warnings : undefined
          }
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerUpdatePlan(): Tool {
  return createUpdatePlanTool();
}
