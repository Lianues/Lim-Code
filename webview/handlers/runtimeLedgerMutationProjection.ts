import type { HandlerContext } from '../types';
import { chatStreamRuntimeLedgerBridge } from '../stream/runtimeLedgerBridge';

export async function createChatMutationProjection(
  ctx: HandlerContext,
  input: {
    conversationId: string;
    operation: string;
    targetIndex?: number;
    deletedCount?: number;
  }
) {
  const [page, checkpoints, metadata] = await Promise.all([
    ctx.conversationManager.getMessagesPaged(input.conversationId, { limit: 800 }),
    ctx.checkpointManager?.getCheckpoints(input.conversationId).catch(error => {
      console.warn('[RuntimeLedgerMutationProjection] Failed to include checkpoints:', error);
      return [];
    }) ?? Promise.resolve([]),
    ctx.conversationManager.getMetadata(input.conversationId).catch(error => {
      console.warn('[RuntimeLedgerMutationProjection] Failed to include metadata:', error);
      return undefined;
    })
  ]);
  const custom = (metadata?.custom || {}) as Record<string, unknown>;

  return chatStreamRuntimeLedgerBridge.createMutationProjection({
    conversationId: input.conversationId,
    operation: input.operation,
    targetIndex: input.targetIndex,
    deletedCount: input.deletedCount,
    messages: page.messages as unknown as Record<string, unknown>[],
    totalMessages: page.total,
    checkpoints: checkpoints as unknown as Record<string, unknown>[],
    activeBuild: (custom.activeBuild ?? null) as Record<string, unknown> | null
  });
}
