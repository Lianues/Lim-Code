import { SubAgentMonitorPanel, createMonitorEventPayload } from '../../../webview/SubAgentMonitorPanel';
import { WEBVIEW_CLIENT_IDS } from '../../../webview/runtime/WebviewClientRegistry';
import { subAgentRunEventBus, subAgentRunController } from '../../../backend/tools/subagents';
import { subAgentRuntimeLedgerBridge } from '../../../backend/tools/subagents/runtimeLedgerBridge';
import { estimateJsonBytes } from '../../../frontend/src/utils/cacheLifecycleGovernor';
import * as vscode from 'vscode';
import type { Content } from '../../../backend/modules/conversation/types';

const WEBVIEW_ENVELOPE_BUDGET_BYTES = 16 * 1024;

function expectWithinWebviewBudget(message: unknown): void {
  expect(estimateJsonBytes(message)).toBeLessThanOrEqual(WEBVIEW_ENVELOPE_BUDGET_BYTES);
}

function createThenable<T>(value: T): Thenable<T> {
  return {
    then: (onfulfilled?: ((value: T) => any) | null) => {
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value) as any;
    }
  };
}

function createWebviewSink() {
  const messages: any[] = [];
  const receiveHandlers: Array<(message: any) => void> = [];
  const webview = {
    cspSource: 'vscode-webview://limcode-test',
    html: '',
    asWebviewUri: jest.fn((uri: any) => ({ toString: () => `webview:${uri.fsPath || uri.path || 'asset'}` })),
    postMessage: jest.fn((message: any) => {
      messages.push(message);
      return createThenable(true);
    }),
    onDidReceiveMessage: jest.fn((handler: (message: any) => void) => {
      receiveHandlers.push(handler);
      return { dispose: jest.fn() };
    })
  };
  return { messages, receiveHandlers, webview };
}

function createContext() {
  return {
    extensionPath: 'extension-root',
    subscriptions: [] as any[]
  } as any;
}

function createContent(index: number, text: string): Content {
  return {
    role: 'model',
    index,
    parts: [{ text }],
    timestamp: 1000 + index
  } as Content;
}

