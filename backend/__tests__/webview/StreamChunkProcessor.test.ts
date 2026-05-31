import { StreamChunkProcessor } from '../../../webview/stream/StreamChunkProcessor';
import { chatStreamRuntimeLedgerBridge } from '../../../webview/stream/runtimeLedgerBridge';
import { estimateJsonBytes } from '../../../frontend/src/utils/cacheLifecycleGovernor';

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

function createVisibilityAwareProcessor(visibleRef: { value: boolean }) {
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
    processor: new StreamChunkProcessor(view as any, 'conversation-1', 'stream-hidden-1', {
      isVisible: () => visibleRef.value
    })
  };
}

function flushRuntimeLedger(): Promise<void> {
  return Array.from({ length: 20 }).reduce<Promise<void>>(
    promise => promise.then(() => Promise.resolve()),
    Promise.resolve()
  );
}

describe('StreamChunkProcessor immediate transport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes high-frequency chunk messages immediately without throttle delay', async () => {
    const { processor, messages, postMessage } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'A' }] } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'streamChunk',
      data: { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' }
    });

    processor.processChunk({ chunk: { delta: [{ text: 'B' }] } });
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      type: 'streamChunk',
      data: { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' }
    });
  });

  it('still flushes terminal events immediately after any buffered chunks', async () => {
    const { processor, messages } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'A' }] } });
    processor.processChunk({ content: { role: 'model', parts: [{ text: 'final' }] } });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      type: 'streamChunk',
      data: { type: 'chunk', conversationId: 'conversation-1', streamId: 'stream-1' }
    });
    expect(messages[1]).toMatchObject({
      type: 'streamChunk',
      data: { type: 'complete', conversationId: 'conversation-1', streamId: 'stream-1' }
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
    });
    expect(messages[0].data).not.toHaveProperty('chunk');
    expect(messages[0].data).not.toHaveProperty('content');
    expect(messages[0].data).not.toHaveProperty('toolResults');
    expect(messages[0].data).not.toHaveProperty('pendingToolCalls');
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
      }
    });
    expect(messages[1].data).not.toHaveProperty('toolStatus');
    expect(messages[1].data).not.toHaveProperty('tool');
    expect(messages[1].data).not.toHaveProperty('content');
    expect(messages[1].data).not.toHaveProperty('toolResults');
  });

  it('keeps a basic stream transport envelope under the current payload budget', async () => {
    const { processor, messages } = createProcessor();

    processor.processChunk({ chunk: { delta: [{ text: 'small projected text' }] } });
    await flushRuntimeLedger();

    expect(messages).toHaveLength(1);
    expect(estimateJsonBytes(messages[0])).toBeLessThanOrEqual(16 * 1024);
  });

  it('keeps immediate stream chunk envelopes under the transport byte budget', async () => {
    const { processor, messages } = createProcessor();
    const chunkText = '批量分片'.repeat(900);

    for (let index = 0; index < 6; index++) {
      processor.processChunk({ chunk: { delta: [{ text: `${index}-${chunkText}` }] } });
    }

    expect(messages).toHaveLength(6);
    expect(messages.every(message => message.type === 'streamChunk')).toBe(true);
    expect(messages.every(message => estimateJsonBytes(message) <= 16 * 1024)).toBe(true);
  });

  it('bounds oversized live snapshots and function-call args on the stream hot path', async () => {
    const { processor, messages } = createProcessor();
    const huge = `HUGE-${'0123456789'.repeat(2000)}-END`;

    processor.processChunk({
      chunk: {
        delta: [{
          functionCall: {
            id: 'tool-huge-args',
            name: 'write_file',
            args: { body: huge },
            partialArgs: huge,
            finalArgs: { body: huge }
          }
        }],
        contentSnapshot: {
          role: 'model',
          parts: [{ text: huge }]
        }
      }
    });
    await flushRuntimeLedger();

    expect(messages).toHaveLength(1);
    const payload = messages[0].data.runtimeLedger.ledger.liveDelta.payload;
    const functionCall = payload.delta[0].functionCall;
    expect(JSON.stringify(messages[0])).not.toContain(huge);
    expect(estimateJsonBytes(messages[0])).toBeLessThanOrEqual(16 * 1024);
    expect(payload).toMatchObject({
      contentSnapshotTruncated: true,
      contentSnapshotRef: {
        kind: 'liveDeltaContentSnapshot',
        truncated: true
      }
    });
    expect(functionCall).toMatchObject({
      argsTruncated: true,
      partialArgsTruncated: true,
      finalArgsTruncated: true
    });
  });

  it('bounds pending tool calls and tool status snapshots behind refs/previews', async () => {
    const { processor, messages } = createProcessor();
    const huge = `TOOL-${'abcdef'.repeat(2000)}-END`;

    processor.processChunk({
      toolsExecuting: true,
      content: {
        role: 'model',
        parts: [{ functionCall: { id: 'pending-huge', name: 'write_file', args: { body: huge } } }]
      },
      pendingToolCalls: [{
        id: 'pending-huge',
        name: 'write_file',
        args: { body: huge }
      }]
    });
    processor.processChunk({
      toolStatus: true,
      tool: {
        id: 'pending-huge',
        name: 'write_file',
        status: 'success',
        args: { body: huge },
        result: { output: huge }
      }
    });
    await flushRuntimeLedger();

    expect(messages).toHaveLength(2);
    const terminalContent = messages[0].data.runtimeLedger.ledger.terminalContent;
    const toolSnapshot = messages[1].data.runtimeLedger.ledger.toolSnapshotsByInvocationId['tool:chat:pending-huge'];

    expect(JSON.stringify(messages)).not.toContain(huge);
    expect(messages.every(message => estimateJsonBytes(message) <= 16 * 1024)).toBe(true);
    expect(terminalContent).toMatchObject({
      pendingToolCallsTruncated: true,
      pendingToolCallsRef: {
        kind: 'pendingToolCalls',
        truncated: true
      }
    });
    expect(toolSnapshot).toMatchObject({
      argsTruncated: true,
      argsRef: { kind: 'toolArgs', truncated: true },
      resultTruncated: true,
      resultRef: { kind: 'toolStatusResult', truncated: true }
    });
  });

  it('coalesces hidden stream chunks and refreshes a bounded Runtime Ledger projection when visible', async () => {
    const visibility = { value: false };
    const { processor, messages, postMessage } = createVisibilityAwareProcessor(visibility);

    processor.processChunk({ chunk: { delta: [{ text: 'hidden ' }] } });
    processor.processChunk({ chunk: { delta: [{ text: 'stream' }] } });
    await flushRuntimeLedger();

    processor.flush();
    expect(postMessage).not.toHaveBeenCalled();
    expect(processor.hasHiddenTransportMessages()).toBe(true);

    visibility.value = true;
    processor.flushHiddenTransportMessages();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      type: 'webview.hiddenDeliverySummary',
      data: {
        originalType: 'streamChunk',
        coalescedCount: 2,
        deliveredCount: 1
      }
    });
    expect(messages[1]).toMatchObject({
      type: 'streamChunk',
      data: {
        type: 'chunk',
        runtimeLedger: {
          ledger: {
            liveDelta: {
              payload: {
                delta: [{ text: 'hidden stream' }]
              }
            }
          }
        }
      }
    });
    expect(messages[1].data).not.toHaveProperty('chunk');
    expect(estimateJsonBytes(messages[0])).toBeLessThanOrEqual(16 * 1024);
    expect(estimateJsonBytes(messages[1])).toBeLessThanOrEqual(16 * 1024);
  });

  it('does not deliver an unbounded accumulated hidden stream delta when visible again', async () => {
    const visibility = { value: false };
    const { processor, messages } = createVisibilityAwareProcessor(visibility);
    const hugeHiddenChunk = 'hidden-long-stream'.repeat(400);

    for (let index = 0; index < 8; index++) {
      processor.processChunk({ chunk: { delta: [{ text: hugeHiddenChunk }] } });
    }
    await flushRuntimeLedger();

    processor.flush();
    expect(messages).toHaveLength(0);

    visibility.value = true;
    processor.flushHiddenTransportMessages();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      type: 'webview.hiddenDeliverySummary',
      data: {
        coalescedCount: 8
      }
    });
    expect(JSON.stringify(messages[1])).not.toContain(hugeHiddenChunk);
    expect(estimateJsonBytes(messages[1])).toBeLessThanOrEqual(16 * 1024);
  });

  it('bounds long terminal content behind Runtime Ledger refs and serves explicit byte windows', async () => {
    const { processor, messages } = createProcessor();
    const longText = `START-${'0123456789'.repeat(1200)}-END`;

    processor.processChunk({
      content: {
        role: 'model',
        parts: [{ text: longText }]
      }
    });
    await flushRuntimeLedger();

    const terminalContent = messages[0].data.runtimeLedger.ledger.terminalContent;
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0])).not.toContain(longText);
    expect(estimateJsonBytes(messages[0])).toBeLessThanOrEqual(16 * 1024);
    expect(terminalContent).toMatchObject({
      type: 'complete',
      contentTruncated: true,
      contentRef: {
        kind: 'content',
        truncated: true
      }
    });

    const full = chatStreamRuntimeLedgerBridge.getTerminalContentWindow(terminalContent.contentRef.refId);
    expect((full?.payload as any).parts[0].text).toBe(longText);

    const window = chatStreamRuntimeLedgerBridge.getTerminalContentWindow(terminalContent.contentRef.refId, {
      startBytes: 0,
      maxBytes: 96,
      includePayload: false
    });
    expect(window?.payload).toBeUndefined();
    expect(window?.serializedWindow).toContain('START-');
    expect(window?.window).toMatchObject({
      startBytes: 0,
      hasMoreBefore: false,
      hasMoreAfter: true
    });
  });

  it('bounds long bound tool results behind Runtime Ledger result refs', async () => {
    const { processor, messages } = createProcessor();
    const hugeResult = `RESULT-${'abcdef'.repeat(2000)}-END`;

    processor.processChunk({
      toolIteration: true,
      content: {
        role: 'model',
        parts: [{ functionCall: { id: 'tool-long-result', name: 'read_file', args: { path: 'large.txt' } } }]
      },
      toolResults: [{
        id: 'tool-long-result',
        name: 'read_file',
        result: { success: true, data: hugeResult }
      }]
    });
    await flushRuntimeLedger();

    const terminalContent = messages[0].data.runtimeLedger.ledger.terminalContent;
    const resultRef = terminalContent.toolResultRefsById['tool-long-result'];
    expect(JSON.stringify(messages[0])).not.toContain(hugeResult);
    expect(estimateJsonBytes(messages[0])).toBeLessThanOrEqual(16 * 1024);
    expect(resultRef).toMatchObject({
      kind: 'toolResult',
      truncated: true
    });
    expect(terminalContent.toolResults[0]).toMatchObject({
      id: 'tool-long-result',
      name: 'read_file',
      runtimeLedgerRef: {
        refId: resultRef.refId
      },
      result: {
        success: true,
        runtimeLedgerPreviewTruncated: true
      }
    });

    const full = chatStreamRuntimeLedgerBridge.getTerminalContentWindow(resultRef.refId);
    expect((full?.payload as any).result.data).toBe(hugeResult);
  });

  it('keeps diffContentId in truncated tool result previews so diff actions can load full files', async () => {
    const { processor, messages } = createProcessor();
    const noisyResults = Array.from({ length: 80 }, (_, index) => ({
      index,
      success: true,
      startLine: index + 1,
      endLine: index + 1,
      detail: `changed ${index} ${'x'.repeat(80)}`
    }));

    processor.processChunk({
      toolIteration: true,
      content: {
        role: 'model',
        parts: [{ functionCall: { id: 'tool-apply-diff', name: 'apply_diff', args: { path: 'src/example.ts', hunks: [] } } }]
      },
      toolResults: [{
        id: 'tool-apply-diff',
        name: 'apply_diff',
        result: {
          success: true,
          data: {
            file: 'src/example.ts',
            status: 'accepted',
            appliedCount: 80,
            failedCount: 0,
            results: noisyResults,
            diffContentId: 'diff-full-file-1',
            pendingDiffId: 'pending-diff-1'
          }
        }
      }]
    });
    await flushRuntimeLedger();

    const projectedResult = messages[0].data.runtimeLedger.ledger.terminalContent.toolResults[0].result;
    expect(projectedResult.runtimeLedgerPreviewTruncated).toBe(true);
    expect(projectedResult.data.diffContentId).toBe('diff-full-file-1');
    expect(projectedResult.data.pendingDiffId).toBe('pending-diff-1');
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
    expect(messages[0].data).not.toHaveProperty('content');
    expect(messages[0].data).not.toHaveProperty('toolResults');
    expect(messages[0].data).not.toHaveProperty('pendingToolCalls');
  });

  it('keeps transport projection immediate when background Runtime Ledger append is rejected', async () => {
    const { processor, messages } = createProcessor();
    const appendSpy = jest.spyOn(chatStreamRuntimeLedgerBridge, 'appendStreamEvent').mockResolvedValueOnce({
      accepted: false,
      diagnostics: ['append_failed:runtime.chat.stream_event:forced rejection']
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      processor.processChunk({
        toolStatus: true,
        tool: { id: 'tool-call-rejected', name: 'read_file', status: 'executing' }
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].data.runtimeLedger).toMatchObject({
        status: 'ok',
        ledger: {
          toolStatesByInvocationId: {
            'tool:chat:tool-call-rejected': 'executing'
          }
        }
      });

      await processor.drainRuntimeLedgerForTests();
      expect(appendSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[StreamChunkProcessor] Runtime Ledger append rejected:',
        ['append_failed:runtime.chat.stream_event:forced rejection']
      );
    } finally {
      warnSpy.mockRestore();
    }
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
    expect(messages[0].data).not.toHaveProperty('content');
    expect(messages[0].data).not.toHaveProperty('toolIteration');
    expect(messages[0].data).not.toHaveProperty('toolResults');
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
    expect(messages[1].data).not.toHaveProperty('error');
  });
});
