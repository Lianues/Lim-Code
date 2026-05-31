import { StreamChunkProcessor } from '../../../webview/stream/StreamChunkProcessor';
import { chatStreamRuntimeLedgerBridge } from '../../../webview/stream/runtimeLedgerBridge';

function createThenable<T>(value: T): Thenable<T> {
  return {
    then: (onfulfilled?: ((value: T) => any) | null, _onrejected?: ((reason: any) => any) | null) => {
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value) as any;
    }
  };
}

function createProcessor() {
  const messages: any[] = [];
  const view = {
    webview: {
      postMessage: jest.fn((message: any) => {
        messages.push(message);
        return createThenable(true);
      })
    }
  };

  return {
    messages,
    postMessage: view.webview.postMessage,
    processor: new StreamChunkProcessor(view as any, 'conversation-1', 'stream-1')
  };
}

function flushRuntimeLedger(): Promise<void> {
  return Array.from({ length: 20 }).reduce<Promise<void>>(
    promise => promise.then(() => Promise.resolve()),
    Promise.resolve()
  );
}

describe('StreamChunkProcessor throttling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps high-frequency chunk messages buffered until the throttle window expires', async () => {
    const { processor, messages, postMessage } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'A' }] } });
    processor.processChunk({ chunk: { delta: [{ text: 'B' }] } });
    await flushRuntimeLedger();

    // 修改原因：此前 enqueue 内部的 setTimeout(0) 会抢先 flush，使 CHUNK_THROTTLE_MS 形同虚设。
    // 修改方式：测试在 50ms 节流窗口结束前没有任何 postMessage，窗口结束后一次性发送 batch。
    // 修改目的：锁定 trace 中 webview.postMessage 反序列化长任务的核心回归防线。
    expect(postMessage).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);

    jest.advanceTimersByTime(49);
    expect(postMessage).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'streamChunkBatch',
      data: [
        { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' },
        { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' }
      ]
    });
  });

  it('still flushes terminal events immediately after any buffered chunks', async () => {
    const { processor, messages } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'A' }] } });
    processor.processChunk({ content: { role: 'model', parts: [{ text: 'final' }] } });
    await flushRuntimeLedger();

    // 修改原因：关闭 chunk 的 0ms 兜底后，complete 等终结事件仍必须立即把已有内容一起送到前端。
    // 修改方式：complete 分支继续调用 flush，因此 pending chunk 与 complete 会合并为同一个 batch。
    // 修改目的：降低消息频率的同时，保持前端完成态不延迟、不丢内容。
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'streamChunkBatch',
      data: [
        { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' },
        { type: 'complete', conversationId: 'conversation-1', streamId: 'stream-1' }
      ]
    });
  });
});