function flushRuntimeLedger(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('SubAgentMonitorPanel manifest/window protocol', () => {
  const runIds: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode as any).ViewColumn = { Beside: 2 };
    (vscode as any).Uri.file = (filePath: string) => ({ fsPath: filePath, path: filePath, scheme: 'file' });
    (vscode as any).window = {
      createWebviewPanel: jest.fn()
    };
    jest.spyOn(subAgentRunController, 'getActiveRunIds').mockReturnValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    const snapshots = (subAgentRunEventBus as any).snapshots as Map<string, unknown> | undefined;
    const stores = (subAgentRunEventBus as any).stores as Map<string, unknown> | undefined;
    for (const runId of runIds.splice(0)) {
      snapshots?.delete(runId);
      stores?.delete(runId);
    }
    subAgentRuntimeLedgerBridge.resetForTests();
  });

  function createRun(runId: string, contents: Content[]) {
    runIds.push(runId);
    subAgentRunEventBus.createRun(runId, 'Agent ' + runId, undefined, {
      conversationId: 'conversation-1',
      initialContents: contents
    });
  }

  function openPanel() {
    const sink = createWebviewSink();
    const fakePanel = {
      webview: sink.webview,
      reveal: jest.fn(),
      onDidDispose: jest.fn(),
      dispose: jest.fn()
    };
    (vscode as any).window.createWebviewPanel.mockReturnValue(fakePanel);
    const panel = new SubAgentMonitorPanel(
      createContext(),
      undefined,
      jest.fn().mockResolvedValue(false),
      jest.fn(() => ({ dispose: jest.fn() } as any))
    );
    panel.open('protocol-run-1', 'conversation-1');
    return { panel, sink };
  }

  it('monitorReady returns manifests without full snapshot contents', async () => {
    createRun('protocol-run-1', [createContent(0, '首条'), createContent(1, '尾条')]);
    const { panel, sink } = openPanel();
    await flushRuntimeLedger();

    await sink.receiveHandlers[0]({
      type: 'subagents.monitorReady',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'ready-1',
      data: {}
    });

    const response = sink.messages.find(message => message.requestId === 'ready-1');
    expect(response).toMatchObject({
      type: 'response',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      success: true
    });
    expect(response.data.manifests).toHaveLength(1);
    expect(response.data.manifests[0]).toMatchObject({
      runId: 'protocol-run-1',
      contentCount: 2,
      contentRevision: 0,
      eventSequence: 1
    });
    expect(response.data.snapshots).toBeUndefined();
    expect(response.data.manifests[0].contents).toBeUndefined();
    panel.dispose();
  });

  it('pushes low-frequency events with manifest/runtimeLedger but without full snapshot or long response payload', async () => {
    createRun('protocol-run-1', [createContent(0, '首条'), createContent(1, '尾条')]);
    const { panel, sink } = openPanel();
    sink.messages.length = 0;

    subAgentRunEventBus.emit({
      runId: 'protocol-run-1',
      agentName: 'Agent protocol-run-1',
      type: 'run_completed',
      payload: { response: 'x'.repeat(2000), steps: 1, modelVersion: 'test-model' }
    });
    await flushRuntimeLedger();

    const pushed = sink.messages.find(message => message.type === 'subagentMonitor.event');
    expect(pushed.data.manifest).toMatchObject({
      runId: 'protocol-run-1',
      contentCount: 2,
      contentRevision: 0,
      eventSequence: 2
    });
    expect(pushed.data.snapshot).toBeUndefined();
    expect(pushed.data.runtimeLedger).toMatchObject({
      status: 'ok',
      health: {
        content: 'ok',
        renderable: true
      },
      ledger: {
        eventSequence: 2,
        eventCountsByType: {
          'runtime.subagent.run_event': 2,
          'runtime.subagent.content_snapshot': 1
        }
      }
    });
    expect(pushed.data.runtimeLedger.ledger.contentWindow).toBeUndefined();
    expect(pushed.data.event.payload.response).toBeUndefined();
    expect(pushed.data.event.payload).toMatchObject({ steps: 1, modelVersion: 'test-model' });
    expectWithinWebviewBudget(pushed);
    panel.dispose();
  });

  it('keeps monitor ready, manifest, heartbeat, and window envelopes under payload budgets', async () => {
    for (let index = 0; index < 24; index++) {
      createRun(`budget-run-${index}`, [
        createContent(0, `首条 ${index}`),
        createContent(1, `尾条 ${index}`)
      ]);
    }
    createRun('protocol-run-1', Array.from({ length: 30 }, (_, index) => createContent(index, `窗口内容 ${index}`)));
    const { panel, sink } = openPanel();
    await flushRuntimeLedger();

    const heartbeat = sink.messages.find(message => message.type === 'subagentMonitor.heartbeat');
    expect(heartbeat).toBeDefined();
    expectWithinWebviewBudget(heartbeat);

    sink.messages.length = 0;
    panel.open('protocol-run-1', 'conversation-1');
    const manifest = sink.messages.find(message => message.type === 'subagentMonitor.manifest');
    expect(manifest).toBeDefined();
    expect(JSON.stringify(manifest)).not.toContain('"contents"');
    expectWithinWebviewBudget(manifest);

    await sink.receiveHandlers[0]({
      type: 'subagents.monitorReady',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'ready-budget-1',
      data: {}
    });
    const readyResponse = sink.messages.find(message => message.requestId === 'ready-budget-1');
    expect(readyResponse).toBeDefined();
    expect(JSON.stringify(readyResponse)).not.toContain('"contents"');
    expectWithinWebviewBudget(readyResponse);

    await sink.receiveHandlers[0]({
      type: 'subagents.monitor.getRunWindow',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'window-budget-1',
      data: {
        runId: 'protocol-run-1',
        options: { limit: 20, fromTail: true }
      }
    });
    await flushRuntimeLedger();
    const windowResponse = sink.messages.find(message => message.requestId === 'window-budget-1');
    expect(windowResponse).toBeDefined();
    expect(windowResponse.data.runtimeLedger.ledger.contentWindow.contents).toHaveLength(20);
    expectWithinWebviewBudget(windowResponse);
    panel.dispose();
  });

  it('sanitizes content_snapshot, run_completed and unknown large payload events for monitor transport', () => {
    const snapshot = {
      runId: 'sanitize-run',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      contents: [createContent(0, '正文 0'), createContent(1, '正文 1')],
      events: [],
      contentRevision: 7,
      eventSequence: 9
    } as any;

    const contentSnapshotEvent = createMonitorEventPayload({
      runId: 'sanitize-run',
      type: 'content_snapshot',
      timestamp: 10,
      payload: { contents: snapshot.contents, content: createContent(0, '大正文') }
    } as any, snapshot);
    const completedEvent = createMonitorEventPayload({
      runId: 'sanitize-run',
      type: 'run_completed',
      timestamp: 11,
      payload: { response: 'x'.repeat(3000), content: '正文', contents: snapshot.contents, steps: 3, modelVersion: 'm' }
    } as any, snapshot);
    const unknownEvent = createMonitorEventPayload({
      runId: 'sanitize-run',
      type: 'tool_progress',
      timestamp: 12,
      toolName: 'read_file',
      toolId: 'tool-1',
      payload: { response: '大响应', content: '大内容', result: { data: '大结果' }, data: 'base64', status: 'running', attempt: 2 }
    } as any, snapshot);
    const llmDeltaEvent = createMonitorEventPayload({
      runId: 'sanitize-run',
      type: 'llm_delta',
      timestamp: 13,
      payload: {
        delta: [
          { text: '实时正文' },
          { text: '思考', thought: true },
          { functionCall: { id: 'tool-1', name: 'read_file', partialArgs: '{"path"', args: { path: 'README.md' }, result: '不应透传' } },
          { functionResponse: { id: 'tool-1', response: { huge: true } } }
        ],
        contentSnapshot: { contents: snapshot.contents },
        usage: { candidatesTokenCount: 3 },
        done: false,
        modelVersion: 'm'
      }
    } as any, snapshot);

    // 修改原因：postEvent 的瘦身逻辑必须覆盖已知大事件和未来未知大 payload，不能只删除 run_completed.response。
    // 修改方式：直接测试导出的 createMonitorEventPayload helper，锁定 contents/response/content/data/result 等字段不会进入 transport。
    // 修改目的：新增事件时若绕过“事件只承载状态、正文走 window”原则，会在这里回归失败。
    expect(contentSnapshotEvent.payload).toEqual({ contentCount: 2, contentRevision: 7, eventSequence: 9 });
    expect((completedEvent.payload as any).response).toBeUndefined();
    expect((completedEvent.payload as any).content).toBeUndefined();
    expect((completedEvent.payload as any).contents).toBeUndefined();
    expect(completedEvent.payload).toMatchObject({ steps: 3, modelVersion: 'm' });
    expect((unknownEvent.payload as any).response).toBeUndefined();
    expect((unknownEvent.payload as any).content).toBeUndefined();
    expect((unknownEvent.payload as any).result).toBeUndefined();
    expect((unknownEvent.payload as any).data).toBeUndefined();
    expect(unknownEvent.payload).toMatchObject({ status: 'running', attempt: 2 });
    // 修改原因：Monitor 的 raw event 通道只承载控制/诊断字段，不能再成为第二条正文渲染路径。
    // 修改方式：llm_delta 的 text/thought/functionCall delta 也必须从 raw payload 剥离，正文只允许走 runtimeLedger.ledger.liveDelta。
    // 修改目的：锁定“raw event 不渲染正文，Runtime Ledger projection 才是正文 source-of-truth”的统一协议。
    expect(llmDeltaEvent.payload).toMatchObject({
      contentCount: 1,
      usage: { candidatesTokenCount: 3 },
      modelVersion: 'm',
      contentRevision: 7,
      eventSequence: 9
    });
    expect((llmDeltaEvent.payload as any).delta).toBeUndefined();
    expect(JSON.stringify(llmDeltaEvent.payload)).not.toContain('functionResponse');
    expect(JSON.stringify(llmDeltaEvent.payload)).not.toContain('实时正文');
    expect(JSON.stringify(llmDeltaEvent.payload)).not.toContain('不应透传');
    expect(JSON.stringify(llmDeltaEvent.payload)).not.toContain('contents');
  });

  it('getRunWindow returns the requested run window only', async () => {
    createRun('protocol-run-1', Array.from({ length: 4 }, (_, index) => createContent(index, `内容 ${index}`)));
    const { panel, sink } = openPanel();

    await flushRuntimeLedger();
    await sink.receiveHandlers[0]({
      type: 'subagents.monitor.getRunWindow',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'window-1',
      data: {
        runId: 'protocol-run-1',
        options: { limit: 2, fromTail: true }
      }
    });

    await flushRuntimeLedger();
    const response = sink.messages.find(message => message.requestId === 'window-1');
    expect(response).toMatchObject({
      type: 'response',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      success: true
    });
    expect(response.data.window).toBeUndefined();
    expect(response.data.runtimeLedger).toMatchObject({
      status: 'degraded',
      mismatches: ['runtimeLedgerContentWindow:pending'],
      ledger: {
        projectionStatus: 'ok',
        eventSequence: 1,
        contentRevision: 0,
        contentCount: 4,
        contentWindow: {
          runId: 'protocol-run-1',
          startIndex: 2,
          endIndex: 4,
          totalCount: 4,
          contentRevision: 0,
          eventSequence: 1,
          hasMoreBefore: true,
          hasMoreAfter: false,
          source: 'source-window'
        },
        truncated: false,
        eventCountsByType: {
          'runtime.subagent.run_event': 1
        },
        toolStatesByInvocationId: {}
      }
    });
    expect(response.data.runtimeLedger.ledger.contentWindow.contents.map((content: Content) => content.parts[0].text)).toEqual(['内容 2', '内容 3']);
    panel.dispose();
  });

  it('getRunWindow includes a healthy Runtime Ledger content window projection when coverage exists', async () => {
    createRun('protocol-run-1', []);
    subAgentRunEventBus.appendContent('protocol-run-1', createContent(0, 'ledger window text'));
    const { panel, sink } = openPanel();

    await flushRuntimeLedger();
    await sink.receiveHandlers[0]({
      type: 'subagents.monitor.getRunWindow',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'window-ledger-1',
      data: {
        runId: 'protocol-run-1',
        options: { limit: 1, fromTail: true }
      }
    });

    await flushRuntimeLedger();
    const response = sink.messages.find(message => message.requestId === 'window-ledger-1');
    expect(response.data.runtimeLedger).toMatchObject({
      status: 'ok',
      ledger: {
        contentWindow: {
          runId: 'protocol-run-1',
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
    expect(response.data.runtimeLedger.ledger.contentWindow.contents[0].parts[0].text).toBe('ledger window text');
    panel.dispose();
  });

  it('bounds oversized Monitor content text behind Runtime Ledger refs and serves explicit byte windows', async () => {
    const longText = `MONITOR-START-${'abcdef0123456789'.repeat(1000)}-MONITOR-END`;
    createRun('protocol-run-1', [createContent(0, longText)]);
    const { panel, sink } = openPanel();

    await flushRuntimeLedger();
    await sink.receiveHandlers[0]({
      type: 'subagents.monitor.getRunWindow',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'window-long-text-1',
      data: {
        runId: 'protocol-run-1',
        options: { limit: 1, fromTail: true }
      }
    });

    await flushRuntimeLedger();
    const response = sink.messages.find(message => message.requestId === 'window-long-text-1');
    const part = response.data.runtimeLedger.ledger.contentWindow.contents[0].parts[0];
    expect(JSON.stringify(response)).not.toContain(longText);
    expect(part.text).toContain('MONITOR-START-');
    expect(part.textTruncated).toBe(true);
    expect(part.runtimeLedgerTextRef).toMatchObject({
      runId: 'protocol-run-1',
      contentIndex: 0,
      partIndex: 0,
      truncated: true
    });
    expectWithinWebviewBudget(response);

    await sink.receiveHandlers[0]({
      type: 'subagents.monitor.getContentTextWindow',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'content-text-window-1',
      data: {
        refId: part.runtimeLedgerTextRef.refId,
        includePayload: true
      }
    });
    await flushRuntimeLedger();
    const fullResponse = sink.messages.find(message => message.requestId === 'content-text-window-1');
    expect(fullResponse.data.text).toBe(longText);

    await sink.receiveHandlers[0]({
      type: 'subagents.monitor.getContentTextWindow',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'content-text-window-2',
      data: {
        refId: part.runtimeLedgerTextRef.refId,
        startBytes: 0,
        maxBytes: 64,
        includePayload: false
      }
    });
    await flushRuntimeLedger();
    const rangeResponse = sink.messages.find(message => message.requestId === 'content-text-window-2');
    expect(rangeResponse.data.text).toContain('MONITOR-START-');
    expect(rangeResponse.data.window).toMatchObject({
      startBytes: 0,
      hasMoreBefore: false,
      hasMoreAfter: true
    });
    panel.dispose();
  });

  it('increments contentRevision and eventSequence when transcript changes', () => {
    createRun('protocol-run-1', [createContent(0, '旧尾条')]);
    const before = subAgentRunEventBus.getManifest('protocol-run-1');

    subAgentRunEventBus.updateLastModelContent('protocol-run-1', createContent(0, '新尾条'));
    const manifest = subAgentRunEventBus.getManifest('protocol-run-1');
    const window = subAgentRunEventBus.getContentWindow('protocol-run-1', { limit: 1, fromTail: true });

    // 修改原因：Monitor 前端依赖 contentRevision/eventSequence 判断 window 是否过期，后端所有 transcript 写入必须递增这些协议字段。
    // 修改方式：用 updateLastModelContent 模拟流式模型内容校准，验证 manifest/window 携带同一新 revision。
    // 修改目的：防止后续新增写入口绕过 revision，导致 stale delta 保护失效。
    expect(before).toMatchObject({ contentRevision: 0, eventSequence: 1 });
    expect(manifest?.contentRevision).toBe(1);
    expect(manifest?.eventSequence).toBeGreaterThan(before?.eventSequence || 0);
    expect(window).toMatchObject({ contentRevision: manifest?.contentRevision, eventSequence: manifest?.eventSequence });
    expect(window?.contents[0].parts[0].text).toBe('新尾条');
  });
});
