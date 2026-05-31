/**
 * 流式请求处理器
 * 
 * 处理所有流式消息类型
 */

import type * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { ChatHandler } from '../../backend/modules/api/chat';
import type { ConversationManager } from '../../backend/modules/conversation/ConversationManager';
import type { SettingsManager } from '../../backend/modules/settings/SettingsManager';
import { StreamAbortManager } from './StreamAbortManager';
import { StreamChunkProcessor } from './StreamChunkProcessor';
import { t } from '../../backend/i18n';
import { getDiffManager } from '../../backend/tools/file/diffManager';
import { ChannelError, ErrorType } from '../../backend/modules/channel/types';
import { chatStreamRuntimeLedgerBridge } from './runtimeLedgerBridge';

export interface StreamHandlerDeps {
  chatHandler: ChatHandler;
  abortManager: StreamAbortManager;
  conversationManager: ConversationManager;
  getView: () => vscode.WebviewView | undefined;
  sendResponse: (requestId: string, data: any) => void;
  sendError: (requestId: string, code: string, message: string) => void;
  settingsManager?: SettingsManager;
}

/**
 * 流式请求处理器
 */
export class StreamRequestHandler {
  constructor(private deps: StreamHandlerDeps) {}

  /**
   * 规范化请求携带的 Prompt 模式 ID。
   */
  private normalizePromptModeId(promptModeId: unknown): string | undefined {
    if (typeof promptModeId !== 'string') return undefined
    const normalized = promptModeId.trim()
    return normalized || undefined
  }

  private isAbortError(error: any): boolean {
    const name = error?.name
    const message = typeof error?.message === 'string' ? error.message : ''
    return name === 'AbortError' || message.toLowerCase().includes('aborted') || message.toLowerCase().includes('cancelled')
  }

