import { deleteMessage, retryFromMessage } from '../../../frontend/src/stores/chat/messageActions';
import { restoreCheckpoint } from '../../../frontend/src/stores/chat/checkpointActions';
import { sendToExtension } from '../../../frontend/src/utils/vscode';

jest.mock('../../../frontend/src/utils/vscode', () => ({
  sendToExtension: jest.fn()
}));

function createMessage(id: string, role: 'user' | 'assistant', content: string, backendIndex: number) {
  return {
    id,
    role,
    content,
    timestamp: backendIndex + 1,
    backendIndex,
    parts: [{ text: content }]
  };
}

function createState() {
  const messages = [
    createMessage('user-1', 'user', 'prompt', 0),
    createMessage('assistant-1', 'assistant', 'answer', 1)
  ];
  return {
    allMessages: { value: messages },
    messageIndexById: { value: new Map(messages.map((message, index) => [message.id, index])) },
    currentConversationId: { value: 'conversation-1' },
    streamingMessageId: { value: null },
    activeStreamId: { value: null },
    isStreaming: { value: false },
    isWaitingForResponse: { value: false },
    isLoading: { value: false },
    error: { value: null },
    windowStartIndex: { value: 0 },
    totalMessages: { value: 2 },
    checkpoints: { value: [{ id: 'cp-1', conversationId: 'conversation-1', messageIndex: 1, timestamp: 1 }] },
    activeBuild: { value: { id: 'build-1' } },
    isLoadingMoreMessages: { value: false },
    historyFolded: { value: false },
    foldedMessageCount: { value: 0 },
    toolResponseCache: { value: new Map() },
    openTabs: { value: [] },
    sessionSnapshots: { value: new Map() }
  } as any;
}

describe('chat mutation actions Runtime Ledger fail-closed behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not locally truncate deleteMessage when backend omits Runtime Ledger mutation projection', async () => {
    const state = createState();
    (sendToExtension as jest.Mock).mockResolvedValue({ success: true });

    await deleteMessage(state, 1, jest.fn());

    expect(sendToExtension).toHaveBeenCalledWith('deleteMessage', {
      conversationId: 'conversation-1',
      targetIndex: 1
    });
    expect(state.allMessages.value.map((message: any) => message.id)).toEqual(['user-1', 'assistant-1']);
    expect(state.error.value).toEqual({
      code: 'RUNTIME_LEDGER_PROJECTION_ERROR',
      message: 'Runtime Ledger mutation projection missing for delete_range'
    });
  });

  it('does not locally start retryFromMessage when delete mutation projection is missing', async () => {
    const state = createState();
    (sendToExtension as jest.Mock).mockResolvedValue({ success: true });

    await retryFromMessage(
      state,
      { currentModelName: { value: 'model-under-test' } } as any,
      1,
      jest.fn()
    );

    expect(state.allMessages.value.map((message: any) => message.id)).toEqual(['user-1', 'assistant-1']);
    expect(state.streamingMessageId.value).toBeNull();
    expect(state.isStreaming.value).toBe(false);
    expect(state.error.value).toEqual({
      code: 'RUNTIME_LEDGER_PROJECTION_ERROR',
      message: 'Runtime Ledger mutation projection missing for retry delete_range'
    });
  });

  it('reports checkpoint restore failure when backend omits Runtime Ledger mutation projection', async () => {
    const state = createState();
    (sendToExtension as jest.Mock).mockResolvedValue({ success: true, restored: 2 });

    const result = await restoreCheckpoint(state, 'checkpoint-1');

    expect(sendToExtension).toHaveBeenCalledWith('checkpoint.restore', {
      conversationId: 'conversation-1',
      checkpointId: 'checkpoint-1'
    });
    expect(result).toEqual({
      success: false,
      restored: 2,
      error: 'Runtime Ledger mutation projection missing for checkpoint restore'
    });
    expect(state.allMessages.value.map((message: any) => message.id)).toEqual(['user-1', 'assistant-1']);
    expect(state.error.value).toEqual({
      code: 'RUNTIME_LEDGER_PROJECTION_ERROR',
      message: 'Runtime Ledger mutation projection missing for checkpoint restore'
    });
  });
});