describe('StreamChunkProcessor Runtime Ledger observer', () => {
  beforeEach(() => {
    chatStreamRuntimeLedgerBridge.resetForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    chatStreamRuntimeLedgerBridge.resetForTests();
  });

  it('records stream events as redacted Runtime Ledger summaries and attaches canonical transport projections', async () => {
    const { processor, messages } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'secret stream text' }] } });
    processor.processChunk({
      toolStatus: true,
      tool: { id: 'tool-call-1', name: 'read_file', status: 'executing', args: { path: 'secret.txt' } }
    });

    await flushRuntimeLedger();

    const events = await chatStreamRuntimeLedgerBridge.getEvents();
    expect(events.map(event => event.eventType)).toEqual([
      'runtime.chat.stream_event',
      'runtime.chat.stream_event',
      'runtime.tool.lifecycle'
    ]);
    expect(events[0]).toMatchObject({
      context: 'chat',
      subject: 'stream',
      persistence: 'ephemeral',
      conversationId: 'conv:chat:conversation-1',
      runId: 'run:stream:stream-1',
      messageId: 'msg:stream:stream-1',
      contentId: 'cnt:stream:stream-1',
      payload: {
        sourceType: 'chunk',
        hasChunk: true,
        hasContent: false
      },
      payloadSummary: {
        redacted: true
      }
    });
    expect(events[1]).toMatchObject({
      messageId: 'msg:stream:stream-1',
      toolInvocationId: 'tool:chat:tool-call-1',
      payload: {
        sourceType: 'toolStatus',
        hasTool: true
      }
    });
    expect(events[2]).toMatchObject({
      eventType: 'runtime.tool.lifecycle',
      context: 'tool',
      subject: 'toolInvocation',
      persistence: 'durable',
      toolInvocationId: 'tool:chat:tool-call-1',
      payload: {
        sourceType: 'toolStatus',
        phase: 'executing',
        toolName: 'read_file',
        hasArgs: true
      }
    });
    expect(JSON.stringify(events)).not.toContain('secret stream text');
    expect(JSON.stringify(events)).not.toContain('secret.txt');

    // 修改原因：Runtime Ledger projection 是前端 reducer 的权威输入，transport 必须携带后端 identity/projection。
    // 修改方式：断言 runtimeLedger 带 canonical identity/projection，并保留渲染所需的轻量 transport envelope。
    // 修改目的：锁定主聊天不再依赖 UI 侧猜测工具或内容归属。
    expect(messages.map(message => message.type)).toEqual(['streamChunk', 'streamChunk']);
    expect(messages[0].data).toMatchObject({
      type: 'chunk',
      runtime: {
        conversationId: 'conv:chat:conversation-1',
        runId: 'run:stream:stream-1',
        messageId: 'msg:stream:stream-1',
        contentId: 'cnt:stream:stream-1'
      },
      runtimeLedger: {
        status: 'ok',
        identity: {
          messageId: 'msg:stream:stream-1',
          contentId: 'cnt:stream:stream-1'
        },
        ledger: {
          liveDelta: {
            type: 'chunk',
            messageId: 'msg:stream:stream-1',
            contentId: 'cnt:stream:stream-1',
            source: 'runtime-ledger',
            payload: { delta: [{ text: 'secret stream text' }] }
          }
        }
      },
      chunk: { delta: [{ text: 'secret stream text' }] }
    });
    expect(messages[1].data).toMatchObject({
      type: 'toolStatus',
      runtime: {
        messageId: 'msg:stream:stream-1'
      },
      runtimeLedger: {
        status: 'ok',
        ledger: {
          toolStatesByInvocationId: {
            'tool:chat:tool-call-1': 'executing'
          },
          toolSnapshotsByInvocationId: {
            'tool:chat:tool-call-1': {
              id: 'tool-call-1',
              status: 'executing',
              args: { path: 'secret.txt' }
            }
          }
        }
      },
      toolStatus: true,
      tool: { id: 'tool-call-1' }
    });
  });

  it('uses final functionResponse events as tool state authority over earlier lifecycle status', async () => {
    const { processor } = createProcessor();

    processor.processChunk({
      toolStatus: true,
      tool: {
        id: 'tool-call-final',
        name: 'read_file',
        status: 'success',
        args: { path: 'secret-final.txt' },
        result: { success: true }
      }
    });
    processor.processChunk({
      toolIteration: true,
      content: {
        role: 'model',
        parts: [{ functionCall: { id: 'tool-call-final', name: 'read_file', args: { path: 'secret-final.txt' } } }]
      },
      toolResults: [{
        id: 'tool-call-final',
        name: 'read_file',
        args: { path: 'secret-final.txt' },
        result: { success: false, error: 'boom' }
      }]
    });

    await flushRuntimeLedger();

    const snapshot = await chatStreamRuntimeLedgerBridge.getPartialSnapshotForStream('conversation-1', 'stream-1');

    expect(snapshot.projection.eventCountsByType).toMatchObject({
      'runtime.chat.stream_event': 2,
      'runtime.tool.lifecycle': 1,
      'runtime.tool.function_response': 1
    });
    expect(snapshot.projection.toolStatesByInvocationId['tool:chat:tool-call-final']).toBe('error');
    expect(JSON.stringify(snapshot)).not.toContain('secret-final.txt');
  });

  it('records awaitingConfirmation toolResults as functionResponse authority and diagnoses missing ids', async () => {
    const { processor } = createProcessor();

    processor.processChunk({
      awaitingConfirmation: true,
      content: {
        role: 'model',
        parts: [{ functionCall: { id: 'tool-call-confirm', name: 'read_file', args: { path: 'secret-confirm.txt' } } }]
      },
      pendingToolCalls: [],
      toolResults: [
        {
          id: 'tool-call-confirm',
          name: 'read_file',
          args: { path: 'secret-confirm.txt' },
          result: { success: true }
        },
        {
          name: 'read_file',
          args: { path: 'missing-id.txt' },
          result: { success: true, data: 'missing id result should stay redacted' }
        }
      ]
    });

    await flushRuntimeLedger();

    const events = await chatStreamRuntimeLedgerBridge.getEvents();
    const snapshot = await chatStreamRuntimeLedgerBridge.getPartialSnapshotForStream('conversation-1', 'stream-1');

    expect(snapshot.projection.eventCountsByType).toMatchObject({
      'runtime.chat.stream_event': 1,
      'runtime.tool.function_response': 1,
      'runtime.tool.function_response_unbound': 1
    });
    expect(snapshot.projection.toolStatesByInvocationId['tool:chat:tool-call-confirm']).toBe('success');
    expect(events.find(event => event.eventType === 'runtime.tool.function_response_unbound')).toMatchObject({
      kind: 'diagnostic',
      context: 'diagnostic',
      subject: 'functionResponse',
      toolInvocationId: undefined,
      payload: {
        sourceType: 'awaitingConfirmation',
        reason: 'missing_function_response_id',
        toolName: 'read_file'
      }
    });
    expect(JSON.stringify(events)).not.toContain('secret-confirm.txt');
    expect(JSON.stringify(events)).not.toContain('missing-id.txt');
    expect(JSON.stringify(events)).not.toContain('missing id result should stay redacted');
  });

  it('diagnoses duplicate, unmatched, and ambiguous functionResponse ids instead of treating them as authority', async () => {
    const { processor, messages } = createProcessor();

    processor.processChunk({
      awaitingConfirmation: true,
      content: {
        role: 'model',
        parts: [
          { functionCall: { id: 'call-duplicate', name: 'read_file', args: {} } },
          { functionCall: { id: 'call-ambiguous', name: 'read_file', args: {} } },
          { functionCall: { id: 'call-ambiguous', name: 'read_file', args: {} } }
        ]
      },
      pendingToolCalls: [],
      toolResults: [
        { id: 'call-duplicate', name: 'read_file', result: { success: true } },
        { id: 'call-duplicate', name: 'read_file', result: { success: true } },
        { id: 'call-unmatched', name: 'read_file', result: { success: true } },
        { id: 'call-ambiguous', name: 'read_file', result: { success: true } }
      ]
    });

    await flushRuntimeLedger();

    const events = await chatStreamRuntimeLedgerBridge.getEvents();
    const snapshot = await chatStreamRuntimeLedgerBridge.getPartialSnapshotForStream('conversation-1', 'stream-1');
    const unboundReasons = events
      .filter(event => event.eventType === 'runtime.tool.function_response_unbound')
      .map(event => (event.payload as any).reason);

    expect(snapshot.projection.eventCountsByType).toMatchObject({
      'runtime.chat.stream_event': 1,
      'runtime.tool.function_response_unbound': 4
    });
    expect(snapshot.projection.eventCountsByType['runtime.tool.function_response']).toBeUndefined();
    expect(snapshot.projection.toolStatesByInvocationId).toEqual({});
    expect(unboundReasons).toEqual([
      'duplicate_function_response_id',
      'duplicate_function_response_id',
      'unmatched_function_response_id',
      'ambiguous_function_response_id'
    ]);
    expect(messages[0].data.runtimeLedger.ledger.terminalContent.toolResults).toBeUndefined();
  });

  it('marks transport projection degraded when Runtime Ledger append is rejected', async () => {
    const { processor, messages } = createProcessor();
    jest.spyOn(chatStreamRuntimeLedgerBridge, 'appendStreamEvent').mockResolvedValueOnce({
      accepted: false,
      diagnostics: ['append_failed:runtime.chat.stream_event:forced rejection']
    });

    processor.processChunk({
      toolStatus: true,
      tool: { id: 'tool-call-rejected', name: 'read_file', status: 'executing' }
    });

    await flushRuntimeLedger();

    expect(messages).toHaveLength(1);
    expect(messages[0].data.runtimeLedger).toMatchObject({
      status: 'degraded',
      diagnostics: ['append_failed:runtime.chat.stream_event:forced rejection'],
      ledger: {
        toolStatesByInvocationId: {
          'tool:chat:tool-call-rejected': 'executing'
        }
      }
    });
  });

  it('attaches Runtime Ledger terminal content and state projections to transport messages', async () => {
    const { processor, messages } = createProcessor();

    processor.processChunk({
      toolIteration: true,
      content: {
        role: 'model',
        parts: [
          { text: 'terminal text' },
          { functionCall: { id: 'tool-terminal', name: 'read_file', args: {} } }
        ]
      },
      toolResults: [{ id: 'tool-terminal', name: 'read_file', result: { success: true, data: 'ok' } }]
    });
    processor.sendError('STREAM_FAILED', 'boom');
    await flushRuntimeLedger();

    expect(messages).toHaveLength(2);
    expect(messages[0].data).toMatchObject({
      type: 'toolIteration',
      runtimeLedger: {
        status: 'ok',
        identity: {
          messageId: 'msg:stream:stream-1',
          contentId: 'cnt:stream:stream-1'
        },
        ledger: {
          terminalContent: {
            type: 'toolIteration',
            source: 'runtime-ledger',
            content: {
              role: 'model',
              parts: [
                { text: 'terminal text' },
                { functionCall: { id: 'tool-terminal', name: 'read_file', args: {} } }
              ]
            },
            toolResults: [{ id: 'tool-terminal', name: 'read_file', result: { success: true, data: 'ok' } }]
          }
        }
      }
    });
    expect(messages[1].data).toMatchObject({
      type: 'error',
      runtimeLedger: {
        ledger: {
          terminalState: {
            type: 'error',
            source: 'runtime-ledger',
            error: { code: 'STREAM_FAILED', message: 'boom' }
          }
        }
      }
    });
  });
});
