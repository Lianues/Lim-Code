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
      result?: Record<string, unknown>;
    }>;
    terminalContent?: {
      type: 'toolsExecuting' | 'awaitingConfirmation' | 'toolIteration' | 'complete' | 'cancelled';
      messageId: string;
      contentId: string;
      content?: Record<string, unknown>;
      pendingToolCalls?: Array<Record<string, unknown>>;
      toolResults?: Array<Record<string, unknown>>;
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
        payload: this.sanitizeLiveDeltaPayload(input.data.chunk),
        source: 'runtime-ledger'
      };
    }

    if (this.isTerminalContentType(input.type) && this.asRecord(input.data?.content)) {
      const boundToolResults = this.getFunctionResponseBindings(input)
        .filter(binding => !binding.reason)
        .map(binding => binding.toolResult);
      projection.ledger.terminalContent = {
        type: input.type as ChatStreamRuntimeTransportProjection['ledger']['terminalContent']['type'],
        messageId: identity.messageId,
        contentId: identity.contentId,
        content: this.asRecord(input.data.content),
        pendingToolCalls: this.asRecordArray(input.data?.pendingToolCalls),
        toolResults: boundToolResults.length > 0 ? boundToolResults : undefined,
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
      projection.ledger.toolSnapshotsByInvocationId = {
        [invocationId]: {
          id: tool.id,
          name: typeof tool.name === 'string' ? tool.name : undefined,
          status,
          args: this.asRecord(tool.args),
          result: this.asRecord(tool.result)
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

  configureDurableStore(filePath: string): void {
    this.bootstrap = createDefaultRuntimeLedger({
      mode: 'canonical',
      store: new JsonlRuntimeLedgerStore(filePath)
    });
  }

  resetForTests(): void {
    this.bootstrap = createDefaultRuntimeLedger('canonical');
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

  private sanitizeLiveDeltaPayload(chunk: Record<string, any>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (Array.isArray(chunk.delta)) {
      payload.delta = chunk.delta.map((part: unknown) => this.sanitizeDeltaPart(part)).filter(Boolean);
    }
    if (chunk.contentSnapshot && typeof chunk.contentSnapshot === 'object') {
      payload.contentSnapshot = chunk.contentSnapshot;
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
      return source.thought === true ? { text: source.text, thought: true } : { text: source.text };
    }
    if (source.functionCall && typeof source.functionCall === 'object') {
      const fc = source.functionCall as Record<string, unknown>;
      const safeFunctionCall: Record<string, unknown> = {};
      for (const key of ['id', 'name', 'args', 'partialArgs', 'index', 'itemId', 'finalArgs', 'rejected']) {
        if (!(key in fc)) continue;
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