  private reportCancelled(processor: StreamChunkProcessor): void {
    // 确保前端一定能收到 cancelled 事件以清理占位消息
    processor.processChunk({ cancelled: true })
    processor.flush()
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

  private createAuthoritativeStreamId(): string {
    return `server-stream-${randomUUID()}`
  }

  private async cleanupAbortedConversations(conversationIds: string[]): Promise<void> {
    try {
      const diffManager = getDiffManager();
      await diffManager.cancelAllPending();
    } catch (err) {
      console.error('Failed to cancel pending diffs:', err);
    }

    if (conversationIds.length === 0) {
      return;
    }

    await Promise.all(conversationIds.map(async (conversationId) => {
      try {
        await this.deps.conversationManager.rejectAllPendingToolCalls(conversationId);
      } catch (err) {
        console.error(`Failed to reject pending tool calls for conversation ${conversationId}:`, err);
      }
    }));
  }

  private async createCancelMutationProjection(conversationId: string) {
    const [page, metadata] = await Promise.all([
      this.deps.conversationManager.getMessagesPaged(conversationId, { limit: 800 }),
      this.deps.conversationManager.getMetadata(conversationId).catch(error => {
        console.warn('[StreamRequestHandler] Failed to include metadata in Runtime Ledger cancel projection:', error);
        return undefined;
      })
    ]);
    const custom = (metadata?.custom || {}) as Record<string, unknown>;
    const checkpoints = Array.isArray(custom.checkpoints)
      ? custom.checkpoints as Record<string, unknown>[]
      : [];

    return chatStreamRuntimeLedgerBridge.createMutationProjection({
      conversationId,
      operation: 'cancel_stream',
      messages: page.messages as unknown as Record<string, unknown>[],
      totalMessages: page.total,
      checkpoints,
      activeBuild: (custom.activeBuild ?? null) as Record<string, unknown> | null
    });
  }

  async cancelAllStreams(): Promise<void> {
    const conversationIds = this.deps.abortManager.listConversationIds();
    this.deps.abortManager.cancelAll(this.deps.getView());
    await this.cleanupAbortedConversations(conversationIds);
  }

  /**
   * 处理普通聊天流
   */
  async handleChatStream(data: any, requestId: string): Promise<void> {
    const { conversationId, message, configId, attachments, modelOverride, hiddenFunctionResponse, promptModeId } = data;
    const streamId = this.createAuthoritativeStreamId()
    
    const controller = this.deps.abortManager.create(conversationId);
    const summarizeController = this.deps.abortManager.createSummary(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId, streamId);
    
    try {
      const stream = this.deps.chatHandler.handleChatStream({
        conversationId,
        message,
        configId,
        modelOverride,
        attachments,
        hiddenFunctionResponse,
        promptModeId: this.normalizePromptModeId(promptModeId),
        abortSignal: controller.signal,
        summarizeAbortSignal: summarizeController.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true, streamId });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
      // 流结束后刷新缓冲区，确保所有消息都已发送
      await processor.drain();
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
      this.deps.abortManager.deleteSummary(conversationId);
    }
  }

  /**
   * 处理重试流
   */
  async handleRetryStream(data: any, requestId: string): Promise<void> {
    const { conversationId, configId, modelOverride, promptModeId } = data;
    const streamId = this.createAuthoritativeStreamId()
    
    const controller = this.deps.abortManager.create(conversationId);
    const summarizeController = this.deps.abortManager.createSummary(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId, streamId);
    
    try {
      const stream = this.deps.chatHandler.handleRetryStream({
        conversationId,
        configId,
        modelOverride,
        promptModeId: this.normalizePromptModeId(promptModeId),
        abortSignal: controller.signal,
        summarizeAbortSignal: summarizeController.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true, streamId });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
      await processor.drain();
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
      this.deps.abortManager.deleteSummary(conversationId);
    }
  }

  /**
   * 处理编辑并重试流
   */
  async handleEditAndRetryStream(data: any, requestId: string): Promise<void> {
    const { conversationId, messageIndex, newMessage, configId, modelOverride, attachments, promptModeId } = data;
    const streamId = this.createAuthoritativeStreamId()
    
    const controller = this.deps.abortManager.create(conversationId);
    const summarizeController = this.deps.abortManager.createSummary(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId, streamId);
    
    try {
      const stream = this.deps.chatHandler.handleEditAndRetryStream({
        conversationId,
        messageIndex,
        newMessage,
        configId,
        modelOverride,
        attachments,
        promptModeId: this.normalizePromptModeId(promptModeId),
        abortSignal: controller.signal,
        summarizeAbortSignal: summarizeController.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true, streamId });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
      await processor.drain();
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
      this.deps.abortManager.deleteSummary(conversationId);
    }
  }

  /**
   * 处理工具确认流
   */
  async handleToolConfirmationStream(data: any, requestId: string): Promise<void> {
    const { conversationId, toolResponses, annotation, configId, modelOverride, promptModeId } = data;
    const streamId = this.createAuthoritativeStreamId()
    
    const controller = this.deps.abortManager.create(conversationId);
    const summarizeController = this.deps.abortManager.createSummary(conversationId);
    const processor = new StreamChunkProcessor(this.deps.getView(), conversationId, streamId);
    
    try {
      const stream = this.deps.chatHandler.handleToolConfirmation({
        conversationId,
        toolResponses,
        annotation,
        configId,
        modelOverride,
        promptModeId: this.normalizePromptModeId(promptModeId),
        summarizeAbortSignal: summarizeController.signal,
        abortSignal: controller.signal
      });
      
      // 发送响应，通知前端请求已接收并开始
      this.deps.sendResponse(requestId, { started: true, streamId });
      
      for await (const chunk of stream) {
        const isError = processor.processChunk(chunk);
        if (isError) break;
      }
      await processor.drain();
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
      this.deps.abortManager.deleteSummary(conversationId);
    }
  }

  /**
   * 取消流
   */
  async cancelStream(conversationId: string, requestId: string): Promise<void> {
    // 1. 取消流式请求
    this.deps.abortManager.cancel(conversationId);

    await this.cleanupAbortedConversations([conversationId]);

    const runtimeLedger = await this.createCancelMutationProjection(conversationId);
    this.deps.sendResponse(requestId, { cancelled: true, runtimeLedger });
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
      const resolvedMessage = message || t('errors.unknown')
      processor.sendError(errorCode, resolvedMessage)
      this.deps.sendError(requestId, errorCode, resolvedMessage)
      return
    }

    const errorMessage = this.normalizeErrorMessage(error)
    processor.sendError('STREAM_ERROR', t('core.channel.errors.streamRequestFailed', { error: errorMessage }))

    // 同时发送请求错误响应，确保前端 await sendToExtension 能够返回
    this.deps.sendError(requestId, 'STREAM_ERROR', errorMessage)
  }
}
