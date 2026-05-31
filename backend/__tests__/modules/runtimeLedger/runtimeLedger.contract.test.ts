import {
  RuntimeEventRegistry,
  RuntimeIdentityRegistry,
  RuntimeLedger,
  RuntimeOperationRegistry,
  RuntimeSchemaRegistry,
  createRuntimeSchema
} from '../../../modules/runtimeLedger';

function createFixture(mode: 'canonical' | 'shadow' = 'canonical') {
  const schemas = new RuntimeSchemaRegistry();
  const events = new RuntimeEventRegistry(schemas);
  const operations = new RuntimeOperationRegistry(schemas);
  const ids = new RuntimeIdentityRegistry({
    now: () => 1000,
    random: () => 'abc123'
  });

  events.register({
    eventType: 'runtime.tool.lifecycle',
    kind: 'domain',
    context: 'tool',
    subject: 'toolInvocation',
    persistence: 'durable',
    schema: createRuntimeSchema<{ phase: string }>('runtime.tool.lifecycle', 1, payload => {
      if (!payload || typeof payload.phase !== 'string') {
        throw new Error('phase is required');
      }
    })
  });
  events.register({
    eventType: 'runtime.tool.function_response',
    kind: 'domain',
    context: 'tool',
    subject: 'functionResponse',
    persistence: 'durable',
    schema: createRuntimeSchema<{ isError?: boolean }>('runtime.tool.function_response', 1)
  });
  events.register({
    eventType: 'runtime.monitor.window_materialized',
    kind: 'domain',
    context: 'monitor',
    subject: 'contentWindow',
    persistence: 'snapshot',
    schema: createRuntimeSchema<{ contentCount: number }>('runtime.monitor.window_materialized', 1, payload => {
      if (typeof payload?.contentCount !== 'number') {
        throw new Error('contentCount is required');
      }
    })
  });
  operations.register({
    operationId: 'monitor.getRunWindow',
    kind: 'query',
    context: 'monitor',
    subject: 'contentWindow',
    schema: createRuntimeSchema<{ runId: string }>('operation.monitor.getRunWindow', 1)
  });

  const ledger = new RuntimeLedger({
    mode,
    eventRegistry: events,
    identityRegistry: ids,
    now: () => 2000,
    recentEventLimit: 1
  });

  return { ledger, ids, events, operations };
}

