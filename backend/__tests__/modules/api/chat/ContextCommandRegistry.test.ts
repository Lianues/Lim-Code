import { ConversationManager, MemoryStorageAdapter } from '../../../../modules/conversation';
import { ContextProjectionStore } from '../../../../modules/api/chat/services/ContextProjectionStore';
import { ContextLedgerService } from '../../../../modules/api/chat/services/ContextLedgerService';
import { ContextStatusService } from '../../../../modules/api/chat/services/ContextStatusService';
import { ContextOperationService } from '../../../../modules/api/chat/services/ContextOperationService';
import { ContextCommandRegistry } from '../../../../modules/api/chat/services/ContextCommandRegistry';
import type { Content } from '../../../../modules/conversation/types';

function createRegistry(options: { mode?: 'trim' | 'summarize' } = {}) {
    const manager = new ConversationManager(new MemoryStorageAdapter());
    const repository = manager.getMetadataRepository();
    const projectionStore = new ContextProjectionStore(repository);
    const ledgerService = new ContextLedgerService(repository);
    const statusService = new ContextStatusService(manager, projectionStore, ledgerService);
    const summarizeService = {
        handleSummarizeContext: jest.fn(async (): Promise<any> => ({
            success: true,
            summaryContent: { role: 'user', parts: [{ text: 'summary' }], isSummary: true } as Content,
            summarizedMessageCount: 3,
            beforeTokenCount: 1200,
            afterTokenCount: 300,
            insertIndex: 2
        }))
    };
    const configManager = {
        getConfig: jest.fn(async () => ({ id: 'config-a', enabled: true, type: 'custom', contextManagementMode: options.mode ?? 'summarize' }))
    };
    const contextTrimService = {
        identifyRounds: jest.fn((history: Content[]) => {
            const rounds: Array<{ startIndex: number; endIndex: number }> = [];
            let current = -1;
            for (let i = 0; i < history.length; i++) {
                const message = history[i];
                if (message.role === 'user' && !message.isFunctionResponse) {
                    if (current !== -1) rounds.push({ startIndex: current, endIndex: i });
                    current = i;
                }
            }
            if (current !== -1) rounds.push({ startIndex: current, endIndex: history.length });
            return rounds;
        })
    };
    const operationService = new ContextOperationService(
        manager,
        configManager as any,
        summarizeService as any,
        contextTrimService as any,
        projectionStore,
        ledgerService,
        statusService
    );
    return { manager, projectionStore, ledgerService, summarizeService, configManager, contextTrimService, registry: new ContextCommandRegistry(operationService) };
}

