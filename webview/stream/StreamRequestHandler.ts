/**
 * 流式请求处理器
 * 
 * 处理所有流式消息类型
 */

import type * as vscode from 'vscode';
import type { ChatHandler } from '../../backend/modules/api/chat';
import type { ConversationManager } from '../../backend/modules/conversation/ConversationManager';
import { StreamAbortManager } from './StreamAbortManager';
import { StreamChunkProcessor } from './StreamChunkProcessor';
import { t } from '../../backend/i18n';
import { getDiffManager } from '../../backend/tools/file/diffManager';

export interface StreamHandlerDeps {
  chatHandler: ChatHandler;
  abortManager: StreamAbortManager;
  conversationManager: ConversationManager;
  getView: () => vscode.WebviewView | undefined;
  sendResponse: (requestId: string, data: any) => void;
  sendError: (requestId: string, code: string, message: string) => void;
}

/**
 * 流式请求处理器
 */
export class StreamRequestHandler {
  constructor(private deps: StreamHandlerDeps) {}

  /**
   * 处理普通聊天流
   */
  async handleChatStream(data: any, requestId: string): Promise<void> {
    const { conversationId, message, configId, attachments } = data;
    
    const controller = this.deps.abortManager.create(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId);
    
    try {
      const stream = this.deps.chatHandler.handleChatStream({
        conversationId,
        message,
        configId,
        attachments,
        abortSignal: controller.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
    } catch (error: any) {
      this.handleStreamError(error, processor, requestId);
    } finally {
      this.deps.abortManager.delete(conversationId);
    }
  }

  /**
   * 处理重试流
   */
  async handleRetryStream(data: any, requestId: string): Promise<void> {
    const { conversationId, configId } = data;
    
    const controller = this.deps.abortManager.create(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId);
    
    try {
      const stream = this.deps.chatHandler.handleRetryStream({
        conversationId,
        configId,
        abortSignal: controller.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
    } catch (error: any) {
      this.handleStreamError(error, processor, requestId);
    } finally {
      this.deps.abortManager.delete(conversationId);
    }
  }

  /**
   * 处理编辑并重试流
   */
  async handleEditAndRetryStream(data: any, requestId: string): Promise<void> {
    const { conversationId, messageIndex, newMessage, configId, attachments } = data;
    
    const controller = this.deps.abortManager.create(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId);
    
    try {
      const stream = this.deps.chatHandler.handleEditAndRetryStream({
        conversationId,
        messageIndex,
        newMessage,
        configId,
        attachments,
        abortSignal: controller.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
    } catch (error: any) {
      this.handleStreamError(error, processor, requestId);
    } finally {
      this.deps.abortManager.delete(conversationId);
    }
  }

  /**
   * 处理工具确认流
   */
  async handleToolConfirmationStream(data: any, requestId: string): Promise<void> {
    const { conversationId, toolResponses, annotation, configId } = data;
    
    const controller = this.deps.abortManager.create(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId);
    
    try {
      const stream = this.deps.chatHandler.handleToolConfirmation({
        conversationId,
        toolResponses,
        annotation,
        configId,
        abortSignal: controller.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
    } catch (error: any) {
      this.handleStreamError(error, processor, requestId);
    } finally {
      this.deps.abortManager.delete(conversationId);
    }
  }

  /**
   * 取消流
   */
  async cancelStream(conversationId: string, requestId: string): Promise<void> {
    // 1. 取消流式请求
    this.deps.abortManager.cancel(conversationId);
    
    // 2. 取消所有待处理的 diff（关闭编辑器并恢复文件）
    try {
      const diffManager = getDiffManager();
      await diffManager.cancelAllPending();
    } catch (err) {
      console.error('Failed to cancel pending diffs:', err);
    }
    
    // 3. 拒绝所有未响应的工具调用
    try {
      await this.deps.conversationManager.rejectAllPendingToolCalls(conversationId);
    } catch (err) {
      console.error('Failed to reject pending tool calls:', err);
    }
    
    this.deps.sendResponse(requestId, { cancelled: true });
  }

  /**
   * 处理流式错误
   */
  private handleStreamError(error: any, processor: StreamChunkProcessor, requestId: string): void {
    if (error.name === 'AbortError' || error.message?.includes('aborted')) {
      // 被用户取消，不需要发送错误
      return;
    }
    
    const errorMessage = error.message || t('webview.errors.streamFailed');
    processor.sendError('STREAM_ERROR', errorMessage);
    
    // 同时发送请求错误响应，确保前端 await sendToExtension 能够返回
    this.deps.sendError(requestId, 'STREAM_ERROR', errorMessage);
  }
}
