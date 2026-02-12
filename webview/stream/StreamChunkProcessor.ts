/**
 * 流式响应 Chunk 处理器
 * 
 * 统一处理流式响应的 chunk 并发送到前端。
 * 使用消息缓冲 + 节流机制，将高频 chunk 合并为批量 postMessage（streamChunkBatch），
 * 减少序列化开销和前端响应式更新次数。
 * 
 * 设计要点：
 * - chunk 类型消息使用节流（throttle）而非立即 flush，避免高速模型产生数百次 postMessage
 * - complete/toolsExecuting/toolIteration/awaitingConfirmation 等终结事件立即 flush，
 *   确保前端能及时收到最终状态，消除前后端不一致
 * - error/cancelled 等状态变更也立即 flush
 */

import type * as vscode from 'vscode';

/** chunk 类型消息的节流间隔（毫秒） */
const CHUNK_THROTTLE_MS = 50;

/**
 * 流式响应 Chunk 处理器
 */
export class StreamChunkProcessor {
  /** 待发送消息缓冲区 */
  private messageBuffer: Record<string, any>[] = [];
  /** 自动刷新计时器句柄（setTimeout(0) 兜底） */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** chunk 节流计时器句柄 */
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 上次 chunk flush 的时间戳 */
  private lastChunkFlushTime: number = 0;

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
      // chunk 类型使用节流：积攒一小段时间后批量 flush，
      // 避免高速模型每个 token 都触发 postMessage
      this.scheduleThrottledFlush();
    } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
      this.enqueue('toolsExecuting', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls,
        toolsExecuting: true
      });
      // 终结事件立即刷新，确保前端及时切换状态
      this.flush();
    } else if ('toolStatus' in chunk && chunk.toolStatus) {
      this.enqueue('toolStatus', {
        tool: chunk.tool,
        toolStatus: true
      });
      // 工具状态变更立即刷新，确保前端实时反映执行进度
      this.flush();
    } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
      this.enqueue('awaitingConfirmation', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls,
        toolResults: chunk.toolResults,
        checkpoints: chunk.checkpoints
      });
      // 终结事件立即刷新
      this.flush();
    } else if ('toolIteration' in chunk && chunk.toolIteration) {
      this.enqueue('toolIteration', {
        content: chunk.content,
        toolIteration: true,
        toolResults: chunk.toolResults,
        checkpoints: chunk.checkpoints
      });
      // 终结事件立即刷新
      this.flush();
    } else if ('autoSummaryStatus' in chunk && chunk.autoSummaryStatus) {
      this.enqueue('autoSummaryStatus', {
        autoSummaryStatus: true,
        status: chunk.status,
        message: chunk.message
      });
      // 状态提示需要即时更新
      this.flush();
    } else if ('autoSummary' in chunk && chunk.autoSummary) {
      this.enqueue('autoSummary', {
        autoSummary: true,
        summaryContent: chunk.summaryContent,
        insertIndex: chunk.insertIndex
      });
    } else if ('content' in chunk && chunk.content && !('cancelled' in chunk)) {
      this.enqueue('complete', {
        content: chunk.content,
        checkpoints: chunk.checkpoints
      });
      // 终结事件立即刷新，确保前端立即收到完成信号
      this.flush();
    } else if ('cancelled' in chunk && chunk.cancelled) {
      this.enqueue('cancelled', { content: chunk.content });
      // 终结事件立即刷新
      this.flush();
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
    // 清除所有待执行的计时器
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.messageBuffer.length === 0 || !this.view) return;

    const messages = this.messageBuffer;
    this.messageBuffer = [];
    this.lastChunkFlushTime = Date.now();

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
   * 为 chunk 类型消息调度节流 flush。
   * 
   * 策略：
   * - 如果距离上次 flush 已经超过 CHUNK_THROTTLE_MS，立即 flush（保证首个 chunk 低延迟）
   * - 否则设定一个定时器在 CHUNK_THROTTLE_MS 后 flush（合并高频 chunk）
   * - 同一时间只有一个节流定时器
   */
  private scheduleThrottledFlush(): void {
    const now = Date.now();
    const elapsed = now - this.lastChunkFlushTime;

    if (elapsed >= CHUNK_THROTTLE_MS) {
      // 距上次 flush 已足够久，立即发送（保证首个 chunk 低延迟）
      this.flush();
    } else if (this.throttleTimer === null) {
      // 设定节流定时器，合并后续高频 chunk
      const delay = CHUNK_THROTTLE_MS - elapsed;
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this.flush();
      }, delay);
    }
    // 如果 throttleTimer 已存在，说明已有待执行的 flush，新 chunk 会被合并
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
