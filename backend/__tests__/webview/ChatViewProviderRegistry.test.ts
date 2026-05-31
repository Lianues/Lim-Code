import { ChatViewProvider } from '../../../webview/ChatViewProvider';
import { SubAgentMonitorPanel } from '../../../webview/SubAgentMonitorPanel';
import { MessageRouter } from '../../../webview/MessageRouter';
import { WEBVIEW_CLIENT_IDS, type WebviewClientRegistry } from '../../../webview/runtime/WebviewClientRegistry';
import type { HandlerContext } from '../../../webview/types';
import { createTestRegistry } from './helpers/createTestRegistry';
import * as vscode from 'vscode';
import { createSkillsManager } from '../../../backend/modules/skills';
import * as path from 'path';
import { estimateJsonBytes } from '../../../frontend/src/utils/cacheLifecycleGovernor';

jest.mock('../../../webview/handlers', () => ({
  createMessageHandlerRegistry: () => {
    const handlers = new Map<string, (data: any, requestId: string, ctx: HandlerContext) => Promise<void>>();
    handlers.set('showNotification', async (_data, requestId, ctx) => {
      ctx.sendResponse(requestId, { success: true });
    });
    return handlers;
  }
}));

jest.mock('../../../webview/stream', () => ({
  StreamAbortManager: jest.fn().mockImplementation(() => ({
    cancelAll: jest.fn()
  })),
  StreamRequestHandler: jest.fn().mockImplementation(() => ({
    cancelAllStreams: jest.fn().mockResolvedValue(undefined),
    handleChatStream: jest.fn().mockResolvedValue(undefined),
    handleRetryStream: jest.fn().mockResolvedValue(undefined),
    handleEditAndRetryStream: jest.fn().mockResolvedValue(undefined),
    handleToolConfirmationStream: jest.fn().mockResolvedValue(undefined),
    cancelStream: jest.fn().mockResolvedValue(undefined),
    flushHiddenStreamTransports: jest.fn()
  }))
}));

jest.mock('../../../backend/i18n', () => ({
  t: (key: string) => key,
  setLanguage: jest.fn()
}));

jest.mock('../../../backend/modules/conversation', () => ({
  ConversationManager: jest.fn().mockImplementation(() => ({})),
  FileSystemStorageAdapter: jest.fn().mockImplementation(() => ({
    migrateLegacyConversationsToSegmented: jest.fn().mockResolvedValue({ migrated: 0, skipped: 0, failed: [] })
  })),
  DiffStorageManager: {
    initialize: jest.fn(() => ({}))
  }
}));

jest.mock('../../../backend/modules/config', () => ({
  ConfigManager: jest.fn().mockImplementation(() => ({
    getConfig: jest.fn().mockResolvedValue({ id: 'gemini-pro' })
  })),
  MementoStorageAdapter: jest.fn()
}));

jest.mock('../../../backend/modules/channel', () => ({
  ChannelManager: jest.fn().mockImplementation(() => ({
    setRetryStatusCallback: jest.fn(),
    setMcpManager: jest.fn()
  }))
}));

jest.mock('../../../backend/modules/api/chat', () => ({
  ChatHandler: jest.fn().mockImplementation(() => ({
    setCheckpointManager: jest.fn(),
    setSettingsManager: jest.fn(),
    setDiffStorageManager: jest.fn(),
    setMcpManager: jest.fn(),
    getToolExecutionService: jest.fn(() => ({}))
  }))
}));

jest.mock('../../../backend/modules/api/models', () => ({
  ModelsHandler: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../../../backend/modules/settings', () => ({
  SettingsManager: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    addChangeListener: jest.fn(),
    removeChangeListener: jest.fn(),
    getApplyDiffConfig: jest.fn(() => ({})),
    getSettings: jest.fn(() => ({ ui: { language: 'zh-CN' } })),
    getSkillsConfig: jest.fn(() => ({ skills: [] }))
  })),
  VSCodeSettingsStorage: jest.fn(),
  StoragePathManager: jest.fn().mockImplementation(() => ({
    ensureDirectories: jest.fn().mockResolvedValue(undefined),
    getEffectiveDataUri: jest.fn(() => ({ fsPath: 'global-storage', toString: () => 'global-storage' })),
    getEffectiveDataPath: jest.fn(() => 'global-storage'),
    getMcpPath: jest.fn(() => 'global-storage/mcp'),
    getDependenciesPath: jest.fn(() => 'global-storage/dependencies')
  }))
}));

jest.mock('../../../backend/modules/api/settings', () => ({
  SettingsHandler: jest.fn().mockImplementation(() => ({
    setConversationManager: jest.fn()
  }))
}));

jest.mock('../../../backend/modules/checkpoint', () => ({
  CheckpointManager: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../../../backend/modules/mcp', () => ({
  McpManager: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn()
  })),
  VSCodeFileSystemMcpStorageAdapter: jest.fn()
}));

