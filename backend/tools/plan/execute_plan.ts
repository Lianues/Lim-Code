/**
 * execute_plan 工具
 *
 * 目标：读取 .cursor/plans/**.md 计划内容，并切换 PromptMode 到 code。
 *
 * 注意：本工具默认应“需要用户确认”才能执行（通过 toolAutoExec 配置控制）。
 */

import * as vscode from 'vscode';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { getAllWorkspaces, resolveUriWithInfo, normalizeLineEndingsToLF } from '../utils';
import { isPlanPathAllowed } from '../../modules/settings/modeToolsPolicy';
import { getGlobalSettingsManager } from '../../core/settingsContext';

export interface ExecutePlanArgs {
  path: string;
}

function isPlanModePathAllowedWithMultiRoot(pathStr: string): boolean {
  if (isPlanPathAllowed(pathStr)) return true;
  const workspaces = getAllWorkspaces();
  if (workspaces.length <= 1) return false;

  const normalized = (pathStr || '').replace(/\\/g, '/');
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) return false;

  const workspacePrefix = normalized.slice(0, slashIndex);
  if (workspacePrefix === '.' || workspacePrefix === '..') return false;
  if (workspacePrefix.includes(':')) return false;

  const rest = normalized.slice(slashIndex + 1);
  return isPlanPathAllowed(rest);
}

export function createExecutePlanToolDeclaration(): ToolDeclaration {
  return {
    name: 'execute_plan',
    description:
      'Read a plan markdown document from .cursor/plans/**.md and switch the current prompt mode to "code". This tool is a gate and should require user approval.',
    category: 'file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Plan file path under .cursor/plans/**.md' }
      },
      required: ['path']
    }
  };
}

export function createExecutePlanTool(): Tool {
  return {
    declaration: createExecutePlanToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      const p = (rawArgs as any)?.path;
      if (typeof p !== 'string' || !p.trim()) {
        return { success: false, error: 'path is required' };
      }
      const planPath = p.trim();

      if (!isPlanModePathAllowedWithMultiRoot(planPath)) {
        return { success: false, error: `Invalid plan path. Only ".cursor/plans/**.md" is allowed. Rejected path: ${planPath}` };
      }

      const { uri, error } = resolveUriWithInfo(planPath);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
      }

      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const planContent = normalizeLineEndingsToLF(new TextDecoder().decode(bytes));

        const settingsManager = getGlobalSettingsManager();
        if (!settingsManager) {
          return { success: false, error: 'SettingsManager is not available' };
        }

        const from = settingsManager.getCurrentPromptModeId();
        await settingsManager.setCurrentPromptMode('code');

        return {
          success: true,
          data: {
            path: planPath,
            planContent,
            switchedModeFrom: from,
            switchedModeTo: 'code'
          }
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerExecutePlan(): Tool {
  return createExecutePlanTool();
}

