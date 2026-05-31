import {
  createPayloadPerfSample,
  createRenderWindowPerfSample,
  DEFAULT_RUNTIME_PERF_BUDGET,
  evaluateRuntimePerfSample
} from '../../../frontend/src/utils/runtimePerfBudget';
import type { Message } from '../../../frontend/src/types';

function createMessage(index: number, toolCount = 0): Message {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    timestamp: index,
    backendIndex: index,
    parts: [{ text: `message ${index}` }],
    tools: Array.from({ length: toolCount }, (_, toolIndex) => ({
      id: `tool-${index}-${toolIndex}`,
      name: 'read_file',
      args: {},
      status: 'success'
    }))
  };
}

describe('runtime perf budget samples', () => {
  it('evaluates payload, render-window, cache, and refresh samples against shared budgets', () => {
    const payload = createPayloadPerfSample('streamChunk', {
      type: 'streamChunk',
      data: {
        type: 'chunk',
        runtimeLedger: {
          ledger: {
            liveDelta: {
              payload: { delta: [{ text: 'hello' }] }
            }
          }
        }
      }
    });
    const renderWindow = createRenderWindowPerfSample(
      'main-chat-tail-window',
      Array.from({ length: 20 }, (_, index) => createMessage(index, index % 5 === 0 ? 2 : 0))
    );
    const cache = {
      name: 'subagent-monitor-retained-cache',
      retainedCacheBytes: 180 * 1024
    };
    const refresh = {
      name: 'hidden-visible-refresh',
      refreshLatencyMs: 40
    };

    for (const sample of [payload, renderWindow, cache, refresh]) {
      expect(evaluateRuntimePerfSample(sample).ok).toBe(true);
    }
  });

  it('fails closed when a sample exceeds the runtime budget', () => {
    const result = evaluateRuntimePerfSample({
      name: 'oversized-dom',
      domItems: DEFAULT_RUNTIME_PERF_BUDGET.maxDomItems + 1
    });

    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('oversized-dom');
  });
});
