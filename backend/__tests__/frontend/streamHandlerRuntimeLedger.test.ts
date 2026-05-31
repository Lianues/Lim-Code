import { handleStreamChunk, handleStreamChunkBatch } from '../../../frontend/src/stores/chat/streamHandler';
import type { Message, StreamChunk } from '../../../frontend/src/types';

function createAssistant(): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    streaming: true,
    localOnly: true,
    tools: [
      { id: 'call-ok', name: 'read_file', args: {}, status: 'queued' },
      { id: 'call-missing', name: 'write_file', args: {}, status: 'queued' }
    ],
    parts: []
  };
}

function createState() {
  const assistant = createAssistant();
  return {
    allMessages: { value: [assistant] },
    messageIndexById: { value: new Map([[assistant.id, 0]]) },
    currentConversationId: { value: 'conversation-1' },
    streamingMessageId: { value: assistant.id },
    activeStreamId: { value: 'stream-1' },
    isStreaming: { value: true },
    isWaitingForResponse: { value: true },
    autoSummaryStatus: { value: null },
    pendingModelOverride: { value: null },
    _lastApprovalGatedStreamId: { value: null },
    _lastCancelledStreamId: { value: null },
    error: { value: null },
    openTabs: { value: [{ id: 'tab-1', conversationId: 'conversation-1', isStreaming: true }] },
    sessionSnapshots: { value: new Map() },
    backgroundStreamBuffers: { value: new Map() },
    windowStartIndex: { value: 0 },
    totalMessages: { value: 1 },
    checkpoints: { value: [] },
    historyFolded: { value: false },
    foldedMessageCount: { value: 0 },
    isLoadingMoreMessages: { value: false },
    toolResponseCache: { value: new Map() },
    activeBuild: { value: null }
  } as any;
}

function createContext(state = createState()) {
  return {
    state,
    currentModelName: () => 'model-under-test',
    addCheckpoint: jest.fn(),
    updateConversationAfterMessage: jest.fn().mockResolvedValue(undefined),
    processQueue: jest.fn().mockResolvedValue(undefined)
  };
}

describe('streamHandler Runtime Ledger fail-closed behavior', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('fails closed when a core stream event carries a degraded Runtime Ledger projection', () => {
    const state = createState();
    const ctx = createContext(state);

    handleStreamChunk({
      type: 'complete',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      runtimeLedger: {
        status: 'degraded',
        ledger: {
          terminalState: { type: 'complete', messageId: 'msg', contentId: 'cnt', source: 'runtime-ledger' }
        }
      }
    } as StreamChunk, ctx as any);

    expect(state.error.value).toEqual({
      code: 'RUNTIME_LEDGER_PROJECTION_ERROR',
      message: 'Runtime Ledger projection missing or degraded for stream event: complete'
    });
    expect(state.streamingMessageId.value).toBeNull();
    expect(state.activeStreamId.value).toBeNull();
    expect(state.isStreaming.value).toBe(false);
    expect(state.isWaitingForResponse.value).toBe(false);
  });

  it('fails closed for mixed toolStatus batches when any chunk lacks a usable Runtime Ledger projection', () => {
    const state = createState();
    const ctx = createContext(state);
    const okChunk = {
      type: 'toolStatus',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolStatus: true,
      tool: { id: 'call-ok', name: 'read_file', status: 'queued' },
      runtimeLedger: {
        status: 'ok',
        ledger: {
          toolStatesByInvocationId: { 'tool:chat:call-ok': 'executing' },
          toolSnapshotsByInvocationId: {
            'tool:chat:call-ok': {
              id: 'call-ok',
              name: 'read_file',
              status: 'executing',
              args: { path: 'README.md' }
            }
          }
        }
      }
    } as StreamChunk;
    const missingProjection = {
      type: 'toolStatus',
      conversationId: 'conversation-1',
      streamId: 'stream-1',
      toolStatus: true,
      tool: { id: 'call-missing', name: 'write_file', status: 'success' }
    } as StreamChunk;

    handleStreamChunkBatch([okChunk, missingProjection], ctx as any);

    expect(state.allMessages.value[0].tools?.[0]).toMatchObject({
      id: 'call-ok',
      status: 'executing',
      args: { path: 'README.md' }
    });
    expect(state.allMessages.value[0].tools?.[1]).toMatchObject({
      id: 'call-missing',
      status: 'queued'
    });
    expect(state.error.value).toEqual({
      code: 'RUNTIME_LEDGER_PROJECTION_ERROR',
      message: 'Runtime Ledger projection missing or degraded for stream event: toolStatus'
    });
  });
});
