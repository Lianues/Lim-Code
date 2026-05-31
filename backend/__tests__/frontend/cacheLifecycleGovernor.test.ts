import { createChatState } from '../../../frontend/src/stores/chat/state';
import {
  CacheLifecycleGovernor,
  frontendCacheLifecycleGovernor
} from '../../../frontend/src/utils/cacheLifecycleGovernor';
import { trimWindowFromTop } from '../../../frontend/src/stores/chat/windowUtils';
import type { Message, StreamChunk } from '../../../frontend/src/types';

function createChunk(index: number): StreamChunk {
  return {
    type: 'chunk',
    conversationId: 'conversation-1',
    streamId: 'stream-1',
    runtimeLedger: {
      status: 'ok',
      ledger: {
        liveDelta: {
          type: 'chunk',
          messageId: 'message-1',
          contentId: 'content-1',
          payload: {
            delta: [{ text: `chunk-${index}` }],
            done: false
          }
        }
      }
    }
  };
}

function createMessage(id: string, role: Message['role'], backendIndex: number, toolId?: string): Message {
  return {
    id,
    role,
    content: id,
    timestamp: backendIndex,
    backendIndex,
    tools: toolId
      ? [{ id: toolId, name: 'tool', args: {}, status: 'success' }]
      : undefined
  };
}

describe('cache lifecycle governor', () => {
  afterEach(() => {
    frontendCacheLifecycleGovernor.clearForTests();
  });

  it('registers caches, reports diagnostics, and prunes over-budget entries', () => {
    const governor = new CacheLifecycleGovernor();
    const cache = new Map<string, unknown>([
      ['a', { value: 1 }],
      ['b', { value: 2 }],
      ['c', { value: 3 }]
    ]);

    governor.register({
      id: 'test.cache',
      owner: 'test',
      scope: 'unit',
      maxEntries: 2,
      getEntryCount: () => cache.size,
      estimateBytes: () => cache.size,
      prune: context => {
        let removed = 0;
        while (cache.size > (context.maxEntries ?? 0)) {
          const next = cache.keys().next();
          if (next.done) break;
          cache.delete(next.value);
          removed += 1;
        }
        return removed;
      }
    });

    expect(governor.getDiagnostics()).toEqual([
      expect.objectContaining({
        id: 'test.cache',
        owner: 'test',
        scope: 'unit',
        entries: 3,
        maxEntries: 2
      })
    ]);

    expect(governor.enforceBudgets('unit-test')).toBe(1);
    expect(Array.from(cache.keys())).toEqual(['b', 'c']);
    expect(governor.getDiagnostics()[0]).toEqual(expect.objectContaining({
      entries: 2,
      lastPruneReason: 'unit-test',
      lastPrunedEntries: 1
    }));
  });

  it('registers chat retained maps and prunes background stream buffers', () => {
    frontendCacheLifecycleGovernor.clearForTests();
    const state = createChatState();
    state.backgroundStreamBuffers.value.set(
      'conversation-1',
      Array.from({ length: 205 }, (_, index) => createChunk(index))
    );

    const diagnostics = frontendCacheLifecycleGovernor.getDiagnostics();
    expect(diagnostics.map(item => item.id)).toEqual(expect.arrayContaining([
      'chat.sessionSnapshots',
      'chat.backgroundStreamBuffers',
      'chat.toolResponseCache'
    ]));

    expect(frontendCacheLifecycleGovernor.prune('unit-test', ['chat.backgroundStreamBuffers'])).toBe(5);
    expect(state.backgroundStreamBuffers.value.get('conversation-1')).toHaveLength(200);
  });

  it('prunes toolResponseCache entries that fall outside the retained message window', () => {
    const messages = [
      createMessage('old-user', 'user', 0),
      createMessage('old-assistant', 'assistant', 1, 'old-call'),
      createMessage('new-user', 'user', 2),
      createMessage('new-assistant', 'assistant', 3, 'new-call')
    ];
    const state = {
      allMessages: { value: messages },
      messageIndexById: { value: new Map(messages.map((message, index) => [message.id, index])) },
      windowStartIndex: { value: 0 },
      totalMessages: { value: messages.length },
      checkpoints: { value: [] },
      historyFolded: { value: false },
      foldedMessageCount: { value: 0 },
      toolResponseCache: {
        value: new Map<string, Record<string, unknown>>([
          ['old-call', { old: true }],
          ['new-call', { new: true }]
        ])
      }
    } as any;

    expect(trimWindowFromTop(state, 2)).toBe(2);
    expect(state.toolResponseCache.value.has('old-call')).toBe(false);
    expect(state.toolResponseCache.value.get('new-call')).toEqual({ new: true });
  });
});

