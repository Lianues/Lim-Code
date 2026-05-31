/**
 * LimCode - Runtime Ledger foundation
 *
 * 修改原因：完整替代 release 需要一个可运行的事实层，先于 Main/Monitor 热路径迁移存在并可测试。
 * 修改方式：实现 append-only ledger、registry 校验、coverage 查询、bounded replay 和 partial snapshot。
 * 修改目的：为后续逐步替代旧事件碎片系统提供稳定后端契约。
 */

import { RuntimeIdentityRegistry } from './identity';
import { RuntimeEventRegistry } from './registry';
import { buildRuntimeProjection } from './projection';
import { createRuntimeScopeKey, matchesRuntimeScope } from './scope';
import type {
    RuntimeCoverage,
    RuntimeEventDraft,
    RuntimeEventEnvelope,
    RuntimeDiagnostic,
    RuntimeLedgerAppendResult,
    RuntimeLedgerMode,
    RuntimeLedgerScope,
    RuntimeLedgerStore,
    RuntimePartialSnapshot,
    RuntimePayloadSummary,
    RuntimeProjection,
    RuntimeReplayCursor,
    RuntimeReplayResult
} from './types';

export interface RuntimeLedgerOptions {
    mode?: RuntimeLedgerMode;
    eventRegistry: RuntimeEventRegistry;
    identityRegistry?: RuntimeIdentityRegistry;
    store?: RuntimeLedgerStore;
    now?: () => number;
    recentEventLimit?: number;
}

export class InMemoryRuntimeLedgerStore implements RuntimeLedgerStore {
    private readonly events: RuntimeEventEnvelope[] = [];

    append<TPayload>(event: RuntimeEventEnvelope<TPayload>): void {
        this.events.push(event as RuntimeEventEnvelope);
    }

    list<TPayload>(): RuntimeEventEnvelope<TPayload>[] {
        return [...this.events] as RuntimeEventEnvelope<TPayload>[];
    }
}

export class RuntimeLedger {
    private readonly mode: RuntimeLedgerMode;
    private readonly identityRegistry: RuntimeIdentityRegistry;
    private readonly store: RuntimeLedgerStore;
    private readonly now: () => number;
    private readonly recentEventLimit: number;
    private readonly coverageByScope = new Map<string, RuntimeCoverage>();
    private readonly diagnostics: RuntimeDiagnostic[] = [];
    private nextSequence = 1;
    private sequenceInitialization: Promise<void> | undefined;

    constructor(private readonly options: RuntimeLedgerOptions) {
        this.mode = options.mode ?? 'canonical';
        this.identityRegistry = options.identityRegistry ?? new RuntimeIdentityRegistry();
        this.store = options.store ?? new InMemoryRuntimeLedgerStore();
        this.now = options.now ?? (() => Date.now());
        this.recentEventLimit = options.recentEventLimit ?? 50;
    }

    async append<TPayload>(draft: RuntimeEventDraft<TPayload>): Promise<RuntimeLedgerAppendResult<TPayload>> {
        try {
            await this.ensureSequenceInitialized();
            this.options.eventRegistry.validateDraft(draft);
            const event = this.createEnvelope(draft);
            await this.store.append(event);
            this.recordCoverage(event);
            return { accepted: true, event };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.recordDiagnostic('append_failed', message, draft);
            if (this.mode === 'canonical') {
                throw error;
            }
            return { accepted: false, diagnostic: message };
        }
    }

    async appendBatch<TPayload>(drafts: RuntimeEventDraft<TPayload>[]): Promise<RuntimeLedgerAppendResult<TPayload>[]> {
        const results: RuntimeLedgerAppendResult<TPayload>[] = [];
        for (const draft of drafts) {
            results.push(await this.append(draft));
        }
        return results;
    }

