import { cancelStream } from '../../../frontend/src/stores/chat/toolActions';
import { sendToExtension } from '../../../frontend/src/utils/vscode';

jest.mock('../../../frontend/src/utils/vscode', () => ({
  sendToExtension: jest.fn()
}));

function createState() {
  const assistant = {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    streaming: true,
    localOnly: true,
    parts: [],
    tools: [{ id: 'call-1', name: 'read_file', args: {}, status: 'executing' }]
  };

  return {
    allMessages: { value: [assistant] },
    messageIndexById: { value: new Map([[assistant.id, 0]]) },
    currentConversationId: { value: 'conversation-1' },
    streamingMessageId: { value: assistant.id },
    activeStreamId: { value: 'stream-1' },
    isStreaming: { value: true },
    isWaitingForResponse: { value: true },
    isLoading: { value: true },
    retryStatus: { value: null },
    _lastCancelledStreamId: { value: null },
    error: { value: null },
    windowStartIndex: { value: 0 },
    totalMessages: { value: 1 },
    isLoadingMoreMessages: { value: true },
    historyFolded: { value: true },
    foldedMessageCount: { value: 2 },
    checkpoints: { value: [] },
    activeBuild: { value: { id: 'build-1' } },
    toolResponseCache: { value: new Map() }
  } as any;
}

describe('toolActions cancel Runtime Ledger projection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replaces local cancel guesses with the backend Runtime Ledger mutation window', async () => {
    const state = createState();
    (sendToExtension as jest.Mock).mockResolvedValue({
      cancelled: true,
      runtimeLedger: {
        status: 'ok',
        ledger: {
          mutation: {
            type: 'cancel_stream',
            conversationId: 'conv:chat:conversation-1',
            runId: 'run:mutation:cancel_stream:1',
            messageWindow: {
              total: 2,
              startIndex: 0,
              messages: [
                { role: 'user', parts: [{ text: 'prompt' }], timestamp: 1, index: 0 },
                {
                  role: 'user',
                  isFunctionResponse: true,
                  timestamp: 2,
                  index: 1,
                  parts: [{
                    functionResponse: {
                      id: 'call-1',
                      name: 'read_file',
                      response: { success: false, rejected: true, error: 'Cancelled by user' }
                    }
                  }]
                }
              ]
            },
            checkpoints: [],
            activeBuild: null
          }
        }
      }
    });

    await cancelStream(state, {} as any);

    expect(sendToExtension).toHaveBeenCalledWith('cancelStream', { conversationId: 'conversation-1' });
    expect(state.allMessages.value).toHaveLength(2);
    expect(state.allMessages.value[0]).toMatchObject({ role: 'user', content: 'prompt', backendIndex: 0 });
    expect(state.allMessages.value[1]).toMatchObject({ isFunctionResponse: true, backendIndex: 1 });
    expect(state.totalMessages.value).toBe(2);
    expect(state.activeBuild.value).toBeNull();
    expect(state.toolResponseCache.value.get('call-1')).toEqual({
      success: false,
      rejected: true,
      error: 'Cancelled by user'
    });
    expect(state.streamingMessageId.value).toBeNull();
    expect(state.activeStreamId.value).toBeNull();
    expect(state.isStreaming.value).toBe(false);
    expect(state.isWaitingForResponse.value).toBe(false);
  });

  it('fails closed when cancelStream does not return a usable Runtime Ledger projection', async () => {
    const state = createState();
    const originalMessage = state.allMessages.value[0];
    (sendToExtension as jest.Mock).mockResolvedValue({ cancelled: true });

    await cancelStream(state, {} as any);

    expect(state.error.value).toEqual({
      code: 'RUNTIME_LEDGER_PROJECTION_ERROR',
      message: 'Runtime Ledger mutation projection missing for cancelled stream'
    });
    expect(state.allMessages.value).toEqual([originalMessage]);
    expect(state.allMessages.value[0].streaming).toBe(true);
    expect(state.streamingMessageId.value).toBeNull();
    expect(state.isStreaming.value).toBe(false);
    expect(state.isWaitingForResponse.value).toBe(false);
  });
});
