import {
  applyRuntimeLedgerLiveDeltaToContents,
  applyRuntimeLedgerToolProjection,
  describeRuntimeLedgerRecoveryState,
  enqueueRuntimeLedgerLiveDelta,
  getRuntimeLedgerContentWindow,
  getRuntimeLedgerLiveDelta,
  selectReplayableRuntimeLedgerLiveDeltas,
  getRuntimeLedgerToolState,
  hasRuntimeLedgerToolProjection
} from '../../../frontend/src/components/subagents/monitorRuntimeLedgerProjection';
import type { Content, ToolUsage } from '../../../frontend/src/types';

describe('SubAgent Monitor Runtime Ledger tool projection', () => {
  it('maps backend runtime tool invocation ids to ToolUsage status', () => {
    const tool: ToolUsage = {
      id: 'call-1',
      name: 'read_file',
      args: { path: 'README.md' },
      status: 'queued'
    };

    const runtimeLedger = {
      status: 'ok' as const,
      ledger: {
        toolStatesByInvocationId: {
          'tool:subagent:call-1': 'executing' as const
        }
      }
    };

    expect(getRuntimeLedgerToolState('call-1', runtimeLedger)).toBe('executing');
    expect(hasRuntimeLedgerToolProjection('call-1', runtimeLedger)).toBe(true);
    expect(applyRuntimeLedgerToolProjection(tool, runtimeLedger)).toMatchObject({
      id: 'call-1',
      status: 'executing',
      args: { path: 'README.md' }
    });
  });

  it('lets final functionResponse projection override earlier lifecycle success', () => {
    const tool: ToolUsage = {
      id: 'call-1',
      name: 'read_file',
      args: {},
      status: 'success'
    };

    const runtimeLedger = {
      status: 'ok' as const,
      ledger: {
        toolStatesByInvocationId: {
          'tool:subagent:call-1': 'error' as const
        }
      }
    };

    expect(applyRuntimeLedgerToolProjection(tool, runtimeLedger)).toMatchObject({
      id: 'call-1',
      status: 'error'
    });
  });

  it('does not invent a projection for missing tool identity', () => {
    const tool: ToolUsage = {
      id: '',
      name: 'read_file',
      args: {},
      status: 'queued'
    };

    expect(hasRuntimeLedgerToolProjection(tool.id, {
      status: 'degraded',
      ledger: { toolStatesByInvocationId: {} }
    })).toBe(false);
    expect(applyRuntimeLedgerToolProjection(tool, undefined)).toBe(tool);
  });

  it('surfaces recovery state only when content is not renderable', () => {
    expect(describeRuntimeLedgerRecoveryState({
      status: 'degraded',
      health: {
        content: 'recovering',
        replay: 'ok',
        projection: 'ok',
        renderable: false,
        contentReasons: ['contentWindow:missing'],
        diagnosticReasons: []
      },
      ledger: { toolStatesByInvocationId: {} }
    })).toBe('正在重新同步 SubAgent 对话窗口…');
    expect(describeRuntimeLedgerRecoveryState({
      status: 'ok',
      health: {
        content: 'ok',
        replay: 'truncated',
        projection: 'diagnostic',
        renderable: true,
        contentReasons: [],
        diagnosticReasons: ['ledger_recent_replay_truncated']
      }
    })).toBeUndefined();
  });

  it('exposes content windows only from healthy Runtime Ledger projections', () => {
    const contentWindow = {
      runId: 'run-1',
      contents: [{ role: 'model' as const, parts: [{ text: 'ledger text' }] }],
      startIndex: 0,
      endIndex: 1,
      totalCount: 1,
      contentRevision: 2,
      eventSequence: 3,
      hasMoreBefore: false,
      hasMoreAfter: false,
      source: 'runtime-ledger'
    };

    expect(getRuntimeLedgerContentWindow({
      status: 'ok',
      health: {
        content: 'ok',
        replay: 'ok',
        projection: 'ok',
        renderable: true,
        contentReasons: [],
        diagnosticReasons: []
      },
      ledger: { contentWindow }
    }, 'run-1')).toBe(contentWindow);
    expect(getRuntimeLedgerContentWindow({
      status: 'degraded',
      health: {
        content: 'recovering',
        replay: 'ok',
        projection: 'ok',
        renderable: false,
        contentReasons: ['contentWindow:missing'],
        diagnosticReasons: []
      },
      ledger: { contentWindow }
    }, 'run-1')).toBeUndefined();
    expect(getRuntimeLedgerContentWindow({
      status: 'ok',
      health: {
        content: 'ok',
        replay: 'ok',
        projection: 'ok',
        renderable: true,
        contentReasons: [],
        diagnosticReasons: []
      },
      ledger: { contentWindow }
    }, 'other-run')).toBeUndefined();
  });

  it('exposes Runtime Ledger live delta projections by run id', () => {
    const liveDelta = {
      runId: 'run-1',
      type: 'llm_delta' as const,
      eventSequence: 4,
      contentRevision: 1,
      payload: { delta: [{ text: 'streamed' }] },
      source: 'runtime-ledger'
    };

    expect(getRuntimeLedgerLiveDelta({
      status: 'ok',
      ledger: { liveDelta }
    }, 'run-1')).toBe(liveDelta);
    expect(getRuntimeLedgerLiveDelta({
      status: 'ok',
      ledger: { liveDelta }
    }, 'other-run')).toBeUndefined();
    expect(getRuntimeLedgerLiveDelta({
      status: 'ok',
      ledger: { liveDelta: { ...liveDelta, payload: undefined } }
    }, 'run-1')).toBeUndefined();
  });

  it('buffers and applies Runtime Ledger live deltas without depending on removed monitor helpers', () => {
    const first = {
      runId: 'run-1',
      type: 'llm_delta' as const,
      eventSequence: 1,
      contentRevision: 0,
      payload: { delta: [{ text: 'hello ' }] },
      source: 'runtime-ledger' as const
    };
    const second = {
      runId: 'run-1',
      type: 'llm_delta' as const,
      eventSequence: 2,
      contentRevision: 0,
      payload: {
        delta: [{
          functionCall: {
            id: 'tool-1',
            name: 'read_file',
            args: { path: 'README.md' }
          }
        }]
      },
      source: 'runtime-ledger' as const
    };

    let buffer = enqueueRuntimeLedgerLiveDelta(undefined, second, 5);
    buffer = enqueueRuntimeLedgerLiveDelta(buffer, first, 5);
    const selected = selectReplayableRuntimeLedgerLiveDeltas(buffer, { contentRevision: 0, eventSequence: 0 });
    let contents: Content[] = [{ role: 'user' as const, index: 0, parts: [{ text: 'prompt' }] }];
    for (const event of selected.replayable) {
      contents = applyRuntimeLedgerLiveDeltaToContents(contents, event.payload, 2000, 0);
    }

    expect(selected.replayable.map(event => event.eventSequence)).toEqual([1, 2]);
    expect(contents).toHaveLength(2);
    expect(contents[1]).toMatchObject({
      role: 'model',
      index: 1,
      parts: [
        { text: 'hello ' },
        { functionCall: { id: 'tool-1', name: 'read_file', args: { path: 'README.md' } } }
      ]
    });
  });

  it('creates live-delta model content with absolute index inside nonzero content windows', () => {
    const contents: Content[] = [
      { role: 'user' as const, index: 20, parts: [{ text: 'window prompt' }] }
    ];

    const next = applyRuntimeLedgerLiveDeltaToContents(
      contents,
      { delta: [{ text: 'window response' }] },
      2000,
      20
    );

    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      role: 'model',
      index: 21,
      parts: [{ text: 'window response' }]
    });
  });
});
