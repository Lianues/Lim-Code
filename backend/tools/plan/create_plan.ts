/**
 * create_plan 工具
 *
 * 目标：把计划文档写入 .limcode/plans/**.md（或 multi-root: workspace/.limcode/plans/**.md）。
 * 注意：这是“生成计划”工具，不负责执行。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { getAllWorkspaces, resolveUriWithInfo, normalizeLineEndingsToLF } from '../utils';
import { isPlanPathAllowed } from '../../modules/settings/modeToolsPolicy';

const TODO_METADATA_KEY = 'todoList';

export interface CreatePlanArgs {
  title?: string;
  overview?: string;
  plan: string;
  todos?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }>;
  path?: string;
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

function isPlanModePathAllowedWithMultiRoot(pathStr: string): boolean {
  // 单工作区格式：.limcode/plans/...
  if (isPlanPathAllowed(pathStr)) return true;

  // 多工作区：允许 workspaceName/.limcode/plans/...
  const workspaces = getAllWorkspaces();
  if (workspaces.length <= 1) return false;

  const normalized = (pathStr || '').replace(/\\/g, '/');
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) return false;

  const workspacePrefix = normalized.slice(0, slashIndex);
  // 基本拒绝：伪前缀/盘符
  if (workspacePrefix === '.' || workspacePrefix === '..') return false;
  if (workspacePrefix.includes(':')) return false;

  const rest = normalized.slice(slashIndex + 1);
  return isPlanPathAllowed(rest);
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

async function ensureParentDir(uriFsPath: string): Promise<void> {
  const dir = path.dirname(uriFsPath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
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

        const content = normalizeLineEndingsToLF(plan);
        const bytes = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(uri, bytes);

        // 如果提供了 todos，则同步到对话元数据中（实现 TaskCards 自动同步）
        if (args.todos && args.todos.length > 0 && context?.conversationStore && context?.conversationId) {
          try {
            await context.conversationStore.setCustomMetadata(
              context.conversationId,
              TODO_METADATA_KEY,
              args.todos
            );
          } catch (todoError) {
            console.error('[create_plan] Failed to sync todos:', todoError);
          }
        }

        return {
          success: true,
          requiresUserConfirmation: true,
          data: {
            path: outPath,
            content,
            todos: args.todos
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

