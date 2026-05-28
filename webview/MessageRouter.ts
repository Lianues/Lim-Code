/**
 * 消息路由器
 * 
 * 负责将前端消息路由到正确的处理器
 */

import type { HandlerContext, MessageHandlerRegistry } from './types';
import { createMessageHandlerRegistry } from './handlers';
import { StreamRequestHandler, StreamAbortManager } from './stream';
import type { ChatHandler } from '../backend/modules/api/chat';
import type { ConversationManager } from '../backend/modules/conversation/ConversationManager';
import type { SettingsManager } from '../backend/modules/settings/SettingsManager';
import { WebviewClientRegistry, type WebviewClientId, type WebviewClientRegistration } from './runtime/WebviewClientRegistry';
import type * as vscode from 'vscode';

/**
 * 流式消息类型
 */
const STREAM_MESSAGE_TYPES = [
  'chatStream',
  'retryStream',
  'editAndRetryStream',
  'toolConfirmation',
  'cancelStream'
] as const;

type StreamMessageType = typeof STREAM_MESSAGE_TYPES[number];

/**
 * 消息路由器
 */
export class MessageRouter {
  private registry: MessageHandlerRegistry;
  private streamHandler: StreamRequestHandler;
  private abortManager: StreamAbortManager;
  private clientRegistry: WebviewClientRegistry;
  private requestClients = new Map<string, WebviewClientId>();

  constructor(
    private chatHandler: ChatHandler,
    private conversationManager: ConversationManager,
    private settingsManager: SettingsManager,
    private getView: () => vscode.WebviewView | undefined,
    private sendResponse: (requestId: string, data: any) => void,
    private sendError: (requestId: string, code: string, message: string) => void,
    clientRegistry: WebviewClientRegistry
  ) {
    this.clientRegistry = clientRegistry;
    // 创建处理器注册表
    this.registry = createMessageHandlerRegistry();
    
    // 创建流式处理器
    this.abortManager = new StreamAbortManager();
    this.streamHandler = new StreamRequestHandler({
      chatHandler: this.chatHandler,
      abortManager: this.abortManager,
      conversationManager: this.conversationManager,
      getView: this.getView,
      sendResponse: (requestId, data) => this.sendRoutedResponse(requestId, data),
      sendError: (requestId, code, message) => this.sendRoutedError(requestId, code, message),
      settingsManager: this.settingsManager
    });
  }

  /** 注册可接收响应的 webview client；router 只转交给 registry，不写 view 类型特判。 */
  registerClient(client: WebviewClientRegistration): vscode.Disposable {
    return this.clientRegistry.register(client);
  }

  postMessageToClient(clientId: string, message: Record<string, unknown>): boolean {
    return this.clientRegistry.postMessage(clientId, message);
  }

  /**
   * 路由消息到正确的处理器
   * 
   * @returns true 如果消息已处理，false 如果需要回退到原有处理
   */
  async route(type: string, data: any, requestId: string, ctx: HandlerContext, clientId?: string): Promise<boolean> {
    const resolvedClientId = this.clientRegistry.resolveClientId(clientId, ctx.clientId);
    if (requestId && resolvedClientId) {
      this.requestClients.set(requestId, resolvedClientId);
    }

    const routedCtx = this.createRoutedContext(ctx, resolvedClientId);

    // 检查是否是流式消息
    if (this.isStreamMessage(type)) {
      await this.handleStreamMessage(type as StreamMessageType, data, requestId);
      return true;
    }

    // 检查注册表中是否有处理器
    const handler = this.registry.get(type);
    if (handler) {
      await handler(data, requestId, routedCtx);
      return true;
    }

    // 未找到处理器，返回 false 表示需要回退
    return false;
  }

  private createRoutedContext(ctx: HandlerContext, clientId?: WebviewClientId): HandlerContext {
    if (!clientId) {
      return ctx;
    }

    return {
      ...ctx,
      clientId,
      view: ctx.view,
      sendResponse: (requestId, data) => {
        if (!this.clientRegistry.sendResponse(clientId, requestId, data)) {
          ctx.sendResponse(requestId, data);
        }
        this.requestClients.delete(requestId);
      },
      sendError: (requestId, code, message) => {
        if (!this.clientRegistry.sendError(clientId, requestId, code, message)) {
          ctx.sendError(requestId, code, message);
        }
        this.requestClients.delete(requestId);
      },
      postMessage: (message: any) => {
        if (!this.clientRegistry.postMessage(clientId, message)) {
          ctx.postMessage?.(message);
        }
      }
    };
  }

  private sendRoutedResponse(requestId: string, data: any): void {
    const clientId = this.requestClients.get(requestId);
    if (clientId && this.clientRegistry.sendResponse(clientId, requestId, data)) {
      this.requestClients.delete(requestId);
      return;
    }

    this.sendResponse(requestId, data);
  }

  private sendRoutedError(requestId: string, code: string, message: string): void {
    const clientId = this.requestClients.get(requestId);
    if (clientId && this.clientRegistry.sendError(clientId, requestId, code, message)) {
      this.requestClients.delete(requestId);
      return;
    }

    this.sendError(requestId, code, message);
  }

  /**
   * 检查是否是流式消息
   */
  private isStreamMessage(type: string): type is StreamMessageType {
    return STREAM_MESSAGE_TYPES.includes(type as StreamMessageType);
  }

  /**
   * 处理流式消息
   */
  private async handleStreamMessage(type: StreamMessageType, data: any, requestId: string): Promise<void> {
    switch (type) {
      case 'chatStream':
        // 不阻塞消息循环，流式处理在后台进行
        this.streamHandler.handleChatStream(data, requestId).catch(console.error);
        break;
        
      case 'retryStream':
        this.streamHandler.handleRetryStream(data, requestId).catch(console.error);
        break;
        
      case 'editAndRetryStream':
        this.streamHandler.handleEditAndRetryStream(data, requestId).catch(console.error);
        break;
        
      case 'toolConfirmation':
        this.streamHandler.handleToolConfirmationStream(data, requestId).catch(console.error);
        break;
        
      case 'cancelStream':
        const { conversationId } = data;
        this.streamHandler.cancelStream(conversationId, requestId).catch(console.error);
        break;
    }
  }

  /**
   * 取消所有活跃的流
   */
  cancelAllStreams(): void {
    this.streamHandler.cancelAllStreams().catch(console.error);
  }

  /**
   * 获取流式请求取消控制器
   */
  getAbortManager(): StreamAbortManager {
    return this.abortManager;
  }
}
