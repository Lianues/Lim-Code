import type * as vscode from 'vscode';
import type { RunScope } from '../../backend/core/RunController';

/**
 * WebviewRuntime 边界的稳定 transport client id。
 * clientId 只描述响应要发回哪个 webview endpoint；运行语义仍由 RunScope/request data 表达。
 */
export const WEBVIEW_CLIENT_IDS = {
  mainChat: 'main-chat',
  subagentMonitor: 'subagent-monitor'
} as const;

export type KnownWebviewClientId = typeof WEBVIEW_CLIENT_IDS[keyof typeof WEBVIEW_CLIENT_IDS];
export type WebviewClientId = KnownWebviewClientId | (string & {});

export interface WebviewClientVisibility {
  visible: boolean;
  source: 'register' | 'vscode' | 'frontend' | 'dispose';
  updatedAt: number;
  sequence: number;
  reason?: string;
}

export interface WebviewClientRegistration {
  clientId: WebviewClientId;
  /** 可选 RunScope 投影。registry 只保存元数据，不基于 scope/type 写分支。 */
  runScope?: RunScope;
  webviewHost?: { webview: vscode.Webview };
  postMessage(message: Record<string, unknown>): Thenable<boolean> | Promise<boolean> | boolean;
  visibility?: WebviewClientVisibility;
}

/**
 * webview client registry 是路由响应的唯一权威表。
 * ChatViewProvider/SubAgentMonitorPanel 注册 endpoint，MessageRouter 只按 clientId 查表，避免并发请求串响应。
 */
export class WebviewClientRegistry {
  private readonly clients = new Map<WebviewClientId, WebviewClientRegistration>();
  private visibilitySequence = 0;

  register(client: WebviewClientRegistration): vscode.Disposable {
    const normalizedClientId = this.normalizeClientId(client.clientId);
    const registration: WebviewClientRegistration = {
      ...client,
      clientId: normalizedClientId,
      visibility: client.visibility ?? this.createVisibility(true, 'register')
    };

    this.clients.set(normalizedClientId, registration);

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.clients.get(normalizedClientId) === registration) {
          this.clients.delete(normalizedClientId);
        }
      }
    };
  }

  has(clientId: unknown): clientId is WebviewClientId {
    const normalized = this.tryNormalizeClientId(clientId);
    return !!normalized && this.clients.has(normalized);
  }

  get(clientId: unknown): WebviewClientRegistration | undefined {
    const normalized = this.tryNormalizeClientId(clientId);
    return normalized ? this.clients.get(normalized) : undefined;
  }

  getWebviewHost(clientId: unknown): { webview: vscode.Webview } | undefined {
    return this.get(clientId)?.webviewHost;
  }

  setVisibility(
    clientId: unknown,
    visible: boolean,
    source: WebviewClientVisibility['source'] = 'frontend',
    reason?: string
  ): boolean {
    const client = this.get(clientId);
    if (!client) {
      return false;
    }

    client.visibility = this.createVisibility(visible, source, reason);
    return true;
  }

  getVisibility(clientId: unknown): WebviewClientVisibility | undefined {
    const visibility = this.get(clientId)?.visibility;
    return visibility ? { ...visibility } : undefined;
  }

  isVisible(clientId: unknown): boolean {
    return this.get(clientId)?.visibility?.visible !== false;
  }

  resolveClientId(requestedClientId?: unknown, fallbackClientId?: unknown): WebviewClientId | undefined {
    const requested = this.tryNormalizeClientId(requestedClientId);
    const fallback = this.tryNormalizeClientId(fallbackClientId);

    if (requested && this.clients.has(requested)) {
      return requested;
    }
    if (fallback && this.clients.has(fallback)) {
      return fallback;
    }
    if (requested) {
      return requested;
    }
    if (fallback) {
      return fallback;
    }

    return this.clients.keys().next().value;
  }

  postMessage(clientId: unknown, message: Record<string, unknown>): boolean {
    const client = this.get(clientId);
    if (!client) {
      return false;
    }

    const routedMessage = {
      ...message,
      clientId: client.clientId
    };

    try {
      void Promise.resolve(client.postMessage(routedMessage)).catch(error => {
        console.error('[WebviewClientRegistry] Failed to post routed webview message:', error);
      });
      return true;
    } catch (error) {
      console.error('[WebviewClientRegistry] Failed to post routed webview message:', error);
      return false;
    }
  }

  sendResponse(clientId: unknown, requestId: string, data: unknown): boolean {
    return this.postMessage(clientId, {
      type: 'response',
      requestId,
      success: true,
      data
    });
  }

  sendError(clientId: unknown, requestId: string, code: string, message: string): boolean {
    return this.postMessage(clientId, {
      type: 'error',
      requestId,
      success: false,
      error: { code, message }
    });
  }

  private normalizeClientId(clientId: WebviewClientId): WebviewClientId {
    const normalized = String(clientId).trim();
    if (!normalized) {
      throw new Error('webview clientId must be a non-empty string');
    }
    return normalized as WebviewClientId;
  }

  private tryNormalizeClientId(clientId: unknown): WebviewClientId | undefined {
    if (typeof clientId !== 'string') {
      return undefined;
    }
    const normalized = clientId.trim();
    return normalized ? normalized as WebviewClientId : undefined;
  }

  private createVisibility(
    visible: boolean,
    source: WebviewClientVisibility['source'],
    reason?: string
  ): WebviewClientVisibility {
    return {
      visible,
      source,
      reason,
      updatedAt: Date.now(),
      sequence: ++this.visibilitySequence
    };
  }
}
