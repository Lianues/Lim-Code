/**
 * 流式响应 Chunk 处理器
 * 
 * 统一处理流式响应的 chunk 并发送到前端
 */

import type * as vscode from 'vscode';

/**
 * 流式响应 Chunk 处理器
 */
export class StreamChunkProcessor {
  constructor(
    private view: vscode.WebviewView | undefined,
    private conversationId: string
  ) {}

  /**
   * 处理并发送 chunk
   * @returns 是否为错误类型
   */
  processChunk(chunk: any): boolean {
    if (!this.view) return false;

    if ('checkpointOnly' in chunk && chunk.checkpointOnly) {
      this.sendMessage('checkpoints', { checkpoints: chunk.checkpoints });
    } else if ('chunk' in chunk && chunk.chunk) {
      this.sendMessage('chunk', { chunk: chunk.chunk });
    } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
      this.sendMessage('toolsExecuting', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls,
        toolsExecuting: true
      });
    } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
      this.sendMessage('awaitingConfirmation', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls
      });
    } else if ('toolIteration' in chunk && chunk.toolIteration) {
      this.sendMessage('toolIteration', {
        content: chunk.content,
        toolIteration: true,
        toolResults: chunk.toolResults,
        checkpoints: chunk.checkpoints,
        // diff 确认/批注流程所需字段（可选）
        needAnnotation: chunk.needAnnotation,
        pendingDiffToolIds: chunk.pendingDiffToolIds,
        annotationUsed: chunk.annotationUsed,
        pendingAnnotation: chunk.pendingAnnotation
      });
    } else if ('content' in chunk && chunk.content && !('cancelled' in chunk)) {
      this.sendMessage('complete', {
        content: chunk.content,
        checkpoints: chunk.checkpoints
      });
    } else if ('cancelled' in chunk && chunk.cancelled) {
      this.sendMessage('cancelled', { content: chunk.content });
    } else if ('error' in chunk && chunk.error) {
      this.sendMessage('error', { error: chunk.error });
      return true; // 指示错误
    }

    return false;
  }

  /**
   * 发送错误消息
   */
  sendError(code: string, message: string): void {
    this.sendMessage('error', {
      error: { code, message }
    });
  }

  /**
   * 发送消息到前端
   */
  private sendMessage(type: string, data: Record<string, any>): void {
    this.view?.webview.postMessage({
      type: 'streamChunk',
      data: {
        conversationId: this.conversationId,
        type,
        ...data
      }
    });
  }
}
