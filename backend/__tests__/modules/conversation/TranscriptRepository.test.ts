import { ConversationManager, MemoryStorageAdapter } from '../../../modules/conversation';
import { deleteLogicalMessage } from '../../../modules/conversation/TranscriptMutation';
import { DelegatingTranscriptRepository } from '../../../modules/conversation/TranscriptRepository';
import type { Content } from '../../../modules/conversation/types';
import { subAgentRunEventBus } from '../../../tools/subagents/runEventBus';

function createTextContent(text: string, role: 'user' | 'model' = 'user', index?: number): Content {
    return {
        role,
        parts: [{ text }],
        ...(typeof index === 'number' ? { index } : {})
    } as Content;
}

function createToolCallContent(id: string, index?: number): Content {
    return {
        role: 'model',
        parts: [{ functionCall: { id, name: 'read_file', args: { path: 'README.md' } } }],
        ...(typeof index === 'number' ? { index } : {})
    } as Content;
}

function createFunctionResponseContent(id: string, index?: number): Content {
    return {
        role: 'user',
        parts: [{ functionResponse: { id, name: 'read_file', response: { success: true } } }],
        isFunctionResponse: true,
        ...(typeof index === 'number' ? { index } : {})
    } as Content;
}

describe('TranscriptRepository', () => {
    it('retries history reads when missing-then-create races with an existing conversation', async () => {
        class RacingCreateStorage extends MemoryStorageAdapter {
            private missed = false;

            async loadHistoryWithStatus(conversationId: string) {
                if (conversationId === 'repo-stop-race-main' && !this.missed) {
                    this.missed = true;
                    return { value: null, errorCode: 'not_found' as const };
                }
                return super.loadHistoryWithStatus(conversationId);
            }
        }

        const storage = new RacingCreateStorage();
        const manager = new ConversationManager(storage);
        await storage.saveHistory('repo-stop-race-main', []);

        await expect(manager.getHistory('repo-stop-race-main')).resolves.toEqual([]);
    });

    it('appends content through ConversationManager repository without changing transcript shape', async () => {
        const storage = new MemoryStorageAdapter();
        const manager = new ConversationManager(storage);
        const conversationId = 'repo-append-main';
        const repository = manager.getTranscriptRepository(conversationId);

        const next = await repository.appendContent(createTextContent('hello from repository', 'user'));

        expect(next).toHaveLength(1);
        expect(next[0].parts?.[0]?.text).toBe('hello from repository');
        expect(next[0].role).toBe('user');

        const persisted = await manager.getHistory(conversationId);
        expect(persisted).toHaveLength(1);
        expect(persisted[0].parts?.[0]?.text).toBe('hello from repository');
        expect(typeof persisted[0].timestamp).toBe('number');
    });

    it('returns backend-authored rejected functionResponse content for rejected tool calls', async () => {
        const storage = new MemoryStorageAdapter();
        const manager = new ConversationManager(storage);
        const conversationId = 'repo-reject-tools-main';
        const repository = manager.getTranscriptRepository(conversationId);

        await repository.replaceContents([
            createTextContent('start', 'user', 0),
            createToolCallContent('call-1', 1)
        ]);

        const result = await manager.rejectToolCalls(conversationId, 1, ['call-1']);
        const persisted = await manager.getHistory(conversationId);

        expect(result).toMatchObject({
            modified: true,
            insertedIndex: 2,
            rejectedToolCalls: [{ id: 'call-1', name: 'read_file' }],
            functionResponseContent: {
                role: 'user',
                isFunctionResponse: true,
                parts: [{
                    functionResponse: {
                        id: 'call-1',
                        name: 'read_file',
                        response: {
                            success: false,
                            rejected: true
                        }
                    }
                }]
            }
        });
        expect(persisted[2].parts[0].functionResponse?.id).toBe('call-1');
        expect(persisted[2].parts[0].functionResponse?.response).toMatchObject({
            success: false,
            rejected: true
        });
    });

    it('replaces an empty transcript and keeps long transcripts readable through the same repository', async () => {
        const storage = new MemoryStorageAdapter();
        const manager = new ConversationManager(storage);
        const conversationId = 'repo-replace-main';
        const repository = manager.getTranscriptRepository(conversationId);
        const longTranscript = Array.from({ length: 256 }, (_, index) =>
            createTextContent(`line-${index}`, index % 2 === 0 ? 'user' : 'model', index)
        );

        const empty = await repository.getContents();
        expect(empty).toEqual([]);

        const replaced = await repository.replaceContents(longTranscript);

        expect(replaced).toHaveLength(256);
        expect(replaced[0].parts?.[0]?.text).toBe('line-0');
        expect(replaced[255].parts?.[0]?.text).toBe('line-255');

        const persisted = await manager.getHistory(conversationId);
        expect(persisted).toHaveLength(256);
        expect(persisted[255].parts?.[0]?.text).toBe('line-255');
    });

    it('mutates ConversationManager transcript via TranscriptMutation while preserving paired deletion semantics', async () => {
        const storage = new MemoryStorageAdapter();
        const manager = new ConversationManager(storage);
        const conversationId = 'repo-mutate-main';
        const repository = manager.getTranscriptRepository(conversationId);

        await repository.replaceContents([
            createTextContent('start', 'user', 0),
            createToolCallContent('call-1', 1),
            createFunctionResponseContent('call-1', 2),
            createTextContent('done', 'model', 3)
        ]);

        const next = await repository.mutateContents(contents => deleteLogicalMessage(contents, 1));

        expect(next).toHaveLength(2);
        expect(next.map(item => item.parts?.[0]?.text || item.parts?.[0]?.functionResponse?.id)).toEqual(['start', 'done']);
        expect(next.map(item => item.index)).toEqual([0, 1]);
    });

    it('appends, replaces and mutates SubAgent transcripts through the shared repository interface', async () => {
        const runId = 'repo-subagent-basic';
        subAgentRunEventBus.createRun(runId, 'wp22-agent', {
            task: 'basic-repository-check'
        });
        const repository = subAgentRunEventBus.getTranscriptRepository(runId);

        const appended = await repository.appendContent(createTextContent('subagent-start', 'user'));
        expect(appended).toHaveLength(1);
        expect(appended[0].index).toBe(0);
        expect(appended[0].parts?.[0]?.text).toBe('subagent-start');

        const replaced = await repository.replaceContents([
            createTextContent('first', 'user', 99),
            createTextContent('second', 'model', 100)
        ]);
        expect(replaced).toHaveLength(2);
        expect(replaced.map(item => item.index)).toEqual([0, 1]);
        expect(replaced[1].parts?.[0]?.text).toBe('second');

        const mutated = await repository.mutateContents(contents => {
            contents.push(createTextContent('tail', 'user'));
            return contents;
        });
        expect(mutated).toHaveLength(3);
        expect(mutated.map(item => item.index)).toEqual([0, 1, 2]);
        expect(mutated[2].parts?.[0]?.text).toBe('tail');

        const snapshot = subAgentRunEventBus.getSnapshot(runId);
        expect(snapshot?.contents).toHaveLength(3);
        expect(snapshot?.contents.map(item => item.index)).toEqual([0, 1, 2]);
    });

    it('handles long SubAgent transcripts and paired deletion through mutate on the same repository contract', async () => {
        const runId = 'repo-subagent-mutate';
        subAgentRunEventBus.createRun(runId, 'wp22-agent', {
            task: 'paired-delete-check'
        }, {
            initialContents: Array.from({ length: 64 }, (_, index) =>
                createTextContent(`seed-${index}`, index % 2 === 0 ? 'user' : 'model', index)
            )
        });
        const repository = subAgentRunEventBus.getTranscriptRepository(runId);

        await repository.replaceContents([
            createTextContent('prefix', 'user', 0),
            createToolCallContent('call-sub-1', 1),
            createFunctionResponseContent('call-sub-1', 2),
            ...Array.from({ length: 40 }, (_, index) => createTextContent(`tail-${index}`, index % 2 === 0 ? 'model' : 'user', index + 3))
        ]);

        const next = await repository.mutateContents(contents => deleteLogicalMessage(contents, 1));

        expect(next).toHaveLength(41);
        expect(next[0].parts?.[0]?.text).toBe('prefix');
        expect(next[1].parts?.[0]?.text).toBe('tail-0');
        expect(next[40].parts?.[0]?.text).toBe('tail-39');
        expect(next.map(item => item.index)).toEqual(Array.from({ length: 41 }, (_, index) => index));
    });

    it('returns cloned contents so callers cannot create new write paths by mutating snapshots in place', async () => {
        const backingStore: Content[] = [createTextContent('immutable-source', 'user', 0)];
        const repository = new DelegatingTranscriptRepository({
            loadContents: async () => backingStore,
            saveContents: async contents => {
                backingStore.splice(0, backingStore.length, ...contents);
            }
        });

        const firstRead = await repository.getContents();
        firstRead[0].parts = [{ text: 'mutated-outside' }];

        const secondRead = await repository.getContents();
        expect(secondRead[0].parts?.[0]?.text).toBe('immutable-source');
    });
});
