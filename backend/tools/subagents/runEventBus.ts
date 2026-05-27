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

/**
 * SubAgent run 的显式状态机。
 *
 * 修改原因：原有 running/completed/failed/cancelled 无法区分 Monitor 暂停、等待用户处理和扩展重载中断。
 * 修改方式：增加 paused、awaiting_monitor_action、interrupted，并作为持久快照的唯一状态类型。
 * 修改目的：让 UI 控制按钮、主工具等待语义和历史 run 展示不再混用 failed/cancelled。
 */
export type SubAgentRunStatus = 'running' | 'paused' | 'awaiting_monitor_action' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface SubAgentRunPersistedRecord {
    runId: string;
    agentName?: string;
    status: SubAgentRunStatus;
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
        } else if (normalized.type === 'run_paused') {
            // 修改原因：Monitor 中止不能被记录成 failed，否则主窗口工具会误判 SubAgent 已经失败。
            // 修改方式：运行事件总线将 run_paused 映射为 paused 状态。
            // 修改目的：保留主工具等待语义，同时让 Monitor 明确显示“已暂停”。
            snapshot.status = 'paused';
        } else if (normalized.type === 'run_resumed') {
            snapshot.status = 'running';
        } else if (normalized.type === 'run_awaiting_monitor_action') {
            snapshot.status = 'awaiting_monitor_action';
        } else if (normalized.type === 'run_interrupted') {
            snapshot.status = 'interrupted';
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

    replaceContents(runId: string, contents: Content[]): SubAgentRunSnapshot | undefined {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return undefined;
        }

        // 修改原因：Monitor 删除/重试内部楼层后，新的 Content[] 必须写回 run 快照和 conversation metadata。
        // 修改方式：由事件总线提供 replaceContents 作为唯一写入口，统一更新时间、通知前端和入队持久化。
        // 修改目的：避免 SubAgentsHandlers 直接改 snapshot.contents，保证内存和持久化记录同步。
        const now = Date.now();
        snapshot.contents = contents.map((content, index) => ({
            ...content,
            index,
            timestamp: content.timestamp || now
        } as Content));
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
        return snapshot;
    }

    mutateContents(runId: string, mutator: (contents: Content[]) => Content[]): SubAgentRunSnapshot | undefined {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return undefined;
        }

        // 修改原因：SubAgent 子对话要复用 TranscriptMutation 这类纯变更函数，同时由事件总线负责保存结果。
        // 修改方式：复制当前 contents 后交给 mutator，再通过 replaceContents 统一落盘和广播。
        // 修改目的：让 Monitor 消息操作不绕过事件总线的持久化队列。
        const nextContents = mutator(JSON.parse(JSON.stringify(snapshot.contents || [])) as Content[]);
        return this.replaceContents(runId, nextContents);
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
