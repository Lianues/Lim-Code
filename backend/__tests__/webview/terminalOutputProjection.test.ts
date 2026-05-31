import { TerminalOutputProjectionStore } from '../../../webview/terminalOutputProjection';
import { estimateJsonBytes } from '../../../frontend/src/utils/cacheLifecycleGovernor';

describe('TerminalOutputProjectionStore', () => {
  it('passes through small terminal output events', () => {
    const store = new TerminalOutputProjectionStore();
    const projected = store.project({
      terminalId: 'term-1',
      type: 'output',
      data: 'small output'
    });

    expect(projected).toMatchObject({
      terminalId: 'term-1',
      type: 'output',
      data: 'small output'
    });
    expect(projected.dataRef).toBeUndefined();
  });

  it('bounds large terminal output events and serves full/ranged output by ref', () => {
    const store = new TerminalOutputProjectionStore();
    const large = `BEGIN-${'0123456789'.repeat(1000)}-END`;
    const projected = store.project({
      terminalId: 'term-large',
      type: 'output',
      data: large
    });

    expect(projected.data).not.toBe(large);
    expect(projected.data).toContain('Terminal output preview truncated');
    expect(projected.dataRef).toMatchObject({
      terminalId: 'term-large',
      truncated: true
    });
    expect(estimateJsonBytes({ type: 'terminalOutput', data: projected })).toBeLessThanOrEqual(16 * 1024);

    const full = store.getWindow(projected.dataRef!.refId);
    expect(full?.data).toBe(large);

    const range = store.getWindow(projected.dataRef!.refId, {
      startBytes: 0,
      maxBytes: 80,
      includePayload: false
    });
    expect(range?.data).toContain('BEGIN-');
    expect(range?.window.hasMoreAfter).toBe(true);
  });
});
