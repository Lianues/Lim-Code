/**
 * Plan 文档中的来源元数据区块处理工具
 */

import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { getAllWorkspaces, normalizeLineEndingsToLF, resolveUriWithInfo } from '../utils';
import { isDesignPathAllowed, isReviewPathAllowed } from '../../modules/settings/modeToolsPolicy';

export type PlanSourceArtifactType = 'design' | 'review';

export interface PlanSourceArtifact {
  type: PlanSourceArtifactType;
  path: string;
  contentHash: string;
}

export interface PlanSourceArtifactInput {
  type: PlanSourceArtifactType;
  path: string;
}

export type PlanSourceStatus = 'up_to_date' | 'mismatched' | 'missing_source' | 'untracked';

export interface PlanSourceStatusResult {
  sourceStatus: PlanSourceStatus;
  sourceArtifactType?: PlanSourceArtifactType;
  sourcePath?: string;
  sourceArtifact?: PlanSourceArtifact;
}

export const PLAN_SOURCE_ARTIFACT_SECTION_START = '<!-- LIMCODE_SOURCE_ARTIFACT_START -->';
export const PLAN_SOURCE_ARTIFACT_SECTION_END = '<!-- LIMCODE_SOURCE_ARTIFACT_END -->';

function isPlanSourceArtifactType(value: unknown): value is PlanSourceArtifactType {
  return value === 'design' || value === 'review';
}

function getSourcePathValidator(type: PlanSourceArtifactType): (path: string) => boolean {
  return type === 'design' ? isDesignPathAllowed : isReviewPathAllowed;
}

function isScopedPathAllowedWithMultiRoot(pathStr: string, validator: (path: string) => boolean): boolean {
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

export function isPlanSourceArtifactPathAllowedWithMultiRoot(input: PlanSourceArtifactInput): boolean {
  return isScopedPathAllowedWithMultiRoot(input.path, getSourcePathValidator(input.type));
}

export function computeSourceArtifactHash(content: string): string {
  const normalized = normalizeLineEndingsToLF(content || '').trim();
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export function renderPlanSourceArtifactSection(artifact: PlanSourceArtifact): string {
  return [
    PLAN_SOURCE_ARTIFACT_SECTION_START,
    JSON.stringify(artifact),
    PLAN_SOURCE_ARTIFACT_SECTION_END
  ].join('\n');
}

export function extractPlanSourceArtifactSection(content: string): string | null {
  const normalized = normalizeLineEndingsToLF(content || '');
  const start = normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_START);
  const end = start >= 0
    ? normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_END, start + PLAN_SOURCE_ARTIFACT_SECTION_START.length)
    : -1;

  if (start < 0 || end < 0 || end < start) return null;
  return normalized.slice(start, end + PLAN_SOURCE_ARTIFACT_SECTION_END.length).trim();
}

export function stripPlanSourceArtifactSection(content: string): string {
  const normalized = normalizeLineEndingsToLF(content || '');
  const start = normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_START);
  const end = start >= 0
    ? normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_END, start + PLAN_SOURCE_ARTIFACT_SECTION_START.length)
    : -1;

  if (start < 0 || end < 0 || end < start) {
    return normalized;
  }

  const before = normalized.slice(0, start).trimEnd();
  const after = normalized.slice(end + PLAN_SOURCE_ARTIFACT_SECTION_END.length).trim();

  if (before && after) return `${before}\n\n${after}`;
  return before || after || '';
}

export function extractPlanSourceArtifact(content: string): PlanSourceArtifact | null {
  const section = extractPlanSourceArtifactSection(content);
  if (!section) return null;

  const normalized = normalizeLineEndingsToLF(section);
  const start = normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_START);
  const end = normalized.indexOf(PLAN_SOURCE_ARTIFACT_SECTION_END, start + PLAN_SOURCE_ARTIFACT_SECTION_START.length);
  if (start < 0 || end < 0 || end < start) return null;

  const payload = normalized
    .slice(start + PLAN_SOURCE_ARTIFACT_SECTION_START.length, end)
    .trim();
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as Partial<PlanSourceArtifact>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isPlanSourceArtifactType(parsed.type)) return null;
    if (typeof parsed.path !== 'string' || !parsed.path.trim()) return null;
    if (typeof parsed.contentHash !== 'string' || !parsed.contentHash.trim()) return null;

    return {
      type: parsed.type,
      path: parsed.path.trim(),
      contentHash: parsed.contentHash.trim()
    };
  } catch {
    return null;
  }
}

export async function buildTrackedPlanSourceArtifact(input: unknown): Promise<PlanSourceArtifact> {
  const type = (input as any)?.type;
  const path = typeof (input as any)?.path === 'string' ? (input as any).path.trim() : '';

  if (!isPlanSourceArtifactType(type) || !path) {
    throw new Error('sourceArtifact must include a valid type and path');
  }

  if (!isPlanSourceArtifactPathAllowedWithMultiRoot({ type, path })) {
    throw new Error(`Invalid sourceArtifact path for type "${type}": ${path}`);
  }

  const { uri, error } = resolveUriWithInfo(path);
  if (!uri) {
    throw new Error(error || `Unable to resolve sourceArtifact path: ${path}`);
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const content = Buffer.from(bytes).toString('utf-8');

  return {
    type,
    path,
    contentHash: computeSourceArtifactHash(content)
  };
}

export async function getPlanSourceStatusFromContent(
  planContent: string,
  readSourceContent: (path: string) => Promise<string | null>
): Promise<PlanSourceStatusResult> {
  const rawSection = extractPlanSourceArtifactSection(planContent);
  if (!rawSection) {
    return { sourceStatus: 'untracked' };
  }

  const artifact = extractPlanSourceArtifact(planContent);
  if (!artifact) {
    return { sourceStatus: 'missing_source' };
  }

  const sourceContent = await readSourceContent(artifact.path);
  if (typeof sourceContent !== 'string') {
    return {
      sourceStatus: 'missing_source',
      sourceArtifactType: artifact.type,
      sourcePath: artifact.path,
      sourceArtifact: artifact
    };
  }

  const currentHash = computeSourceArtifactHash(sourceContent);
  if (currentHash !== artifact.contentHash) {
    return {
      sourceStatus: 'mismatched',
      sourceArtifactType: artifact.type,
      sourcePath: artifact.path,
      sourceArtifact: artifact
    };
  }

  return {
    sourceStatus: 'up_to_date',
    sourceArtifactType: artifact.type,
    sourcePath: artifact.path,
    sourceArtifact: artifact
  };
}
