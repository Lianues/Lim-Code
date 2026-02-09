/**
 * 流式响应 Chunk 处理器
 * 
 * 统一处理流式响应的 chunk 并发送到前端。
 * 使用消息缓冲 + setTimeout(0) 自动刷新，将同一事件循环 tick 内产生的
 * 多条消息合并为一次 postMessage（streamChunkBatch），减少序列化开销和
 * 前端响应式更新次数。
 */

import type * as vscode from 'vscode';

/**
 * 流式响应 Chunk 处理器
 */
export class StreamChunkProcessor {
  /** 待发送消息缓冲区 */
  private messageBuffer: Record<string, any>[] = [];
  /** 自动刷新计时器句柄 */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
      this.enqueue('checkpoints', { checkpoints: chunk.checkpoints });
    } else if ('chunk' in chunk && chunk.chunk) {
      this.enqueue('chunk', { chunk: chunk.chunk });
      // 内容块立即刷新，确保前端实时逐词显示（不等 setTimeout(0) 批处理）
      this.flush();
    } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
      this.enqueue('toolsExecuting', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls,
        toolsExecuting: true
      });
      // 工具状态变更立即刷新，确保前端实时反映执行进度（不等 setTimeout(0) 批处理）
      this.flush();
    } else if ('toolStatus' in chunk && chunk.toolStatus) {
      this.enqueue('toolStatus', {
        tool: chunk.tool,
        toolStatus: true
      });
      // 工具状态变更立即刷新，确保前端实时反映执行进度（不等 setTimeout(0) 批处理）
      this.flush();
    } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
      this.enqueue('awaitingConfirmation', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls,
        toolResults: chunk.toolResults,
        checkpoints: chunk.checkpoints
      });
    } else if ('toolIteration' in chunk && chunk.toolIteration) {
      this.enqueue('toolIteration', {
        content: chunk.content,
        toolIteration: true,
        toolResults: chunk.toolResults,
        checkpoints: chunk.checkpoints
      });
    } else if ('content' in chunk && chunk.content && !('cancelled' in chunk)) {
      this.enqueue('complete', {
        content: chunk.content,
        checkpoints: chunk.checkpoints
      });
    } else if ('cancelled' in chunk && chunk.cancelled) {
      this.enqueue('cancelled', { content: chunk.content });
    } else if ('error' in chunk && chunk.error) {
      this.enqueue('error', { error: chunk.error });
      // 错误消息立即刷新，确保调用方可以安全 break
      this.flush();
      return true;
    }

    return false;
  }

  /**
   * 发送错误消息（立即刷新）
   */
  sendError(code: string, message: string): void {
    this.enqueue('error', {
      error: { code, message }
    });
    this.flush();
  }

  /**
   * 立即刷新缓冲区，将所有待发送消息发送到前端。
   * 单条消息保持原有 streamChunk 格式；多条合并为 streamChunkBatch。
   */
  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.messageBuffer.length === 0 || !this.view) return;

    const messages = this.messageBuffer;
    this.messageBuffer = [];

    if (messages.length === 1) {
      // 单条消息：保持原有格式，向前兼容
      this.view.webview.postMessage({
        type: 'streamChunk',
        data: messages[0]
      });
    } else {
      // 多条消息：批量发送，前端一次性同步处理以利用 Vue 响应式批量更新
      this.view.webview.postMessage({
        type: 'streamChunkBatch',
        data: messages
      });
    }
  }

  /**
   * 将消息放入缓冲区并调度自动刷新。
   * 使用 setTimeout(0)：在当前 event loop tick 的所有微任务完成后刷新，
   * 从而将同一 tick 内 for-await 循环产生的多条消息自动合并。
   */
  private enqueue(type: string, data: Record<string, any>): void {
    this.messageBuffer.push({
      conversationId: this.conversationId,
      type,
      ...data
    });

    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, 0);
    }
  }
}
