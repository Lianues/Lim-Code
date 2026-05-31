/**
 * LimCode - SubAgent Runtime Ledger bridge
 *
 * 修改原因：SubAgent run/content/tool 事实需要进入统一 Runtime Ledger，而不是由 Monitor 前端自行拼接。
 * 修改方式：把 runEventBus 的状态变更转换为 canonical Runtime Ledger 事件，并维护可重放的内容窗口投影。
 * 修改目的：让 Monitor 的 manifest/window/live/tool 状态都来自同一事实层。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createDefaultRuntimeLedger } from '../../modules/runtimeLedger/defaults';
import { JsonlRuntimeLedgerStore } from '../../modules/runtimeLedger/stores';
import type {
    RuntimeEventDraft,
    RuntimeEventEnvelope,
    RuntimePartialSnapshot
} from '../../modules/runtimeLedger';
import type { Content } from '../../modules/conversation/types';
import type {
    SubAgentRunContentWindow,
    SubAgentRunContentWindowOptions,
    SubAgentRunEvent,
    SubAgentRunSnapshot
} from './runEventBus';

function normalizeIdPart(value: string | undefined): string {
    const raw = value || 'unknown';
    const normalized = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
    if (normalized === raw && raw.length <= 80) return normalized;
    return `${normalized.slice(0, 64)}_${stableIdHash(raw)}`;
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
    if (!payload) return undefined;
    if (Array.isArray(payload)) return 'array';
    return typeof payload;
}

function payloadRecord(payload: unknown): Record<string, any> {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, any>
        : {};
}

export class SubAgentRuntimeLedgerBridge {
    private bootstrap = createDefaultRuntimeLedger('canonical');
    private readonly emittedFunctionResponseKeys = new Set<string>();
    private readonly contentWindowsByRunId = new Map<string, RuntimeLedgerSubAgentContentWindowRecord>();
    private readonly liveDeltasByRunId = new Map<string, RuntimeLedgerSubAgentLiveDeltaProjection>();
    private contentWindowStorePath: string | undefined;
    private contentWindowStoreLoaded = false;
    private contentWindowAppendQueue: Promise<void> = Promise.resolve();

    async appendRunEvent(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): Promise<void> {
        const drafts = this.createEventDrafts(event, snapshot);
        const results = await this.bootstrap.ledger.appendBatch(drafts);
        for (const result of results) {
            if (!result.accepted) {
                console.warn('[SubAgentRuntimeLedgerBridge] Runtime Ledger append rejected:', result.diagnostic);
            }
        }
        const acceptedContentEvent = results
            .map(result => result.event)
            .find(resultEvent => resultEvent?.eventType === 'runtime.subagent.content_snapshot');
        if (acceptedContentEvent && event.type === 'content_snapshot') {
            await this.recordContentWindowProjection(event, snapshot, acceptedContentEvent as RuntimeEventEnvelope<Record<string, unknown>>);
        }
        const acceptedLiveEvent = results
            .map(result => result.event)
            .find(resultEvent => resultEvent?.eventType === 'runtime.subagent.live_delta');
        if (acceptedLiveEvent && event.type === 'llm_delta') {
            this.recordLiveDeltaProjection(event, snapshot, acceptedLiveEvent as RuntimeEventEnvelope<Record<string, unknown>>);
        }
    }

    async getEvents(): Promise<RuntimeEventEnvelope[]> {
        const replay = await this.bootstrap.ledger.getEvents({});
        return replay.events;
    }

    async getPartialSnapshotForRun(runId: string): Promise<RuntimePartialSnapshot<Record<string, unknown>>> {
        return await this.bootstrap.ledger.getPartialSnapshot({
            runId: this.toRuntimeRunId(runId)
        });
    }

    async getContentWindowForRun(
        runId: string,
        options: SubAgentRunContentWindowOptions = {}
    ): Promise<RuntimeLedgerSubAgentContentWindowProjection | undefined> {
        await this.ensureContentWindowStoreLoaded();
        const record = this.contentWindowsByRunId.get(runId);
        if (!record) return undefined;
        return toContentWindow(record, options);
    }

    getLiveDeltaForRun(runId: string): RuntimeLedgerSubAgentLiveDeltaProjection | undefined {
        const liveDelta = this.liveDeltasByRunId.get(runId);
        return liveDelta ? JSON.parse(JSON.stringify(liveDelta)) as RuntimeLedgerSubAgentLiveDeltaProjection : undefined;
    }

    configureDurableStore(filePath: string): void {
        this.bootstrap = createDefaultRuntimeLedger({
            mode: 'canonical',
            store: new JsonlRuntimeLedgerStore(filePath)
        });
        this.emittedFunctionResponseKeys.clear();
        this.contentWindowsByRunId.clear();
        this.liveDeltasByRunId.clear();
        this.contentWindowStoreLoaded = false;
        this.contentWindowAppendQueue = Promise.resolve();
        this.contentWindowStorePath = path.join(path.dirname(filePath), 'subagent-content-windows.jsonl');
    }

    resetForTests(): void {
        this.bootstrap = createDefaultRuntimeLedger('canonical');
        this.emittedFunctionResponseKeys.clear();
        this.contentWindowsByRunId.clear();
        this.liveDeltasByRunId.clear();
        this.contentWindowStoreLoaded = false;
        this.contentWindowAppendQueue = Promise.resolve();
        this.contentWindowStorePath = undefined;
    }

    private createEventDrafts(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): RuntimeEventDraft<Record<string, unknown>>[] {
        const drafts: RuntimeEventDraft<Record<string, unknown>>[] = [
            this.createRunEventDraft(event, snapshot)
        ];

        const lifecycleDraft = this.createToolLifecycleDraft(event, snapshot);
        if (lifecycleDraft) drafts.push(lifecycleDraft);

        if (event.type === 'content_snapshot') {
            drafts.push(...this.createFunctionResponseDrafts(event, snapshot));
        }

        return drafts;
    }

    private createRunEventDraft(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): RuntimeEventDraft<Record<string, unknown>> {
        const isContentSnapshot = event.type === 'content_snapshot';
        const isLiveDelta = event.type === 'llm_delta';
        const conversationId = this.toRuntimeConversationId(snapshot.conversationId);
        const runId = this.toRuntimeRunId(snapshot.runId);
        const toolInvocationId = this.toRuntimeToolInvocationId(event.toolId);
        const payload = {
            sourceType: event.type,
            sourceRunId: snapshot.runId,
            sourceAgentName: snapshot.agentName,
            sourceEventSequence: event.eventSequence,
            sourceContentRevision: event.contentRevision,
            status: snapshot.status,
            payloadKind: payloadKind(event.payload),
            contentCount: snapshot.contents.length,
            contentRevision: snapshot.contentRevision
        };

        return {
            eventType: isContentSnapshot
                ? 'runtime.subagent.content_snapshot'
                : isLiveDelta
                    ? 'runtime.subagent.live_delta'
                    : 'runtime.subagent.run_event',
            kind: isContentSnapshot ? 'domain' : 'integration',
            context: isContentSnapshot ? 'content' : 'subagent',
            subject: isContentSnapshot ? 'contentWindow' : isLiveDelta ? 'liveDelta' : 'run',
            conversationId,
            runId,
            toolInvocationId,
            persistence: isContentSnapshot ? 'snapshot' : isLiveDelta ? 'ephemeral' : 'durable',
            timestamp: event.timestamp,
            payload,
            payloadSummary: {
                kind: 'json',
                bytes: JSON.stringify(payload).length,
                redacted: true
            },
            coverage: {
                eventSequence: event.eventSequence,
                contentRevision: snapshot.contentRevision,
                contentCoveredEventSequence: isContentSnapshot ? event.eventSequence : undefined,
                partialCoveredEventSequence: isLiveDelta ? event.eventSequence : undefined,
                replayAvailableFrom: 1
            }
        };
    }

    private createToolLifecycleDraft(
        event: SubAgentRunEvent,
        snapshot: SubAgentRunSnapshot
    ): RuntimeEventDraft<Record<string, unknown>> | undefined {
        const phase = this.toToolLifecyclePhase(event);
        const toolInvocationId = this.toRuntimeToolInvocationId(event.toolId);
        if (!phase || !toolInvocationId) return undefined;

        const eventPayload = payloadRecord(event.payload);
        const payload = {
            sourceType: event.type,
            phase,
            toolName: event.toolName,
            hasArgs: Boolean(eventPayload.args && typeof eventPayload.args === 'object'),
            hasResult: Boolean(eventPayload.result),
            hasError: Boolean(eventPayload.error || eventPayload.result?.error),
            contentRevision: snapshot.contentRevision
        };

        return {
            eventType: 'runtime.tool.lifecycle',
            kind: 'domain',
            context: 'tool',
            subject: 'toolInvocation',
            conversationId: this.toRuntimeConversationId(snapshot.conversationId),
            runId: this.toRuntimeRunId(snapshot.runId),
            toolInvocationId,
            persistence: 'durable',
            timestamp: event.timestamp,
            payload,
            payloadSummary: {
                kind: 'json',
                bytes: JSON.stringify(payload).length,
                redacted: true
            },
            coverage: {
                eventSequence: event.eventSequence,
                contentRevision: snapshot.contentRevision,
                partialCoveredEventSequence: event.eventSequence,
                replayAvailableFrom: 1
            }
        };
    }

    private createFunctionResponseDrafts(
        event: SubAgentRunEvent,
        snapshot: SubAgentRunSnapshot
    ): RuntimeEventDraft<Record<string, unknown>>[] {
        const drafts: RuntimeEventDraft<Record<string, unknown>>[] = [];
        const functionCallOwnership = this.collectFunctionCallOwners(snapshot);
        const seenResponseIds = new Set<string>();

        snapshot.contents.forEach((content, contentIndex) => {
            for (const part of content.parts || []) {
                const response = part.functionResponse;
                if (!response) continue;
                const responseId = typeof response.id === 'string' && response.id.trim() ? response.id.trim() : '';
                if (!responseId) {
                    drafts.push(this.createUnboundFunctionResponseDraft(event, snapshot, content, contentIndex, response.name, 'missing_function_response_id'));
                    continue;
                }
                if (seenResponseIds.has(responseId)) {
                    drafts.push(this.createUnboundFunctionResponseDraft(event, snapshot, content, contentIndex, response.name, 'duplicate_function_response_id', responseId));
                    continue;
                }
                seenResponseIds.add(responseId);
                if (functionCallOwnership.duplicateIds.has(responseId)) {
                    drafts.push(this.createUnboundFunctionResponseDraft(event, snapshot, content, contentIndex, response.name, 'ambiguous_function_response_id', responseId));
                    continue;
                }
                const dedupeKey = `${snapshot.runId}:${responseId}:${contentIndex}`;
                if (this.emittedFunctionResponseKeys.has(dedupeKey)) continue;
                this.emittedFunctionResponseKeys.add(dedupeKey);

                const owner = functionCallOwnership.owners.get(responseId);
                if (!owner) {
                    drafts.push(this.createUnboundFunctionResponseDraft(event, snapshot, content, contentIndex, response.name, 'unmatched_function_response_id', responseId));
                    continue;
                }
                const toolInvocationId = this.toRuntimeToolInvocationId(responseId);
                const contentId = this.toRuntimeContentId(snapshot.runId, content.index ?? contentIndex);
                const messageId = this.toRuntimeMessageId(snapshot.runId, owner.content.index ?? owner.contentIndex);
                const responsePayload = response.response || {};
                const payload = {
                    sourceType: 'function_response',
                    toolName: response.name,
                    isError: this.isErrorFunctionResponse(responsePayload),
                    responseKeys: Object.keys(responsePayload).sort(),
                    contentRevision: snapshot.contentRevision
                };

                drafts.push({
                    eventType: 'runtime.tool.function_response',
                    kind: 'domain',
                    context: 'tool',
                    subject: 'functionResponse',
                    conversationId: this.toRuntimeConversationId(snapshot.conversationId),
                    runId: this.toRuntimeRunId(snapshot.runId),
                    messageId,
                    contentId,
                    toolInvocationId,
                    persistence: 'durable',
                    timestamp: content.timestamp || event.timestamp,
                    payload,
                    payloadSummary: {
                        kind: 'json',
                        bytes: JSON.stringify(payload).length,
                        redacted: true
                    },
                    coverage: {
                        eventSequence: event.eventSequence,
                        contentRevision: snapshot.contentRevision,
                        contentCoveredEventSequence: event.eventSequence,
                        replayAvailableFrom: 1
                    }
                });
            }
        });

        return drafts;
    }

    private createUnboundFunctionResponseDraft(
        event: SubAgentRunEvent,
        snapshot: SubAgentRunSnapshot,
        content: Content,
        contentIndex: number,
        toolName: string | undefined,
        reason: string,
        responseId?: string
    ): RuntimeEventDraft<Record<string, unknown>> {
        const payload = {
            sourceType: 'function_response',
            reason,
            toolName,
            responseId,
            contentRevision: snapshot.contentRevision
        };

        return {
            eventType: 'runtime.tool.function_response_unbound',
            kind: 'diagnostic',
            context: 'diagnostic',
            subject: 'functionResponse',
            conversationId: this.toRuntimeConversationId(snapshot.conversationId),
            runId: this.toRuntimeRunId(snapshot.runId),
            contentId: this.toRuntimeContentId(snapshot.runId, content.index ?? contentIndex),
            persistence: 'durable',
            timestamp: content.timestamp || event.timestamp,
            payload,
            payloadSummary: {
                kind: 'json',
                bytes: JSON.stringify(payload).length,
                redacted: true
            },
            coverage: {
                eventSequence: event.eventSequence,
                contentRevision: snapshot.contentRevision,
                contentCoveredEventSequence: event.eventSequence,
                replayAvailableFrom: 1
            }
        };
    }

    private collectFunctionCallOwners(snapshot: SubAgentRunSnapshot): {
        owners: Map<string, { content: Content; contentIndex: number }>;
        duplicateIds: Set<string>;
    } {
        const owners = new Map<string, { content: Content; contentIndex: number }>();
        const duplicateIds = new Set<string>();
        snapshot.contents.forEach((content, contentIndex) => {
            for (const part of content.parts || []) {
                const callId = part.functionCall?.id;
                if (typeof callId === 'string' && callId.trim()) {
                    const normalized = callId.trim();
                    if (owners.has(normalized)) {
                        duplicateIds.add(normalized);
                    } else {
                        owners.set(normalized, { content, contentIndex });
                    }
                }
            }
        });
        return { owners, duplicateIds };
    }

    private toToolLifecyclePhase(event: SubAgentRunEvent): string | undefined {
        if (event.type === 'tool_started') return 'executing';
        if (event.type === 'tool_completed') return 'success';
        if (event.type === 'tool_failed') return 'error';
        if (event.type === 'tool_progress') {
            const status = payloadRecord(event.payload).status;
            return typeof status === 'string' && status.trim() ? status.trim() : 'executing';
        }
        return undefined;
    }

    private isErrorFunctionResponse(response: Record<string, unknown>): boolean {
        return response.success === false
            || Boolean(response.error)
            || Boolean(response.cancelled)
            || Boolean(response.rejected);
    }

    private toRuntimeConversationId(conversationId: string | undefined): string {
        return `conv:subagent:${normalizeIdPart(conversationId)}`;
    }

    private toRuntimeRunId(runId: string): string {
        return `run:subagent:${normalizeIdPart(runId)}`;
    }

    private toRuntimeMessageId(runId: string, contentIndex: number): string {
        return `msg:subagent:${normalizeIdPart(runId)}:${contentIndex}`;
    }

    private toRuntimeContentId(runId: string, contentIndex: number): string {
        return `cnt:subagent:${normalizeIdPart(runId)}:${contentIndex}`;
    }

    private toRuntimeToolInvocationId(toolId: string | undefined): string | undefined {
        return toolId ? `tool:subagent:${normalizeIdPart(toolId)}` : undefined;
    }

    async ensureContentWindowForSnapshot(snapshot: SubAgentRunSnapshot): Promise<void> {
        const existing = this.contentWindowsByRunId.get(snapshot.runId);
        if (
            existing
            && existing.contentRevision === snapshot.contentRevision
            && existing.contentCoveredEventSequence !== undefined
        ) {
            return;
        }
        await this.appendRunEvent({
            runId: snapshot.runId,
            agentName: snapshot.agentName,
            type: 'content_snapshot',
            timestamp: snapshot.updatedAt || Date.now(),
            payload: { contents: snapshot.contents },
            eventSequence: snapshot.eventSequence,
            contentRevision: snapshot.contentRevision
        }, snapshot);
    }

    private async recordContentWindowProjection(
        event: SubAgentRunEvent,
        snapshot: SubAgentRunSnapshot,
        acceptedEvent: RuntimeEventEnvelope<Record<string, unknown>>
    ): Promise<void> {
        const record: RuntimeLedgerSubAgentContentWindowRecord = {
            sourceRunId: snapshot.runId,
            runtimeRunId: acceptedEvent.runId,
            conversationId: acceptedEvent.conversationId,
            contentRevision: snapshot.contentRevision,
            eventSequence: snapshot.eventSequence,
            contentCoveredEventSequence: acceptedEvent.coverage?.contentCoveredEventSequence ?? event.eventSequence,
            updatedAt: acceptedEvent.timestamp,
            contents: cloneContents(snapshot.contents || []),
            projectionKind: 'snapshot'
        };
        const existing = this.contentWindowsByRunId.get(snapshot.runId);
        if (
            existing?.projectionKind === 'live'
            && existing.contentRevision === record.contentRevision
            && existing.eventSequence >= record.eventSequence
        ) {
            this.upsertContentWindowRecord({
                ...existing,
                runtimeRunId: record.runtimeRunId,
                conversationId: record.conversationId,
                contentCoveredEventSequence: record.contentCoveredEventSequence ?? existing.contentCoveredEventSequence,
                updatedAt: Math.max(existing.updatedAt || 0, record.updatedAt || 0),
                projectionKind: 'live'
            });
            return;
        }
        this.upsertContentWindowRecord(record);
        await this.appendContentWindowRecord(record);
    }

    private recordLiveDeltaProjection(
        event: SubAgentRunEvent,
        snapshot: SubAgentRunSnapshot,
        acceptedEvent: RuntimeEventEnvelope<Record<string, unknown>>
    ): void {
        const payload = createLiveDeltaProjectionPayload(event, snapshot);
        const projection: RuntimeLedgerSubAgentLiveDeltaProjection = {
            runId: snapshot.runId,
            type: 'llm_delta',
            timestamp: acceptedEvent.timestamp,
            eventSequence: event.eventSequence ?? acceptedEvent.coverage?.eventSequence,
            contentRevision: event.contentRevision ?? snapshot.contentRevision,
            payload,
            source: 'runtime-ledger'
        };
        this.liveDeltasByRunId.set(snapshot.runId, projection);
        this.recordLiveContentWindowProjection(event, snapshot, acceptedEvent, payload);
    }

    private recordLiveContentWindowProjection(
        event: SubAgentRunEvent,
        snapshot: SubAgentRunSnapshot,
        acceptedEvent: RuntimeEventEnvelope<Record<string, unknown>>,
        payload: Record<string, unknown>
    ): void {
        if (!hasRenderableLiveDeltaPayload(payload)) return;
        const partialCoveredEventSequence = event.eventSequence ?? acceptedEvent.coverage?.partialCoveredEventSequence;
        if (partialCoveredEventSequence === undefined) return;
        const existing = this.contentWindowsByRunId.get(snapshot.runId);
        if (existing?.partialCoveredEventSequence !== undefined && partialCoveredEventSequence <= existing.partialCoveredEventSequence) {
            return;
        }

        const baseRecord = existing ?? createContentWindowRecordFromSnapshot(snapshot, acceptedEvent);
        const nextContents = applyLiveDeltaPayloadToContents(
            baseRecord.contents || [],
            payload,
            acceptedEvent.timestamp
        );
        this.upsertContentWindowRecord({
            ...baseRecord,
            contentRevision: snapshot.contentRevision,
            eventSequence: Math.max(baseRecord.eventSequence || 0, partialCoveredEventSequence),
            partialCoveredEventSequence,
            updatedAt: acceptedEvent.timestamp,
            contents: nextContents,
            projectionKind: 'live'
        });
    }

    private upsertContentWindowRecord(record: RuntimeLedgerSubAgentContentWindowRecord): void {
        const existing = this.contentWindowsByRunId.get(record.sourceRunId);
        const shouldReplace = !existing
            || record.contentRevision > existing.contentRevision
            || record.eventSequence > existing.eventSequence
            || (
                record.eventSequence === existing.eventSequence
                && record.projectionKind === 'live'
                && existing.projectionKind !== 'live'
            )
            || (
                record.eventSequence === existing.eventSequence
                && existing.contentCoveredEventSequence === undefined
                && record.contentCoveredEventSequence !== undefined
            );
        if (shouldReplace) {
            this.contentWindowsByRunId.set(record.sourceRunId, record);
        }
    }

    private async appendContentWindowRecord(record: RuntimeLedgerSubAgentContentWindowRecord): Promise<void> {
        if (!this.contentWindowStorePath) return;
        const write = this.contentWindowAppendQueue
            .catch(() => undefined)
            .then(async () => {
                await fs.mkdir(path.dirname(this.contentWindowStorePath!), { recursive: true });
                await fs.appendFile(this.contentWindowStorePath!, `${JSON.stringify(record)}\n`, 'utf-8');
            });
        this.contentWindowAppendQueue = write;
        await write;
    }

    private async ensureContentWindowStoreLoaded(): Promise<void> {
        if (this.contentWindowStoreLoaded || !this.contentWindowStorePath) return;
        this.contentWindowStoreLoaded = true;
        let content: string;
        try {
            content = await fs.readFile(this.contentWindowStorePath, 'utf-8');
        } catch (error: any) {
            if (error?.code === 'ENOENT') return;
            throw error;
        }

        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const record = JSON.parse(trimmed) as RuntimeLedgerSubAgentContentWindowRecord;
                if (isValidContentWindowRecord(record)) {
                    this.upsertContentWindowRecord(record);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn('[SubAgentRuntimeLedgerBridge] Ignoring invalid content window record:', message);
            }
        }
    }
}

export const subAgentRuntimeLedgerBridge = new SubAgentRuntimeLedgerBridge();

interface RuntimeLedgerSubAgentContentWindowRecord {
    sourceRunId: string;
    runtimeRunId: string;
    conversationId: string;
    contentRevision: number;
    eventSequence: number;
    contentCoveredEventSequence?: number;
    partialCoveredEventSequence?: number;
    updatedAt: number;
    contents: Content[];
    projectionKind?: 'snapshot' | 'live';
}

export interface RuntimeLedgerSubAgentContentWindowProjection extends SubAgentRunContentWindow {
    contentCoveredEventSequence?: number;
    partialCoveredEventSequence?: number;
    source: 'runtime-ledger';
}

export interface RuntimeLedgerSubAgentLiveDeltaProjection {
    runId: string;
    type: 'llm_delta';
    timestamp?: number;
    eventSequence?: number;
    contentRevision?: number;
    payload: Record<string, unknown>;
    source: 'runtime-ledger';
}

function cloneContents(contents: Content[]): Content[] {
    return JSON.parse(JSON.stringify(contents || [])) as Content[];
}

function createContentWindowRecordFromSnapshot(
    snapshot: SubAgentRunSnapshot,
    acceptedEvent: RuntimeEventEnvelope<Record<string, unknown>>
): RuntimeLedgerSubAgentContentWindowRecord {
    return {
        sourceRunId: snapshot.runId,
        runtimeRunId: acceptedEvent.runId,
        conversationId: acceptedEvent.conversationId,
        contentRevision: snapshot.contentRevision,
        eventSequence: snapshot.eventSequence,
        contentCoveredEventSequence: acceptedEvent.coverage?.contentCoveredEventSequence,
        partialCoveredEventSequence: acceptedEvent.coverage?.partialCoveredEventSequence,
        updatedAt: acceptedEvent.timestamp,
        contents: cloneContents(snapshot.contents || []),
        projectionKind: acceptedEvent.eventType === 'runtime.subagent.live_delta' ? 'live' : 'snapshot'
    };
}

function cloneJsonSafeValue(value: unknown): unknown {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
}

function hasRenderableLiveDeltaPayload(payload: Record<string, unknown>): boolean {
    return Array.isArray(payload.delta) || isContent(payload.contentSnapshot);
}

function isContent(value: unknown): value is Content {
    return !!value && typeof value === 'object' && Array.isArray((value as Content).parts);
}

function cloneContent(content: Content): Content {
    return {
        ...content,
        parts: (content.parts || []).map(part => {
            const cloned = { ...part } as any;
            if (part.functionCall) cloned.functionCall = { ...(part.functionCall as any) };
            if (part.functionResponse) cloned.functionResponse = { ...part.functionResponse };
            return cloned;
        })
    } as Content;
}

function normalizeNonEmptyString(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function hasNonEmptyArgs(args: unknown): args is Record<string, unknown> {
    return !!(args && typeof args === 'object' && Object.keys(args as Record<string, unknown>).length > 0);
}

function mergeLiveFunctionCall(target: Record<string, any>, incoming: Record<string, any>): void {
    if (incoming.name && !target.name) target.name = incoming.name;
    if (incoming.id) target.id = incoming.id;
    if (incoming.itemId && !target.itemId) target.itemId = incoming.itemId;
    if (typeof incoming.index === 'number' && typeof target.index !== 'number') target.index = incoming.index;
    if (typeof incoming.partialArgs === 'string') {
        target.partialArgs = incoming.finalArgs === true
            ? incoming.partialArgs
            : `${target.partialArgs || ''}${incoming.partialArgs}`;
        if (incoming.finalArgs === true) {
            try {
                const parsed = JSON.parse(target.partialArgs);
                if (parsed && typeof parsed === 'object') {
                    target.args = parsed;
                    delete target.partialArgs;
                }
            } catch {
                // Partial args can be incomplete until the stream marks them final.
            }
        }
        return;
    }
    if (hasNonEmptyArgs(incoming.args)) {
        target.args = { ...(target.args || {}), ...incoming.args };
        delete target.partialArgs;
    }
}

function shouldMergeLiveFunctionCall(incoming: Record<string, any>, existing: Record<string, any>, isLastFunctionCall: boolean): boolean {
    const incomingItemId = normalizeNonEmptyString(incoming.itemId);
    const existingItemId = normalizeNonEmptyString(existing.itemId);
    if (incomingItemId && existingItemId && incomingItemId === existingItemId) return true;
    if (typeof incoming.index === 'number' && typeof existing.index === 'number' && incoming.index === existing.index) return true;
    const incomingId = normalizeNonEmptyString(incoming.id);
    const existingId = normalizeNonEmptyString(existing.id);
    if (incomingId && existingId && incomingId === existingId) return true;
    const incomingHasPartial = typeof incoming.partialArgs === 'string';
    const incomingHasIdentity = !!incomingId || !!incomingItemId || typeof incoming.index === 'number';
    return !incomingHasIdentity && incomingHasPartial && isLastFunctionCall;
}

function appendLiveFunctionCallPart(parts: Content['parts'], incomingPart: Record<string, any>): void {
    const incoming = incomingPart.functionCall;
    if (!incoming || typeof incoming !== 'object') return;

    let isLastFunctionCall = true;
    for (let index = parts.length - 1; index >= 0; index--) {
        const existing = (parts[index] as any).functionCall;
        if (!existing) continue;
        if (shouldMergeLiveFunctionCall(incoming, existing, isLastFunctionCall)) {
            mergeLiveFunctionCall(existing, incoming);
            return;
        }
        isLastFunctionCall = false;
    }

    const next = { ...incoming };
    if (!next.name) next.name = '';
    if (!hasNonEmptyArgs(next.args)) next.args = {};
    mergeLiveFunctionCall(next, incoming);
    parts.push({ functionCall: next } as any);
}

function appendLiveContentPart(target: Content, part: Record<string, any>): void {
    if (typeof part.text === 'string') {
        const lastPart = target.parts[target.parts.length - 1] as any;
        const isThought = part.thought === true;
        const lastIsThought = lastPart?.thought === true;
        if (lastPart && lastPart.text !== undefined && !lastPart.functionCall && lastIsThought === isThought) {
            lastPart.text += part.text;
        } else {
            target.parts.push(isThought ? { text: part.text, thought: true } : { text: part.text });
        }
        return;
    }

    if (part.functionCall) {
        appendLiveFunctionCallPart(target.parts, part);
        return;
    }

    target.parts.push({ ...part } as any);
}

function ensureLastModelContent(contents: Content[], timestamp: number): Content {
    const last = contents[contents.length - 1];
    if (last?.role === 'model') return last;

    const created = {
        role: 'model' as const,
        parts: [],
        timestamp,
        index: contents.length
    } as Content;
    contents.push(created);
    return created;
}

function applyLiveDeltaPayloadToContents(
    contents: Content[],
    payload: Record<string, unknown>,
    timestamp: number = Date.now()
): Content[] {
    const next = cloneContents(contents || []);
    const snapshot = payload.contentSnapshot;
    if (isContent(snapshot)) {
        const replacement = cloneContent({
            ...snapshot,
            timestamp: snapshot.timestamp || timestamp
        } as Content);
        let lastModelIndex = -1;
        for (let index = next.length - 1; index >= 0; index--) {
            if (next[index]?.role === 'model') {
                lastModelIndex = index;
                break;
            }
        }
        if (lastModelIndex >= 0) {
            next[lastModelIndex] = replacement;
        } else {
            replacement.index = next.length;
            next.push(replacement);
        }
        return next;
    }

    const lastIndex = next.length - 1;
    let modelContent: Content;
    if (lastIndex >= 0 && next[lastIndex]?.role === 'model') {
        modelContent = cloneContent(next[lastIndex]);
        next[lastIndex] = modelContent;
    } else {
        modelContent = ensureLastModelContent(next, timestamp);
    }

    for (const part of (payload.delta || []) as Record<string, any>[]) {
        appendLiveContentPart(modelContent, part);
    }

    const usage = payload.usage;
    if (usage && typeof usage === 'object') modelContent.usageMetadata = usage as any;
    if (typeof payload.modelVersion === 'string') modelContent.modelVersion = payload.modelVersion;
    if (payload.thinkingStartTime) modelContent.thinkingStartTime = payload.thinkingStartTime as any;
    return next.map((content, index) => ({
        ...content,
        index: typeof content.index === 'number' ? content.index : index
    } as Content));
}

function sanitizeLiveDeltaPart(part: unknown): Record<string, unknown> | undefined {
    if (!part || typeof part !== 'object') return undefined;
    const source = part as Record<string, any>;

    if (typeof source.text === 'string') {
        const textPart: Record<string, unknown> = { text: source.text };
        if (source.thought === true) textPart.thought = true;
        return textPart;
    }

    if (source.functionCall && typeof source.functionCall === 'object') {
        const fc = source.functionCall as Record<string, unknown>;
        const safeFunctionCall: Record<string, unknown> = {};
        for (const key of ['id', 'name', 'args', 'partialArgs', 'index', 'itemId', 'finalArgs', 'rejected']) {
            if (!(key in fc)) continue;
            const cloned = cloneJsonSafeValue(fc[key]);
            if (cloned !== undefined) safeFunctionCall[key] = cloned;
        }
        return Object.keys(safeFunctionCall).length > 0
            ? { functionCall: safeFunctionCall }
            : undefined;
    }

    return undefined;
}

function createLiveDeltaProjectionPayload(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): Record<string, unknown> {
    const rawPayload = (event.payload || {}) as Record<string, any>;
    const rawDelta = Array.isArray(rawPayload.delta) ? rawPayload.delta : [];
    const delta = rawDelta
        .map(sanitizeLiveDeltaPart)
        .filter((part): part is Record<string, unknown> => !!part);

    const payload: Record<string, unknown> = {
        deltaCount: rawDelta.length,
        contentCount: rawPayload.contentSnapshot ? 1 : undefined,
        done: rawPayload.done === true,
        modelVersion: rawPayload.modelVersion,
        thinkingStartTime: rawPayload.thinkingStartTime,
        usage: cloneJsonSafeValue(rawPayload.usage),
        delta: delta.length > 0 ? delta : undefined,
        contentSnapshot: isContent(rawPayload.contentSnapshot) ? cloneContent(rawPayload.contentSnapshot as Content) : undefined,
        contentRevision: snapshot.contentRevision,
        eventSequence: snapshot.eventSequence
    };

    for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
    }
    return payload;
}

function isValidContentWindowRecord(record: RuntimeLedgerSubAgentContentWindowRecord | undefined): record is RuntimeLedgerSubAgentContentWindowRecord {
    return !!record
        && typeof record.sourceRunId === 'string'
        && typeof record.runtimeRunId === 'string'
        && Array.isArray(record.contents)
        && typeof record.contentRevision === 'number'
        && typeof record.eventSequence === 'number';
}

function toContentWindow(
    record: RuntimeLedgerSubAgentContentWindowRecord,
    options: SubAgentRunContentWindowOptions = {}
): RuntimeLedgerSubAgentContentWindowProjection {
    const contents = record.contents || [];
    const totalCount = contents.length;
    const rawLimit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit!)) : 20;
    const limit = rawLimit > 0 ? rawLimit : 20;
    let startIndex: number;
    let endIndex: number;

    if (typeof options.startIndex === 'number' || typeof options.endIndex === 'number') {
        if (typeof options.startIndex === 'number' && typeof options.endIndex === 'number') {
            startIndex = Math.max(0, Math.min(totalCount, Math.floor(options.startIndex)));
            endIndex = Math.max(startIndex, Math.min(totalCount, Math.floor(options.endIndex)));
            if (endIndex - startIndex > limit) {
                endIndex = startIndex + limit;
            }
        } else if (typeof options.endIndex === 'number') {
            endIndex = Math.max(0, Math.min(totalCount, Math.floor(options.endIndex)));
            startIndex = Math.max(0, endIndex - limit);
        } else {
            startIndex = Math.max(0, Math.min(totalCount, Math.floor(options.startIndex!)));
            endIndex = Math.min(totalCount, startIndex + limit);
        }
    } else if (options.fromTail !== false) {
        endIndex = totalCount;
        startIndex = Math.max(0, endIndex - limit);
    } else {
        startIndex = 0;
        endIndex = Math.min(totalCount, limit);
    }

    return {
        runId: record.sourceRunId,
        contents: cloneContents(contents.slice(startIndex, endIndex)),
        startIndex,
        endIndex,
        totalCount,
        contentRevision: record.contentRevision,
        eventSequence: record.eventSequence,
        contentCoveredEventSequence: record.contentCoveredEventSequence,
        partialCoveredEventSequence: record.partialCoveredEventSequence,
        hasMoreBefore: startIndex > 0,
        hasMoreAfter: endIndex < totalCount,
        source: 'runtime-ledger'
    };
}

export function summarizeContentForRuntimeLedger(content: Content): Record<string, unknown> {
    return {
        role: content.role,
        partCount: content.parts?.length ?? 0,
        hasFunctionCall: Boolean(content.parts?.some(part => part.functionCall)),
        hasFunctionResponse: Boolean(content.parts?.some(part => part.functionResponse)),
        hasThought: Boolean(content.parts?.some(part => part.thought))
    };
}