describe('RuntimeLedger contracts', () => {
  it('appends canonical envelopes with backend-owned id, sequence, coverage, and schema validation', async () => {
    const { ledger, ids } = createFixture();
    const conversationId = ids.create('conversation', 'main');
    const runId = ids.create('run', 'subagent');
    const toolInvocationId = ids.create('toolInvocation', 'call');

    const result = await ledger.append({
      eventType: 'runtime.tool.lifecycle',
      kind: 'domain',
      context: 'tool',
      subject: 'toolInvocation',
      conversationId,
      runId,
      toolInvocationId,
      persistence: 'durable',
      payload: { phase: 'executing' },
      coverage: {
        contentRevision: 3,
        contentCoveredEventSequence: 1,
        replayAvailableFrom: 1
      }
    });

    expect(result.accepted).toBe(true);
    expect(result.event).toMatchObject({
      eventType: 'runtime.tool.lifecycle',
      eventId: expect.stringMatching(/^rtevt_tool_/),
      sequence: 1,
      timestamp: 2000,
      conversationId,
      runId,
      toolInvocationId,
      schemaVersion: 1,
      coverage: {
        eventSequence: 1,
        contentRevision: 3,
        contentCoveredEventSequence: 1,
        replayAvailableFrom: 1,
        replayAvailableTo: 1
      },
      payloadSummary: { kind: 'json', bytes: expect.any(Number) }
    });
  });

  it('rejects unregistered or schema-invalid events in canonical mode', async () => {
    const { ledger, ids } = createFixture();
    const conversationId = ids.create('conversation', 'main');
    const runId = ids.create('run', 'subagent');

    await expect(ledger.append({
      eventType: 'runtime.tool.lifecycle',
      kind: 'domain',
      context: 'tool',
      subject: 'toolInvocation',
      conversationId,
      runId,
      persistence: 'durable',
      payload: {}
    })).rejects.toThrow('phase is required');

    await expect(ledger.append({
      eventType: 'runtime.unknown',
      kind: 'domain',
      context: 'tool',
      subject: 'toolInvocation',
      conversationId,
      runId,
      persistence: 'durable',
      payload: { phase: 'executing' }
    })).rejects.toThrow('Runtime event is not registered');
  });

  it('returns explicit diagnostics instead of throwing in shadow mode', async () => {
    const { ledger, ids } = createFixture('shadow');
    const conversationId = ids.create('conversation', 'main');
    const runId = ids.create('run', 'subagent');

    const result = await ledger.append({
      eventType: 'runtime.tool.lifecycle',
      kind: 'domain',
      context: 'tool',
      subject: 'toolInvocation',
      conversationId,
      runId,
      persistence: 'durable',
      payload: {}
    });

    expect(result.accepted).toBe(false);
    expect(result.diagnostic).toContain('phase is required');
    expect(ledger.getDiagnostics({ conversationId, runId })).toEqual([
      expect.objectContaining({
        code: 'append_failed',
        message: 'phase is required',
        eventType: 'runtime.tool.lifecycle',
        conversationId,
        runId
      })
    ]);
  });

  it('builds deterministic projections and uses functionResponse as final tool authority', async () => {
    const { ledger, ids } = createFixture();
    const conversationId = ids.create('conversation', 'main');
    const runId = ids.create('run', 'subagent');
    const toolInvocationId = ids.create('toolInvocation', 'call');

    await ledger.append({
      eventType: 'runtime.tool.lifecycle',
      kind: 'domain',
      context: 'tool',
      subject: 'toolInvocation',
      conversationId,
      runId,
      toolInvocationId,
      persistence: 'durable',
      payload: { phase: 'executing' }
    });
    await ledger.append({
      eventType: 'runtime.tool.function_response',
      kind: 'domain',
      context: 'tool',
      subject: 'functionResponse',
      conversationId,
      runId,
      toolInvocationId,
      persistence: 'durable',
      payload: { isError: true }
    });

    const projection = await ledger.getProjection({ conversationId, runId });

    expect(projection.status).toBe('ok');
    expect(projection.eventCountsByType).toEqual({
      'runtime.tool.lifecycle': 1,
      'runtime.tool.function_response': 1
    });
    expect(projection.toolStatesByInvocationId[toolInvocationId]).toBe('error');
  });

  it('reports bounded replay truncation and partial snapshot coverage', async () => {
    const { ledger, ids } = createFixture();
    const conversationId = ids.create('conversation', 'main');
    const runId = ids.create('run', 'subagent');

    await ledger.append({
      eventType: 'runtime.monitor.window_materialized',
      kind: 'domain',
      context: 'monitor',
      subject: 'contentWindow',
      conversationId,
      runId,
      persistence: 'snapshot',
      payload: { contentCount: 1 },
      coverage: { contentRevision: 1, contentCoveredEventSequence: 1, replayAvailableFrom: 1 }
    });
    await ledger.append({
      eventType: 'runtime.monitor.window_materialized',
      kind: 'domain',
      context: 'monitor',
      subject: 'contentWindow',
      conversationId,
      runId,
      persistence: 'snapshot',
      payload: { contentCount: 2 },
      coverage: { contentRevision: 2, contentCoveredEventSequence: 2, replayAvailableFrom: 1 }
    });

    const replay = await ledger.getEvents({ conversationId, runId, limit: 1 });
    expect(replay.truncated).toBe(true);
    expect(replay.degradedReason).toBe('replay_truncated:1/2');

    const snapshot = await ledger.getPartialSnapshot({ conversationId, runId, context: 'monitor' });
    expect(snapshot.recentEvents).toHaveLength(1);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.coverage).toMatchObject({
      eventSequence: 2,
      contentRevision: 2,
      contentCoveredEventSequence: 2,
      replayAvailableFrom: 1,
      replayAvailableTo: 2
    });
  });
});
