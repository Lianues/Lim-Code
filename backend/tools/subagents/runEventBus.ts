/**
 * SubAgent 运行时事件总线。
 *
 * 修改原因：SubAgent Monitor 要像正常聊天窗口一样恢复和渲染内部对话，而不是只展示事件列表。
 * 修改方式：每个 run 同时维护 runtime events 和标准 Content[] 子对话，并可将子对话保存到 conversation metadata。
 * 修改目的：主聊天时间线保持干净，Monitor 可恢复完整 SubAgent 内部记录，且前端能复用 MessageItem/ToolMessage/MessageTaskCards。
 */

import type { Content } from '../../modules/conversation/types';
import type { ToolProgressEvent } from '../types';

export const SUBAGENT_RUNS_METADATA_KEY = 'subAgentRuns';

export interface SubAgentRunEvent extends ToolProgressEvent {
    runId: string;
    agentName?: string;
    timestamp: number;
}

export interface SubAgentRunPersistedRecord {
    runId: string;
    agentName?: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    createdAt: number;
    updatedAt: number;
    contents: Content[];
}

export interface SubAgentRunSnapshot extends SubAgentRunPersistedRecord {
    events: SubAgentRunEvent[];
    conversationId?: string;
}

export interface SubAgentRunConversationStore {
    getCustomMetadata(conversationId: string, key: string): Promise<unknown>;
    setCustomMetadata(conversationId: string, key: string, value: unknown): Promise<void>;
}

type SubAgentRunListener = (event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot) => void;

function normalizePersistedMap(raw: unknown): Record<string, SubAgentRunPersistedRecord> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }
    return raw as Record<string, SubAgentRunPersistedRecord>;
}

class SubAgentRunEventBus {
    private readonly listeners = new Set<SubAgentRunListener>();
    private readonly snapshots = new Map<string, SubAgentRunSnapshot>();
    private readonly stores = new Map<string, SubAgentRunConversationStore>();
    private readonly persistQueues = new Map<string, Promise<void>>();

    createRun(
        runId: string,
        agentName?: string,
        payload?: unknown,
        options?: {
            conversationId?: string;
            conversationStore?: SubAgentRunConversationStore;
            initialContents?: Content[];
        }
    ): SubAgentRunSnapshot {
        const now = Date.now();
        const snapshot: SubAgentRunSnapshot = {
            runId,
            agentName,
            status: 'running',
            createdAt: now,
            updatedAt: now,
            contents: options?.initialContents || [],
            events: [],
            conversationId: options?.conversationId
        };
        this.snapshots.set(runId, snapshot);
        if (options?.conversationId && options.conversationStore) {
            this.stores.set(runId, options.conversationStore);
        }
        this.emit({
            runId,
            agentName,
            type: 'run_created',
            timestamp: now,
            payload
        });
        this.enqueuePersist(runId);
        return snapshot;
    }

    emit(event: ToolProgressEvent & { runId: string; agentName?: string }): void {
        const timestamp = event.timestamp || Date.now();
        const normalized: SubAgentRunEvent = {
            ...event,
            timestamp
        };

        let snapshot = this.snapshots.get(normalized.runId);
        if (!snapshot) {
            snapshot = {
                runId: normalized.runId,
                agentName: normalized.agentName,
                status: 'running',
                createdAt: timestamp,
                updatedAt: timestamp,
                contents: [],
                events: []
            };
            this.snapshots.set(normalized.runId, snapshot);
        }

        snapshot.agentName = normalized.agentName || snapshot.agentName;
        snapshot.updatedAt = timestamp;
        snapshot.events.push(normalized);

        if (normalized.type === 'run_completed') {
            snapshot.status = 'completed';
        } else if (normalized.type === 'run_failed') {
            snapshot.status = 'failed';
        } else if (normalized.type === 'run_cancelled') {
            snapshot.status = 'cancelled';
        }

        this.notify(normalized, snapshot);
        if (normalized.type.startsWith('run_')) {
            this.enqueuePersist(normalized.runId);
        }
    }

