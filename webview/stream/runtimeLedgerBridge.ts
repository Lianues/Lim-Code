/**
 * LimCode - Chat stream Runtime Ledger bridge
 *
 * 修改原因：主聊天需要由后端 Runtime Ledger projection 提供 identity、工具绑定和终态窗口事实。
 * 修改方式：StreamChunkProcessor 入队时生成 transport projection，并把轻量事件摘要写入 ledger。
 * 修改目的：让前端只消费统一 projection，避免在 UI 侧继续拼接散乱事件。
 */

import { createDefaultRuntimeLedger } from '../../backend/modules/runtimeLedger/defaults';
import { JsonlRuntimeLedgerStore } from '../../backend/modules/runtimeLedger/stores';
import type { RuntimeEventDraft, RuntimeEventEnvelope, RuntimePartialSnapshot } from '../../backend/modules/runtimeLedger';

function normalizeIdPart(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
  if (normalized === value && value.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 64)}_${stableIdHash(value)}`;
}

function stableIdHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function payloadKind(payload: unknown): string | undefined {
  if (payload === undefined || payload === null) return undefined;
  if (Array.isArray(payload)) return 'array';
  return typeof payload;
}

const TERMINAL_CONTENT_PREVIEW_BYTES = 4096;
const TERMINAL_TOOL_RESULT_PREVIEW_BYTES = 2048;
const TERMINAL_PENDING_TOOL_CALLS_PREVIEW_BYTES = 2048;
const TOOL_SNAPSHOT_FIELD_PREVIEW_BYTES = 2048;
const LIVE_DELTA_CONTENT_PREVIEW_BYTES = 4096;
const LIVE_DELTA_FUNCTION_FIELD_PREVIEW_BYTES = 1024;
const TERMINAL_REF_STORE_MAX_ENTRIES = 256;

export interface RuntimeTerminalPayloadRef {
  refId: string;
  kind: 'content'
    | 'toolResult'
    | 'pendingToolCalls'
    | 'toolArgs'
    | 'toolStatusResult'
    | 'liveDeltaContentSnapshot';
  byteLength: number;
  previewBytes: number;
  truncated: boolean;
  createdAt: number;
}

export interface RuntimeTerminalContentWindow {
  ref: RuntimeTerminalPayloadRef;
  payload?: unknown;
  serializedWindow?: string;
  window: {
    startBytes: number;
    endBytes: number;
    totalBytes: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  };
}

export interface ChatStreamRuntimeLedgerInput {
  conversationId: string;
  streamId: string;
  type: string;
  data: Record<string, any>;
  createdAt: number;
}

export interface ChatStreamRuntimeIdentity {
  conversationId: string;
  runId: string;
  messageId: string;
  contentId: string;
}

export interface ChatStreamRuntimeTransportProjection {
  status: 'ok' | 'degraded';
  identity: ChatStreamRuntimeIdentity;
  diagnostics?: string[];
  ledger: {
    liveDelta?: {
      type: 'chunk';
      messageId: string;
      contentId: string;
      payload: Record<string, unknown>;
      source: 'runtime-ledger';
    };
    toolStatesByInvocationId?: Record<string, 'queued' | 'executing' | 'success' | 'error' | 'cancelled'>;
    toolSnapshotsByInvocationId?: Record<string, {
      id: string;
      name?: string;
      status: 'queued' | 'executing' | 'success' | 'error' | 'cancelled';
      args?: Record<string, unknown>;
      argsRef?: RuntimeTerminalPayloadRef;
      argsTruncated?: boolean;
      result?: Record<string, unknown>;
      resultRef?: RuntimeTerminalPayloadRef;
      resultTruncated?: boolean;
    }>;
    terminalContent?: {
      type: 'toolsExecuting' | 'awaitingConfirmation' | 'toolIteration' | 'complete' | 'cancelled';
      messageId: string;
      contentId: string;
      contentRef?: RuntimeTerminalPayloadRef;
      contentTruncated?: boolean;
      content?: Record<string, unknown>;
      pendingToolCalls?: Array<Record<string, unknown>>;
      pendingToolCallsRef?: RuntimeTerminalPayloadRef;
      pendingToolCallsTruncated?: boolean;
      toolResults?: Array<Record<string, unknown>>;
      toolResultRefsById?: Record<string, RuntimeTerminalPayloadRef>;
      source: 'runtime-ledger';
    };
    terminalState?: {
      type: 'complete' | 'cancelled' | 'error';
      messageId: string;
      contentId: string;
      error?: Record<string, unknown>;
      source: 'runtime-ledger';
    };
  };
}

export interface ChatRuntimeLedgerAppendResult {
  accepted: boolean;
  diagnostics?: string[];
}

export interface ChatRuntimeLedgerMutationInput {
  conversationId: string;
  operation: 'delete_range' | 'delete_single' | 'clear' | 'restore' | string;
  createdAt?: number;
  targetIndex?: number;
  deletedCount?: number;
  messages?: Record<string, unknown>[];
  totalMessages?: number;
  checkpoints?: Record<string, unknown>[];
  activeBuild?: Record<string, unknown> | null;
}

export interface ChatRuntimeLedgerMutationProjection {
  status: 'ok' | 'degraded';
  identity: {
    conversationId: string;
    runId: string;
  };
  ledger: {
    mutation: {
      type: string;
      conversationId: string;
      runId: string;
      source: 'runtime-ledger';
      coverage?: {
        eventSequence: number;
        contentCoveredEventSequence?: number;
        replayAvailableTo?: number;
      };
      targetIndex?: number;
      deletedCount?: number;
      messageWindow?: {
        total: number;
        startIndex: number;
        messages: Record<string, unknown>[];
      };
      checkpoints?: Record<string, unknown>[];
      activeBuild?: Record<string, unknown> | null;
      diagnostics?: string[];
    };
  };
}

interface FunctionResponseBinding {
  toolResult: Record<string, any>;
  id?: string;
  reason?: 'missing_function_response_id'
    | 'duplicate_function_response_id'
    | 'unmatched_function_response_id'
    | 'ambiguous_function_response_id';
}

export class ChatStreamRuntimeLedgerBridge {
  private bootstrap = createDefaultRuntimeLedger('canonical');
  private terminalPayloadStore = new Map<string, {
    ref: RuntimeTerminalPayloadRef;
    payload: unknown;
    serialized: string;
  }>();
  private terminalPayloadOrder: string[] = [];
  private terminalPayloadCounter = 0;

  async appendStreamEvent(input: ChatStreamRuntimeLedgerInput): Promise<ChatRuntimeLedgerAppendResult> {
    const payload = this.summarize(input);
    const identity = this.getRuntimeIdentity(input.conversationId, input.streamId);
    const drafts: RuntimeEventDraft<Record<string, unknown>>[] = [{
      eventType: 'runtime.chat.stream_event',
      kind: 'integration',
      context: 'chat',
      subject: 'stream',
      conversationId: identity.conversationId,
      runId: identity.runId,
      messageId: identity.messageId,
      contentId: this.hasContentIdentity(input) ? identity.contentId : undefined,
      toolInvocationId: typeof input.data?.tool?.id === 'string'
        ? `tool:chat:${normalizeIdPart(input.data.tool.id)}`
        : undefined,
      persistence: 'ephemeral',
      timestamp: input.createdAt,
      payload,
      payloadSummary: {
        kind: 'json',
        bytes: JSON.stringify(payload).length,
        redacted: true
      }
    }];
    drafts.push(...this.createToolEventDrafts(input));

    const diagnostics: string[] = [];
    for (const draft of drafts) {
      try {
        const result = await this.bootstrap.ledger.append(draft);
        if (!result.accepted) {
          const diagnostic = `append_failed:${draft.eventType}:${result.diagnostic || 'unknown'}`;
          diagnostics.push(diagnostic);
          console.warn('[ChatStreamRuntimeLedgerBridge] Runtime Ledger append rejected:', result.diagnostic);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const diagnostic = `append_failed:${draft.eventType}:${message}`;
        diagnostics.push(diagnostic);
        console.warn('[ChatStreamRuntimeLedgerBridge] Runtime Ledger append threw:', message);
      }
    }

    return {
      accepted: diagnostics.length === 0,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined
    };
  }

  getRuntimeIdentity(conversationId: string, streamId: string): ChatStreamRuntimeIdentity {
    return {
      conversationId: this.toRuntimeConversationId(conversationId),
      runId: this.toRuntimeRunId(streamId),
      messageId: `msg:stream:${normalizeIdPart(streamId)}`,
      contentId: `cnt:stream:${normalizeIdPart(streamId)}`
    };
  }

  async createMutationProjection(input: ChatRuntimeLedgerMutationInput): Promise<ChatRuntimeLedgerMutationProjection> {
    const createdAt = input.createdAt ?? Date.now();
    const conversationId = this.toRuntimeConversationId(input.conversationId);
    const runId = this.toRuntimeMutationRunId(input.operation, createdAt);
    const payload = {
      operation: input.operation,
      targetIndex: typeof input.targetIndex === 'number' ? input.targetIndex : undefined,
      deletedCount: typeof input.deletedCount === 'number' ? input.deletedCount : undefined,
      messageCount: typeof input.totalMessages === 'number' ? input.totalMessages : input.messages?.length,
      checkpointCount: input.checkpoints?.length,
      hasActiveBuild: Boolean(input.activeBuild)
    };
    const appendResult = await this.bootstrap.ledger.append({
      eventType: 'runtime.chat.mutation',
      kind: 'domain',
      context: 'mutation',
      subject: 'transcript',
      conversationId,
      runId,
      persistence: 'durable',
      timestamp: createdAt,
      payload,
      payloadSummary: {
        kind: 'json',
        bytes: JSON.stringify(payload).length,
        redacted: true
      }
    });

    const diagnostics = appendResult.accepted ? [] : [`append_failed:${appendResult.diagnostic || 'unknown'}`];
    const firstIndex = this.getFirstContentIndex(input.messages);
    return {
      status: appendResult.accepted ? 'ok' : 'degraded',
      identity: {
        conversationId,
        runId
      },
      ledger: {
        mutation: {
          type: input.operation,
          conversationId,
          runId,
          source: 'runtime-ledger',
          coverage: appendResult.event?.coverage
            ? {
              eventSequence: appendResult.event.coverage.eventSequence,
              contentCoveredEventSequence: appendResult.event.coverage.contentCoveredEventSequence,
              replayAvailableTo: appendResult.event.coverage.replayAvailableTo
            }
            : undefined,
          targetIndex: input.targetIndex,
          deletedCount: input.deletedCount,
          messageWindow: input.messages
            ? {
              total: typeof input.totalMessages === 'number' ? input.totalMessages : input.messages.length,
              startIndex: firstIndex,
              messages: input.messages
            }
            : undefined,
          checkpoints: input.checkpoints,
          activeBuild: input.activeBuild,
          diagnostics: diagnostics.length > 0 ? diagnostics : undefined
        }
      }
    };
  }

  createTransportProjection(
    input: ChatStreamRuntimeLedgerInput,
    appendResult: ChatRuntimeLedgerAppendResult = { accepted: true }
  ): ChatStreamRuntimeTransportProjection {
    const identity = this.getRuntimeIdentity(input.conversationId, input.streamId);
    const projection: ChatStreamRuntimeTransportProjection = {
      status: appendResult.accepted ? 'ok' : 'degraded',
      identity,
      diagnostics: appendResult.diagnostics,
      ledger: {}
    };

    if (input.type === 'chunk' && input.data?.chunk) {
      projection.ledger.liveDelta = {
        type: 'chunk',
        messageId: identity.messageId,
        contentId: identity.contentId,
        payload: this.sanitizeLiveDeltaPayload(input.data.chunk, input),
        source: 'runtime-ledger'
      };
    }

    if (this.isTerminalContentType(input.type) && this.asRecord(input.data?.content)) {
      const content = this.asRecord(input.data.content)!;
      const contentProjection = this.createBoundedTerminalPayloadRef(
        content,
        'content',
        TERMINAL_CONTENT_PREVIEW_BYTES,
        input,
        'terminal-content'
      );
      const boundToolResults = this.getFunctionResponseBindings(input)
        .filter(binding => !binding.reason)
        .map(binding => binding.toolResult);
      const boundedToolResults = this.createBoundedToolResults(input, boundToolResults);
      const boundedPendingToolCalls = this.createBoundedPendingToolCalls(input);
      projection.ledger.terminalContent = {
        type: input.type as ChatStreamRuntimeTransportProjection['ledger']['terminalContent']['type'],
        messageId: identity.messageId,
        contentId: identity.contentId,
        contentRef: contentProjection.ref,
        contentTruncated: Boolean(contentProjection.ref?.truncated),
        content: contentProjection.payload as Record<string, unknown>,
        pendingToolCalls: boundedPendingToolCalls.pendingToolCalls,
        pendingToolCallsRef: boundedPendingToolCalls.ref,
        pendingToolCallsTruncated: Boolean(boundedPendingToolCalls.ref?.truncated),
        toolResults: boundedToolResults.results,
        toolResultRefsById: boundedToolResults.refsById,
        source: 'runtime-ledger'
      };
    }

    if (input.type === 'complete' || input.type === 'cancelled' || input.type === 'error') {
      projection.ledger.terminalState = {
        type: input.type as ChatStreamRuntimeTransportProjection['ledger']['terminalState']['type'],
        messageId: identity.messageId,
        contentId: identity.contentId,
        error: this.asRecord(input.data?.error),
        source: 'runtime-ledger'
      };
    }

    const tool = input.data?.tool;
    if (tool && typeof tool.id === 'string' && typeof tool.status === 'string') {
      const invocationId = `tool:chat:${normalizeIdPart(tool.id)}`;
      const status = this.toRuntimeToolState(tool.status);
      projection.ledger.toolStatesByInvocationId = {
        [invocationId]: status
      };
      const argsProjection = this.createBoundedToolSnapshotField(
        tool.args,
        'toolArgs',
        input,
        `tool-args-${normalizeIdPart(tool.id)}`
      );
      const resultProjection = this.createBoundedToolSnapshotField(
        tool.result,
        'toolStatusResult',
        input,
        `tool-result-${normalizeIdPart(tool.id)}`
      );
      projection.ledger.toolSnapshotsByInvocationId = {
        [invocationId]: {
          id: tool.id,
          name: typeof tool.name === 'string' ? tool.name : undefined,
          status,
          args: this.asRecord(argsProjection.payload),
          argsRef: argsProjection.ref,
          argsTruncated: Boolean(argsProjection.ref?.truncated),
          result: this.asRecord(resultProjection.payload),
          resultRef: resultProjection.ref,
          resultTruncated: Boolean(resultProjection.ref?.truncated)
        }
      };
    }

    return projection;
  }

  async getEvents(): Promise<RuntimeEventEnvelope[]> {
    const replay = await this.bootstrap.ledger.getEvents({});
    return replay.events;
  }

  async getPartialSnapshotForStream(
    conversationId: string,
    streamId: string
  ): Promise<RuntimePartialSnapshot<Record<string, unknown>>> {
    return await this.bootstrap.ledger.getPartialSnapshot({
      conversationId: this.toRuntimeConversationId(conversationId),
      runId: this.toRuntimeRunId(streamId)
    });
  }

  getTerminalContentWindow(
    refId: string,
    options: { startBytes?: number; maxBytes?: number; includePayload?: boolean } = {}
  ): RuntimeTerminalContentWindow | undefined {
    const entry = this.terminalPayloadStore.get(refId);
    if (!entry) return undefined;

    const totalBytes = this.utf8ByteLength(entry.serialized);
    const hasRange = typeof options.startBytes === 'number' || typeof options.maxBytes === 'number';
    const startBytes = Math.max(0, Math.min(totalBytes, Math.floor(options.startBytes ?? 0)));
    const maxBytes = Math.max(0, Math.floor(options.maxBytes ?? totalBytes));
    const serializedWindow = hasRange
      ? this.sliceUtf8ByBytes(entry.serialized, startBytes, maxBytes)
      : undefined;
    const endBytes = hasRange
      ? Math.min(totalBytes, startBytes + this.utf8ByteLength(serializedWindow || ''))
      : totalBytes;
    const includePayload = options.includePayload ?? !hasRange;

    return {
      ref: entry.ref,
      payload: includePayload ? entry.payload : undefined,
      serializedWindow,
      window: {
        startBytes,
        endBytes,
        totalBytes,
        hasMoreBefore: startBytes > 0,
        hasMoreAfter: endBytes < totalBytes
      }
    };
  }

  configureDurableStore(filePath: string): void {
    this.bootstrap = createDefaultRuntimeLedger({
      mode: 'canonical',
      store: new JsonlRuntimeLedgerStore(filePath)
    });
    this.terminalPayloadStore.clear();
    this.terminalPayloadOrder = [];
    this.terminalPayloadCounter = 0;
  }

  resetForTests(): void {
    this.bootstrap = createDefaultRuntimeLedger('canonical');
    this.terminalPayloadStore.clear();
    this.terminalPayloadOrder = [];
    this.terminalPayloadCounter = 0;
  }

  private summarize(input: ChatStreamRuntimeLedgerInput): Record<string, unknown> {
    const keys = Object.keys(input.data || {}).sort();
    return {
      sourceType: input.type,
      keyCount: keys.length,
      keys,
      hasChunk: Boolean(input.data?.chunk),
      hasContent: Boolean(input.data?.content),
      hasTool: Boolean(input.data?.tool),
      hasPendingToolCalls: Array.isArray(input.data?.pendingToolCalls),
      hasCheckpoints: Array.isArray(input.data?.checkpoints),
      errorCode: typeof input.data?.error?.code === 'string' ? input.data.error.code : undefined
    };
  }

  private sanitizeLiveDeltaPayload(
    chunk: Record<string, any>,
    input: ChatStreamRuntimeLedgerInput
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (Array.isArray(chunk.delta)) {
      payload.delta = chunk.delta.map((part: unknown) => this.sanitizeDeltaPart(part)).filter(Boolean);
    }
    if (chunk.contentSnapshot && typeof chunk.contentSnapshot === 'object') {
      const contentProjection = this.createBoundedTerminalPayloadRef(
        chunk.contentSnapshot,
        'liveDeltaContentSnapshot',
        LIVE_DELTA_CONTENT_PREVIEW_BYTES,
        input,
        'live-delta-content-snapshot'
      );
      payload.contentSnapshot = contentProjection.payload;
      if (contentProjection.ref) {
        payload.contentSnapshotRef = contentProjection.ref;
        payload.contentSnapshotTruncated = true;
      }
    }
    if (chunk.done === true) payload.done = true;
    if (chunk.usage && typeof chunk.usage === 'object') payload.usage = chunk.usage;
    if (typeof chunk.modelVersion === 'string') payload.modelVersion = chunk.modelVersion;
    if (typeof chunk.thinkingStartTime === 'number') payload.thinkingStartTime = chunk.thinkingStartTime;
    return payload;
  }

  private sanitizeDeltaPart(part: unknown): Record<string, unknown> | undefined {
    if (!part || typeof part !== 'object') return undefined;
    const source = part as Record<string, any>;
    if (typeof source.text === 'string') {
      const bounded = this.createBoundedStructuredValue(source.text, LIVE_DELTA_CONTENT_PREVIEW_BYTES);
      const textPart: Record<string, unknown> = { text: bounded.value };
      if (source.thought === true) textPart.thought = true;
      if (bounded.truncated) {
        textPart.textTruncated = true;
        textPart.textByteLength = bounded.byteLength;
      }
      return textPart;
    }
    if (source.functionCall && typeof source.functionCall === 'object') {
      const fc = source.functionCall as Record<string, unknown>;
      const safeFunctionCall: Record<string, unknown> = {};
      for (const key of ['id', 'name', 'args', 'partialArgs', 'index', 'itemId', 'finalArgs', 'rejected']) {
        if (!(key in fc)) continue;
        if (key === 'args' || key === 'partialArgs' || key === 'finalArgs') {
          const bounded = this.createBoundedStructuredValue(fc[key], LIVE_DELTA_FUNCTION_FIELD_PREVIEW_BYTES);
          safeFunctionCall[key] = bounded.value;
          if (bounded.truncated) {
            safeFunctionCall[`${key}Truncated`] = true;
            safeFunctionCall[`${key}ByteLength`] = bounded.byteLength;
          }
          continue;
        }
        safeFunctionCall[key] = fc[key];
      }
      return Object.keys(safeFunctionCall).length > 0 ? { functionCall: safeFunctionCall } : undefined;
    }
    return undefined;
  }

  private toRuntimeToolState(status: string): 'queued' | 'executing' | 'success' | 'error' | 'cancelled' {
    if (status === 'queued') return 'queued';
    if (status === 'executing' || status === 'awaiting_apply') return 'executing';
    if (status === 'success' || status === 'warning') return 'success';
    if (status === 'cancelled' || status === 'canceled') return 'cancelled';
    return 'error';
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private asRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
    if (!Array.isArray(value)) return undefined;
    const records = value.filter(item => this.asRecord(item)) as Array<Record<string, unknown>>;
    return records.length > 0 ? records : undefined;
  }

  private createBoundedStructuredValue(
    value: unknown,
    maxBytes: number
  ): { value: unknown; truncated: boolean; byteLength: number } {
    const byteLength = this.estimateJsonBytes(value);
    if (byteLength <= maxBytes) {
      return { value, truncated: false, byteLength };
    }
    return {
      value: this.createStructuredPreview(value, maxBytes),
      truncated: true,
      byteLength
    };
  }

  private createBoundedToolSnapshotField(
    value: unknown,
    kind: RuntimeTerminalPayloadRef['kind'],
    input: ChatStreamRuntimeLedgerInput,
    suffix: string
  ): { payload: unknown; ref?: RuntimeTerminalPayloadRef } {
    if (value === undefined || value === null) return { payload: undefined };
    return this.createBoundedTerminalPayloadRef(
      value,
      kind,
      TOOL_SNAPSHOT_FIELD_PREVIEW_BYTES,
      input,
      suffix
    );
  }

  private createBoundedPendingToolCalls(
    input: ChatStreamRuntimeLedgerInput
  ): { pendingToolCalls?: Array<Record<string, unknown>>; ref?: RuntimeTerminalPayloadRef } {
    const pendingToolCalls = this.asRecordArray(input.data?.pendingToolCalls);
    if (!pendingToolCalls) return {};
    const projection = this.createBoundedTerminalPayloadRef(
      pendingToolCalls,
      'pendingToolCalls',
      TERMINAL_PENDING_TOOL_CALLS_PREVIEW_BYTES,
      input,
      'pending-tool-calls'
    );
    return {
      pendingToolCalls: this.asRecordArray(projection.payload),
      ref: projection.ref
    };
  }

  private createBoundedTerminalPayloadRef(
    payload: unknown,
    kind: RuntimeTerminalPayloadRef['kind'],
    previewBytes: number,
    input: ChatStreamRuntimeLedgerInput,
    suffix: string
  ): { payload: unknown; ref?: RuntimeTerminalPayloadRef } {
    const serialized = this.safeStringify(payload);
    const byteLength = this.utf8ByteLength(serialized);
    if (byteLength <= previewBytes) {
      return { payload };
    }

    const ref = this.storeTerminalPayload(payload, serialized, kind, byteLength, previewBytes, input, suffix);
    const previewPayload = kind === 'content'
      ? this.createTerminalContentPreview(payload, previewBytes)
      : this.createStructuredPreview(payload, previewBytes);
    return { payload: previewPayload, ref };
  }

  private createBoundedToolResults(
    input: ChatStreamRuntimeLedgerInput,
    toolResults: Record<string, any>[]
  ): {
    results?: Array<Record<string, unknown>>;
    refsById?: Record<string, RuntimeTerminalPayloadRef>;
  } {
    if (toolResults.length === 0) return {};

    const results: Array<Record<string, unknown>> = [];
    const refsById: Record<string, RuntimeTerminalPayloadRef> = {};
    for (let index = 0; index < toolResults.length; index++) {
      const toolResult = toolResults[index];
      const id = this.getTrimmedId(toolResult.id) || `index:${index}`;
      const projection = this.createBoundedTerminalPayloadRef(
        toolResult,
        'toolResult',
        TERMINAL_TOOL_RESULT_PREVIEW_BYTES,
        input,
        `tool-result-${normalizeIdPart(id)}`
      );
      const projectedResult = this.asRecord(projection.payload) || {};
      if (projection.ref) {
        refsById[id] = projection.ref;
        projectedResult.runtimeLedgerRef = projection.ref;
      }
      results.push(projectedResult);
    }

    return {
      results,
      refsById: Object.keys(refsById).length > 0 ? refsById : undefined
    };
  }

  private storeTerminalPayload(
    payload: unknown,
    serialized: string,
    kind: RuntimeTerminalPayloadRef['kind'],
    byteLength: number,
    previewBytes: number,
    input: ChatStreamRuntimeLedgerInput,
    suffix: string
  ): RuntimeTerminalPayloadRef {
    const refId = [
      'rtterm',
      normalizeIdPart(input.conversationId),
      normalizeIdPart(input.streamId),
      normalizeIdPart(input.type),
      normalizeIdPart(String(input.createdAt)),
      normalizeIdPart(suffix),
      (++this.terminalPayloadCounter).toString(36),
      stableIdHash(serialized)
    ].join(':');
    const ref: RuntimeTerminalPayloadRef = {
      refId,
      kind,
      byteLength,
      previewBytes,
      truncated: true,
      createdAt: input.createdAt
    };

    this.terminalPayloadStore.set(refId, { ref, payload, serialized });
    this.terminalPayloadOrder.push(refId);
    while (this.terminalPayloadOrder.length > TERMINAL_REF_STORE_MAX_ENTRIES) {
      const staleRefId = this.terminalPayloadOrder.shift();
      if (staleRefId) this.terminalPayloadStore.delete(staleRefId);
    }

    return ref;
  }

  private createTerminalContentPreview(payload: unknown, maxBytes: number): unknown {
    const content = this.asRecord(payload);
    if (!content) return this.createStructuredPreview(payload, maxBytes);

    for (const textLimit of [1024, 512, 256, 128]) {
      const preview = {
        ...content,
        parts: this.previewContentParts(content.parts, textLimit)
      };
      if (this.estimateJsonBytes(preview) <= maxBytes) {
        return preview;
      }
    }

    return {
      role: content.role || 'model',
      parts: [{
        text: '[Runtime Ledger preview truncated; fetch the referenced content window for full payload.]'
      }],
      usageMetadata: content.usageMetadata,
      modelVersion: content.modelVersion,
      thinkingDuration: content.thinkingDuration,
      responseDuration: content.responseDuration,
      streamDuration: content.streamDuration,
      firstChunkTime: content.firstChunkTime,
      chunkCount: content.chunkCount
    };
  }

  private previewContentParts(value: unknown, textLimit: number): unknown[] {
    if (!Array.isArray(value)) return [];
    const sourceParts = value.slice(0, 40);
    const parts = sourceParts
      .map(part => this.previewContentPart(part, textLimit))
      .filter(Boolean);
    if (value.length > sourceParts.length) {
      parts.push({
        text: `[Runtime Ledger preview omitted ${value.length - sourceParts.length} additional parts.]`
      });
    }
    return parts;
  }

  private previewContentPart(part: unknown, textLimit: number): unknown {
    const source = this.asRecord(part);
    if (!source) return undefined;
    const preview: Record<string, unknown> = { ...source };
    if (typeof source.text === 'string') {
      preview.text = this.truncateStringByBytes(source.text, textLimit);
    }
    const functionCall = this.asRecord(source.functionCall);
    if (functionCall) {
      preview.functionCall = {
        ...functionCall,
        args: this.createStructuredPreview(functionCall.args, Math.max(512, textLimit))
      };
    }
    const functionResponse = this.asRecord(source.functionResponse);
    if (functionResponse) {
      preview.functionResponse = {
        ...functionResponse,
        response: this.createStructuredPreview(functionResponse.response, Math.max(512, textLimit))
      };
    }
    const inlineData = this.asRecord(source.inlineData);
    if (inlineData && typeof inlineData.data === 'string') {
      preview.inlineData = {
        ...inlineData,
        data: this.truncateStringByBytes(inlineData.data, 256),
        runtimeLedgerPreviewTruncated: this.utf8ByteLength(inlineData.data) > 256
      };
    }
    return preview;
  }

  private createStructuredPreview(value: unknown, maxBytes: number, depth = 0): unknown {
    if (this.estimateJsonBytes(value) <= maxBytes) return value;
    if (typeof value === 'string') return this.truncateStringByBytes(value, maxBytes);
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (depth >= 3) {
      return {
        runtimeLedgerPreviewTruncated: true,
        kind: payloadKind(value),
        byteLength: this.estimateJsonBytes(value)
      };
    }

    if (Array.isArray(value)) {
      const items = value.slice(0, 20).map(item => this.createStructuredPreview(item, Math.max(256, Math.floor(maxBytes / 4)), depth + 1));
      if (value.length > items.length) {
        items.push({
          runtimeLedgerPreviewOmitted: value.length - items.length
        });
      }
      return this.estimateJsonBytes(items) <= maxBytes
        ? items
        : items.slice(0, 5);
    }

    const source = value as Record<string, unknown>;
    const preview: Record<string, unknown> = {
      runtimeLedgerPreviewTruncated: true,
      byteLength: this.estimateJsonBytes(value)
    };
    const priorityKeys = [
      'success',
      'status',
      'error',
      'message',
      'cancelled',
      'canceled',
      'rejected',
      'requiresUserConfirmation',
      'data',
      'file',
      'path',
      'diffContentId',
      'pendingDiffId',
      'appliedCount',
      'failedCount',
      'autoSaveError',
      'diffGuardWarning',
      'diffGuardDeletePercent',
      'id',
      'name'
    ];
    for (const key of priorityKeys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        preview[key] = this.createStructuredPreview(source[key], Math.max(256, Math.floor(maxBytes / 4)), depth + 1);
      }
    }
    for (const key of Object.keys(source)) {
      if (Object.prototype.hasOwnProperty.call(preview, key)) continue;
      if (Object.keys(preview).length >= 24) break;
      preview[key] = this.createStructuredPreview(source[key], Math.max(256, Math.floor(maxBytes / 6)), depth + 1);
      if (this.estimateJsonBytes(preview) > maxBytes) {
        delete preview[key];
        break;
      }
    }
    return preview;
  }

  private estimateJsonBytes(value: unknown): number {
    return this.utf8ByteLength(this.safeStringify(value));
  }

  private safeStringify(value: unknown): string {
    try {
      const serialized = JSON.stringify(value);
      return typeof serialized === 'string' ? serialized : 'null';
    } catch {
      return JSON.stringify(String(value));
    }
  }

  private utf8ByteLength(text: string): number {
    return Buffer.byteLength(text, 'utf8');
  }

  private truncateStringByBytes(text: string, maxBytes: number): string {
    if (this.utf8ByteLength(text) <= maxBytes) return text;
    const marker = '\n[Runtime Ledger preview truncated.]';
    const markerBytes = this.utf8ByteLength(marker);
    return `${this.sliceUtf8ByBytes(text, 0, Math.max(0, maxBytes - markerBytes))}${marker}`;
  }

  private sliceUtf8ByBytes(text: string, startBytes: number, maxBytes: number): string {
    if (maxBytes <= 0) return '';
    let currentBytes = 0;
    let outputBytes = 0;
    let output = '';

    for (const char of text) {
      const charBytes = this.utf8ByteLength(char);
      if (currentBytes + charBytes <= startBytes) {
        currentBytes += charBytes;
        continue;
      }
      if (outputBytes + charBytes > maxBytes) {
        break;
      }
      output += char;
      outputBytes += charBytes;
      currentBytes += charBytes;
    }

    return output;
  }

  private isTerminalContentType(type: string): boolean {
    return type === 'toolsExecuting'
      || type === 'awaitingConfirmation'
      || type === 'toolIteration'
      || type === 'complete'
      || type === 'cancelled';
  }

  private getFirstContentIndex(messages: Record<string, unknown>[] | undefined): number {
    if (!messages || messages.length === 0) return 0;
    const index = messages[0]?.index;
    return typeof index === 'number' && Number.isFinite(index) ? index : 0;
  }

  private createToolEventDrafts(input: ChatStreamRuntimeLedgerInput): RuntimeEventDraft<Record<string, unknown>>[] {
    const drafts: RuntimeEventDraft<Record<string, unknown>>[] = [];
    const conversationId = this.toRuntimeConversationId(input.conversationId);
    const runId = this.toRuntimeRunId(input.streamId);
    const messageId = this.getRuntimeIdentity(input.conversationId, input.streamId).messageId;

    const tool = input.data?.tool;
    if (tool && typeof tool.id === 'string' && typeof tool.status === 'string') {
      const payload = this.summarizeToolLifecycle(input.type, tool);
      drafts.push({
        eventType: 'runtime.tool.lifecycle',
        kind: 'domain',
        context: 'tool',
        subject: 'toolInvocation',
        conversationId,
        runId,
        messageId,
        toolInvocationId: `tool:chat:${normalizeIdPart(tool.id)}`,
        persistence: 'durable',
        timestamp: input.createdAt,
        payload,
        payloadSummary: {
          kind: 'json',
          bytes: JSON.stringify(payload).length,
          redacted: true
        }
      });
    }

    if (input.type === 'toolIteration' || input.type === 'awaitingConfirmation') {
      for (const binding of this.getFunctionResponseBindings(input)) {
        const toolResult = binding.toolResult;
        if (binding.reason) {
          const payload = {
            sourceType: input.type,
            reason: binding.reason,
            functionResponseId: binding.id,
            toolName: typeof toolResult?.name === 'string' ? toolResult.name : undefined
          };
          drafts.push({
            eventType: 'runtime.tool.function_response_unbound',
            kind: 'diagnostic',
            context: 'diagnostic',
            subject: 'functionResponse',
            conversationId,
            runId,
            messageId,
            persistence: 'durable',
            timestamp: input.createdAt,
            payload,
            payloadSummary: {
              kind: 'json',
              bytes: JSON.stringify(payload).length,
              redacted: true
            }
          });
          continue;
        }
        const payload = this.summarizeFunctionResponse(input.type, toolResult);
        drafts.push({
          eventType: 'runtime.tool.function_response',
          kind: 'domain',
          context: 'tool',
          subject: 'functionResponse',
          conversationId,
          runId,
          messageId,
          toolInvocationId: `tool:chat:${normalizeIdPart(binding.id!)}`,
          persistence: 'durable',
          timestamp: input.createdAt,
          payload,
          payloadSummary: {
            kind: 'json',
            bytes: JSON.stringify(payload).length,
            redacted: true
          }
        });
      }
    }

    return drafts;
  }

  private getFunctionResponseBindings(input: ChatStreamRuntimeLedgerInput): FunctionResponseBinding[] {
    if (!Array.isArray(input.data?.toolResults)) return [];

    const toolResults = input.data.toolResults
      .map((toolResult: unknown) => this.asRecord(toolResult) as Record<string, any> | undefined)
      .filter((toolResult): toolResult is Record<string, any> => Boolean(toolResult));
    if (toolResults.length === 0) return [];

    const functionCallIdCounts = this.collectFunctionCallIdCounts(input.data?.content);
    const toolResultIdCounts = new Map<string, number>();
    for (const toolResult of toolResults) {
      const id = this.getTrimmedId(toolResult.id);
      if (!id) continue;
      toolResultIdCounts.set(id, (toolResultIdCounts.get(id) || 0) + 1);
    }

    return toolResults.map(toolResult => {
      const id = this.getTrimmedId(toolResult.id);
      if (!id) {
        return { toolResult, reason: 'missing_function_response_id' };
      }
      if ((toolResultIdCounts.get(id) || 0) > 1) {
        return { toolResult, id, reason: 'duplicate_function_response_id' };
      }
      const functionCallCount = functionCallIdCounts.get(id) || 0;
      if (functionCallCount === 0) {
        return { toolResult, id, reason: 'unmatched_function_response_id' };
      }
      if (functionCallCount > 1) {
        return { toolResult, id, reason: 'ambiguous_function_response_id' };
      }
      return { toolResult, id };
    });
  }

  private collectFunctionCallIdCounts(content: unknown): Map<string, number> {
    const counts = new Map<string, number>();
    const record = this.asRecord(content);
    const parts = Array.isArray(record?.parts) ? record.parts : [];
    for (const part of parts) {
      const partRecord = this.asRecord(part);
      const functionCall = this.asRecord(partRecord?.functionCall);
      const id = this.getTrimmedId(functionCall?.id);
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  private getTrimmedId(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private summarizeToolLifecycle(sourceType: string, tool: Record<string, any>): Record<string, unknown> {
    return {
      sourceType,
      phase: String(tool.status),
      toolName: typeof tool.name === 'string' ? tool.name : undefined,
      hasArgs: Boolean(tool.args && typeof tool.args === 'object'),
      hasResult: Boolean(tool.result)
    };
  }

  private summarizeFunctionResponse(sourceType: string, toolResult: Record<string, any>): Record<string, unknown> {
    return {
      sourceType,
      toolName: typeof toolResult.name === 'string' ? toolResult.name : undefined,
      isError: this.isErrorResult(toolResult.result),
      resultKind: payloadKind(toolResult.result),
      hasArgs: Boolean(toolResult.args && typeof toolResult.args === 'object')
    };
  }

  private isErrorResult(result: unknown): boolean {
    const r = result as any;
    return Boolean(r?.success === false || r?.error || r?.cancelled || r?.rejected);
  }

  private hasContentIdentity(input: ChatStreamRuntimeLedgerInput): boolean {
    return Boolean(input.data?.chunk || input.data?.content);
  }

  private toRuntimeConversationId(conversationId: string): string {
    return `conv:chat:${normalizeIdPart(conversationId)}`;
  }

  private toRuntimeRunId(streamId: string): string {
    return `run:stream:${normalizeIdPart(streamId)}`;
  }

  private toRuntimeMutationRunId(operation: string, createdAt: number): string {
    return `run:mutation:${normalizeIdPart(operation)}:${normalizeIdPart(String(createdAt))}`;
  }
}

export const chatStreamRuntimeLedgerBridge = new ChatStreamRuntimeLedgerBridge();
