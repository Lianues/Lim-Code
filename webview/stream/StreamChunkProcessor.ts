/**
 * 流式响应 Chunk 处理器
 * 
 * 统一处理流式响应的 chunk 并发送到前端。
 * 使用即时 transport projection 将流式 chunk 发送到前端。
 * 
 * 设计要点：
 * - chunk 类型消息不做时间节流，到达后立即 flush，优先保证主界面响应速度
 * - Runtime Ledger 写入是后台观察者，不阻塞 transport projection
 * - complete/toolsExecuting/toolIteration/awaitingConfirmation 等终结事件立即 flush，
 *   确保前端能及时收到最终状态，消除前后端不一致
 * - error/cancelled 等状态变更也立即 flush
 */

import type * as vscode from 'vscode';
import { chatStreamRuntimeLedgerBridge, type ChatRuntimeLedgerAppendResult } from './runtimeLedgerBridge';

const STREAM_TRANSPORT_MAX_ENVELOPE_BYTES = 16 * 1024;
const STREAM_TRANSPORT_BATCH_TARGET_BYTES = 14 * 1024;
const HIDDEN_STREAM_DELTA_PREVIEW_BYTES = 4096;

interface HiddenTransportState {
  count: number;
  firstHiddenAt: number;
  lastHiddenAt: number;
  accumulatedChunk?: Record<string, any>;
  truncatedChunkCount?: number;
  latestByType: Map<string, Record<string, any>>;
}

interface EnqueueOptions {
  scheduleImmediateFlush?: boolean;
  flushBeforeAppend?: boolean;
  flushAfterAppend?: boolean;
}

export interface StreamChunkProcessorOptions {
  isVisible?: () => boolean;
}

/**
 * 流式响应 Chunk 处理器
 */
