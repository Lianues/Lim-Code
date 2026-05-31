import { StreamAbortManager } from '../../../webview/stream/StreamAbortManager';
import { StreamRequestHandler } from '../../../webview/stream/StreamRequestHandler';
import { chatStreamRuntimeLedgerBridge } from '../../../webview/stream/runtimeLedgerBridge';

function createThenable<T>(value: T): Thenable<T> {
  return {
    then: (onfulfilled?: ((value: T) => any) | null) => {
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value) as any;
    }
  };
}

async function* singleChunkStream() {
  yield { content: { role: 'model', parts: [{ text: 'done' }] } };
}

describe('StreamRequestHandler Runtime Ledger stream identity', () => {
  beforeEach(() => {
    chatStreamRuntimeLedgerBridge.resetForTests();
  });

  afterEach(() => {
    chatStreamRuntimeLedgerBridge.resetForTests();
  });

  it('uses an extension-generated stream id instead of the client supplied stream id', async () => {
    const postedMessages: any[] = [];
    const responses: any[] = [];
    const handler = new StreamRequestHandler({
      chatHandler: {
        handleChatStream: jest.fn(() => singleChunkStream())
      } as any,
      abortManager: new StreamAbortManager(),
      conversationManager: {
        rejectAllPendingToolCalls: jest.fn()
      } as any,
      getView: () => ({
        webview: {
          postMessage: jest.fn((message: any) => {
            postedMessages.push(message);
            return createThenable(true);
          })
        }
      }) as any,
      sendResponse: (requestId: string, data: any) => responses.push({ requestId, data }),
      sendError: jest.fn()
    });

    await handler.handleChatStream({
      conversationId: 'conversation-1',
      message: 'hello',
      streamId: 'client-stream-id'
    }, 'request-1');

    expect(responses[0]).toMatchObject({
      requestId: 'request-1',
      data: {
        started: true
      }
    });
    expect(responses[0].data.streamId).toMatch(/^server-stream-/);
    expect(responses[0].data.streamId).not.toBe('client-stream-id');
    expect(postedMessages[0].data.streamId).toBe(responses[0].data.streamId);
    expect(postedMessages[0].data.runtimeLedger.identity.runId).toBe(`run:stream:${responses[0].data.streamId}`);
  });
});
