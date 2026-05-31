import { subAgentRunEventBus } from '../../tools/subagents/runEventBus';
import { subAgentRuntimeLedgerBridge } from '../../tools/subagents/runtimeLedgerBridge';
import {
  SUBAGENT_RUNS_METADATA_KEY,
  type SubAgentRunConversationStore,
  type SubAgentRunPersistedRecord
} from '../../tools/subagents/runEventBus';
import type { Content } from '../../modules/conversation/types';

function createContent(text: string): Content {
  return {
    role: 'model',
    parts: [{ text }],
    timestamp: 1000
  } as Content;
}

function createToolCallContent(toolId: string): Content {
  return {
    role: 'model',
    parts: [{
      functionCall: {
        id: toolId,
        name: 'read_file',
        args: { path: 'README.md' }
      }
    }],
    timestamp: 1001
  } as Content;
}

function createFunctionResponseContent(toolId: string, response: Record<string, unknown>): Content {
  return {
    role: 'user',
    isFunctionResponse: true,
    parts: [{
      functionResponse: {
        id: toolId,
        name: 'read_file',
        response
      }
    }],
    timestamp: 1002
  } as Content;
}

function flushRuntimeLedger(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('SubAgent Runtime Ledger bridge', () => {
  const runIds: string[] = [];

  afterEach(async () => {
    await (subAgentRunEventBus as any).flushRuntimeLedgerBackfillsForTests?.();
    const snapshots = (subAgentRunEventBus as any).snapshots as Map<string, unknown> | undefined;
    const stores = (subAgentRunEventBus as any).stores as Map<string, unknown> | undefined;
    for (const runId of runIds.splice(0)) {
      snapshots?.delete(runId);
      stores?.delete(runId);
    }
    subAgentRuntimeLedgerBridge.resetForTests();
  });

  it('records run and content snapshot events without exposing full transcript payload text', async () => {
    runIds.push('ledger-run-1');
    subAgentRunEventBus.createRun('ledger-run-1', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-1'
    });
    subAgentRunEventBus.appendContent('ledger-run-1', createContent('secret model output should not be in runtime ledger payload'));

    await flushRuntimeLedger();

    const events = await subAgentRuntimeLedgerBridge.getEvents();
    expect(events.map(event => event.eventType)).toEqual([
      'runtime.subagent.run_event',
      'runtime.subagent.content_snapshot'
    ]);
    expect(events[0]).toMatchObject({
      context: 'subagent',
      subject: 'run',
      persistence: 'durable',
      conversationId: 'conv:subagent:conversation-ledger-1',
      runId: 'run:subagent:ledger-run-1'
    });
    expect(events[1]).toMatchObject({
      context: 'content',
      subject: 'contentWindow',
      persistence: 'snapshot',
      payload: {
        sourceType: 'content_snapshot',
        contentCount: 1,
        contentRevision: 1
      },
      payloadSummary: {
        redacted: true
      }
    });
    expect(JSON.stringify(events)).not.toContain('secret model output');
  });

  it('records llm_delta as explicit ephemeral event rather than durable replay fact', async () => {
    runIds.push('ledger-run-live');
    subAgentRunEventBus.createRun('ledger-run-live', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-live'
    });
    subAgentRunEventBus.emit({
      runId: 'ledger-run-live',
      type: 'llm_delta',
      payload: { part: { text: 'live only' } }
    });

    await flushRuntimeLedger();

    const events = await subAgentRuntimeLedgerBridge.getEvents();
    const liveEvent = events.find(event => event.eventType === 'runtime.subagent.live_delta');
    expect(liveEvent).toMatchObject({
      kind: 'integration',
      context: 'subagent',
      subject: 'liveDelta',
      persistence: 'ephemeral',
      payload: {
        sourceType: 'llm_delta',
        payloadKind: 'object'
      }
    });
  });

  it('projects sanitized live deltas through Runtime Ledger without storing stream text in event payloads', async () => {
    runIds.push('ledger-run-live-projection');
    subAgentRunEventBus.createRun('ledger-run-live-projection', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-live-projection'
    });
    subAgentRunEventBus.emit({
      runId: 'ledger-run-live-projection',
      type: 'llm_delta',
      payload: {
        delta: [
          { text: 'runtime live text' },
          {
            functionCall: {
              id: 'call-1',
              name: 'read_file',
              args: { path: 'README.md' },
              result: 'must not project'
            }
          },
          { functionResponse: { id: 'call-1', response: { secret: true } } }
        ],
        usage: { candidatesTokenCount: 3 },
        modelVersion: 'm'
      }
    });

    await flushRuntimeLedger();

    const projection = await (subAgentRunEventBus as any).getRuntimeLedgerMonitorProjection('ledger-run-live-projection');
    const events = await subAgentRuntimeLedgerBridge.getEvents();

    expect(projection.ledger.liveDelta).toMatchObject({
      runId: 'ledger-run-live-projection',
      type: 'llm_delta',
      eventSequence: 2,
      contentRevision: 0,
      source: 'runtime-ledger',
      payload: {
        delta: [
          { text: 'runtime live text' },
          { functionCall: { id: 'call-1', name: 'read_file', args: { path: 'README.md' } } }
        ],
        usage: { candidatesTokenCount: 3 },
        modelVersion: 'm'
      }
    });
    expect(JSON.stringify(projection.ledger.liveDelta)).not.toContain('functionResponse');
    expect(JSON.stringify(projection.ledger.liveDelta)).not.toContain('must not project');
    expect(JSON.stringify(events)).not.toContain('runtime live text');
  });

  it('exposes a ledger partial snapshot beside the source content window', async () => {
    runIds.push('ledger-run-window');
    subAgentRunEventBus.createRun('ledger-run-window', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-window'
    });
    subAgentRunEventBus.appendContent('ledger-run-window', createContent('window text'));

    await flushRuntimeLedger();

    const sourceWindow = subAgentRunEventBus.getContentWindow('ledger-run-window', { limit: 1, fromTail: true });
    const snapshot = await (subAgentRunEventBus as any).getRuntimeLedgerPartialSnapshot('ledger-run-window');

    expect(sourceWindow).toMatchObject({
      runId: 'ledger-run-window',
      totalCount: 1,
      contentRevision: 1,
      eventSequence: 2
    });
    expect(snapshot).toMatchObject({
      scopeKey: expect.stringContaining('run:run:subagent:ledger-run-window'),
      projection: {
        status: 'ok',
        eventCountsByType: {
          'runtime.subagent.run_event': 1,
          'runtime.subagent.content_snapshot': 1
        },
        lastEventSequence: 2
      },
      coverage: {
        eventSequence: 2,
        contentRevision: 1,
        contentCoveredEventSequence: 2
      },
      truncated: false
    });
  });

  it('tracks content mutations in ledger projection without replacing source window authority', async () => {
    runIds.push('ledger-run-mutation');
    subAgentRunEventBus.createRun('ledger-run-mutation', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-mutation',
      initialContents: [createContent('first')]
    });
    subAgentRunEventBus.replaceContents('ledger-run-mutation', [
      { ...createContent('replacement'), role: 'user' }
    ]);

    await flushRuntimeLedger();

    const sourceWindow = subAgentRunEventBus.getContentWindow('ledger-run-mutation', { limit: 5, fromTail: true });
    const snapshot = await (subAgentRunEventBus as any).getRuntimeLedgerPartialSnapshot('ledger-run-mutation');

    expect(sourceWindow).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'replacement' }], index: 0 }],
      totalCount: 1,
      contentRevision: 1,
      eventSequence: 2
    });
    expect(snapshot.projection.eventCountsByType).toEqual({
      'runtime.subagent.run_event': 1,
      'runtime.subagent.content_snapshot': 1
    });
    expect(snapshot.coverage).toMatchObject({
      eventSequence: 2,
      contentRevision: 1,
      contentCoveredEventSequence: 2
    });
  });

  it('projects SubAgent content windows from Runtime Ledger storage without putting text in event payloads', async () => {
    runIds.push('ledger-run-content-window');
    subAgentRunEventBus.createRun('ledger-run-content-window', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-content-window'
    });
    subAgentRunEventBus.appendContent('ledger-run-content-window', createContent('ledger projected text'));

    await flushRuntimeLedger();

    const projection = await (subAgentRunEventBus as any).getRuntimeLedgerMonitorProjection('ledger-run-content-window', {
      limit: 1,
      fromTail: true
    });
    const events = await subAgentRuntimeLedgerBridge.getEvents();

    expect(projection).toMatchObject({
      status: 'ok',
      ledger: {
        contentWindow: {
          runId: 'ledger-run-content-window',
          startIndex: 0,
          endIndex: 1,
          totalCount: 1,
          contentRevision: 1,
          eventSequence: 2,
          contentCoveredEventSequence: 2,
          source: 'runtime-ledger'
        }
      }
    });
    expect(projection.ledger.contentWindow.contents[0].parts[0].text).toBe('ledger projected text');
    expect(JSON.stringify(events)).not.toContain('ledger projected text');
  });

  it('restores persisted snapshots without eagerly materializing Runtime Ledger content windows', async () => {
    const runId = 'ledger-run-lazy-restore';
    runIds.push(runId);
    const record: SubAgentRunPersistedRecord = {
      runId,
      agentName: 'Ledger Agent',
      status: 'completed',
      createdAt: 1000,
      updatedAt: 2000,
      contents: [createContent('persisted restore text')],
      contentRevision: 7,
      eventSequence: 9
    };
    const store: SubAgentRunConversationStore = {
      getCustomMetadata: jest.fn(async (_conversationId: string, key: string) => {
        expect(key).toBe(SUBAGENT_RUNS_METADATA_KEY);
        return { [runId]: record };
      }),
      setCustomMetadata: jest.fn()
    };
    const ensureSpy = jest.spyOn(subAgentRuntimeLedgerBridge, 'ensureContentWindowForSnapshot');

    try {
      const snapshots = await subAgentRunEventBus.loadConversationSnapshots('conversation-lazy-restore', store);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        runId,
        conversationId: 'conversation-lazy-restore',
        contentRevision: 7,
        eventSequence: 9
      });
      expect(subAgentRunEventBus.getManifest(runId)).toMatchObject({
        runId,
        contentCount: 1,
        contentRevision: 7,
        eventSequence: 9
      });
      expect(ensureSpy).not.toHaveBeenCalled();
    } finally {
      ensureSpy.mockRestore();
    }
  });

  it('reports Monitor projection when source window metadata matches the ledger snapshot', async () => {
    runIds.push('ledger-run-projection');
    subAgentRunEventBus.createRun('ledger-run-projection', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-projection'
    });
    subAgentRunEventBus.appendContent('ledger-run-projection', createContent('projection text'));
    subAgentRunEventBus.emit({
      runId: 'ledger-run-projection',
      type: 'llm_delta',
      payload: { part: { text: 'live only' } }
    });

    await flushRuntimeLedger();

    const projection = await (subAgentRunEventBus as any).getRuntimeLedgerMonitorProjection('ledger-run-projection', {
      limit: 1,
      fromTail: true
    });

    expect(projection).toMatchObject({
      runId: 'ledger-run-projection',
      status: 'ok',
      mismatches: [],
      ledger: {
        projectionStatus: 'ok',
        eventSequence: 3,
        contentRevision: 1,
        contentCoveredEventSequence: 2,
        contentCount: 1,
        contentWindow: {
          runId: 'ledger-run-projection',
          totalCount: 1,
          contentRevision: 1,
          eventSequence: 3,
          contentCoveredEventSequence: 2,
          source: 'runtime-ledger'
        },
        truncated: false,
        eventCountsByType: {
          'runtime.subagent.run_event': 1,
          'runtime.subagent.content_snapshot': 1,
          'runtime.subagent.live_delta': 1
        }
      }
    });
  });

  it('returns source content immediately while Runtime Ledger window backfill is pending', async () => {
    runIds.push('ledger-run-source-window-pending');
    subAgentRunEventBus.createRun('ledger-run-source-window-pending', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-source-window-pending'
    });
    subAgentRunEventBus.appendContent('ledger-run-source-window-pending', createContent('source window text'));

    await flushRuntimeLedger();
    subAgentRuntimeLedgerBridge.resetForTests();

    const projection = await (subAgentRunEventBus as any).getRuntimeLedgerMonitorProjection('ledger-run-source-window-pending', {
      limit: 1,
      fromTail: true
    });

    expect(projection.status).toBe('degraded');
    expect(projection.mismatches).toContain('runtimeLedgerContentWindow:pending');
    expect(projection.health).toMatchObject({
      content: 'ok',
      renderable: true
    });
    expect(projection.ledger.contentWindow).toMatchObject({
      runId: 'ledger-run-source-window-pending',
      totalCount: 1,
      contentRevision: 1,
      eventSequence: 2,
      source: 'source-window'
    });
    expect(projection.ledger.contentWindow.contents[0].parts[0].text).toBe('source window text');
  });

  it('keeps an available content window renderable when coverage diagnostics drift', async () => {
    runIds.push('ledger-run-projection-diagnostic');
    subAgentRunEventBus.createRun('ledger-run-projection-diagnostic', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-projection-diagnostic'
    });
    subAgentRunEventBus.appendContent('ledger-run-projection-diagnostic', createContent('diagnostic render text'));

    await flushRuntimeLedger();

    const actualSnapshot = await subAgentRuntimeLedgerBridge.getPartialSnapshotForRun('ledger-run-projection-diagnostic');
    const snapshotSpy = jest.spyOn(subAgentRuntimeLedgerBridge, 'getPartialSnapshotForRun').mockResolvedValue({
      ...actualSnapshot,
      coverage: {
        ...actualSnapshot.coverage,
        contentRevision: (actualSnapshot.coverage?.contentRevision || 0) + 1
      }
    } as any);

    try {
      const projection = await (subAgentRunEventBus as any).getRuntimeLedgerMonitorProjection('ledger-run-projection-diagnostic', {
        limit: 1,
        fromTail: true
      });

      expect(projection.status).toBe('degraded');
      expect(projection.mismatches).toContain('contentRevision:1->2');
      expect(projection.health).toMatchObject({
        content: 'ok',
        renderable: true
      });
      expect(projection.ledger.contentWindow.contents[0].parts[0].text).toBe('diagnostic render text');
    } finally {
      snapshotSpy.mockRestore();
    }
  });

  it('reports degraded Monitor projection instead of guessing when ledger coverage is unavailable', async () => {
    runIds.push('ledger-run-projection-missing');
    subAgentRunEventBus.createRun('ledger-run-projection-missing', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-projection-missing'
    });
    subAgentRunEventBus.appendContent('ledger-run-projection-missing', createContent('source-only text'));

    await flushRuntimeLedger();
    subAgentRuntimeLedgerBridge.resetForTests();
    const originalEnsure = subAgentRuntimeLedgerBridge.ensureContentWindowForSnapshot;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (subAgentRuntimeLedgerBridge as any).ensureContentWindowForSnapshot = jest.fn().mockRejectedValue(new Error('projection unavailable'));

    try {
      const projection = await (subAgentRunEventBus as any).getRuntimeLedgerMonitorProjection('ledger-run-projection-missing');

      expect(projection.status).toBe('degraded');
      expect(projection.mismatches).toEqual([
        'runtimeLedgerContentWindow:pending',
        'sourceContentRevision:1->missing',
        'sourceEventSequence:2->missing'
      ]);
      expect(projection.health).toMatchObject({
        content: 'ok',
        renderable: true
      });
      expect(projection.ledger).toMatchObject({
        projectionStatus: 'ok',
        contentWindow: {
          runId: 'ledger-run-projection-missing',
          totalCount: 1,
          contentRevision: 1,
          eventSequence: 2,
          source: 'source-window'
        },
        truncated: false,
        eventCountsByType: {}
      });
    } finally {
      (subAgentRuntimeLedgerBridge as any).ensureContentWindowForSnapshot = originalEnsure;
      warnSpy.mockRestore();
    }
  });

  it('records run lifecycle transitions as ledger events while manifest remains unchanged', async () => {
    runIds.push('ledger-run-lifecycle');
    subAgentRunEventBus.createRun('ledger-run-lifecycle', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-lifecycle'
    });
    subAgentRunEventBus.emit({
      runId: 'ledger-run-lifecycle',
      type: 'run_paused'
    });
    subAgentRunEventBus.emit({
      runId: 'ledger-run-lifecycle',
      type: 'run_resumed'
    });
    subAgentRunEventBus.emit({
      runId: 'ledger-run-lifecycle',
      type: 'run_completed'
    });

    await flushRuntimeLedger();

    const manifest = subAgentRunEventBus.getManifest('ledger-run-lifecycle');
    const snapshot = await (subAgentRunEventBus as any).getRuntimeLedgerPartialSnapshot('ledger-run-lifecycle');

    expect(manifest).toMatchObject({
      runId: 'ledger-run-lifecycle',
      status: 'completed',
      eventSequence: 4
    });
    expect(snapshot.projection).toMatchObject({
      status: 'ok',
      lastEventSequence: 4,
      eventCountsByType: {
        'runtime.subagent.run_event': 4
      }
    });
    expect(snapshot.coverage).toMatchObject({
      eventSequence: 4
    });
  });

  it('mirrors SubAgent tool lifecycle and final functionResponse authority into the ledger', async () => {
    runIds.push('ledger-run-tool');
    subAgentRunEventBus.createRun('ledger-run-tool', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-tool'
    });
    subAgentRunEventBus.emit({
      runId: 'ledger-run-tool',
      type: 'tool_started',
      toolId: 'call-1',
      toolName: 'read_file',
      payload: { args: { path: 'README.md' } }
    });
    subAgentRunEventBus.emit({
      runId: 'ledger-run-tool',
      type: 'tool_completed',
      toolId: 'call-1',
      toolName: 'read_file',
      payload: { result: { success: true, secret: 'tool payload should stay redacted' } }
    });
    subAgentRunEventBus.appendContent('ledger-run-tool', createToolCallContent('call-1'));
    subAgentRunEventBus.appendContent('ledger-run-tool', createFunctionResponseContent('call-1', {
      success: false,
      error: 'functionResponse is final',
      secret: 'function response secret should stay redacted'
    }));

    await flushRuntimeLedger();

    const events = await subAgentRuntimeLedgerBridge.getEvents();
    const lifecycleEvents = events.filter(event => event.eventType === 'runtime.tool.lifecycle');
    const functionResponseEvents = events.filter(event => event.eventType === 'runtime.tool.function_response');
    const snapshot = await (subAgentRunEventBus as any).getRuntimeLedgerPartialSnapshot('ledger-run-tool');

    expect(lifecycleEvents.map(event => event.payload)).toEqual([
      expect.objectContaining({ sourceType: 'tool_started', phase: 'executing', toolName: 'read_file' }),
      expect.objectContaining({ sourceType: 'tool_completed', phase: 'success', toolName: 'read_file' })
    ]);
    expect(functionResponseEvents).toHaveLength(1);
    expect(functionResponseEvents[0]).toMatchObject({
      context: 'tool',
      subject: 'functionResponse',
      persistence: 'durable',
      runId: 'run:subagent:ledger-run-tool',
      messageId: 'msg:subagent:ledger-run-tool:0',
      contentId: 'cnt:subagent:ledger-run-tool:1',
      toolInvocationId: 'tool:subagent:call-1',
      payload: {
        sourceType: 'function_response',
        toolName: 'read_file',
        isError: true,
        responseKeys: ['error', 'secret', 'success']
      }
    });
    expect(snapshot.projection.toolStatesByInvocationId['tool:subagent:call-1']).toBe('error');
    expect(JSON.stringify(events)).not.toContain('tool payload should stay redacted');
    expect(JSON.stringify(events)).not.toContain('function response secret should stay redacted');
  });

  it('does not synthesize tool authority when SubAgent functionResponse id is missing', async () => {
    runIds.push('ledger-run-tool-missing-id');
    subAgentRunEventBus.createRun('ledger-run-tool-missing-id', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-tool-missing-id'
    });
    subAgentRunEventBus.appendContent('ledger-run-tool-missing-id', {
      ...createFunctionResponseContent('', { success: true, result: 'unbound result' }),
      parts: [{
        functionResponse: {
          name: 'read_file',
          response: { success: true, result: 'unbound result' }
        }
      }]
    } as Content);

    await flushRuntimeLedger();

    const events = await subAgentRuntimeLedgerBridge.getEvents();
    const authorityEvents = events.filter(event => event.eventType === 'runtime.tool.function_response');
    const unboundEvents = events.filter(event => event.eventType === 'runtime.tool.function_response_unbound');
    const snapshot = await (subAgentRunEventBus as any).getRuntimeLedgerPartialSnapshot('ledger-run-tool-missing-id');

    expect(authorityEvents).toHaveLength(0);
    expect(unboundEvents).toHaveLength(1);
    expect(unboundEvents[0]).toMatchObject({
      kind: 'diagnostic',
      context: 'diagnostic',
      subject: 'functionResponse',
      toolInvocationId: undefined,
      payload: {
        sourceType: 'function_response',
        reason: 'missing_function_response_id',
        toolName: 'read_file'
      }
    });
    expect(snapshot.projection.toolStatesByInvocationId).toEqual({});
    expect(JSON.stringify(events)).not.toContain('unbound result');
  });

  it('classifies unmatched, duplicate, and ambiguous functionResponse ids as diagnostics', async () => {
    runIds.push('ledger-run-tool-binding-diagnostics');
    subAgentRunEventBus.createRun('ledger-run-tool-binding-diagnostics', 'Ledger Agent', undefined, {
      conversationId: 'conversation-ledger-tool-binding-diagnostics'
    });
    subAgentRunEventBus.appendContent('ledger-run-tool-binding-diagnostics', {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'ambiguous-call',
            name: 'read_file',
            args: {}
          }
        },
        {
          functionCall: {
            id: 'ambiguous-call',
            name: 'read_file',
            args: {}
          }
        }
      ],
      timestamp: 1001
    } as Content);
    subAgentRunEventBus.appendContent('ledger-run-tool-binding-diagnostics', createFunctionResponseContent('missing-call', {
      success: true,
      result: 'unmatched result'
    }));
    subAgentRunEventBus.appendContent('ledger-run-tool-binding-diagnostics', createFunctionResponseContent('missing-call', {
      success: true,
      result: 'duplicate result'
    }));
    subAgentRunEventBus.appendContent('ledger-run-tool-binding-diagnostics', createFunctionResponseContent('ambiguous-call', {
      success: true,
      result: 'ambiguous result'
    }));

    await flushRuntimeLedger();

    const events = await subAgentRuntimeLedgerBridge.getEvents();
    const authorityEvents = events.filter(event => event.eventType === 'runtime.tool.function_response');
    const unboundReasons = events
      .filter(event => event.eventType === 'runtime.tool.function_response_unbound')
      .map(event => (event.payload as any).reason);
    const snapshot = await (subAgentRunEventBus as any).getRuntimeLedgerPartialSnapshot('ledger-run-tool-binding-diagnostics');

    expect(authorityEvents).toHaveLength(0);
    expect(unboundReasons).toEqual(expect.arrayContaining([
      'unmatched_function_response_id',
      'duplicate_function_response_id',
      'ambiguous_function_response_id'
    ]));
    expect(snapshot.projection.toolStatesByInvocationId).toEqual({});
    expect(JSON.stringify(events)).not.toContain('unmatched result');
    expect(JSON.stringify(events)).not.toContain('duplicate result');
    expect(JSON.stringify(events)).not.toContain('ambiguous result');
  });
});
