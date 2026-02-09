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
import { ChannelError, ErrorType } from '../../backend/modules/channel/types';

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

  private isAbortError(error: any): boolean {
    const name = error?.name
    const message = typeof error?.message === 'string' ? error.message : ''
    return name === 'AbortError' || message.toLowerCase().includes('aborted') || message.toLowerCase().includes('cancelled')
  }

  private reportCancelled(processor: StreamChunkProcessor): void {
    // 确保前端一定能收到 cancelled 事件以清理占位消息
    processor.processChunk({ cancelled: true })
  }

  private reportNetworkAbort(error: any, processor: StreamChunkProcessor, requestId: string): void {
    const details = typeof error?.message === 'string' && error.message.trim() ? `: ${error.message}` : ''
    const message = `${t('errors.networkError')}${details}`
    processor.sendError('NETWORK_ERROR', message)
    // 确保请求侧也有响应（即使前端已收到 started:true，这里也安全）
    this.deps.sendError(requestId, 'NETWORK_ERROR', message)
  }

  private serializeErrorDetails(details: unknown): string {
    if (details === undefined || details === null) return ''
    if (typeof details === 'string') return details.trim()
    try {
      return JSON.stringify(details, null, 2)
    } catch {
      return String(details)
    }
  }

  private normalizeErrorMessage(error: any): string {
    if (typeof error?.message === 'string' && error.message.trim()) {
      return error.message.trim()
    }
    return t('errors.unknown')
  }

  /**
   * 处理普通聊天流
   */
  async handleChatStream(data: any, requestId: string): Promise<void> {
    const { conversationId, message, configId, attachments, modelOverride } = data;
    
    const controller = this.deps.abortManager.create(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId);
    
    try {
      const stream = this.deps.chatHandler.handleChatStream({
        conversationId,
        message,
        configId,
        modelOverride,
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
      // AbortError 可能来自：用户点击中断 / 网络抖动 / 上游直接抛 abort
      // 关键：无论哪种情况，都必须给前端一个明确的 stream 结尾事件，避免残留空占位消息。
      if (controller.signal.aborted) {
        this.reportCancelled(processor)
        return
      }
      if (this.isAbortError(error)) {
        this.reportNetworkAbort(error, processor, requestId)
        return
      }
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
      if (controller.signal.aborted) {
        this.reportCancelled(processor)
        return
      }
      if (this.isAbortError(error)) {
        this.reportNetworkAbort(error, processor, requestId)
        return
      }
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
      if (controller.signal.aborted) {
        this.reportCancelled(processor)
        return
      }
      if (this.isAbortError(error)) {
        this.reportNetworkAbort(error, processor, requestId)
        return
      }
      this.handleStreamError(error, processor, requestId);
    } finally {
      this.deps.abortManager.delete(conversationId);
    }
  }

  /**
   * 处理工具确认流
   */
  async handleToolConfirmationStream(data: any, requestId: string): Promise<void> {
    const { conversationId, toolResponses, annotation, configId, modelOverride } = data;
    
    const controller = this.deps.abortManager.create(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId);
    
    try {
      const stream = this.deps.chatHandler.handleToolConfirmation({
        conversationId,
        toolResponses,
        annotation,
        configId,
        modelOverride,
        abortSignal: controller.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
    } catch (error: any) {
      if (controller.signal.aborted) {
        this.reportCancelled(processor)
        return
      }
      if (this.isAbortError(error)) {
        this.reportNetworkAbort(error, processor, requestId)
        return
      }
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
    if (error instanceof ChannelError) {
      if (error.type === ErrorType.CANCELLED_ERROR) {
        this.reportCancelled(processor)
        return
      }

      const details = this.serializeErrorDetails(error.details)
      const message = details ? `${error.message}\n${details}` : error.message

      if (error.type === ErrorType.NETWORK_ERROR || error.type === ErrorType.TIMEOUT_ERROR) {
        const networkMessage = message || t('errors.networkError')
        processor.sendError('NETWORK_ERROR', networkMessage)
        this.deps.sendError(requestId, 'NETWORK_ERROR', networkMessage)
        return
      }

      const errorCode = error.type || 'STREAM_ERROR'
      const fallbackMessage = message || t('errors.unknown')
      processor.sendError(errorCode, fallbackMessage)
      this.deps.sendError(requestId, errorCode, fallbackMessage)
      return
    }

    const errorMessage = this.normalizeErrorMessage(error)
    processor.sendError('STREAM_ERROR', t('core.channel.errors.streamRequestFailed', { error: errorMessage }))

    // 同时发送请求错误响应，确保前端 await sendToExtension 能够返回
    this.deps.sendError(requestId, 'STREAM_ERROR', errorMessage)
  }
}