    appendContent(runId: string, content: Content): void {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return;
        }
        const now = Date.now();
        snapshot.contents.push({
            ...content,
            timestamp: content.timestamp || now,
            index: snapshot.contents.length
        } as Content);
        snapshot.updatedAt = now;

        const event: SubAgentRunEvent = {
            runId,
            agentName: snapshot.agentName,
            type: 'content_snapshot',
            timestamp: now,
            payload: { contents: snapshot.contents }
        };
        snapshot.events.push(event);
        this.notify(event, snapshot);
        this.enqueuePersist(runId);
    }

    updateLastModelContent(runId: string, content: Content): void {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return;
        }
        const lastIndex = snapshot.contents.length - 1;
        if (lastIndex >= 0 && snapshot.contents[lastIndex]?.role === 'model') {
            snapshot.contents[lastIndex] = {
                ...content,
                timestamp: content.timestamp || snapshot.contents[lastIndex].timestamp || Date.now(),
                index: snapshot.contents[lastIndex].index ?? lastIndex
            } as Content;
        } else {
            this.appendContent(runId, content);
            return;
        }

        const now = Date.now();
        snapshot.updatedAt = now;
        const event: SubAgentRunEvent = {
            runId,
            agentName: snapshot.agentName,
            type: 'content_snapshot',
            timestamp: now,
            payload: { contents: snapshot.contents }
        };
        snapshot.events.push(event);
        this.notify(event, snapshot);
    }

    subscribe(listener: SubAgentRunListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getSnapshot(runId: string): SubAgentRunSnapshot | undefined {
        return this.snapshots.get(runId);
    }

    getSnapshots(): SubAgentRunSnapshot[] {
        return Array.from(this.snapshots.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async loadConversationSnapshots(
        conversationId: string,
        store: SubAgentRunConversationStore
    ): Promise<SubAgentRunSnapshot[]> {
        const raw = await store.getCustomMetadata(conversationId, SUBAGENT_RUNS_METADATA_KEY);
        const persistedMap = normalizePersistedMap(raw);
        const snapshots: SubAgentRunSnapshot[] = [];

        for (const record of Object.values(persistedMap)) {
            const existing = this.snapshots.get(record.runId);
            if (existing) {
                snapshots.push(existing);
                continue;
            }
            const snapshot: SubAgentRunSnapshot = {
                ...record,
                events: [],
                conversationId
            };
            this.snapshots.set(record.runId, snapshot);
            this.stores.set(record.runId, store);
            snapshots.push(snapshot);
        }

        return snapshots.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    private notify(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): void {
        for (const listener of this.listeners) {
            listener(event, snapshot);
        }
    }

    private enqueuePersist(runId: string): void {
        const snapshot = this.snapshots.get(runId);
        const store = this.stores.get(runId);
        if (!snapshot?.conversationId || !store) {
            return;
        }

        const previous = this.persistQueues.get(runId) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                const raw = await store.getCustomMetadata(snapshot.conversationId!, SUBAGENT_RUNS_METADATA_KEY);
                const persistedMap = normalizePersistedMap(raw);
                const record: SubAgentRunPersistedRecord = {
                    runId: snapshot.runId,
                    agentName: snapshot.agentName,
                    status: snapshot.status,
                    createdAt: snapshot.createdAt,
                    updatedAt: snapshot.updatedAt,
                    contents: snapshot.contents
                };
                persistedMap[runId] = record;
                await store.setCustomMetadata(snapshot.conversationId!, SUBAGENT_RUNS_METADATA_KEY, persistedMap);
            })
            .catch(error => {
                console.warn('[SubAgentRunEventBus] Failed to persist SubAgent run:', error);
            });

        this.persistQueues.set(runId, next);
    }
}

export const subAgentRunEventBus = new SubAgentRunEventBus();