describe('ContextCommandRegistry', () => {
    it('parses only supported context slash commands', () => {
        const { registry } = createRegistry();

        expect(registry.parse('/context-status')?.name).toBe('/context-status');
        expect(registry.parse('/compact --confirm')?.confirmed).toBe(true);
        expect(registry.parse('/unknown')).toBeNull();
        expect(registry.parse('normal prompt')).toBeNull();
    });

    it('returns confirmation payload for lossy or reset commands before execution', async () => {
        const { manager, registry, summarizeService } = createRegistry();
        await manager.createConversation('ctx-command-confirm');
        const parsed = registry.parse('/compact')!;

        /**
         * 修改原因：/compact、/summarize 和 /context-reset 不能直接改变 projection，必须二次确认。
         * 修改方式：registry 在未带 --confirm 时直接返回 confirmation payload，不调用 operation service。
         * 目的：锁定危险操作确认模型，避免 UI 或 ChatFlow 绕过确认。
         */
        const payload = await registry.execute(parsed, {
            conversationId: 'ctx-command-confirm',
            configId: 'config-a',
            actor: 'slash_command'
        });

        expect(payload.kind).toBe('confirmation');
        expect(payload.nextActions?.[0]).toContain('/compact --confirm');
        expect(summarizeService.handleSummarizeContext).not.toHaveBeenCalled();
    });

    it('executes context status without creating a normal user message', async () => {
        const { manager, registry } = createRegistry();
        await manager.createConversation('ctx-command-status');
        await manager.addMessage('ctx-command-status', 'user', [{ text: 'hello' }]);

        const payload = await registry.execute(registry.parse('/context-status')!, {
            conversationId: 'ctx-command-status',
            configId: 'config-a',
            actor: 'slash_command'
        });

        expect(payload.kind).toBe('status');
        expect(payload.status?.historyLength).toBe(1);
        expect(await manager.getHistory('ctx-command-status')).toHaveLength(1);
    });

    it('executes confirmed reset through projection and ledger services', async () => {
        const { manager, registry, ledgerService, projectionStore } = createRegistry();
        const conversationId = 'ctx-command-reset';
        await manager.createConversation(conversationId);
        await manager.addMessage(conversationId, 'user', [{ text: 'original' }]);

        const payload = await registry.execute(registry.parse('/context-reset --confirm')!, {
            conversationId,
            configId: 'config-a',
            actor: 'slash_command'
        });

        const projection = await projectionStore.getCurrentProjection(conversationId);
        const entries = await ledgerService.listEntries(conversationId);
        expect(payload.kind).toBe('success');
        expect(projection?.mode).toBe('full');
        expect(entries).toHaveLength(1);
        expect(entries[0].operation).toBe('reset');
        expect(entries[0].status).toBe('success');
        expect(await manager.getHistory(conversationId)).toHaveLength(1);
    });

    it('executes confirmed compact in trim mode as reversible trimmed projection without summarizing', async () => {
        const { manager, registry, ledgerService, projectionStore, summarizeService } = createRegistry({ mode: 'trim' });
        const conversationId = 'ctx-command-compact-trim';
        await manager.createConversation(conversationId);
        await manager.addMessage(conversationId, 'user', [{ text: 'round 1' }]);
        await manager.addMessage(conversationId, 'model', [{ text: 'answer 1' }]);
        await manager.addMessage(conversationId, 'user', [{ text: 'round 2' }]);
        await manager.addMessage(conversationId, 'model', [{ text: 'answer 2' }]);
        await manager.addMessage(conversationId, 'user', [{ text: 'round 3' }]);

        const payload = await registry.execute(registry.parse('/compact --confirm')!, {
            conversationId,
            configId: 'config-a',
            actor: 'slash_command'
        });

        const projection = await projectionStore.getCurrentProjection(conversationId);
        const entries = await ledgerService.listEntries(conversationId);
        expect(summarizeService.handleSummarizeContext).not.toHaveBeenCalled();
        expect(payload.kind).toBe('success');
        expect(payload.lossy).toBe(false);
        expect(payload.reversible).toBe(true);
        expect(typeof payload.tokenAfter).toBe('number');
        expect(projection?.mode).toBe('trimmed');
        expect(projection?.startIndex).toBe(2);
        expect(projection?.lossy).toBe(false);
        expect(entries).toHaveLength(1);
        expect(entries[0].operation).toBe('manual_compact');
        expect(entries[0].status).toBe('success');
        expect(await manager.getHistory(conversationId)).toHaveLength(5);
    });

    it('executes confirmed summarize as lossy ledgered projection', async () => {
        const { manager, registry, ledgerService, projectionStore, summarizeService } = createRegistry();
        const conversationId = 'ctx-command-summarize';
        await manager.createConversation(conversationId);

        const payload = await registry.execute(registry.parse('/summarize --confirm')!, {
            conversationId,
            configId: 'config-a',
            actor: 'slash_command'
        });

        const projection = await projectionStore.getCurrentProjection(conversationId);
        const entries = await ledgerService.listEntries(conversationId);
        expect(summarizeService.handleSummarizeContext).toHaveBeenCalledWith(expect.objectContaining({ conversationId, configId: 'config-a' }));
        expect(payload.lossy).toBe(true);
        expect(payload.reversible).toBe(false);
        expect(projection?.mode).toBe('summarized');
        expect(projection?.lossy).toBe(true);
        expect(entries[0].operation).toBe('manual_summarize');
        expect(entries[0].status).toBe('success');
    });
});
