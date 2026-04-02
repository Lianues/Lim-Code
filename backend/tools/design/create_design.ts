/**
 * create_design 工具
 *
 * 目标：把设计文档写入 .limcode/design/**.md（或 multi-root: workspace/.limcode/design/**.md）。
 * 注意：这是“生成设计”工具，不负责创建 plan 或执行代码。
 */

import * as vscode from 'vscode';
import type { Tool, ToolDeclaration, ToolResult } from '../types';
import { normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { ensureParentDir, isDesignModePathAllowedWithMultiRoot } from './pathUtils';

export interface CreateDesignArgs {
  title?: string;
  overview?: string;
  design: string;
  path?: string;
}

function slugify(input: string): string {
  const s = (input || '').trim().toLowerCase();
  const slug = s
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `design-${Date.now()}`;
}

export function createCreateDesignToolDeclaration(): ToolDeclaration {
  return {
    name: 'create_design',
    description:
      'Create a design document (markdown) and write it under .limcode/design/**.md. This tool only creates the design; it does NOT create a plan or implement code.',
    category: 'design',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional design title (used for default filename)' },
        overview: { type: 'string', description: 'Optional one-line overview' },
        design: { type: 'string', description: 'Design content in markdown' },
        path: {
          type: 'string',
          description:
            'Optional output path. Must be under .limcode/design/**.md (or multi-root: workspace/.limcode/design/**.md).'
        }
      },
      required: ['design']
    }
  };
}

export function createCreateDesignTool(): Tool {
  return {
    declaration: createCreateDesignToolDeclaration(),
    handler: async (rawArgs: Record<string, unknown>): Promise<ToolResult> => {
      const args = rawArgs as unknown as CreateDesignArgs;
      const design = typeof args.design === 'string' ? args.design : '';
      if (!design.trim()) {
        return { success: false, error: 'design is required and must be a non-empty string' };
      }

      const title = typeof args.title === 'string' ? args.title : '';
      const defaultPath = `.limcode/design/${slugify(title || 'design')}.md`;
      const outPath = (typeof args.path === 'string' && args.path.trim()) ? args.path.trim() : defaultPath;

      if (!isDesignModePathAllowedWithMultiRoot(outPath)) {
        return { success: false, error: `Invalid design path. Only ".limcode/design/**.md" is allowed. Rejected path: ${outPath}` };
      }

      const { uri, error } = resolveUriWithInfo(outPath);
      if (!uri) {
        return { success: false, error: error || 'No workspace folder open' };
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
            path: outPath,
            content
          }
        };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  };
}

export function registerCreateDesign(): Tool {
  return createCreateDesignTool();
}
