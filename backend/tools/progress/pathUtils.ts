/**
 * Progress 工具路径辅助函数
 */

import { getAllWorkspaces } from '../utils';
// WP13 去重：ensureParentDir 原来在 progress/pathUtils.ts 中独立定义，
// 现改为从 utils.ts 重导出，消除四份重复实现。
export { ensureParentDir } from '../utils';
import {
  isDesignPathAllowed,
  isPlanPathAllowed,
  isProgressPathAllowed,
  isReviewPathAllowed,
} from '../../modules/settings/modeToolsPolicy';
import type { ProgressArtifactRef } from './schema';

const PROGRESS_ARTIFACT_KEYS = ['design', 'plan', 'review'] as const;
type ProgressArtifactKey = typeof PROGRESS_ARTIFACT_KEYS[number];

function isScopedPathAllowedWithMultiRoot(
  pathStr: string,
  validator: (path: string) => boolean
): boolean {
  if (validator(pathStr)) return true;

  const workspaces = getAllWorkspaces();
  if (workspaces.length <= 1) return false;

  const normalized = (pathStr || '').replace(/\\/g, '/');
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) return false;

  const workspacePrefix = normalized.slice(0, slashIndex);
  if (workspacePrefix === '.' || workspacePrefix === '..') return false;
  if (workspacePrefix.includes(':')) return false;

  const rest = normalized.slice(slashIndex + 1);
  return validator(rest);
}

function getArtifactPathValidator(kind: ProgressArtifactKey): (path: string) => boolean {
  if (kind === 'design') return isDesignPathAllowed;
  if (kind === 'plan') return isPlanPathAllowed;
  return isReviewPathAllowed;
}

function getArtifactScopeLabel(kind: ProgressArtifactKey): string {
  if (kind === 'design') return '.limcode/design/**.md';
  if (kind === 'plan') return '.limcode/plans/**.md';
  return '.limcode/review/**.md';
}

export function isProgressModePathAllowedWithMultiRoot(pathStr: string): boolean {
  return isScopedPathAllowedWithMultiRoot(pathStr, isProgressPathAllowed);
}

export function isProgressArtifactPathAllowedWithMultiRoot(
  kind: ProgressArtifactKey,
  pathStr: string
): boolean {
  return isScopedPathAllowedWithMultiRoot(pathStr, getArtifactPathValidator(kind));
}

export function validateProgressArtifactRefInput(
  value: unknown,
  options: {
    fieldName?: string;
    allowEmptyString?: boolean;
  } = {}
): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `${options.fieldName || 'artifactRef'} must be an object`;
  }

  const allowEmptyString = options.allowEmptyString ?? true;
  for (const key of PROGRESS_ARTIFACT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;

    const rawValue = (value as Record<string, unknown>)[key];
    if (typeof rawValue !== 'string') {
      return `${options.fieldName || 'artifactRef'}.${key} must be a string`;
    }

    const normalized = rawValue.trim();
    if (!normalized) {
      if (allowEmptyString) continue;
      return `${options.fieldName || 'artifactRef'}.${key} must be a non-empty string`;
    }

    if (!isProgressArtifactPathAllowedWithMultiRoot(key, normalized)) {
      return `${options.fieldName || 'artifactRef'}.${key} must point to ${getArtifactScopeLabel(key)}`;
    }
  }

  return null;
}

export function normalizeProgressArtifactRef(value: unknown): ProgressArtifactRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const next: ProgressArtifactRef = {};
  for (const key of PROGRESS_ARTIFACT_KEYS) {
    const rawValue = (value as Record<string, unknown>)[key];
    if (typeof rawValue !== 'string') continue;
    const normalized = rawValue.trim();
    if (!normalized) continue;
    next[key] = normalized;
  }

  return next;
}

export function applyProgressArtifactPatch(
  current: ProgressArtifactRef,
  patch: unknown
): ProgressArtifactRef {
  const next: ProgressArtifactRef = { ...current };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return next;
  }

  for (const key of PROGRESS_ARTIFACT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;

    const rawValue = (patch as Record<string, unknown>)[key];
    const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!normalized) {
      delete next[key];
      continue;
    }

    next[key] = normalized;
  }

  return next;
}
