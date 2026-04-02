/**
 * update_design 工具
 *
 * 目标：正式回写既有 design 文档。
 */

import * as vscode from 'vscode';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { ensureParentDir, isDesignModePathAllowedWithMultiRoot } from './pathUtils';

export interface UpdateDesignArgs {
  path: string;
  design: string;
  title?: string;
  overview?: string;
  changeSummary?: string;
}

export function createUpdateDesignToolDeclaration(): ToolDeclaration {
  return {
    name: 'update_design',
    description:
      'Update an existing design document (markdown) under .limcode/design/**.md. Use this when the user wants to revise the current design instead of creating a new one.',
    category: 'design',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target existing design document path under .limcode/design/**.md.'
        },
        title: { type: 'string', description: 'Optional updated design title.' },
        overview: { type: 'string', description: 'Optional updated one-line overview.' },
        design: { type: 'string', description: 'Updated design content in markdown.' },
        changeSummary: {
          type: 'string',
          description: 'Optional short summary of what changed in this design revision.'
        }
      },
      required: ['path', 'design']
    }
  };
}

export function createUpdateDesignTool(): Tool {
  return {
    declaration: createUpdateDesignToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      const args = rawArgs as unknown as UpdateDesignArgs;
      const targetPath = typeof args.path === 'string' ? args.path.trim() : '';
      const design = typeof args.design === 'string' ? args.design : '';
      const changeSummary = typeof args.changeSummary === 'string' ? args.changeSummary.trim() : '';

      if (!targetPath) {
        return { success: false, error: 'path is required and must be a non-empty string' };
      }

      if (!design.trim()) {
        return { success: false, error: 'design is required and must be a non-empty string' };
      }

      if (!isDesignModePathAllowedWithMultiRoot(targetPath)) {
        return { success: false, error: `Invalid design path. Only ".limcode/design/**.md" is allowed. Rejected path: ${targetPath}` };
      }

      const { uri, error } = resolveUriWithInfo(targetPath);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
      }

      try {
        await vscode.workspace.fs.readFile(uri);
      } catch (e: any) {
        return { success: false, error: e?.message || `Design document does not exist: ${targetPath}` };
      }

      try {
        await ensureParentDir(uri.fsPath);

        const content = normalizeLineEndingsToLF(design);
        const bytes = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(uri, bytes);

        return {
          success: true,
          requiresUserConfirmation: true,
          data: {
            path: targetPath,
            content,
            changeSummary: changeSummary || undefined
          }
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerUpdateDesign(): Tool {
  return createUpdateDesignTool();
}