jest.mock('../../../backend/modules/dependencies', () => ({
  DependencyManager: {
    getInstance: jest.fn(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      isInstalledSync: jest.fn(() => true),
      onProgress: jest.fn(() => jest.fn())
    }))
  }
}));

jest.mock('../../../backend/modules/skills', () => ({
  createSkillsManager: jest.fn().mockResolvedValue(undefined),
  getSkillsManager: jest.fn(() => ({
    getAllSkills: jest.fn(() => []),
    enableSkill: jest.fn(),
    disableSkill: jest.fn(),
    dispose: jest.fn()
  }))
}));

jest.mock('../../../backend/core/settingsContext', () => ({
  setGlobalSettingsManager: jest.fn(),
  setGlobalConfigManager: jest.fn(),
  setGlobalChannelManager: jest.fn(),
  setGlobalToolRegistry: jest.fn(),
  setGlobalDiffStorageManager: jest.fn(),
  setGlobalMcpManager: jest.fn()
}));

jest.mock('../../../backend/tools', () => ({
  toolRegistry: { setDependencyChecker: jest.fn() },
  registerAllTools: jest.fn(),
  onTerminalOutput: jest.fn(() => jest.fn()),
  onImageGenOutput: jest.fn(() => jest.fn()),
  TaskManager: {
    onTaskEvent: jest.fn(() => jest.fn()),
    cancelAllTasks: jest.fn()
  },
  setSubAgentExecutorContext: jest.fn()
}));

jest.mock('../../../backend/tools/file/diffManager', () => ({
  getDiffManager: jest.fn(() => ({
    rejectAll: jest.fn().mockResolvedValue(undefined),
    addStatusListener: jest.fn(),
    removeStatusListener: jest.fn(),
    getPendingDiffs: jest.fn(() => []),
    areAllProcessed: jest.fn(() => true),
    refreshAutoSaveTimers: jest.fn()
  }))
}));

jest.mock('../../../backend/modules/notifications/WindowsAgentStopNotificationService', () => ({
  WindowsAgentStopNotificationService: jest.fn().mockImplementation(() => ({
    dispose: jest.fn()
  }))
}));

jest.mock('../../../webview/handlers/SubAgentsHandlers', () => ({
  initializeSubAgentsFromSettings: jest.fn()
}));

jest.mock('../../../backend/tools/subagents', () => ({
  subAgentRunController: {
    getActiveRunIds: jest.fn(() => [])
  },
  subAgentRunEventBus: {
    subscribe: jest.fn(() => jest.fn()),
    getSnapshots: jest.fn(() => []),
    // 为什么要改：SubAgentMonitorPanel 心跳现在读取 manifests；测试 mock 缺少该方法会让注册表生命周期测试在打开 monitor 时误报 TypeError。
    // 怎么改：补齐与真实 event bus 兼容的 getManifests 空数组实现。
    // 目的：让本测试继续聚焦 webview 注册/路由行为，而不是被无关的 subagent manifest mock 缺口打断。
    getManifests: jest.fn(() => [])
  }
}));

function createThenable<T>(value: T): Thenable<T> {
  return {
    then: (onfulfilled?: ((value: T) => any) | null, _onrejected?: ((reason: any) => any) | null) => {
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value) as any;
    }
  };
}

