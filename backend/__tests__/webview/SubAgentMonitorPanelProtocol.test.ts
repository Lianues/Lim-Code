import { SubAgentMonitorPanel, createMonitorEventPayload } from '../../../webview/SubAgentMonitorPanel';
import { WEBVIEW_CLIENT_IDS } from '../../../webview/runtime/WebviewClientRegistry';
import { subAgentRunEventBus, subAgentRunController } from '../../../backend/tools/subagents';
import * as vscode from 'vscode';
import type { Content } from '../../../backend/modules/conversation/types';

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

  it('pushes low-frequency events with manifest but without full snapshot or long response payload', () => {
    createRun('protocol-run-1', [createContent(0, '首条'), createContent(1, '尾条')]);
    const { panel, sink } = openPanel();
    sink.messages.length = 0;

    subAgentRunEventBus.emit({
      runId: 'protocol-run-1',
      agentName: 'Agent protocol-run-1',
      type: 'run_completed',
      payload: { response: 'x'.repeat(2000), steps: 1, modelVersion: 'test-model' }
    });

    const pushed = sink.messages.find(message => message.type === 'subagentMonitor.event');
    expect(pushed.data.manifest).toMatchObject({
      runId: 'protocol-run-1',
      contentCount: 2,
      contentRevision: 0,
      eventSequence: 2
    });
    expect(pushed.data.snapshot).toBeUndefined();
    expect(pushed.data.event.payload.response).toBeUndefined();
    expect(pushed.data.event.payload).toMatchObject({ steps: 1, modelVersion: 'test-model' });
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
    // 修改原因：Monitor 必须实时显示 SubAgent 输出，但不能回退到每个事件携带完整 transcript。
    // 修改方式：llm_delta 只允许轻量 text/thought/functionCall delta 通过，contentSnapshot/functionResponse/result 仍被剥离。
    // 修改目的：锁定“实时正文走轻量 delta，大对象走 window”的 docs/pm 统一协议。
    expect(llmDeltaEvent.payload).toMatchObject({
      delta: [
        { text: '实时正文' },
        { text: '思考', thought: true },
        { functionCall: { id: 'tool-1', name: 'read_file', partialArgs: '{"path"', args: { path: 'README.md' } } }
      ],
      contentCount: 1,
      usage: { candidatesTokenCount: 3 },
      modelVersion: 'm',
      contentRevision: 7,
      eventSequence: 9
    });
    expect(JSON.stringify(llmDeltaEvent.payload)).not.toContain('functionResponse');
    expect(JSON.stringify(llmDeltaEvent.payload)).not.toContain('不应透传');
    expect(JSON.stringify(llmDeltaEvent.payload)).not.toContain('contents');
  });

  it('getRunWindow returns the requested run window only', async () => {
    createRun('protocol-run-1', Array.from({ length: 4 }, (_, index) => createContent(index, `内容 ${index}`)));
    const { panel, sink } = openPanel();

    await sink.receiveHandlers[0]({
      type: 'subagents.monitor.getRunWindow',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      requestId: 'window-1',
      data: {
        runId: 'protocol-run-1',
        options: { limit: 2, fromTail: true }
      }
    });

    const response = sink.messages.find(message => message.requestId === 'window-1');
    expect(response).toMatchObject({
      type: 'response',
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      success: true,
      data: {
        window: {
          runId: 'protocol-run-1',
          startIndex: 2,
          endIndex: 4,
          totalCount: 4,
          contentRevision: 0,
          eventSequence: 1,
          hasMoreBefore: true,
          hasMoreAfter: false
        }
      }
    });
    expect(response.data.window.contents.map((content: Content) => content.parts[0].text)).toEqual(['内容 2', '内容 3']);
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