    async getEvents<TPayload>(cursor: RuntimeReplayCursor = {}): Promise<RuntimeReplayResult<TPayload>> {
        const allEvents = (await this.store.list<TPayload>())
            .filter(event => matchesRuntimeScope(event as RuntimeEventEnvelope, cursor))
            .sort((a, b) => a.sequence - b.sequence);
        const lowerBound = cursor.fromSequence ?? ((cursor.afterSequence ?? 0) + 1);
        const replayable = allEvents.filter(event => event.sequence >= lowerBound);
        const replayAvailableFrom = allEvents[0]?.sequence;
        const replayAvailableTo = allEvents[allEvents.length - 1]?.sequence;
        const limit = cursor.limit;
        const events = typeof limit === 'number' && limit >= 0 ? replayable.slice(0, limit) : replayable;
        const truncated = events.length < replayable.length;
        const degradedReason = truncated ? `replay_truncated:${events.length}/${replayable.length}` : undefined;
        return { events, replayAvailableFrom, replayAvailableTo, truncated, degradedReason };
    }

    async getProjection(scope: RuntimeLedgerScope = {}): Promise<RuntimeProjection> {
        const events = await this.store.list();
        return buildRuntimeProjection(events, scope, this.now);
    }

    async getPartialSnapshot<TPayload>(scope: RuntimeLedgerScope = {}): Promise<RuntimePartialSnapshot<TPayload>> {
        const projection = await this.getProjection(scope);
        const replay = await this.getEvents<TPayload>(scope);
        const recentEvents = replay.events.slice(Math.max(0, replay.events.length - this.recentEventLimit));
        return {
            scopeKey: createRuntimeScopeKey(scope),
            projection,
            coverage: await this.getCoverage(scope),
            recentEvents,
            recentEventCount: recentEvents.length,
            totalEventCount: replay.events.length,
            replayAvailableFrom: replay.replayAvailableFrom,
            replayAvailableTo: replay.replayAvailableTo,
            truncated: recentEvents.length < replay.events.length
        };
    }

    getDiagnostics(scope: RuntimeLedgerScope = {}): RuntimeDiagnostic[] {
        return this.diagnostics
            .filter(diagnostic => matchesDiagnosticScope(diagnostic, scope))
            .map(diagnostic => ({ ...diagnostic }));
    }

    async getCoverage(scope: RuntimeLedgerScope = {}): Promise<RuntimeCoverage | undefined> {
        await this.ensureSequenceInitialized();
        const exact = this.coverageByScope.get(createRuntimeScopeKey(scope));
        if (exact) return { ...exact };
        let latest: RuntimeCoverage | undefined;
        for (const [scopeKey, coverage] of this.coverageByScope.entries()) {
            if (this.scopeKeyMayMatch(scopeKey, scope)) {
                if (!latest || coverage.eventSequence > latest.eventSequence) latest = coverage;
            }
        }
        return latest ? { ...latest } : undefined;
    }

    private createEnvelope<TPayload>(draft: RuntimeEventDraft<TPayload>): RuntimeEventEnvelope<TPayload> {
        const sequence = this.nextSequence++;
        const eventId = draft.eventId ?? this.identityRegistry.create('event', draft.context);
        if (draft.eventId) this.identityRegistry.register('event', draft.eventId);
        const coverage: RuntimeCoverage | undefined = draft.coverage
            ? {
                ...draft.coverage,
                eventSequence: draft.coverage.eventSequence ?? sequence,
                replayAvailableTo: draft.coverage.replayAvailableTo ?? sequence
            }
            : {
                eventSequence: sequence,
                replayAvailableTo: sequence
            };

        return {
            eventId,
            eventType: draft.eventType,
            kind: draft.kind,
            context: draft.context,
            subject: draft.subject,
            schemaVersion: draft.schemaVersion ?? 1,
            sequence,
            timestamp: draft.timestamp ?? this.now(),
            conversationId: this.identityRegistry.validate('conversation', draft.conversationId),
            runId: this.identityRegistry.validate('run', draft.runId),
            messageId: draft.messageId ? this.identityRegistry.validate('message', draft.messageId) : undefined,
            contentId: draft.contentId ? this.identityRegistry.validate('content', draft.contentId) : undefined,
            toolInvocationId: draft.toolInvocationId ? this.identityRegistry.validate('toolInvocation', draft.toolInvocationId) : undefined,
            causationId: draft.causationId,
            correlationId: draft.correlationId,
            persistence: draft.persistence,
            coverage,
            payloadSummary: draft.payloadSummary ?? summarizePayload(draft.payload),
            payloadRef: draft.payloadRef,
            payload: draft.payload
        };
    }

