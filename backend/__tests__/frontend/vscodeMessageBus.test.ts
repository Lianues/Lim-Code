type WindowMessageListener = (event: { data: unknown }) => void;

function loadVscodeUtils() {
  jest.resetModules();

  const listeners = new Set<WindowMessageListener>();
  const postMessage = jest.fn();
  const windowMock = {
    __LIMCODE_WEBVIEW_CLIENT_ID: 'main-chat',
    addEventListener: jest.fn((type: string, listener: WindowMessageListener) => {
      if (type === 'message') listeners.add(listener);
    }),
    removeEventListener: jest.fn((type: string, listener: WindowMessageListener) => {
      if (type === 'message') listeners.delete(listener);
    })
  };

  (globalThis as any).window = windowMock;
  (globalThis as any).acquireVsCodeApi = jest.fn(() => ({
    postMessage,
    getState: jest.fn(() => ({})),
    setState: jest.fn()
  }));

  const vscodeUtils = require('../../../frontend/src/utils/vscode') as typeof import('../../../frontend/src/utils/vscode');
  return { vscodeUtils, listeners, postMessage, windowMock };
}

describe('frontend vscode message bus', () => {
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).acquireVsCodeApi;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('uses one native message listener and isolates subscriber failures', () => {
    const { vscodeUtils, listeners, windowMock } = loadVscodeUtils();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const seen: unknown[] = [];

    const disposeAll = vscodeUtils.onMessageFromExtension(message => {
      seen.push(['all', message.type]);
    });
    const disposeBad = vscodeUtils.onExtensionMessageType('taskEvent', () => {
      throw new Error('subscriber failed');
    }, 'bad-subscriber');
    const disposeTask = vscodeUtils.onExtensionMessageType('taskEvent', message => {
      seen.push(['task', message.data]);
    }, 'task-subscriber');

    expect(windowMock.addEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);

    const [nativeListener] = Array.from(listeners);
    nativeListener({
      data: {
        type: 'taskEvent',
        clientId: 'other-client',
        data: { ignored: true }
      }
    });
    expect(seen).toEqual([]);

    nativeListener({
      data: {
        type: 'taskEvent',
        clientId: 'main-chat',
        data: { ok: true }
      }
    });

    expect(seen).toEqual([
      ['all', 'taskEvent'],
      ['task', { ok: true }]
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    disposeAll();
    disposeBad();
    expect(windowMock.removeEventListener).not.toHaveBeenCalled();

    disposeTask();
    expect(windowMock.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('routes request responses by clientId and requestId through the same listener', async () => {
    const { vscodeUtils, listeners, postMessage, windowMock } = loadVscodeUtils();

    const responsePromise = vscodeUtils.sendToExtension('getSettings', {});

    expect(windowMock.addEventListener).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const request = postMessage.mock.calls[0][0];
    const [nativeListener] = Array.from(listeners);

    let settled = false;
    responsePromise.then(() => {
      settled = true;
    });

    nativeListener({
      data: {
        clientId: 'other-client',
        requestId: request.requestId,
        success: true,
        data: { ignored: true }
      }
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    nativeListener({
      data: {
        clientId: 'main-chat',
        requestId: request.requestId,
        success: true,
        data: { ok: true }
      }
    });

    await expect(responsePromise).resolves.toEqual({ ok: true });
    expect(windowMock.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('uses typed range request helpers for Runtime Ledger and Monitor refs', async () => {
    const { vscodeUtils, listeners, postMessage } = loadVscodeUtils();
    const terminalPromise = vscodeUtils.loadRuntimeLedgerTerminalContentWindow('rtterm:1', {
      startBytes: 16,
      maxBytes: 64,
      includePayload: false
    });
    const monitorPromise = vscodeUtils.loadSubAgentMonitorContentTextWindow('subagent-content-text:abc:1:0:hash', {
      startBytes: 32,
      maxBytes: 96,
      includePayload: false
    });
    const terminalOutputPromise = vscodeUtils.loadTerminalOutputWindow('terminal-output:term-1:1:1:hash', {
      startBytes: 8,
      maxBytes: 40,
      includePayload: false
    });

    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      type: 'runtimeLedger.getTerminalContentWindow',
      data: {
        refId: 'rtterm:1',
        startBytes: 16,
        maxBytes: 64,
        includePayload: false
      }
    });
    expect(postMessage.mock.calls[1][0]).toMatchObject({
      type: 'subagents.monitor.getContentTextWindow',
      data: {
        refId: 'subagent-content-text:abc:1:0:hash',
        startBytes: 32,
        maxBytes: 96,
        includePayload: false
      }
    });
    expect(postMessage.mock.calls[2][0]).toMatchObject({
      type: 'terminal.getOutputWindow',
      data: {
        refId: 'terminal-output:term-1:1:1:hash',
        startBytes: 8,
        maxBytes: 40,
        includePayload: false
      }
    });

    const [nativeListener] = Array.from(listeners);
    nativeListener({
      data: {
        clientId: 'main-chat',
        requestId: postMessage.mock.calls[0][0].requestId,
        success: true,
        data: {
          ref: { refId: 'rtterm:1', kind: 'content', byteLength: 100, previewBytes: 10, truncated: true, createdAt: 1 },
          serializedWindow: 'terminal-window',
          window: { startBytes: 16, endBytes: 31, totalBytes: 100, hasMoreBefore: true, hasMoreAfter: true }
        }
      }
    });
    nativeListener({
      data: {
        clientId: 'main-chat',
        requestId: postMessage.mock.calls[1][0].requestId,
        success: true,
        data: {
          ref: { refId: 'subagent-content-text:abc:1:0:hash', runId: 'run-1', contentIndex: 1, partIndex: 0, byteLength: 200, previewBytes: 20, truncated: true },
          text: 'monitor-window',
          window: { startBytes: 32, endBytes: 46, totalBytes: 200, hasMoreBefore: true, hasMoreAfter: true }
        }
      }
    });
    nativeListener({
      data: {
        clientId: 'main-chat',
        requestId: postMessage.mock.calls[2][0].requestId,
        success: true,
        data: {
          ref: { refId: 'terminal-output:term-1:1:1:hash', terminalId: 'term-1', byteLength: 160, previewBytes: 40, truncated: true, createdAt: 2 },
          data: 'terminal-output-window',
          window: { startBytes: 8, endBytes: 30, totalBytes: 160, hasMoreBefore: true, hasMoreAfter: true }
        }
      }
    });

    await expect(terminalPromise).resolves.toMatchObject({ serializedWindow: 'terminal-window' });
    await expect(monitorPromise).resolves.toMatchObject({ text: 'monitor-window' });
    await expect(terminalOutputPromise).resolves.toMatchObject({ data: 'terminal-output-window' });
  });

  it('measures UTF-8 payload size and evaluates explicit budgets', () => {
    const { vscodeUtils } = loadVscodeUtils();
    const message = {
      type: 'dependencyProgress',
      data: { text: '汉字', repeat: 'x'.repeat(8) },
      runId: 'run-1'
    };

    expect(vscodeUtils.getUtf8ByteLength('汉字')).toBe(6);

    const measured = vscodeUtils.measureExtensionMessagePayload(message, ['data', 'runId']);
    expect(measured.envelopeBytes).toBeGreaterThan(measured.dataBytes);
    expect(measured.fieldBytes.runId).toBe(5);

    const failed = vscodeUtils.evaluateExtensionMessageBudget(message, {
      maxEnvelopeBytes: measured.envelopeBytes - 1,
      maxFieldBytes: {
        data: measured.dataBytes - 1
      }
    }, ['data', 'runId']);

    expect(failed.ok).toBe(false);
    expect(failed.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('envelopeBytes'),
      expect.stringContaining('dataBytes')
    ]));
    expect(vscodeUtils.isExtensionMessageWithinBudget(message, {
      maxEnvelopeBytes: measured.envelopeBytes,
      maxDataBytes: measured.dataBytes
    })).toBe(true);
  });

  it('records incoming message payload metrics by type', () => {
    const { vscodeUtils, listeners } = loadVscodeUtils();
    const dispose = vscodeUtils.onExtensionMessageType('terminalOutput', () => undefined, 'terminal-test');
    const [nativeListener] = Array.from(listeners);

    vscodeUtils.resetExtensionMessageMetricsForTests();
    nativeListener({
      data: {
        type: 'terminalOutput',
        clientId: 'main-chat',
        data: { output: 'line\nline' }
      }
    });

    const metric = vscodeUtils.getExtensionMessageMetricsSnapshot()
      .find(item => item.type === 'terminalOutput');
    expect(metric).toEqual(expect.objectContaining({
      type: 'terminalOutput',
      count: 1
    }));
    expect(metric!.maxEnvelopeBytes).toBeGreaterThan(0);
    expect(metric!.maxDataBytes).toBeGreaterThan(0);

    dispose();
  });
});