function createWebviewSink() {
  const messages: any[] = [];
  const receiveHandlers: Array<(message: any) => void> = [];
  const webview = {
    cspSource: 'vscode-webview://limcode-test',
    options: {},
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

function createFakeWebviewView() {
  const sink = createWebviewSink();
  return {
    ...sink,
    view: { webview: sink.webview } as any
  };
}

function createContext() {
  return {
    extensionPath: 'extension-root',
    extensionMode: (vscode as any).ExtensionMode.Production,
    globalStorageUri: { fsPath: 'global-storage', toString: () => 'global-storage' },
    globalState: {},
    subscriptions: [] as any[]
  } as any;
}

function createRouterWithRegistry(registry: WebviewClientRegistry) {
  const fallbackResponses: any[] = [];
  const fallbackErrors: any[] = [];
  const router = new MessageRouter(
    {} as any,
    {} as any,
    {} as any,
    () => undefined,
    (requestId, data) => fallbackResponses.push({ requestId, data }),
    (requestId, code, message) => fallbackErrors.push({ requestId, code, message }),
    registry
  );

  return { router, fallbackResponses, fallbackErrors };
}

function createHandlerContext(clientId?: string): HandlerContext {
  return {
    clientId,
    configManager: {} as any,
    channelManager: {} as any,
    conversationManager: {} as any,
    settingsManager: {} as any,
    settingsHandler: {} as any,
    mcpManager: {} as any,
    dependencyManager: {} as any,
    storagePathManager: {} as any,
    diffStorageManager: {} as any,
    streamAbortControllers: new Map() as any,
    diffPreviewProvider: {} as any,
    sendResponse: jest.fn(),
    sendError: jest.fn()
  };
}

describe('WP23 runtime registry lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode as any).ExtensionMode = { Development: 1, Test: 2, Production: 3 };
    (vscode as any).ViewColumn = { Beside: 2 };
    (vscode as any).EventEmitter = jest.fn().mockImplementation(() => ({
      event: jest.fn(),
      fire: jest.fn(),
      dispose: jest.fn()
    }));
    (vscode as any).workspace.workspaceFolders = [];
    (vscode as any).workspace.registerTextDocumentContentProvider = jest.fn(() => ({ dispose: jest.fn() }));
    (vscode as any).workspace.fs.stat = jest.fn().mockResolvedValue({ type: (vscode as any).FileType.File });
    (vscode as any).workspace.fs.createDirectory = jest.fn().mockResolvedValue(undefined);
    (vscode as any).Uri.joinPath = jest.fn((base: any, ...segments: string[]) => ({
      fsPath: [base?.fsPath || base?.path || '', ...segments].join('/'),
      path: [base?.path || base?.fsPath || '', ...segments].join('/'),
      scheme: 'file'
    }));
    (vscode as any).window = {
      createWebviewPanel: jest.fn(),
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showErrorMessage: jest.fn()
    };
  });

  it('constructs dependencies like activation and registers main-chat during resolveWebviewView without TypeError', async () => {
    const context = createContext();
    const provider = new ChatViewProvider(context);
    const fakeView = createFakeWebviewView();

    expect(() => provider.resolveWebviewView(fakeView.view, {} as any, {} as any)).not.toThrow();
    await (provider as any).initPromise;

    const providerInternals = provider as any;
    expect(providerInternals.webviewClientRegistry.has(WEBVIEW_CLIENT_IDS.mainChat)).toBe(true);
    expect(providerInternals.webviewClientRegistry.getWebviewHost(WEBVIEW_CLIENT_IDS.mainChat)?.webview).toBe(fakeView.webview);
    expect(fakeView.webview.html).toContain('LimCode Chat');
    // 为什么要改：builtin Skill 不能在 SkillsManager 内硬编码路径，必须由 VS Code 宿主把插件资源目录传入。
    // 怎么改：测试初始化参数包含 resources/skills 路径，防止未来重构遗漏 builtin 扫描根。
    // 目的：确保安装后的 read_skill 能发现插件随包发布的内置 Skill。
    expect(createSkillsManager).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: undefined,
      globalStoragePath: 'global-storage',
      builtinSkillsPath: path.join('extension-root', 'resources', 'skills')
    }));
  });

  it('registers subagent-monitor when SubAgentMonitorPanel opens its webview panel', () => {
    const context = createContext();
    const registry = createTestRegistry();
    const panelSink = createWebviewSink();
    const fakePanel = {
      webview: panelSink.webview,
      reveal: jest.fn(),
      onDidDispose: jest.fn(),
      dispose: jest.fn()
    };
    (vscode as any).window.createWebviewPanel.mockReturnValue(fakePanel);

    const monitorPanel = new SubAgentMonitorPanel(
      context,
      undefined,
      jest.fn().mockResolvedValue(true),
      (clientId, webview, runScope) => registry.register({
        clientId,
        runScope,
        webviewHost: { webview },
        postMessage: message => webview.postMessage(message)
      })
    );

    expect(() => monitorPanel.open('run-1', 'conversation-1')).not.toThrow();

    expect(registry.has(WEBVIEW_CLIENT_IDS.subagentMonitor)).toBe(true);
    expect(registry.getWebviewHost(WEBVIEW_CLIENT_IDS.subagentMonitor)?.webview).toBe(panelSink.webview);
    expect(panelSink.webview.html).toContain("__LIMCODE_VIEW_MODE = 'subagentMonitor'");
    // 为什么要改：SubAgentMonitorPanel.open 会启动 heartbeat timer；测试不释放会让 Jest 在用例通过后仍保持 open handle。
    // 怎么改：断言完成后显式 dispose monitor panel。
    // 目的：让测试既覆盖注册行为，又不会因为后台心跳定时器导致全量测试超时或被强制 kill。
    monitorPanel.dispose();
  });

  it('keeps main-chat and subagent-monitor registered after sequential resolves and routes envelopes to the correct webview', async () => {
    const registry = createTestRegistry();
    const { router, fallbackResponses } = createRouterWithRegistry(registry);
    const main = createWebviewSink();
    const monitor = createWebviewSink();

    registry.register({
      clientId: WEBVIEW_CLIENT_IDS.mainChat,
      runScope: { type: 'conversation', conversationId: 'main-chat' },
      webviewHost: { webview: main.webview as any },
      postMessage: message => main.webview.postMessage(message)
    });
    registry.register({
      clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
      runScope: { type: 'subagent', runId: 'run-1', parentConversationId: 'conversation-1' },
      webviewHost: { webview: monitor.webview as any },
      postMessage: message => monitor.webview.postMessage(message)
    });

    expect(registry.has(WEBVIEW_CLIENT_IDS.mainChat)).toBe(true);
    expect(registry.has(WEBVIEW_CLIENT_IDS.subagentMonitor)).toBe(true);

    await router.route(
      'showNotification',
      { message: 'main', type: 'info' },
      'main-request-1',
      createHandlerContext(WEBVIEW_CLIENT_IDS.mainChat),
      WEBVIEW_CLIENT_IDS.mainChat
    );
    await router.route(
      'showNotification',
      { message: 'monitor', type: 'info' },
      'monitor-request-1',
      createHandlerContext(WEBVIEW_CLIENT_IDS.subagentMonitor),
      WEBVIEW_CLIENT_IDS.subagentMonitor
    );

    expect(main.messages).toEqual([
      expect.objectContaining({
        type: 'response',
        clientId: WEBVIEW_CLIENT_IDS.mainChat,
        requestId: 'main-request-1',
        success: true
      })
    ]);
    expect(monitor.messages).toEqual([
      expect.objectContaining({
        type: 'response',
        clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
        requestId: 'monitor-request-1',
        success: true
      })
    ]);
    expect(fallbackResponses).toEqual([]);
  });

  it('coalesces main-chat direct pushes while hidden and flushes the latest event when visible', async () => {
    const context = createContext();
    const provider = new ChatViewProvider(context);
    const fakeView = createFakeWebviewView();

    provider.resolveWebviewView(fakeView.view, {} as any, {} as any);
    await (provider as any).initPromise;

    const internals = provider as any;
    internals.updateWebviewVisibility(WEBVIEW_CLIENT_IDS.mainChat, false, 'frontend', 'test-hidden');

    internals.handleTaskEvent({ taskId: 'task-1', type: 'progress', createdAt: 1 });
    internals.handleTaskEvent({ taskId: 'task-1', type: 'complete', createdAt: 2 });

    expect(fakeView.messages).toEqual([]);

    internals.updateWebviewVisibility(WEBVIEW_CLIENT_IDS.mainChat, true, 'frontend', 'test-visible');

    expect(fakeView.messages).toEqual([
      expect.objectContaining({
        type: 'webview.hiddenDeliverySummary',
        clientId: WEBVIEW_CLIENT_IDS.mainChat,
        data: expect.objectContaining({
          originalType: 'taskEvent',
          coalescedCount: 2
        })
      }),
      expect.objectContaining({
        type: 'taskEvent',
        clientId: WEBVIEW_CLIENT_IDS.mainChat,
        data: expect.objectContaining({
          taskId: 'task-1',
          type: 'complete',
          createdAt: 2
        })
      })
    ]);
  });

  it('keeps main-chat direct-push envelope matrix under payload budgets', async () => {
    const context = createContext();
    const provider = new ChatViewProvider(context);
    const fakeView = createFakeWebviewView();

    provider.resolveWebviewView(fakeView.view, {} as any, {} as any);
    await (provider as any).initPromise;

    const internals = provider as any;
    internals.handleTerminalOutputEvent({
      terminalId: 'terminal-1',
      type: 'output',
      data: `START-${'0123456789'.repeat(1600)}-END`
    });
    internals.handleImageGenOutputEvent({
      toolId: 'image-1',
      type: 'progress',
      data: { message: 'rendering', progress: 50 }
    });
    internals.handleTaskEvent({
      taskId: 'task-1',
      taskType: 'terminal',
      type: 'progress',
      createdAt: 1,
      data: { message: 'running' }
    });
    internals.handleDependencyProgressEvent({
      dependency: 'node',
      status: 'installing',
      message: 'installing'
    });
    internals.handleRetryStatus({
      type: 'retrying',
      conversationId: 'conversation-1',
      attempt: 1,
      maxAttempts: 3,
      nextRetryIn: 1000,
      createdAt: 2
    });

    const byType = new Map(fakeView.messages.map(message => [message.type, message]));
    for (const type of ['terminalOutput', 'imageGenOutput', 'taskEvent', 'dependencyProgress', 'retryStatus']) {
      expect(byType.has(type)).toBe(true);
      expect(estimateJsonBytes(byType.get(type))).toBeLessThanOrEqual(16 * 1024);
    }
    expect(JSON.stringify(byType.get('terminalOutput'))).not.toContain('0123456789'.repeat(1600));
    expect(byType.get('terminalOutput').data.dataRef).toBeDefined();
  });
});
