import { deleteMessage, deleteSingleMessage } from '../../../webview/handlers/ChatHandlers';
import { chatStreamRuntimeLedgerBridge } from '../../../webview/stream/runtimeLedgerBridge';

function createContext(overrides: Record<string, any> = {}) {
  return {
    streamAbortControllers: {
      cancel: jest.fn()
    },
    chatHandler: {
      handleDeleteToMessage: jest.fn().mockResolvedValue({ success: true, deletedCount: 2 }),
      refreshDerivedMetadataAfterHistoryMutation: jest.fn().mockResolvedValue(undefined)
    },
    conversationManager: {
      deleteMessage: jest.fn().mockResolvedValue(undefined),
      getMessagesPaged: jest.fn().mockResolvedValue({
        total: 1,
        messages: [{ role: 'user', parts: [{ text: 'remaining' }], timestamp: 1, index: 0 }]
      }),
      getMetadata: jest.fn().mockResolvedValue({ custom: { activeBuild: null } })
    },
    checkpointManager: {
      getCheckpoints: jest.fn().mockResolvedValue([
        { id: 'cp-1', conversationId: 'conversation-1', messageIndex: 0, timestamp: 2 }
      ])
    },
    sendResponse: jest.fn(),
    sendError: jest.fn(),
    ...overrides
  } as any;
}

describe('ChatHandlers Runtime Ledger mutation projections', () => {
  beforeEach(() => {
    chatStreamRuntimeLedgerBridge.resetForTests();
  });

  afterEach(() => {
    chatStreamRuntimeLedgerBridge.resetForTests();
  });

  it('returns a Runtime Ledger transcript mutation projection for deleteMessage', async () => {
    const ctx = createContext();

    await deleteMessage({ conversationId: 'conversation-1', targetIndex: 3 }, 'req-1', ctx);

    expect(ctx.chatHandler.handleDeleteToMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      targetIndex: 3
    });
    expect(ctx.sendResponse).toHaveBeenCalledWith('req-1', expect.objectContaining({
      success: true,
      deletedCount: 2,
      runtimeLedger: expect.objectContaining({
        status: 'ok',
        ledger: {
          mutation: expect.objectContaining({
            type: 'delete_range',
            targetIndex: 3,
            deletedCount: 2,
            messageWindow: {
              total: 1,
              startIndex: 0,
              messages: [{ role: 'user', parts: [{ text: 'remaining' }], timestamp: 1, index: 0 }]
            },
            checkpoints: [{ id: 'cp-1', conversationId: 'conversation-1', messageIndex: 0, timestamp: 2 }],
            activeBuild: null
          })
        }
      })
    }));
  });

  it('returns a Runtime Ledger transcript mutation projection for deleteSingleMessage', async () => {
    const ctx = createContext();

    await deleteSingleMessage({ conversationId: 'conversation-1', targetIndex: 4 }, 'req-2', ctx);

    expect(ctx.conversationManager.deleteMessage).toHaveBeenCalledWith('conversation-1', 4);
    expect(ctx.chatHandler.refreshDerivedMetadataAfterHistoryMutation).toHaveBeenCalledWith('conversation-1');
    expect(ctx.sendResponse).toHaveBeenCalledWith('req-2', expect.objectContaining({
      success: true,
      runtimeLedger: expect.objectContaining({
        status: 'ok',
        ledger: {
          mutation: expect.objectContaining({
            type: 'delete_single',
            targetIndex: 4,
            deletedCount: 1
          })
        }
      })
    }));
  });
});
