/**
 * Plan 工具路径辅助函数
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getAllWorkspaces } from '../utils';
import { isPlanPathAllowed } from '../../modules/settings/modeToolsPolicy';

export function isPlanModePathAllowedWithMultiRoot(pathStr: string): boolean {
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

export async function ensureParentDir(uriFsPath: string): Promise<void> {
  const dir = path.dirname(uriFsPath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
}
