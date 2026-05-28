import { MessageRouter } from '../../../webview/MessageRouter';
import { WEBVIEW_CLIENT_IDS } from '../../../webview/runtime/WebviewClientRegistry';
import type { HandlerContext } from '../../../webview/types';
import { createTestRegistry } from './helpers/createTestRegistry';
import * as vscode from 'vscode';

function createThenable<T>(value: T): Thenable<T> {
  return {
    then: (onfulfilled?: ((value: T) => any) | null, _onrejected?: ((reason: any) => any) | null) => {
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value) as any;
    }
  };
}

function createWebviewSink() {
  const messages: any[] = [];
  return {
    messages,
    webview: {
      postMessage: jest.fn((message: any) => {
        messages.push(message);
        return createThenable(true);
      })
    }
  };
}

function createRouter() {
  const fallbackResponses: any[] = [];
  const fallbackErrors: any[] = [];
  const router = new MessageRouter(
    {} as any,
    {} as any,
    {} as any,
    () => undefined,
    (requestId, data) => fallbackResponses.push({ requestId, data }),
    (requestId, code, message) => fallbackErrors.push({ requestId, code, message }),
    createTestRegistry()
  );

  return { router, fallbackResponses, fallbackErrors };
}

function createContext(clientId?: string): HandlerContext {
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

describe('WP23 MessageRouter client-aware routing', () => {
  beforeEach(() => {
    (vscode as any).window = {
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showErrorMessage: jest.fn()
    };
  });

  it("routes a Main Chat request back with clientId='main-chat' and the same requestId", async () => {
    const { router, fallbackResponses } = createRouter();
    const main = createWebviewSink();
    router.registerClient({
      clientId: WEBVIEW_CLIENT_IDS.mainChat,
      runScope: { type: 'conversation', conversationId: 'conversation-1' },
      webviewHost: main as any,
      postMessage: message => main.webview.postMessage(message)
    });

    const handled = await router.route(
      'showNotification',
      { message: 'hello', type: 'info' },
      'main-request-1',
      createContext(WEBVIEW_CLIENT_IDS.mainChat),
      WEBVIEW_CLIENT_IDS.mainChat
    );

    expect(handled).toBe(true);
    expect(main.messages).toEqual([
      {
        type: 'response',
        clientId: WEBVIEW_CLIENT_IDS.mainChat,
        requestId: 'main-request-1',
        success: true,
        data: { success: true }
      }
    ]);
    expect(fallbackResponses).toEqual([]);
  });

  it("routes a SubAgent Monitor request only to clientId='subagent-monitor' without leaking to Main Chat", async () => {
    const { router } = createRouter();
    const main = createWebviewSink();
    const monitor = createWebviewSink();
    router.registerClient({ clientId: WEBVIEW_CLIENT_IDS.mainChat, postMessage: message => main.webview.postMessage(message) });
    router.registerClient({ clientId: WEBVIEW_CLIENT_IDS.subagentMonitor, postMessage: message => monitor.webview.postMessage(message) });

    const handled = await router.route(
      'showNotification',
      { message: 'monitor only', type: 'info' },
      'monitor-request-1',
      createContext(WEBVIEW_CLIENT_IDS.subagentMonitor),
      WEBVIEW_CLIENT_IDS.subagentMonitor
    );

    expect(handled).toBe(true);
    expect(main.messages).toEqual([]);
    expect(monitor.messages).toEqual([
      expect.objectContaining({
        type: 'response',
        clientId: WEBVIEW_CLIENT_IDS.subagentMonitor,
        requestId: 'monitor-request-1',
        success: true
      })
    ]);
  });

  it('keeps concurrent responses isolated when Main Chat and Monitor use the same shared router', async () => {
    const { router } = createRouter();
    const main = createWebviewSink();
    const monitor = createWebviewSink();
    router.registerClient({ clientId: WEBVIEW_CLIENT_IDS.mainChat, postMessage: message => main.webview.postMessage(message) });
    router.registerClient({ clientId: WEBVIEW_CLIENT_IDS.subagentMonitor, postMessage: message => monitor.webview.postMessage(message) });

    await Promise.all([
      router.route('showNotification', { message: 'from main', type: 'info' }, 'shared-request-main', createContext(WEBVIEW_CLIENT_IDS.mainChat), WEBVIEW_CLIENT_IDS.mainChat),
      router.route('showNotification', { message: 'from monitor', type: 'warning' }, 'shared-request-monitor', createContext(WEBVIEW_CLIENT_IDS.subagentMonitor), WEBVIEW_CLIENT_IDS.subagentMonitor)
    ]);

    expect(main.messages).toHaveLength(1);
    expect(monitor.messages).toHaveLength(1);
    expect(main.messages[0]).toMatchObject({ clientId: WEBVIEW_CLIENT_IDS.mainChat, requestId: 'shared-request-main' });
    expect(monitor.messages[0]).toMatchObject({ clientId: WEBVIEW_CLIENT_IDS.subagentMonitor, requestId: 'shared-request-monitor' });
  });

  it('keeps legacy messages without clientId working through the original response callback', async () => {
    const { router, fallbackResponses } = createRouter();

    const legacyContext = {
      ...createContext(),
      sendResponse: (requestId: string, data: any) => fallbackResponses.push({ requestId, data })
    };

    const handled = await router.route(
      'showNotification',
      { message: 'legacy request', type: 'info' },
      'legacy-request-1',
      legacyContext
    );

    expect(handled).toBe(true);
    expect(fallbackResponses).toEqual([
      { requestId: 'legacy-request-1', data: { success: true } }
    ]);
  });
});
