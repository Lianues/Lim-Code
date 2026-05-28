/**
 * Plan 工具路径辅助函数
 */

import { getAllWorkspaces } from '../utils';
// WP13 去重：ensureParentDir 原来在 plan/pathUtils.ts 中独立定义，
// 现改为从 utils.ts 重导出，消除四份重复实现。
export { ensureParentDir } from '../utils';
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