export class StreamChunkProcessor {
  /** 待发送消息缓冲区 */
  private messageBuffer: Record<string, any>[] = [];
  /** 自动刷新计时器句柄（setTimeout(0) 兜底） */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes Runtime Ledger observer writes without blocking transport projections. */
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(
    private view: vscode.WebviewView | undefined,
    private conversationId: string,
    private streamId: string,
    private readonly options: StreamChunkProcessorOptions = {}
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
      this.enqueue('chunk', { chunk: chunk.chunk }, {
        flushAfterAppend: true
      });
      // 修改原因：主聊天响应速度优先，用户明确要求取消 throttle；Runtime Ledger 写入不能让 UI 慢吐字。
      // 修改方式：chunk 到达后直接生成 projection 并 flush，ledger append 仅后台串行记录。
      // 修改目的：上游 SSE 已结束时，主界面不再继续播放后端积压的 chunk 队列。
    } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
      this.enqueue('toolsExecuting', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls,
        toolsExecuting: true
      }, { flushAfterAppend: true });
      // 终结事件立即刷新，确保前端及时切换状态
    } else if ('toolStatus' in chunk && chunk.toolStatus) {
      this.enqueue('toolStatus', {
        tool: chunk.tool,
        toolStatus: true
      }, { flushAfterAppend: true });
      // 工具状态变更立即刷新，确保前端实时反映执行进度
    } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
      this.enqueue('awaitingConfirmation', {
        content: chunk.content,
        pendingToolCalls: chunk.pendingToolCalls,
        toolResults: chunk.toolResults,
        checkpoints: chunk.checkpoints
      }, { flushAfterAppend: true });
      // 终结事件立即刷新
    } else if ('toolIteration' in chunk && chunk.toolIteration) {
      this.enqueue('toolIteration', {
        content: chunk.content,
        toolIteration: true,
        toolResults: chunk.toolResults,
        checkpoints: chunk.checkpoints
      }, { flushAfterAppend: true });
      // 终结事件立即刷新
    } else if ('autoSummaryStatus' in chunk && chunk.autoSummaryStatus) {
      this.enqueue('autoSummaryStatus', {
        autoSummaryStatus: true,
        status: chunk.status,
        message: chunk.message
      }, { flushAfterAppend: true });
      // 状态提示需要即时更新
    } else if ('autoSummary' in chunk && chunk.autoSummary) {
      this.enqueue('autoSummary', {
        autoSummary: true,
        summaryContent: chunk.summaryContent,
        insertIndex: chunk.insertIndex
      });
    } else if ('contextCommand' in chunk && chunk.contextCommand) {
      this.enqueue('contextCommand', {
        // 修改原因：context slash command 返回的是结构化 UI payload，不能走普通 complete/content 分支。
        // 修改方式：新增 contextCommand stream chunk，前端按 payload 渲染状态卡片或确认卡片。
        // 修改目的：保证命令结果不进入 LLM 文本流，也不丢失 iconName/nextActions/ledger 等结构字段。
        contextCommand: true,
        payload: chunk.payload
      }, { flushAfterAppend: true });
    } else if ('content' in chunk && chunk.content && !('cancelled' in chunk)) {
      this.enqueue('complete', {
        content: chunk.content,
        checkpoints: chunk.checkpoints
      }, { flushAfterAppend: true });
      // 终结事件立即刷新，确保前端立即收到完成信号
    } else if ('cancelled' in chunk && chunk.cancelled) {
      // 先 flush 缓冲的 chunk，确保前端先收到已有内容，
      // 避免 cancelled 与 chunk 合并到同一 batch 导致空消息被误删
      if (this.messageBuffer.length > 0) {
        this.flush();
      }
      this.enqueue('cancelled', { content: chunk.content }, {
        flushBeforeAppend: true,
        flushAfterAppend: true
      });
    } else if ('error' in chunk && chunk.error) {
      // 先 flush 缓冲的 chunk，确保前端先收到已有内容，
      // 避免 error 与 chunk 合并到同一 batch 导致空消息被误删
      if (this.messageBuffer.length > 0) {
        this.flush();
      }
      this.enqueue('error', { error: chunk.error }, {
        flushBeforeAppend: true,
        flushAfterAppend: true
      });
      return true;
    }

    return false;
  }

  /**
   * 发送错误消息（立即刷新）
   */
  sendError(code: string, message: string): void {
    // 先 flush 缓冲的 chunk，确保前端先收到已有内容
    if (this.messageBuffer.length > 0) {
      this.flush();
    }
    this.enqueue('error', {
      error: { code, message }
    }, {
      flushBeforeAppend: true,
      flushAfterAppend: true
    });
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
    if (this.messageBuffer.length === 0 || !this.view) return;

    const messages = this.messageBuffer;
    this.messageBuffer = [];

    for (const outgoing of this.createOutgoingStreamMessages(messages)) {
      this.postOrCoalesce(outgoing);
    }
  }

  async drain(): Promise<void> {
    this.flush();
  }

  async drainRuntimeLedgerForTests(): Promise<void> {
    await this.appendQueue;
  }

  hasHiddenTransportMessages(): boolean {
    return Boolean(this.hiddenTransport?.count);
  }

  flushHiddenTransportMessages(): void {
    if (!this.view || !this.hiddenTransport || !this.isTransportVisible()) {
      return;
    }

    const hidden = this.hiddenTransport;
    this.hiddenTransport = undefined;
    const payloads: Record<string, any>[] = [];
    if (hidden.accumulatedChunk) {
      payloads.push(hidden.accumulatedChunk);
    }
    payloads.push(...hidden.latestByType.values());
    const truncatedChunkCount = hidden.truncatedChunkCount
      || payloads.filter(payload => payload?.runtimeLedger?.ledger?.liveDelta?.payload?.runtimeLedgerHiddenTruncated === true).length;

    this.view.webview.postMessage({
      type: 'webview.hiddenDeliverySummary',
      data: {
        originalType: 'streamChunk',
        coalescedCount: hidden.count,
        deliveredCount: payloads.length,
        truncatedChunkCount,
        firstHiddenAt: hidden.firstHiddenAt,
        lastHiddenAt: hidden.lastHiddenAt
      }
    });

    if (payloads.length === 0) {
      return;
    }

    for (const outgoing of this.createOutgoingStreamMessages(payloads)) {
      this.view.webview.postMessage(outgoing);
    }
  }

  private hiddenTransport?: HiddenTransportState;

  private isTransportVisible(): boolean {
    return this.options.isVisible?.() !== false;
  }

  private postOrCoalesce(message: Record<string, any>): void {
    if (!this.view) return;
    if (!this.isTransportVisible()) {
      this.coalesceHiddenTransportMessage(message);
      return;
    }

    this.flushHiddenTransportMessages();
    this.view.webview.postMessage(message);
  }

  private coalesceHiddenTransportMessage(message: Record<string, any>): void {
    const now = Date.now();
    if (!this.hiddenTransport) {
      this.hiddenTransport = {
        count: 0,
        firstHiddenAt: now,
        lastHiddenAt: now,
        latestByType: new Map()
      };
    }

    const hidden = this.hiddenTransport;
    const payloads = message.type === 'streamChunkBatch' && Array.isArray(message.data)
      ? message.data
      : message.type === 'streamChunk'
        ? [message.data]
        : [];

    for (const payload of payloads) {
      if (!payload || typeof payload !== 'object') continue;
      hidden.count += 1;
      hidden.lastHiddenAt = now;
      this.coalesceHiddenTransportPayload(hidden, payload as Record<string, any>);
    }
  }

  private coalesceHiddenTransportPayload(hidden: HiddenTransportState, payload: Record<string, any>): void {
    if (payload.type === 'chunk' && payload.runtimeLedger?.ledger?.liveDelta?.payload) {
      hidden.accumulatedChunk = this.mergeHiddenChunkProjection(hidden, hidden.accumulatedChunk, payload);
      return;
    }

    hidden.latestByType.set(
      typeof payload.type === 'string' && payload.type ? payload.type : '__unknown__',
      payload
    );

    if (payload.type === 'complete' || payload.type === 'cancelled' || payload.type === 'error') {
      hidden.accumulatedChunk = undefined;
    }
  }

  private mergeHiddenChunkProjection(
    hidden: HiddenTransportState,
    existing: Record<string, any> | undefined,
    incoming: Record<string, any>
  ): Record<string, any> {
    const next = existing
      ? this.cloneTransportPayload(existing)
      : this.cloneTransportPayload(incoming);
    const targetPayload = next.runtimeLedger?.ledger?.liveDelta?.payload;
    const incomingPayload = incoming.runtimeLedger?.ledger?.liveDelta?.payload;
    if (!targetPayload || !incomingPayload) {
      return incoming;
    }

    if (!existing) {
      targetPayload.delta = [];
    }

    if (targetPayload.runtimeLedgerHiddenTruncated === true) {
      hidden.truncatedChunkCount = (hidden.truncatedChunkCount || 0) + 1;
      for (const key of ['done', 'usage', 'modelVersion', 'thinkingStartTime']) {
        if (Object.prototype.hasOwnProperty.call(incomingPayload, key)) {
          targetPayload[key] = incomingPayload[key];
        }
      }
      next.createdAt = incoming.createdAt ?? next.createdAt;
      return next;
    }

    const incomingDelta = Array.isArray(incomingPayload.delta) ? incomingPayload.delta : [];
    const targetDelta = Array.isArray(targetPayload.delta) ? targetPayload.delta : [];
    for (const part of incomingDelta) {
      this.mergeHiddenDeltaPart(targetDelta, part);
    }
    targetPayload.delta = targetDelta;

    for (const key of ['contentSnapshot', 'done', 'usage', 'modelVersion', 'thinkingStartTime']) {
      if (Object.prototype.hasOwnProperty.call(incomingPayload, key)) {
        targetPayload[key] = incomingPayload[key];
      }
    }
    next.createdAt = incoming.createdAt ?? next.createdAt;
    this.enforceHiddenChunkPreviewBudget(hidden, targetPayload);
    return next;
  }

  private createOutgoingStreamMessages(messages: Record<string, any>[]): Record<string, any>[] {
    if (messages.length <= 1) {
      return messages.map(message => ({
        type: 'streamChunk',
        data: message
      }));
    }

    const outgoing: Record<string, any>[] = [];
    let current: Record<string, any>[] = [];
    for (const message of messages) {
      const candidate = [...current, message];
      const candidateEnvelope = {
        type: 'streamChunkBatch',
        data: candidate
      };
      if (
        current.length > 0
        && this.utf8EnvelopeBytes(candidateEnvelope) > STREAM_TRANSPORT_BATCH_TARGET_BYTES
      ) {
        outgoing.push(current.length === 1
          ? { type: 'streamChunk', data: current[0] }
          : { type: 'streamChunkBatch', data: current }
        );
        current = [message];
        continue;
      }
      current = candidate;
    }

    if (current.length > 0) {
      outgoing.push(current.length === 1
        ? { type: 'streamChunk', data: current[0] }
        : { type: 'streamChunkBatch', data: current }
      );
    }

    return outgoing.map(message => {
      if (message.type !== 'streamChunkBatch') return message;
      if (this.utf8EnvelopeBytes(message) <= STREAM_TRANSPORT_MAX_ENVELOPE_BYTES) return message;
      return {
        type: 'streamChunkBatch',
        data: Array.isArray(message.data) ? message.data.slice(0, 1) : []
      };
    });
  }

  private enforceHiddenChunkPreviewBudget(hidden: HiddenTransportState, liveDeltaPayload: Record<string, any>): void {
    if (liveDeltaPayload.runtimeLedgerHiddenTruncated === true) {
      hidden.truncatedChunkCount = (hidden.truncatedChunkCount || 0) + 1;
      return;
    }

    const byteLength = this.utf8EnvelopeBytes(liveDeltaPayload.delta || []);
    if (byteLength <= HIDDEN_STREAM_DELTA_PREVIEW_BYTES) return;

    liveDeltaPayload.runtimeLedgerHiddenTruncated = true;
    liveDeltaPayload.runtimeLedgerHiddenByteLength = byteLength;
    hidden.truncatedChunkCount = (hidden.truncatedChunkCount || 0) + 1;
    liveDeltaPayload.delta = [{
      text: '[Runtime Ledger hidden stream preview truncated; visible refresh will continue from ledger projection.]',
      textTruncated: true,
      textByteLength: byteLength
    }];
    delete liveDeltaPayload.contentSnapshot;
  }

  private mergeHiddenDeltaPart(targetDelta: any[], part: any): void {
    if (!part || typeof part !== 'object') return;

    if (typeof part.text === 'string') {
      const last = targetDelta[targetDelta.length - 1];
      if (
        last &&
        typeof last.text === 'string' &&
        !last.functionCall &&
        Boolean(last.thought) === Boolean(part.thought)
      ) {
        last.text += part.text;
        return;
      }
      targetDelta.push({ ...part });
      return;
    }

    if (part.functionCall && typeof part.functionCall === 'object') {
      const incomingCall = part.functionCall;
      const incomingId = typeof incomingCall.id === 'string' ? incomingCall.id : undefined;
      const existing = incomingId
        ? targetDelta.find(candidate => candidate?.functionCall?.id === incomingId)
        : undefined;
      if (existing?.functionCall) {
        existing.functionCall = { ...existing.functionCall, ...incomingCall };
        return;
      }
      targetDelta.push({ functionCall: { ...incomingCall } });
    }
  }

  private cloneTransportPayload(payload: Record<string, any>): Record<string, any> {
    try {
      return JSON.parse(JSON.stringify(payload));
    } catch {
      return { ...payload };
    }
  }

  private utf8EnvelopeBytes(value: unknown): number {
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
      return Buffer.byteLength(String(value), 'utf8');
    }
  }

  /**
   * 将消息放入缓冲区并调度刷新。
   * chunk/终结事件可立即 flush；非热路径事件仍可用 setTimeout(0) 合并同 tick 更新。
   */
  private enqueue(
    type: string,
    data: Record<string, any>,
    options: EnqueueOptions = { scheduleImmediateFlush: true }
  ): void {
    const createdAt = typeof data.createdAt === 'number' && Number.isFinite(data.createdAt) ? data.createdAt : Date.now();
    const runtime = chatStreamRuntimeLedgerBridge.getRuntimeIdentity(this.conversationId, this.streamId);
    const input = {
      conversationId: this.conversationId,
      streamId: this.streamId,
      type,
      data,
      createdAt
    };

    if (options.flushBeforeAppend) {
      this.flush();
    }

    const runtimeLedger = chatStreamRuntimeLedgerBridge.createTransportProjection(input, { accepted: true });
    this.messageBuffer.push(this.createTransportMessage(type, data, runtime, runtimeLedger, createdAt));

    if (options.flushAfterAppend) {
      this.flush();
    } else if (options.scheduleImmediateFlush !== false && this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, 0);
    }

    this.enqueueRuntimeLedgerAppend(input, type);
  }

  private enqueueRuntimeLedgerAppend(input: {
    conversationId: string;
    streamId: string;
    type: string;
    data: Record<string, any>;
    createdAt: number;
  }, type: string): void {
    const appendTask = this.appendQueue
      .catch(() => undefined)
      .then(async () => {
        let appendResult: ChatRuntimeLedgerAppendResult;
        try {
          appendResult = await chatStreamRuntimeLedgerBridge.appendStreamEvent(input);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appendResult = {
            accepted: false,
            diagnostics: [`append_failed:${type}:${message}`]
          };
          console.error('[StreamChunkProcessor] Runtime Ledger append failed:', error);
        }
        if (!appendResult.accepted) {
          console.warn('[StreamChunkProcessor] Runtime Ledger append rejected:', appendResult.diagnostics);
        }
      });

    this.appendQueue = appendTask.catch(error => {
      console.error('[StreamChunkProcessor] Runtime Ledger append queue failed:', error);
    });
  }

  private createTransportMessage(
    type: string,
    data: Record<string, any>,
    runtime: ReturnType<typeof chatStreamRuntimeLedgerBridge.getRuntimeIdentity>,
    runtimeLedger: ReturnType<typeof chatStreamRuntimeLedgerBridge.createTransportProjection>,
    createdAt: number
  ): Record<string, any> {
    const message: Record<string, any> = {
      conversationId: this.conversationId,
      streamId: this.streamId,
      type,
      runtime,
      runtimeLedger,
      createdAt
    };

    // Keep only small non-content auxiliary fields on the transport envelope.
    // Large content/tool/terminal payloads must be read from Runtime Ledger projection.
    if (Array.isArray(data.checkpoints)) {
      message.checkpoints = data.checkpoints;
    }
    if (type === 'autoSummaryStatus') {
      message.autoSummaryStatus = true;
      message.status = data.status;
      message.message = data.message;
    }
    if (type === 'autoSummary') {
      message.autoSummary = true;
      message.summaryContent = data.summaryContent;
      message.insertIndex = data.insertIndex;
    }
    if (type === 'contextCommand') {
      message.contextCommand = true;
      message.payload = data.payload;
    }

    return message;
  }
}