    private ensureSequenceInitialized(): Promise<void> {
        if (!this.sequenceInitialization) {
            this.sequenceInitialization = Promise.resolve(this.store.list())
                .then(events => {
                    let maxSequence = 0;
                    for (const event of events) {
                        maxSequence = Math.max(maxSequence, event.sequence || 0);
                        if (event.eventId) {
                            this.identityRegistry.register('event', event.eventId);
                        }
                        this.recordCoverage(event as RuntimeEventEnvelope);
                    }
                    this.nextSequence = Math.max(this.nextSequence, maxSequence + 1);
                });
        }
        return this.sequenceInitialization;
    }

    private recordCoverage(event: RuntimeEventEnvelope): void {
        const scopes: RuntimeLedgerScope[] = [
            { conversationId: event.conversationId },
            { conversationId: event.conversationId, runId: event.runId },
            { conversationId: event.conversationId, runId: event.runId, context: event.context },
            { conversationId: event.conversationId, runId: event.runId, context: event.context, subject: event.subject }
        ];

        for (const scope of scopes) {
            const key = createRuntimeScopeKey(scope);
            const existing = this.coverageByScope.get(key);
            this.coverageByScope.set(key, mergeCoverage(existing, event.coverage));
        }
    }

    private scopeKeyMayMatch(scopeKey: string, scope: RuntimeLedgerScope): boolean {
        if (scope.conversationId && !scopeKey.includes(`conversation:${scope.conversationId}`)) return false;
        if (scope.runId && !scopeKey.includes(`run:${scope.runId}`)) return false;
        if (scope.context && !scopeKey.includes(`context:${scope.context}`)) return false;
        if (scope.subject && !scopeKey.includes(`subject:${scope.subject}`)) return false;
        return true;
    }

    private recordDiagnostic(code: string, message: string, draft: RuntimeEventDraft): void {
        const scope: RuntimeLedgerScope = {
            conversationId: draft.conversationId,
            runId: draft.runId,
            context: draft.context,
            subject: draft.subject
        };
        this.diagnostics.push({
            diagnosticId: this.identityRegistry.create('event', 'diagnostic'),
            code,
            message,
            timestamp: this.now(),
            scopeKey: createRuntimeScopeKey(scope),
            eventType: draft.eventType,
            conversationId: draft.conversationId,
            runId: draft.runId
        });
    }
}

function matchesDiagnosticScope(diagnostic: RuntimeDiagnostic, scope: RuntimeLedgerScope): boolean {
    if (scope.conversationId && diagnostic.conversationId !== scope.conversationId) return false;
    if (scope.runId && diagnostic.runId !== scope.runId) return false;
    if (scope.context && !diagnostic.scopeKey.includes(`context:${scope.context}`)) return false;
    if (scope.subject && !diagnostic.scopeKey.includes(`subject:${scope.subject}`)) return false;
    return true;
}

function mergeCoverage(existing: RuntimeCoverage | undefined, incoming: RuntimeCoverage | undefined): RuntimeCoverage {
    const base: RuntimeCoverage = existing ?? { eventSequence: 0 };
    if (!incoming) return base;
    return {
        eventSequence: Math.max(base.eventSequence, incoming.eventSequence),
        contentRevision: maxOptional(base.contentRevision, incoming.contentRevision),
        contentCoveredEventSequence: maxOptional(base.contentCoveredEventSequence, incoming.contentCoveredEventSequence),
        partialCoveredEventSequence: maxOptional(base.partialCoveredEventSequence, incoming.partialCoveredEventSequence),
        replayAvailableFrom: minOptional(base.replayAvailableFrom, incoming.replayAvailableFrom),
        replayAvailableTo: maxOptional(base.replayAvailableTo, incoming.replayAvailableTo)
    };
}

function maxOptional(left: number | undefined, right: number | undefined): number | undefined {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.max(left, right);
}

function minOptional(left: number | undefined, right: number | undefined): number | undefined {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.min(left, right);
}

export function summarizePayload(payload: unknown): RuntimePayloadSummary {
    if (payload === undefined || payload === null) return { kind: 'empty', bytes: 0 };
    if (typeof payload === 'string') {
        return { kind: 'text', bytes: Buffer.byteLength(payload, 'utf8'), preview: payload.slice(0, 120) };
    }
    const serialized = JSON.stringify(payload);
    return { kind: 'json', bytes: Buffer.byteLength(serialized, 'utf8') };
}
