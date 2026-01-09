/**
 * 消息路由器
 * 
 * 负责将前端消息路由到正确的处理器
 */

import type { HandlerContext, MessageHandler, MessageHandlerRegistry } from './types';
import { createMessageHandlerRegistry } from './handlers';
import { StreamRequestHandler, StreamAbortManager } from './stream';
import type { ChatHandler } from '../backend/modules/api/chat';
import type * as vscode from 'vscode';

/**
 * 流式消息类型
 */
const STREAM_MESSAGE_TYPES = [
  'chatStream',
  'retryStream',
  'editAndRetryStream',
  'toolConfirmation',
  'continueWithAnnotation',
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

  constructor(
    private chatHandler: ChatHandler,
    private getView: () => vscode.WebviewView | undefined,
    private sendResponse: (requestId: string, data: any) => void,
    private sendError: (requestId: string, code: string, message: string) => void
  ) {
    // 创建处理器注册表
    this.registry = createMessageHandlerRegistry();
    
    // 创建流式处理器
    this.abortManager = new StreamAbortManager();
    this.streamHandler = new StreamRequestHandler({
      chatHandler: this.chatHandler,
      abortManager: this.abortManager,
      getView: this.getView,
      sendResponse: this.sendResponse,
      sendError: this.sendError
    });
  }

  /**
   * 路由消息到正确的处理器
   * 
   * @returns true 如果消息已处理，false 如果需要回退到原有处理
   */
  async route(type: string, data: any, requestId: string, ctx: HandlerContext): Promise<boolean> {
    // 检查是否是流式消息
    if (this.isStreamMessage(type)) {
      await this.handleStreamMessage(type as StreamMessageType, data, requestId);
      return true;
    }

    // 检查注册表中是否有处理器
    const handler = this.registry.get(type);
    if (handler) {
      await handler(data, requestId, ctx);
      return true;
    }

    // 未找到处理器，返回 false 表示需要回退
    return false;
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

      case 'continueWithAnnotation':
        this.streamHandler.handleContinueWithAnnotationStream(data, requestId).catch(console.error);
        break;
        
      case 'cancelStream':
        const { conversationId } = data;
        this.streamHandler.cancelStream(conversationId, requestId);
        break;
    }
  }

  /**
   * 取消所有活跃的流
   */
  cancelAllStreams(): void {
    this.abortManager.cancelAll(this.getView());
  }

  /**
   * 获取流式请求取消控制器
   */
  getAbortManager(): StreamAbortManager {
    return this.abortManager;
  }
}
