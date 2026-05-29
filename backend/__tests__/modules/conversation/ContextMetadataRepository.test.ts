import { ConversationManager, MemoryStorageAdapter } from '../../../modules/conversation';
import { ContextProjectionStore } from '../../../modules/api/chat/services/ContextProjectionStore';
import { ContextLedgerService } from '../../../modules/api/chat/services/ContextLedgerService';
import {
    CONVERSATION_CONTEXT_LEDGER_KEY,
    CONVERSATION_CONTEXT_PROJECTION_KEY,
    CONVERSATION_METADATA_SCHEMA_VERSION,
    isContextLedgerDocument,
    isContextProjectionDocument
} from '../../../modules/conversation/contextTypes';

describe('typed context metadata foundation', () => {
    it('creates root schemaVersion for new conversations and typed repository fallback reads', async () => {
        const manager = new ConversationManager(new MemoryStorageAdapter());
        const conversationId = 'ctx-meta-schema';

        await manager.createConversation(conversationId, 'schema check');

        const metadata = await manager.getMetadata(conversationId);
        expect(metadata?.schemaVersion).toBe(CONVERSATION_METADATA_SCHEMA_VERSION);

        const repository = manager.getMetadataRepository();
        const projectionDocument = await repository.getContextProjectionDocument(conversationId);
        expect(projectionDocument.schemaVersion).toBe(CONVERSATION_METADATA_SCHEMA_VERSION);
        expect(projectionDocument.projections).toEqual({});
    });

    it('serializes custom metadata updates so P1 domains do not overwrite each other', async () => {
        const manager = new ConversationManager(new MemoryStorageAdapter());
        const conversationId = 'ctx-meta-serialized';
        await manager.createConversation(conversationId);

        /**
         * 修改原因：旧 setCustomMetadata 是裸 load-modify-save，并发写 contextProjection/contextLedger 这类 P1 key 时可能丢更新。
         * 修改方式：测试两个并发 updateCustomMetadata 调用都能保留自己的 key。
         * 目的：锁定 per-conversation metadata 队列，避免后续重构回退到覆盖写。
         */
        await Promise.all([
            manager.updateCustomMetadata(conversationId, async custom => {
                await Promise.resolve();
                custom[CONVERSATION_CONTEXT_PROJECTION_KEY] = { schemaVersion: 1, projections: {} };
            }),
            manager.updateCustomMetadata(conversationId, async custom => {
                await Promise.resolve();
                custom[CONVERSATION_CONTEXT_LEDGER_KEY] = { schemaVersion: 1, entries: [] };
            })
        ]);

        const metadata = await manager.getMetadata(conversationId);
        expect(isContextProjectionDocument(metadata?.custom?.[CONVERSATION_CONTEXT_PROJECTION_KEY])).toBe(true);
        expect(isContextLedgerDocument(metadata?.custom?.[CONVERSATION_CONTEXT_LEDGER_KEY])).toBe(true);
    });

    it('rejects custom metadata keys outside the central whitelist', async () => {
        const manager = new ConversationManager(new MemoryStorageAdapter());
        const repository = manager.getMetadataRepository();

        await expect(repository.setCustomValue('ctx-meta-keyguard', 'unknownKey' as any, {})).rejects.toThrow(
            'Unsupported conversation custom metadata key'
        );
    });

    it('creates a projection version chain without deleting immutable conversation history', async () => {
        const manager = new ConversationManager(new MemoryStorageAdapter());
        const conversationId = 'ctx-projection-chain';
        await manager.createConversation(conversationId);
        await manager.addMessage(conversationId, 'user', [{ text: 'original message' }]);

        const store = new ContextProjectionStore(manager.getMetadataRepository());
        const first = await store.createProjection({
            conversationId,
            mode: 'trimmed',
            startIndex: 1,
            cause: 'auto_trim',
            reversible: true,
            lossy: false
        });
        const reset = await store.resetProjection(conversationId, 'ledger-reset');

        expect(reset.predecessorId).toBe(first.projectionId);
        expect(reset.startIndex).toBe(0);
        expect(reset.lossy).toBe(false);
        expect(await manager.getHistory(conversationId)).toHaveLength(1);

        const document = await manager.getMetadataRepository().getContextProjectionDocument(conversationId);
        expect(document.currentProjectionId).toBe(reset.projectionId);
        expect(Object.keys(document.projections)).toEqual(expect.arrayContaining([first.projectionId, reset.projectionId]));
    });

    it('clears current projection when transcript structure changes', async () => {
        const manager = new ConversationManager(new MemoryStorageAdapter());
        const conversationId = 'ctx-projection-invalidated';
        await manager.createConversation(conversationId);
        await manager.addMessage(conversationId, 'user', [{ text: 'first' }]);
        await manager.addMessage(conversationId, 'model', [{ text: 'answer' }]);
        await manager.addMessage(conversationId, 'user', [{ text: 'second' }]);

        const store = new ContextProjectionStore(manager.getMetadataRepository());
        await store.createProjection({
            conversationId,
            mode: 'trimmed',
            startIndex: 2,
            cause: 'manual_compact',
            reversible: true,
            lossy: false
        });
        expect(await store.getCurrentProjection(conversationId)).toBeDefined();

        /**
         * 修改原因：ContextProjection 已成为 prompt assembly 的工作上下文边界；删除/插入/回档后旧 startIndex 可能指向错误消息。
         * 修改方式：任一结构性 transcript mutation 都通过 ConversationManager.invalidateContextManagementState 清理 current projection。
         * 目的：防止 stale projection 在后续请求中错误截断上下文。
         */
        await manager.deleteMessage(conversationId, 0);

        expect(await store.getCurrentProjection(conversationId)).toBeUndefined();
        const metadata = await manager.getMetadata(conversationId);
        expect(metadata?.custom?.[CONVERSATION_CONTEXT_PROJECTION_KEY]).toBeNull();
    });

    it('writes pending, success and failed ledger entries with recovery boundaries', async () => {
        const manager = new ConversationManager(new MemoryStorageAdapter());
        const conversationId = 'ctx-ledger-basic';
        await manager.createConversation(conversationId);

        const ledger = new ContextLedgerService(manager.getMetadataRepository());
        const pending = await ledger.beginOperation({
            conversationId,
            operation: 'manual_compact',
            actor: 'slash_command',
            reason: 'user requested compact',
            beforeProjectionId: 'before-1',
            reversible: true,
            lossy: false,
            tokenBefore: 1200
        });
        const success = await ledger.markSuccess(conversationId, pending.ledgerEntryId, {
            afterProjectionId: 'after-1',
            tokenAfter: 600
        });
        const failed = await ledger.beginOperation({
            conversationId,
            operation: 'manual_summarize',
            actor: 'slash_command',
            reason: 'user requested summarize',
            reversible: false,
            lossy: true
        });
        await ledger.markFailed(conversationId, failed.ledgerEntryId, { code: 'SUMMARY_FAILED', message: 'model failed' }, 'Retry later');

        expect(success.status).toBe('success');
        expect(success.afterProjectionId).toBe('after-1');
        expect(success.tokenAfter).toBe(600);

        const latest = await ledger.findLatestReversibleSuccess(conversationId);
        expect(latest?.ledgerEntryId).toBe(pending.ledgerEntryId);

        const entries = await ledger.listEntries(conversationId);
        expect(entries).toHaveLength(2);
        expect(entries[1].status).toBe('failed');
        expect(entries[1].recoveryHint).toBe('Retry later');
    });
});
