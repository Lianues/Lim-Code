/**
 * LimCode - Runtime Ledger shared types
 *
 * 修改原因：Runtime Ledger 需要先有稳定的事件信封、identity、coverage 和 replay 契约，避免继续让前端猜测运行时事实。
 * 修改方式：把可测试的公共类型集中在一个后端模块，后续 chat、Monitor、SubAgent 和工具状态逐步接入。
 * 修改目的：让新系统先成为可验证的事实层，再迁移旧热路径。
 */

export type RuntimeEventKind = 'command' | 'query' | 'domain' | 'integration' | 'diagnostic';

export type RuntimeEventContext =
    | 'chat'
    | 'subagent'
    | 'monitor'
    | 'tool'
    | 'content'
    | 'projection'
    | 'mutation'
    | 'diagnostic'
    | 'system';

export type RuntimeEventPersistence = 'durable' | 'ephemeral' | 'snapshot' | 'derived';

export type RuntimeLedgerMode = 'canonical' | 'shadow' | 'diagnostic';

export interface RuntimePayloadSummary {
    kind: 'empty' | 'text' | 'json' | 'binary' | 'redacted' | 'ref';
    bytes: number;
    hash?: string;
    preview?: string;
    redacted?: boolean;
}

export interface RuntimePayloadRef {
    uri: string;
    bytes?: number;
    hash?: string;
}

export interface RuntimeCoverage {
    eventSequence: number;
    contentRevision?: number;
    contentCoveredEventSequence?: number;
    partialCoveredEventSequence?: number;
    replayAvailableFrom?: number;
    replayAvailableTo?: number;
}

export interface RuntimeEventEnvelope<TPayload = unknown> {
    eventId: string;
    eventType: string;
    kind: RuntimeEventKind;
    context: RuntimeEventContext;
    subject: string;
    schemaVersion: number;
    sequence: number;
    timestamp: number;
    conversationId: string;
    runId: string;
    messageId?: string;
    contentId?: string;
    toolInvocationId?: string;
    causationId?: string;
    correlationId?: string;
    persistence: RuntimeEventPersistence;
    coverage?: RuntimeCoverage;
    payloadSummary: RuntimePayloadSummary;
    payloadRef?: RuntimePayloadRef;
    payload?: TPayload;
}

export interface RuntimeEventDraft<TPayload = unknown> {
    eventId?: string;
    eventType: string;
    kind: RuntimeEventKind;
    context: RuntimeEventContext;
    subject: string;
    schemaVersion?: number;
    timestamp?: number;
    conversationId: string;
    runId: string;
    messageId?: string;
    contentId?: string;
    toolInvocationId?: string;
    causationId?: string;
    correlationId?: string;
    persistence: RuntimeEventPersistence;
    coverage?: Omit<RuntimeCoverage, 'eventSequence'> & { eventSequence?: number };
    payloadSummary?: RuntimePayloadSummary;
    payloadRef?: RuntimePayloadRef;
    payload?: TPayload;
}

export interface RuntimeLedgerScope {
    conversationId?: string;
    runId?: string;
    context?: RuntimeEventContext;
    subject?: string;
}

export interface RuntimeReplayCursor extends RuntimeLedgerScope {
    afterSequence?: number;
    fromSequence?: number;
    limit?: number;
}

export interface RuntimeReplayResult<TPayload = unknown> {
    events: RuntimeEventEnvelope<TPayload>[];
    replayAvailableFrom?: number;
    replayAvailableTo?: number;
    truncated: boolean;
    degradedReason?: string;
}

export interface RuntimeProjection {
    projectionId: string;
    scopeKey: string;
    generatedAt: number;
    lastEventSequence: number;
    status: 'ok' | 'degraded';
    diagnostics: string[];
    eventCountsByType: Record<string, number>;
    eventCountsByContext: Record<string, number>;
    toolStatesByInvocationId: Record<string, 'queued' | 'executing' | 'success' | 'error' | 'cancelled'>;
}

export interface RuntimeDiagnostic {
    diagnosticId: string;
    code: string;
    message: string;
    timestamp: number;
    scopeKey: string;
    eventType?: string;
    conversationId?: string;
    runId?: string;
}

export interface RuntimePartialSnapshot<TPayload = unknown> {
    scopeKey: string;
    projection: RuntimeProjection;
    coverage?: RuntimeCoverage;
    recentEvents: RuntimeEventEnvelope<TPayload>[];
    recentEventCount?: number;
    totalEventCount?: number;
    replayAvailableFrom?: number;
    replayAvailableTo?: number;
    truncated: boolean;
}

export interface RuntimeLedgerAppendResult<TPayload = unknown> {
    accepted: boolean;
    event?: RuntimeEventEnvelope<TPayload>;
    diagnostic?: string;
}

export interface RuntimeLedgerStore {
    append<TPayload>(event: RuntimeEventEnvelope<TPayload>): Promise<void> | void;
    list<TPayload>(): Promise<RuntimeEventEnvelope<TPayload>[]> | RuntimeEventEnvelope<TPayload>[];
}

export interface RuntimeSchemaDefinition<TPayload = unknown> {
    name: string;
    version: number;
    validate?: (payload: TPayload) => void;
}

export interface RuntimeEventDefinition<TPayload = unknown> {
    eventType: string;
    kind: RuntimeEventKind;
    context: RuntimeEventContext;
    subject: string;
    persistence: RuntimeEventPersistence;
    schema: RuntimeSchemaDefinition<TPayload>;
}

export interface RuntimeOperationDefinition<TPayload = unknown> {
    operationId: string;
    kind: 'command' | 'query';
    context: RuntimeEventContext;
    subject: string;
    schema: RuntimeSchemaDefinition<TPayload>;
}
