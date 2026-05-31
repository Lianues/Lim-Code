import {
  getFunctionResponseMap,
  MonitorMessageProjectionCache
} from '../../../frontend/src/components/subagents/monitorMessageProjectionCache';
import type { Content } from '../../../frontend/src/types';

function modelContent(index: number, text: string): Content {
  return {
    role: 'model',
    index,
    parts: [{ text }],
    timestamp: 1000 + index
  } as Content;
}

function toolCallContent(index: number, id: string): Content {
  return {
    role: 'model',
    index,
    parts: [{ functionCall: { id, name: 'read_file', args: { path: 'a.txt' } } }],
    timestamp: 1000 + index
  } as Content;
}

function functionResponseContent(index: number, id: string, response: Record<string, unknown>): Content {
  return {
    role: 'user',
    index,
    isFunctionResponse: true,
    parts: [{ functionResponse: { id, name: 'read_file', response } }],
    timestamp: 1000 + index
  } as Content;
}

describe('MonitorMessageProjectionCache', () => {
  it('preserves visible tail message identity when older contents are prepended', () => {
    const cache = new MonitorMessageProjectionCache();
    const tail2 = modelContent(2, 'tail 2');
    const tail3 = modelContent(3, 'tail 3');
    const emptyResponses = new Map();

    const first = [
      cache.project({ runId: 'run-1', content: tail2, contentIndex: 2, responseMap: emptyResponses, isLiveTail: false }),
      cache.project({ runId: 'run-1', content: tail3, contentIndex: 3, responseMap: emptyResponses, isLiveTail: true })
    ];
    const afterPrepend = [
      cache.project({ runId: 'run-1', content: modelContent(0, 'older 0'), contentIndex: 0, responseMap: emptyResponses, isLiveTail: false }),
      cache.project({ runId: 'run-1', content: modelContent(1, 'older 1'), contentIndex: 1, responseMap: emptyResponses, isLiveTail: false }),
      cache.project({ runId: 'run-1', content: tail2, contentIndex: 2, responseMap: emptyResponses, isLiveTail: false }),
      cache.project({ runId: 'run-1', content: tail3, contentIndex: 3, responseMap: emptyResponses, isLiveTail: true })
    ];

    expect(afterPrepend[2]).toBe(first[0]);
    expect(afterPrepend[3]).toBe(first[1]);
    expect(afterPrepend[3].streaming).toBe(true);
  });

  it('rebuilds only the affected tool message when its functionResponse projection changes', () => {
    const cache = new MonitorMessageProjectionCache();
    const call = toolCallContent(1, 'call-1');
    const stable = modelContent(2, 'stable tail');
    const firstResponse = functionResponseContent(3, 'call-1', { success: true });
    const secondResponse = functionResponseContent(3, 'call-1', { success: false, error: 'boom' });

    const firstMap = getFunctionResponseMap([call, stable, firstResponse]);
    const firstToolMessage = cache.project({ runId: 'run-2', content: call, contentIndex: 1, responseMap: firstMap, isLiveTail: false });
    const firstStableMessage = cache.project({ runId: 'run-2', content: stable, contentIndex: 2, responseMap: firstMap, isLiveTail: true });

    const secondMap = getFunctionResponseMap([call, stable, secondResponse]);
    const secondToolMessage = cache.project({ runId: 'run-2', content: call, contentIndex: 1, responseMap: secondMap, isLiveTail: false });
    const secondStableMessage = cache.project({ runId: 'run-2', content: stable, contentIndex: 2, responseMap: secondMap, isLiveTail: true });

    expect(secondToolMessage).not.toBe(firstToolMessage);
    expect(secondToolMessage.tools?.[0]).toMatchObject({
      id: 'call-1',
      status: 'error',
      result: { success: false, error: 'boom' }
    });
    expect(secondStableMessage).toBe(firstStableMessage);
  });

  it('prunes entries outside the retained run window', () => {
    const cache = new MonitorMessageProjectionCache();
    const emptyResponses = new Map();
    cache.project({ runId: 'run-3', content: modelContent(0, 'old'), contentIndex: 0, responseMap: emptyResponses, isLiveTail: false });
    cache.project({ runId: 'run-3', content: modelContent(1, 'kept'), contentIndex: 1, responseMap: emptyResponses, isLiveTail: false });

    expect(cache.pruneRun('run-3', new Set([1]))).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it('supports lifecycle-governor entry budgets and byte diagnostics', () => {
    const cache = new MonitorMessageProjectionCache();
    const emptyResponses = new Map();
    cache.project({ runId: 'run-4', content: modelContent(0, 'old'), contentIndex: 0, responseMap: emptyResponses, isLiveTail: false });
    cache.project({ runId: 'run-4', content: modelContent(1, 'middle'), contentIndex: 1, responseMap: emptyResponses, isLiveTail: false });
    cache.project({ runId: 'run-4', content: modelContent(2, 'tail'), contentIndex: 2, responseMap: emptyResponses, isLiveTail: false });

    expect(cache.estimateBytes()).toBeGreaterThan(0);
    expect(cache.pruneToMaxEntries(2)).toBe(1);
    expect(cache.size()).toBe(2);
  });
});
