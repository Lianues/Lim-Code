/**
 * Review session state helpers
 */

import type { ToolContext } from '../types';
import type { ConversationReviewSessionState } from './schema';

export const REVIEW_SESSION_METADATA_KEY = 'reviewSession';

function getConversationStore(context?: ToolContext): ToolContext['conversationStore'] | undefined {
  return context?.conversationStore;
}

export function hasReviewSessionContext(context?: ToolContext): boolean {
  return Boolean(context?.conversationId && getConversationStore(context));
}

export async function loadReviewSessionState(context?: ToolContext): Promise<ConversationReviewSessionState | null> {
  const conversationId = context?.conversationId;
  const store = getConversationStore(context);
  if (!conversationId || !store) return null;
  const value = await store.getCustomMetadata(conversationId, REVIEW_SESSION_METADATA_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const reviewRunId = typeof record.reviewRunId === 'string' ? record.reviewRunId.trim() : '';
  const reviewPath = typeof record.reviewPath === 'string' ? record.reviewPath.trim() : '';
  const status = record.status === 'completed' ? 'completed' : 'in_progress';
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt.trim() : '';
  const finalizedAt = typeof record.finalizedAt === 'string' && record.finalizedAt.trim()
    ? record.finalizedAt.trim()
    : null;

  if (!reviewRunId || !reviewPath || !createdAt) return null;

  return {
    reviewRunId,
    reviewPath,
    status,
    createdAt,
    finalizedAt
  };
}

export async function saveReviewSessionState(
  context: ToolContext | undefined,
  state: ConversationReviewSessionState | null
): Promise<void> {
  const conversationId = context?.conversationId;
  const store = getConversationStore(context);
  if (!conversationId || !store) return;
  await store.setCustomMetadata(conversationId, REVIEW_SESSION_METADATA_KEY, state);
}

export async function clearReviewSessionState(context?: ToolContext): Promise<void> {
  await saveReviewSessionState(context, null);
}

export async function ensureNoActiveReviewSession(
  context: ToolContext | undefined,
  requestedPath: string
): Promise<{ ok: true } | { ok: false; error: string; session: ConversationReviewSessionState }> {
  const session = await loadReviewSessionState(context);
  if (!session || session.status !== 'in_progress') {
    return { ok: true };
  }

  return {
    ok: false,
    error: `An active review session already exists for this conversation: ${session.reviewPath}. Finish or reopen that review before creating another review document. Requested path: ${requestedPath}`,
    session
  };
}

export async function ensureMatchingActiveReviewSession(
  context: ToolContext | undefined,
  requestedPath: string
): Promise<{ ok: true; session?: ConversationReviewSessionState } | { ok: false; error: string; session?: ConversationReviewSessionState }> {
  const session = await loadReviewSessionState(context);
  if (!session) {
    return { ok: true };
  }

  if (session.reviewPath !== requestedPath) {
    return {
      ok: false,
      error: `Active review session path mismatch. Active review: ${session.reviewPath}. Requested path: ${requestedPath}`,
      session
    };
  }

  if (session.status === 'completed') {
    return {
      ok: false,
      error: `The active review session is already finalized for path: ${requestedPath}. Reopen the review before writing more milestones.`,
      session
    };
  }

  return { ok: true, session };
}
